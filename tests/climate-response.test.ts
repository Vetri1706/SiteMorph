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

test("reports masked Sun coverage against the full in-site target domain", () => {
  const response = buildClimateResponse({
    climate,
    siteBoundary: [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]],
    sun: {
      grid: new Float32Array([0, Number.NaN, 12, 6]),
      mask: new Uint8Array([1, 0, 1, 1]),
      width: 2,
      height: 2,
      x0: 0,
      y0: 2,
      resolution: 1,
    },
  });

  assert.equal(response.grid.grid.length, 4);
  assert.deepEqual(Array.from(response.grid.mask), [1, 0, 1, 1]);
  assert.equal(response.summary.inputs.find((input) => input.id === "forma-sun")?.coveragePercent, 75);
});

test("uses valid Wind cells where the target Sun grid is masked", () => {
  const response = buildClimateResponse({
    climate,
    siteBoundary: [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]],
    sun: {
      grid: new Float32Array([0, Number.NaN, 12, 6]),
      mask: new Uint8Array([1, 0, 1, 1]),
      width: 2,
      height: 2,
      x0: 0,
      y0: 2,
      resolution: 1,
    },
    wind: {
      grid: new Float32Array([1, 2, 3, 4]),
      mask: new Uint8Array([1, 1, 1, 1]),
      width: 2,
      height: 2,
      x0: 0,
      y0: 2,
      resolution: 1,
    },
  });

  assert.deepEqual(Array.from(response.grid.mask), [1, 1, 1, 1]);
  assert.equal(response.summary.inputs.find((input) => input.id === "forma-sun")?.coveragePercent, 75);
  assert.equal(response.summary.inputs.find((input) => input.id === "forma-wind")?.coveragePercent, 100);
});

test("rejects an undecoded raw Uint8 Sun grid", () => {
  assert.throws(() => buildClimateResponse({
    climate,
    siteBoundary: [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]],
    sun: { grid: new Uint8Array([6]), width: 1, height: 1, x0: 0, y0: 1, resolution: 1 },
  }), /must be decoded to exposure hours/);
});

test("rejects a decoded Sun grid containing 25.5 daily hours", () => {
  assert.throws(() => buildClimateResponse({
    climate,
    siteBoundary: [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]],
    sun: { grid: new Float32Array([25.5]), width: 1, height: 1, x0: 0, y0: 1, resolution: 1 },
  }), /implausible daily Sun value \(25\.50 h\)/);
});
