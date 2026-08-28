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

function hostedEnv(cache) {
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
  };
}

function installFortyGuardMock() {
  const original = globalThis.fetch;
  const submissions = [];
  const activities = new Map();
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.pathname.endsWith("/heatmap") && init.method === "POST") {
      const body = JSON.parse(String(init.body));
      const activityId = `activity-${submissions.length + 1}`;
      submissions.push(body);
      activities.set(activityId, body);
      return Response.json({ data: { activity_id: activityId } });
    }
    if (url.pathname.includes("/status/")) {
      const activityId = decodeURIComponent(url.pathname.split("/").at(-1));
      const body = activities.get(activityId);
      assert.ok(body, `unknown activity ${activityId}`);
      const analytic = body.analytic_type;
      const value = analytic === "persistence" ? 18 : analytic === "exceedance" ? 19 : analytic === "time_of_measure" ? 6 : undefined;
      const properties = analytic === "tcm"
        ? { average_temperature: 37.5, max_temperature: 42.5, min_temperature: 28.7 }
        : { value };
      const map_data = {
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          properties,
          geometry: {
            type: "Polygon",
            coordinates: [[[-112.1, 33.4], [-112.099, 33.4], [-112.099, 33.401], [-112.1, 33.401], [-112.1, 33.4]]],
          },
        }],
      };
      return Response.json({ data: { status: "completed", result: { map_data, stats_data: {} } } });
    }
    throw new Error(`Unexpected upstream request: ${url}`);
  };
  return { submissions, restore: () => { globalThis.fetch = original; } };
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
