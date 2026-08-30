import assert from "node:assert/strict";
import test from "node:test";
import worker from "../dist/server/index.js";

class MemoryR2 {
  #objects = new Map();
  #revision = 0;

  async get(key) {
    const entry = this.#objects.get(key);
    if (!entry) return null;
    return { etag: entry.etag, text: async () => entry.value };
  }

  async put(key, value, options = {}) {
    const existing = this.#objects.get(key);
    const condition = options.onlyIf ?? {};
    if (condition.etagDoesNotMatch === "*" && existing) return null;
    if (condition.etagMatches && existing?.etag !== condition.etagMatches) return null;
    const text = typeof value === "string" ? value : new TextDecoder().decode(value);
    const etag = `etag-${++this.#revision}`;
    this.#objects.set(key, { value: text, etag });
    return { etag };
  }

  async delete(key) {
    this.#objects.delete(key);
  }

  jsonValuesContaining(fragment) {
    return [...this.#objects.entries()]
      .filter(([key]) => key.includes(fragment) && !key.endsWith(".tmp"))
      .map(([, entry]) => JSON.parse(entry.value));
  }
}

function polygon(longitude = -112.1) {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [[
        [longitude, 33.4],
        [longitude + 0.004, 33.4],
        [longitude + 0.004, 33.403],
        [longitude, 33.403],
        [longitude, 33.4],
      ]],
    },
  };
}

function requestFor(geometry, cacheOnly) {
  return new Request("https://example.test/api/site/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "https://example.test",
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify({ geometry, thresholdCelsius: 35, siteTimezone: "America/Phoenix", cacheOnly }),
  });
}

function hostedEnv(cache, overrides = {}) {
  return {
    ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
    CACHE: cache,
    FORTYGUARD_API_KEY: "test-key-not-a-secret",
    FORTYGUARD_API_URL: "https://fortyguard.test/v1",
    FORTYGUARD_ANALYSIS_DATES: "2023-07-15,2024-07-15,2025-07-15",
    FORTYGUARD_GRANULARITY: "60",
    FORTYGUARD_MAX_POLL_ATTEMPTS: "2",
    FORTYGUARD_POLL_INTERVAL_MS: "1",
    FORTYGUARD_CACHE_VERSION: "hosted-test-v1",
    SITEMORPH_HOSTED_ACTIVITY_BUDGET: "12",
    ...overrides,
  };
}

function installFortyGuardMock(options = {}) {
  const original = globalThis.fetch;
  let statusMode = options.statusMode ?? "completed";
  const submissions = [];
  const submissionKeys = [];
  const attemptedSubmissionKeys = [];
  const statusKeys = [];
  const activities = new Map();
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.pathname.endsWith("/heatmap") && init.method === "POST") {
      const body = JSON.parse(String(init.body));
      const apiKey = new Headers(init.headers).get("api-key");
      attemptedSubmissionKeys.push(apiKey);
      const intercepted = options.interceptSubmission?.({ apiKey, body });
      if (intercepted) return intercepted;
      const activityId = `activity-${submissions.length + 1}`;
      submissions.push(body);
      submissionKeys.push(apiKey);
      activities.set(activityId, { body, apiKey });
      return Response.json({ data: { activity_id: activityId } });
    }
    if (url.pathname.includes("/status/")) {
      const activityId = decodeURIComponent(url.pathname.split("/").at(-1));
      const activity = activities.get(activityId);
      assert.ok(activity, `unknown activity ${activityId}`);
      const statusKey = new Headers(init.headers).get("api-key");
      statusKeys.push(statusKey);
      if (options.enforceActivityKeyOwnership && statusKey !== activity.apiKey) {
        return Response.json({ message: "Activity not found for this credential" }, { status: 404 });
      }
      if (statusMode === "network-error") throw new Error("simulated status connection reset");
      if (statusMode === "running") return Response.json({ data: { status: "running" } });
      const body = activity.body;
      const analytic = body.analytic_type;
      const value = analytic === "persistence" ? 18 : analytic === "exceedance" ? 19 : analytic === "time_of_measure" ? 6 : undefined;
      const properties = analytic === "tcm"
        ? { average_temperature: 37.5, max_temperature: 42.5, min_temperature: 28.7 }
        : { value };
      const polygonCoordinates = [[[-112.1, 33.4], [-112.099, 33.4], [-112.099, 33.401], [-112.1, 33.401], [-112.1, 33.4]]];
      const features = options.mapDataMode === "empty"
        ? []
        : [{
          type: "Feature",
          properties,
          geometry: options.mapDataMode === "multi-polygon"
            ? { type: "MultiPolygon", coordinates: [polygonCoordinates] }
            : { type: "Polygon", coordinates: polygonCoordinates },
        }];
      const map_data = {
        type: "FeatureCollection",
        features,
      };
      return Response.json({ data: { status: "completed", result: { map_data, stats_data: {} } } });
    }
    throw new Error(`Unexpected upstream request: ${url}`);
  };
  return {
    submissions,
    submissionKeys,
    attemptedSubmissionKeys,
    statusKeys,
    setStatusMode: (value) => { statusMode = value; },
    restore: () => { globalThis.fetch = original; },
  };
}

test("cache-only hosted misses never contact FortyGuard", async () => {
  const cache = new MemoryR2();
  const mock = installFortyGuardMock();
  try {
    const response = await worker.fetch(requestFor(polygon(), true), hostedEnv(cache));
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, "SAVED_ANALYSIS_MISSING");
    assert.equal(mock.submissions.length, 0);
  } finally {
    mock.restore();
  }
});

test("one approved hosted AOI creates exactly 12 activities, persists, and exhausts the lifetime allowance", async () => {
  const cache = new MemoryR2();
  const env = hostedEnv(cache);
  const mock = installFortyGuardMock();
  try {
    const first = await worker.fetch(requestFor(polygon(), false), env);
    assert.equal(first.status, 200, await first.clone().text());
    const firstPayload = await first.json();
    assert.equal(firstPayload.cache.source, "live");
    assert.equal(firstPayload.cache.persisted, true);
    assert.equal(firstPayload.climateDNA.designBrief.thermalZoningConfidence, "LOW");
    assert.equal(mock.submissions.length, 12);
    assert.deepEqual([...new Set(mock.submissions.map((body) => body.analytic_type))].sort(), ["exceedance", "persistence", "tcm", "time_of_measure"]);

    const restored = await worker.fetch(requestFor(polygon(), false), env);
    assert.equal(restored.status, 200);
    assert.equal((await restored.json()).cache.source, "memory");
    assert.equal(mock.submissions.length, 12);

    const blocked = await worker.fetch(requestFor(polygon(-112.2), false), env);
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json()).code, "HOSTED_ACTIVITY_BUDGET_EXHAUSTED");
    assert.equal(mock.submissions.length, 12);
  } finally {
    mock.restore();
  }
});

test("pending saved activities are swept once per request and never resubmitted", async () => {
  const cache = new MemoryR2();
  const env = hostedEnv(cache);
  const mock = installFortyGuardMock({ statusMode: "running" });
  try {
    const first = await worker.fetch(requestFor(polygon(-112.15), false), env);
    assert.equal(first.status, 409, await first.clone().text());
    assert.equal((await first.json()).code, "JOB_PENDING");
    assert.equal(mock.submissions.length, 12);
    assert.equal(mock.statusKeys.length, 12);

    const retry = await worker.fetch(requestFor(polygon(-112.15), true), env);
    assert.equal(retry.status, 409, await retry.clone().text());
    assert.equal((await retry.json()).code, "JOB_PENDING");
    assert.equal(mock.submissions.length, 12);
    assert.equal(mock.statusKeys.length, 24);

    mock.setStatusMode("completed");
    const completed = await worker.fetch(requestFor(polygon(-112.15), true), env);
    assert.equal(completed.status, 200, await completed.clone().text());
    assert.equal((await completed.json()).cache.source, "live");
    assert.equal(mock.submissions.length, 12);
    assert.equal(mock.statusKeys.length, 36);
  } finally {
    mock.restore();
  }
});

test("completed activities with zero cells become terminal coverage gaps and are never resubmitted", async () => {
  const cache = new MemoryR2();
  const env = hostedEnv(cache);
  const mock = installFortyGuardMock({ mapDataMode: "empty" });
  try {
    const first = await worker.fetch(requestFor(polygon(-112.155), false), env);
    assert.equal(first.status, 422, await first.clone().text());
    const firstPayload = await first.json();
    assert.equal(firstPayload.code, "NO_THERMAL_COVERAGE");
    assert.match(firstPayload.error, /no thermal cells/i);
    assert.equal(mock.submissions.length, 12);
    assert.equal(mock.statusKeys.length, 12);
    const activityRecords = cache.jsonValuesContaining("fortyguard-activities");
    assert.equal(activityRecords.length, 12);
    assert.ok(activityRecords.every((entry) => entry.status === "unavailable"));
    assert.ok(activityRecords.every((entry) => entry.code === "NO_THERMAL_COVERAGE"));
    assert.ok(activityRecords.every((entry) => entry.diagnostics?.featureCount === 0));

    const retry = await worker.fetch(requestFor(polygon(-112.155), true), env);
    assert.equal(retry.status, 422, await retry.clone().text());
    assert.equal((await retry.json()).code, "NO_THERMAL_COVERAGE");
    assert.equal(mock.submissions.length, 12);
    assert.equal(mock.statusKeys.length, 12);
  } finally {
    mock.restore();
  }
});

test("valid MultiPolygon heatmap tiles are normalized without discarding provider data", async () => {
  const cache = new MemoryR2();
  const mock = installFortyGuardMock({ mapDataMode: "multi-polygon" });
  try {
    const response = await worker.fetch(requestFor(polygon(-112.157), false), hostedEnv(cache));
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).cache.source, "live");
    assert.equal(mock.submissions.length, 12);
  } finally {
    mock.restore();
  }
});

test("a transient status-network failure keeps every saved activity resumable", async () => {
  const cache = new MemoryR2();
  const mock = installFortyGuardMock({ statusMode: "network-error" });
  try {
    const response = await worker.fetch(requestFor(polygon(-112.16), false), hostedEnv(cache));
    assert.equal(response.status, 409, await response.clone().text());
    assert.equal((await response.json()).code, "JOB_PENDING");
    assert.equal(mock.submissions.length, 12);
    assert.equal(mock.statusKeys.length, 12);
    assert.equal(cache.jsonValuesContaining("fortyguard-activities").length, 12);
  } finally {
    mock.restore();
  }
});

test("invalid hosted geometry is rejected before quota or provider traffic", async () => {
  const cache = new MemoryR2();
  const mock = installFortyGuardMock();
  try {
    const response = await worker.fetch(requestFor({ type: "Feature", geometry: { type: "Polygon", coordinates: [[]] } }, false), hostedEnv(cache));
    assert.equal(response.status, 422);
    assert.equal(mock.submissions.length, 0);
  } finally {
    mock.restore();
  }
});

test("two uncached AOIs racing for the final allowance cannot exceed 12 provider submissions", async () => {
  const cache = new MemoryR2();
  const env = hostedEnv(cache);
  const mock = installFortyGuardMock();
  try {
    const responses = await Promise.all([
      worker.fetch(requestFor(polygon(-112.3), false), env),
      worker.fetch(requestFor(polygon(-112.4), false), env),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 429]);
    assert.equal(mock.submissions.length, 12);
  } finally {
    mock.restore();
  }
});

test("bad-origin and public usage requests create no FortyGuard traffic", async () => {
  const cache = new MemoryR2();
  const env = hostedEnv(cache);
  const mock = installFortyGuardMock();
  try {
    const badOrigin = new Request("https://example.test/api/site/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Origin": "https://attacker.test", "Sec-Fetch-Site": "cross-site" },
      body: JSON.stringify({ geometry: polygon(), cacheOnly: false }),
    });
    assert.equal((await worker.fetch(badOrigin, env)).status, 403);
    const usage = new Request("https://example.test/api/fortyguard/usage", { headers: { "Origin": "https://example.test" } });
    assert.equal((await worker.fetch(usage, env)).status, 503);
    assert.equal(mock.submissions.length, 0);
  } finally {
    mock.restore();
  }
});

test("a definitively exhausted primary key rolls over to the first fallback without expanding the activity budget", async () => {
  const cache = new MemoryR2();
  const env = hostedEnv(cache, { FORTYGUARD_FALLBACK_API_KEYS: "fallback-one,fallback-two" });
  const mock = installFortyGuardMock({
    enforceActivityKeyOwnership: true,
    interceptSubmission: ({ apiKey }) => apiKey === "test-key-not-a-secret"
      ? Response.json({ message: "Credit balance exhausted" }, { status: 403 })
      : undefined,
  });
  try {
    const response = await worker.fetch(requestFor(polygon(-112.5), false), env);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(mock.submissions.length, 12);
    assert.ok(mock.attemptedSubmissionKeys.includes("test-key-not-a-secret"));
    assert.deepEqual([...new Set(mock.submissionKeys)], ["fallback-one"]);
    assert.deepEqual([...new Set(mock.statusKeys)], ["fallback-one"]);
    assert.ok(!mock.attemptedSubmissionKeys.includes("fallback-two"));
    const activityRecords = cache.jsonValuesContaining("fortyguard-activities");
    assert.equal(activityRecords.length, 12);
    assert.ok(activityRecords.every((entry) => entry.credentialSlot === 1));

    const blocked = await worker.fetch(requestFor(polygon(-112.6), false), env);
    assert.equal(blocked.status, 429);
    assert.equal(mock.submissions.length, 12);
  } finally {
    mock.restore();
  }
});

test("definitive exhaustion advances through both ordered fallbacks and stops at the first usable key", async () => {
  const cache = new MemoryR2();
  const env = hostedEnv(cache, { FORTYGUARD_FALLBACK_API_KEYS: "ordered-fallback-one,ordered-fallback-two" });
  const mock = installFortyGuardMock({
    enforceActivityKeyOwnership: true,
    interceptSubmission: ({ apiKey }) => ["test-key-not-a-secret", "ordered-fallback-one"].includes(apiKey)
      ? Response.json({ message: "Credit balance exhausted" }, { status: 403 })
      : undefined,
  });
  try {
    const response = await worker.fetch(requestFor(polygon(-112.51), false), env);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(mock.submissions.length, 12);
    assert.ok(mock.attemptedSubmissionKeys.includes("test-key-not-a-secret"));
    assert.ok(mock.attemptedSubmissionKeys.includes("ordered-fallback-one"));
    assert.deepEqual([...new Set(mock.submissionKeys)], ["ordered-fallback-two"]);
    assert.deepEqual([...new Set(mock.statusKeys)], ["ordered-fallback-two"]);
    assert.ok(cache.jsonValuesContaining("fortyguard-activities").every((entry) => entry.credentialSlot === 2));
  } finally {
    mock.restore();
  }
});

test("a generic provider denial does not rotate credentials", async () => {
  const cache = new MemoryR2();
  const env = hostedEnv(cache, { FORTYGUARD_FALLBACK_API_KEYS: "generic-fallback-one,generic-fallback-two" });
  const mock = installFortyGuardMock({
    interceptSubmission: () => Response.json({ message: "Site geometry is outside supported coverage for api-key test-key-not-a-secret" }, { status: 403 }),
  });
  try {
    const response = await worker.fetch(requestFor(polygon(-112.7), false), env);
    assert.equal(response.status, 502);
    const responseText = await response.text();
    assert.ok(!responseText.includes("test-key-not-a-secret"));
    assert.ok(!responseText.includes("generic-fallback-one"));
    assert.equal(mock.submissions.length, 0);
    assert.ok(mock.attemptedSubmissionKeys.length > 0);
    assert.deepEqual([...new Set(mock.attemptedSubmissionKeys)], ["test-key-not-a-secret"]);
  } finally {
    mock.restore();
  }
});

test("an ambiguous provider network failure never advances to a fallback key", async () => {
  const cache = new MemoryR2();
  const env = hostedEnv(cache, { FORTYGUARD_FALLBACK_API_KEYS: "network-fallback-one,network-fallback-two" });
  const mock = installFortyGuardMock({
    interceptSubmission: () => {
      throw new Error("simulated connection reset for network-fallback-one");
    },
  });
  try {
    const response = await worker.fetch(requestFor(polygon(-112.8), false), env);
    assert.equal(response.status, 502);
    assert.ok(!(await response.text()).includes("network-fallback-one"));
    assert.equal(mock.submissions.length, 0);
    assert.ok(mock.attemptedSubmissionKeys.length > 0);
    assert.deepEqual([...new Set(mock.attemptedSubmissionKeys)], ["test-key-not-a-secret"]);
  } finally {
    mock.restore();
  }
});

test("a temporary API-key usage rate limit does not trigger paid-key failover", async () => {
  const cache = new MemoryR2();
  const env = hostedEnv(cache, { FORTYGUARD_FALLBACK_API_KEYS: "rate-fallback-one,rate-fallback-two" });
  const mock = installFortyGuardMock({
    interceptSubmission: () => Response.json({ message: "API key usage limit exceeded; retry later" }, { status: 429 }),
  });
  try {
    const response = await worker.fetch(requestFor(polygon(-112.9), false), env);
    assert.equal(response.status, 429);
    assert.equal(mock.submissions.length, 0);
    assert.ok(mock.attemptedSubmissionKeys.length > 0);
    assert.deepEqual([...new Set(mock.attemptedSubmissionKeys)], ["test-key-not-a-secret"]);
  } finally {
    mock.restore();
  }
});
