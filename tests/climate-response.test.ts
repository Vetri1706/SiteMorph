import assert from "node:assert/strict";
import test from "node:test";

import type { ClimateDNA } from "../src/types/index.ts";
import { buildClimateResponse, historicalHeatBurden } from "../src/utils/climate-response.ts";

const climate = {
  profile: { thermalExposure: "HIGH", persistence: "HIGH" },
  thermal: {
    meanCelsius: 37.5,
    maxCelsius: 42.5,
    minCelsius: 28.7,
    peakThermalHour: "11:00 PM MST",
    thresholdCelsius: 35,
    hoursAboveThreshold: 19,
    longestPersistenceHours: 24,
    meanPersistenceHours: 18,
    hotZonePercent: 0,
    coolZonePercent: 0,
  },
} as ClimateDNA;

test("keeps the FortyGuard burden site-wide while spatial variation comes from Forma grids", () => {
  const response = buildClimateResponse({
    climate,
    siteBoundary: [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]],
    sun: { grid: new Float32Array([0, 6, 12, 6]), width: 2, height: 2, x0: 0, y0: 2, resolution: 1, analysisId: "sun-1" },
    wind: { grid: new Float32Array([0, 1, 4, 2]), width: 2, height: 2, x0: 0, y0: 2, resolution: 1 },
  });

  assert.equal(response.summary.status, "complete");
  assert.equal(response.summary.resolutionMeters, 1);
  assert.equal(response.summary.inputs.length, 3);
  assert.equal(response.summary.inputs[0].coveragePercent, 100);
  assert.equal(response.summary.inputs[1].analysisId, "sun-1");
  assert.ok(response.summary.maximumRiskScore > response.summary.meanRiskScore);
  assert.equal(new Set(Array.from(response.grid.grid)).size, 4);
});

test("labels the result partial and renormalizes instead of inventing a missing Wind grid", () => {
  const response = buildClimateResponse({
    climate,
    siteBoundary: [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]],
    sun: { grid: new Float32Array([6, 6, 6, 6]), width: 2, height: 2, x0: 0, y0: 2, resolution: 1 },
  });

  assert.equal(response.summary.status, "partial");
  assert.match(response.summary.note, /Wind grid unavailable/);
  assert.equal(response.summary.inputs.some((input) => input.id === "forma-wind"), false);
  assert.equal(new Set(Array.from(response.grid.grid)).size, 1);
  assert.equal(response.summary.historicalBaselineScore, Number((historicalHeatBurden(climate) * 100).toFixed(1)));
});
