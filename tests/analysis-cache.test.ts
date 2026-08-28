import assert from "node:assert/strict";
import test from "node:test";

import type { Feature, Polygon } from "geojson";
import { activityCacheKey, analysisCacheKey } from "../server/cache-key.ts";

const geometry = (coordinates: number[][]): Feature<Polygon> => ({
  type: "Feature",
  properties: {},
  geometry: { type: "Polygon", coordinates: [[...coordinates, coordinates[0]]] },
});

const config = {
  apiKey: "not-used",
  baseUrl: "https://example.invalid",
  analysisDates: ["2024-07-15"],
  granularity: 60 as const,
  pollIntervalMs: 1,
  maxPollAttempts: 1,
  cacheVersion: "v1",
};

test("uses the same cache key when the same AOI starts at another vertex or reverses direction", () => {
  const points = [[-112.08, 33.4], [-112.07, 33.4], [-112.07, 33.41], [-112.08, 33.41]];
  const rotated = [points[2], points[3], points[0], points[1]];
  const reversed = [...points].reverse();
  const first = analysisCacheKey({ geometry: geometry(points), thresholdCelsius: 35, siteTimezone: "America/Phoenix" }, config);
  assert.equal(analysisCacheKey({ geometry: geometry(rotated), thresholdCelsius: 35, siteTimezone: "America/Phoenix" }, config), first);
  assert.equal(analysisCacheKey({ geometry: geometry(reversed), thresholdCelsius: 35, siteTimezone: "America/Phoenix" }, config), first);
});

test("changes the key when a billable analysis parameter changes", () => {
  const points = [[-112.08, 33.4], [-112.07, 33.4], [-112.07, 33.41], [-112.08, 33.41]];
  const base = analysisCacheKey({ geometry: geometry(points), thresholdCelsius: 35, siteTimezone: "America/Phoenix" }, config);
  assert.notEqual(analysisCacheKey({ geometry: geometry(points), thresholdCelsius: 36, siteTimezone: "America/Phoenix" }, config), base);
});

test("reuses a paid activity across equivalent AOI ring orderings", () => {
  const points = [[-112.08, 33.4], [-112.07, 33.4], [-112.07, 33.41], [-112.08, 33.41]];
  const rotated = [points[1], points[2], points[3], points[0]];
  const parameters = { analysisDate: "2024-07-15", granularity: 60, thresholdCelsius: 35 };
  const first = activityCacheKey(geometry(points), "heatmap:persistence", parameters, "v1");
  assert.equal(activityCacheKey(geometry(rotated), "heatmap:persistence", parameters, "v1"), first);
});

test("never aliases different paid activity types or dates", () => {
  const points = [[-112.08, 33.4], [-112.07, 33.4], [-112.07, 33.41], [-112.08, 33.41]];
  const site = geometry(points);
  const july = activityCacheKey(site, "heatmap:tcm", { analysisDate: "2024-07-15", granularity: 60 }, "v1");
  assert.notEqual(activityCacheKey(site, "heatmap:persistence", { analysisDate: "2024-07-15", granularity: 60 }, "v1"), july);
  assert.notEqual(activityCacheKey(site, "heatmap:tcm", { analysisDate: "2025-07-15", granularity: 60 }, "v1"), july);
});
