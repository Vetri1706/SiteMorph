import assert from "node:assert/strict";
import test from "node:test";

import { createSubdivisionOverlaySpec } from "../src/services/forma-subdivision-overlay.service.ts";
import type { SiteGeometry } from "../src/types/index.ts";
import type { SubdivisionVariant } from "../src/types/subdivision.ts";

function geometry(boundary: Array<[number, number]>): SiteGeometry {
  return {
    elementPath: "site-limit/overlay-test",
    pointCount: boundary.length,
    localBoundary: boundary,
    centroid: { longitude: 0, latitude: 0 },
    bounds: { north: 0, east: 0, south: 0, west: 0 },
    geojson: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[]] } },
  };
}

function variant(overrides: Partial<SubdivisionVariant> = {}): SubdivisionVariant {
  return {
    id: "balanced-test",
    strategy: "balanced-neighborhood",
    label: "Balanced neighborhood",
    rank: 1,
    axis: { origin: [0, 0], vector: [1, 0], angleDegrees: 0, basis: "Forma Site Limit dominant axis" },
    lots: [],
    dwellings: [],
    dwellingGroups: [],
    roads: [{
      id: "access-road",
      kind: "access-road",
      label: "Concept access road",
      polygon: [[20, 20], [90, 20], [90, 30], [20, 30], [20, 20]],
      centerline: [[20, 25], [90, 25]],
      widthMeters: 10,
      shaded: false,
    }],
    trees: [],
    openSpaces: [],
    metrics: {
      siteAreaSqFt: 1,
      subdivisionLotAreaSqFt: 1,
      roadAndPathAreaSqFt: 1,
      dwellingFootprintAreaSqFt: 1,
      totalDwellingGfaSqFt: 1,
      averageLotAreaSqFt: 1,
      averageDwellingGfaSqFt: 1,
      lotCount: 1,
      dwellingCount: 1,
      landEfficiencyPercent: 1,
      openLandPercent: 1,
      parkingProvision: 40.6,
      treeCount: 0,
      estimatedCanopyCoveragePercent: 0,
    },
    climatePerformance: {
      source: "FortyGuard × SiteMorph plan mitigation",
      historicalBurdenScore: 1,
      mitigationMultiplier: 1,
      residualHeatRiskScore: 1,
      resilienceScore: 1,
      formula: "test",
      factors: [],
      spatialTreatment: "site-wide",
      directionalClaim: null,
    },
    scoreBreakdown: { totalScore: 1, climateWeightPercent: 50, formula: "test", components: [] },
    assumptions: [],
    warnings: [],
    provenance: [],
    ...overrides,
  };
}

test("produces a deterministic clipped-canvas specification and nearest access marker", () => {
  const boundary: Array<[number, number]> = [[0, 0], [100, 0], [100, 50], [0, 50], [0, 0]];
  const spec = createSubdivisionOverlaySpec(geometry(boundary), variant());
  assert.equal(spec.metersPerPixel, 0.12);
  assert.equal(spec.width, 834);
  assert.equal(spec.height, 417);
  assert.deepEqual(spec.accessPoint, [90, 25]);
  assert.equal(spec.parkingProvision, 41);
  assert.ok(spec.northAnchor[0] >= 0 && spec.northAnchor[0] <= 100);
  assert.ok(spec.northAnchor[1] >= 0 && spec.northAnchor[1] <= 50);
});

test("caps the longest texture axis at 1280 pixels for large Site Limits", () => {
  const boundary: Array<[number, number]> = [[0, 0], [2000, 0], [2000, 1000], [0, 1000], [0, 0]];
  const spec = createSubdivisionOverlaySpec(geometry(boundary), variant({ roads: [] }));
  assert.equal(spec.metersPerPixel, 1.5625);
  assert.equal(spec.width, 1280);
  assert.equal(spec.height, 640);
  assert.equal(spec.accessPoint, null);
});

test("fails closed when Forma does not provide a valid selected Site Limit", () => {
  assert.throws(
    () => createSubdivisionOverlaySpec(geometry([]), variant()),
    /Site Limit boundary is unavailable/,
  );
});
