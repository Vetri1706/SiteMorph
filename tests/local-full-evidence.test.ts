import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function polygon() {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "Polygon" as const,
      coordinates: [[
        [-112.1, 33.4],
        [-112.096, 33.4],
        [-112.096, 33.403],
        [-112.1, 33.403],
        [-112.1, 33.4],
      ]],
    },
  };
}

class TestResponse {
  statusCode = 200;
  headers = new Map<string, string>();
  body = "";

  setHeader(name: string, value: string | number | readonly string[]): void {
    this.headers.set(name, Array.isArray(value) ? value.join(", ") : String(value));
  }

  end(value?: unknown): void {
    if (value !== undefined) this.body += String(value);
  }
}

async function invoke(
  middleware: ReturnType<(typeof import("../server/fortyguard.ts"))["createSiteAnalyzeMiddleware"]>,
  cacheOnly: boolean,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const body = JSON.stringify({ geometry: polygon(), thresholdCelsius: 35, siteTimezone: "America/Phoenix", cacheOnly });
  const request = {
    method: "POST",
    url: "/api/site/analyze",
    async *[Symbol.asyncIterator]() { yield body; },
  };
  const response = new TestResponse();
  let passedThrough = false;
  await middleware(request as never, response as never, () => { passedThrough = true; });
  assert.equal(passedThrough, false);
  return { status: response.statusCode, payload: JSON.parse(response.body) as Record<string, unknown> };
}

test("a complete local first run creates 12 thermal plus 3 enrichment activities and every rerun is saved", async () => {
  const originalDirectory = process.cwd();
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "sitemorph-full-evidence-"));
  const originalFetch = globalThis.fetch;
  try {
    process.chdir(temporaryDirectory);
    const serverUrl = new URL(`../server/fortyguard.ts?full-evidence=${Date.now()}`, import.meta.url);
    const { createSiteAnalyzeMiddleware } = await import(serverUrl.href);
    const submissions: Array<{ path: string; body: Record<string, unknown> }> = [];
    const activities = new Map<string, { path: string; body: Record<string, unknown> }>();
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (init.method === "POST" && ["/heatmap", "/env_params", "/satellite", "/streetview"].some((path) => url.pathname.endsWith(path))) {
        const path = `/${url.pathname.split("/").at(-1)}`;
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        const activityId = `activity-${submissions.length + 1}`;
        submissions.push({ path, body });
        activities.set(activityId, { path, body });
        return Response.json({ data: { activity_id: activityId } });
      }
      if (url.pathname.includes("/status/")) {
        const activityId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
        const activity = activities.get(activityId);
        assert.ok(activity, `unknown activity ${activityId}`);
        if (activity.path === "/heatmap") {
          const analyticType = String(activity.body.analytic_type);
          const properties = analyticType === "tcm"
            ? { average_temperature: 37.5, max_temperature: 42.5, min_temperature: 29 }
            : { value: analyticType === "time_of_measure" ? 6 : analyticType === "persistence" ? 18 : 12 };
          return Response.json({ data: { status: "completed", result: {
            map_data: { type: "FeatureCollection", features: [{ type: "Feature", properties, geometry: polygon().geometry }] },
            stats_data: { n_cells: 1 },
          } } });
        }
        const result = activity.path === "/env_params"
          ? { locations: [{ relative_humidity_percent: 24, heat_index_celsius: 39, ghi: 760 }] }
          : activity.path === "/satellite"
            ? {
                original_image: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
                image_year: 2025,
                segmentation: {
                  image_content: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAC",
                  segments: { tree: 10, vegetation: 8, grass: 4, building: 30, road: 20, pavement: 12 },
                },
              }
            : { front: { segments: { tree: 12, sky: 35, building: 28, road: 20, sidewalk: 5 } } };
        return Response.json({ data: { status: "completed", result } });
      }
      throw new Error(`Unexpected provider request: ${url.pathname}`);
    };

    const config = {
      apiKey: "primary-test-key",
      fallbackApiKeys: ["fallback-test-one", "fallback-test-two"],
      baseUrl: "https://fortyguard.test/v1",
      analysisDates: ["2023-07-15", "2024-07-15", "2025-07-15"],
      granularity: 60 as const,
      pollIntervalMs: 1,
      maxPollAttempts: 1,
      maxNewActivities: 15,
      includeOptionalEvidence: true,
      cacheVersion: "full-evidence-test-v1",
    };
    const middleware = createSiteAnalyzeMiddleware(config);
    const first = await invoke(middleware, false);
    assert.equal(first.status, 200);
    assert.equal(submissions.filter((submission) => submission.path === "/heatmap").length, 12);
    assert.deepEqual(submissions.slice(12).map((submission) => submission.path).sort(), ["/env_params", "/satellite", "/streetview"]);
    assert.equal(submissions.length, 15);
    const firstClimate = first.payload.climateDNA as {
      activityIds?: { environmental?: string; satellite?: string; street?: string };
      surface?: { originalImageDataUrl?: string; segmentedImageDataUrl?: string; imageYear?: number };
    };
    const optionalActivityIds = [
      firstClimate.activityIds?.environmental,
      firstClimate.activityIds?.satellite,
      firstClimate.activityIds?.street,
    ];
    assert.ok(optionalActivityIds.every((activityId) => /^activity-1[345]$/.test(activityId ?? "")));
    assert.equal(new Set(optionalActivityIds).size, 3);
    assert.equal(firstClimate.surface?.originalImageDataUrl, "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB");
    assert.equal(firstClimate.surface?.segmentedImageDataUrl, "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAC");
    assert.equal(firstClimate.surface?.imageYear, 2025);

    const directPaidRerun = await invoke(middleware, false);
    assert.equal(directPaidRerun.status, 200);
    assert.equal(submissions.length, 15);

    const restartedMiddleware = createSiteAnalyzeMiddleware(config);
    const restored = await invoke(restartedMiddleware, true);
    assert.equal(restored.status, 200);
    assert.equal((restored.payload.cache as { source?: string }).source, "persistent");
    assert.equal(submissions.length, 15);
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(originalDirectory);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
