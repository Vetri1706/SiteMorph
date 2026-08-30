import assert from "node:assert/strict";
import test from "node:test";

import type { ClimateDNA, SiteGeometry } from "../src/types/index.ts";
import type { SubdivisionBrief, SubdivisionPoint } from "../src/types/subdivision.ts";
import { generateSubdivisionLayouts } from "../src/utils/subdivision-layout.ts";
import { pointInPolygon } from "../src/utils/geometry-validation.ts";

const SQFT_PER_SQM = 10.7639104167;

const climate: ClimateDNA = {
  id: "south-phoenix-fortyguard",
  generatedAt: "2026-08-23T18:30:00.000Z",
  activityId: "saved-fortyguard",
  activityIds: {
    heat: [{ date: "2025-07-15", tcm: "tcm-1", persistence: "p-1", exceedance: "e-1", timeOfMeasure: "tom-1" }],
  },
  profile: { thermalExposure: "HIGH", persistence: "HIGH" },
  layers: [],
  thermal: {
    meanCelsius: 37.5,
    maxCelsius: 42.5,
    minCelsius: 28.7,
    peakThermalHour: "11:00 PM MST",
    peakThermalHourUtc: "06:00 UTC",
    thresholdCelsius: 35,
    hoursAboveThreshold: 18.7,
    longestPersistenceHours: 24,
    meanPersistenceHours: 18.3,
    hotZonePercent: 0,
    coolZonePercent: 0,
  },
  designBrief: {
    thermalZoningConfidence: "LOW",
    summary: "The parcel is thermally uniform at FortyGuard resolution.",
    priorities: [],
    siteWideConstraints: [],
    formaActions: [],
  },
  zones: [],
  constraints: [],
  provenance: {},
};

const brief: SubdivisionBrief = {
  schemaVersion: "sitemorph.subdivision-brief.v1",
  id: "south-phoenix-townhouses",
  name: "South Phoenix townhouse study",
  dwellingType: "townhouse",
  targetLotAreaSqFt: 3_229.17,
  minimumLotWidthFt: 32.81,
  dwellingGfaSqFt: 1_899,
  floors: 2,
  maxConnectedDwellings: 4,
  roadWidthFt: 19.69,
  pedestrianPathWidthFt: 4.92,
  setbacks: { frontFt: 6.56, sideFt: 1.64, rearFt: 9.84, sitePerimeterFt: 4.92 },
  openLandTargetPercent: 10,
  parkingSpacesPerDwelling: 2,
  treeCanopyTargetPercent: 18,
};

function rotate(point: SubdivisionPoint, angle: number, origin: SubdivisionPoint): SubdivisionPoint {
  return [
    origin[0] + point[0] * Math.cos(angle) - point[1] * Math.sin(angle),
    origin[1] + point[0] * Math.sin(angle) + point[1] * Math.cos(angle),
  ];
}

function polygonArea(points: SubdivisionPoint[]): number {
  const ring = points.length > 1 && points[0][0] === points.at(-1)?.[0] && points[0][1] === points.at(-1)?.[1]
    ? points.slice(0, -1)
    : points;
  return Math.abs(ring.reduce((total, [x, y], index) => {
    const next = ring[(index + 1) % ring.length];
    return total + x * next[1] - next[0] * y;
  }, 0)) / 2;
}

function southPhoenixGeometry(): SiteGeometry {
  const areaSqFt = 359_376;
  const height = areaSqFt / SQFT_PER_SQM / 220;
  const local: SubdivisionPoint[] = [
    [-115, -height / 2],
    [115, -height / 2],
    [105, height / 2],
    [-105, height / 2],
  ];
  const boundary = local.map((point) => rotate(point, Math.PI * 27 / 180, [520, 810]));
  return {
    elementPath: "proposal-1/site-limit/south-phoenix",
    pointCount: 5,
    localBoundary: [...boundary, boundary[0]],
    areaSqFt,
    areaAcres: areaSqFt / 43_560,
    centroid: { longitude: -112.07, latitude: 33.4 },
    bounds: { north: 33.41, east: -112.06, south: 33.39, west: -112.08 },
    geojson: {
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [[[-112.08, 33.39], [-112.06, 33.39], [-112.06, 33.41], [-112.08, 33.41], [-112.08, 33.39]]] },
    },
  };
}

test("generates three deterministic, plausible South Phoenix variants", () => {
  const geometry = southPhoenixGeometry();
  const first = generateSubdivisionLayouts(geometry, climate, brief);
  const second = generateSubdivisionLayouts(geometry, climate, brief);

  assert.deepEqual(first, second);
  assert.equal(first.source, "SiteMorph deterministic native-Forma subdivision engine");
  assert.equal(first.variants.length, 3);
  assert.deepEqual(new Set(first.variants.map((variant) => variant.strategy)), new Set([
    "compact-yield",
    "balanced-neighborhood",
    "heat-resilient-neighborhood",
  ]));
  const compact = first.variants.find((variant) => variant.strategy === "compact-yield")!;
  const balanced = first.variants.find((variant) => variant.strategy === "balanced-neighborhood")!;
  const heatResilient = first.variants.find((variant) => variant.strategy === "heat-resilient-neighborhood")!;
  assert.ok(compact.metrics.lotCount >= 80 && compact.metrics.lotCount <= 95);
  assert.ok(balanced.metrics.lotCount >= 65 && balanced.metrics.lotCount <= 85);
  assert.ok(heatResilient.metrics.lotCount >= 55 && heatResilient.metrics.lotCount <= 75);
  assert.ok(compact.metrics.lotCount > balanced.metrics.lotCount);
  assert.ok(balanced.metrics.lotCount > heatResilient.metrics.lotCount);
  assert.ok(compact.metrics.landEfficiencyPercent >= 75 && compact.metrics.landEfficiencyPercent <= 90);
  assert.ok(balanced.metrics.landEfficiencyPercent >= 65 && balanced.metrics.landEfficiencyPercent <= 80);
  assert.ok(heatResilient.metrics.landEfficiencyPercent >= 55 && heatResilient.metrics.landEfficiencyPercent <= 75);
  assert.deepEqual(first.variants.map((variant) => variant.rank).sort(), [1, 2, 3]);
});

test("keeps lot, dwelling and score mathematics auditable", () => {
  const plan = generateSubdivisionLayouts(southPhoenixGeometry(), climate, brief);
  for (const variant of plan.variants) {
    const lotArea = variant.lots.reduce((total, lot) => total + lot.areaSqFt, 0);
    const roadArea = variant.roads.reduce((total, road) => total + polygonArea(road.polygon) * SQFT_PER_SQM, 0);
    const totalGfa = variant.dwellings.reduce((total, dwelling) => total + dwelling.grossFloorAreaSqFt, 0);
    const weightedScore = variant.scoreBreakdown.components.reduce((total, component) => total + component.weightedScore, 0);
    assert.equal(variant.metrics.subdivisionLotAreaSqFt, lotArea);
    assert.ok(Math.abs(variant.metrics.roadAndPathAreaSqFt - roadArea) <= 5);
    assert.equal(variant.metrics.totalDwellingGfaSqFt, totalGfa);
    assert.equal(variant.metrics.lotCount, variant.lots.length);
    assert.equal(variant.metrics.dwellingCount, variant.dwellings.length);
    assert.equal(variant.metrics.parkingProvision, variant.lots.length * brief.parkingSpacesPerDwelling);
    assert.ok(Math.abs(variant.metrics.landEfficiencyPercent - lotArea / variant.metrics.siteAreaSqFt * 100) <= 0.11);
    const explicitOpenSpaceArea = variant.openSpaces.reduce((total, space) => total + space.areaSqFt, 0);
    assert.ok(Math.abs(variant.metrics.openLandPercent - explicitOpenSpaceArea / variant.metrics.siteAreaSqFt * 100) <= 0.11);
    assert.ok(Math.abs(variant.scoreBreakdown.totalScore - weightedScore) <= 0.11);
    assert.equal(variant.scoreBreakdown.climateWeightPercent, 50);
    assert.ok(variant.scoreBreakdown.components.some((component) => component.id === "fortyguard-climate" && component.weightPercent >= 45));
    assert.ok(variant.lots.every((lot) => lot.polygon.every((point) => pointInPolygon(point, southPhoenixGeometry().localBoundary!, 0.1))));
  }
});

test("uses multiple double-loaded street bands and most of the selected Site Limit", () => {
  const plan = generateSubdivisionLayouts(southPhoenixGeometry(), climate, brief);
  for (const variant of plan.variants) {
    const accessRoads = variant.roads.filter((road) => road.kind === "access-road");
    const pedestrianPaths = variant.roads.filter((road) => road.kind === "pedestrian-path");
    const plannedArea = variant.metrics.subdivisionLotAreaSqFt
      + variant.metrics.roadAndPathAreaSqFt
      + variant.openSpaces.reduce((total, space) => total + space.areaSqFt, 0);
    assert.ok(accessRoads.length >= 2);
    assert.equal(pedestrianPaths.length, accessRoads.length * 2);
    assert.ok(new Set(variant.lots.map((lot) => lot.frontageRoadId)).size >= 2);
    assert.ok(plannedArea / variant.metrics.siteAreaSqFt >= 0.8);
  }
});

test("makes FortyGuard multiplicative and gives the climate-first variant stronger mitigation", () => {
  const plan = generateSubdivisionLayouts(southPhoenixGeometry(), climate, brief);
  const compact = plan.variants.find((variant) => variant.strategy === "compact-yield")!;
  const climateFirst = plan.variants.find((variant) => variant.strategy === "heat-resilient-neighborhood")!;

  assert.equal(plan.historicalBurden.inputs.length, 4);
  assert.deepEqual(plan.historicalBurden.inputs.map((input) => [input.id, input.weightPercent]), [
    ["mean-temperature", 35],
    ["mean-persistence", 25],
    ["maximum-continuous-persistence", 20],
    ["mean-exceedance", 20],
  ]);
  assert.match(plan.historicalBurden.formula, /geometric mean/i);
  assert.match(plan.historicalBurden.formula, /excluded from the numerical burden/i);
  assert.equal(plan.historicalBurden.peakThermalHour, "11:00 PM MST");
  assert.match(climateFirst.climatePerformance.formula, /historical burden × weighted geometric mean/i);
  assert.ok(climateFirst.climatePerformance.mitigationMultiplier < compact.climatePerformance.mitigationMultiplier);
  assert.ok(climateFirst.climatePerformance.residualHeatRiskScore < compact.climatePerformance.residualHeatRiskScore);
  assert.ok(climateFirst.climatePerformance.resilienceScore > compact.climatePerformance.resilienceScore);
  assert.ok(climateFirst.metrics.treeCount > compact.metrics.treeCount);
  assert.ok(climateFirst.metrics.openLandPercent > compact.metrics.openLandPercent);
  const balanced = plan.variants.find((variant) => variant.strategy === "balanced-neighborhood")!;
  assert.ok(compact.metrics.openLandPercent < balanced.metrics.openLandPercent);
  assert.ok(balanced.metrics.openLandPercent < climateFirst.metrics.openLandPercent);
});

test("keeps peak-time availability as supporting evidence without changing numerical burden", () => {
  const withPeak = generateSubdivisionLayouts(southPhoenixGeometry(), climate, brief).historicalBurden;
  const withoutPeakClimate: ClimateDNA = {
    ...climate,
    activityIds: {
      ...climate.activityIds,
      heat: climate.activityIds!.heat.map(({ timeOfMeasure: _timeOfMeasure, ...activity }) => activity),
    },
    thermal: {
      ...climate.thermal,
      peakThermalHour: "Unavailable",
      peakThermalHourUtc: "Unavailable",
    },
  };
  const withoutPeak = generateSubdivisionLayouts(southPhoenixGeometry(), withoutPeakClimate, brief).historicalBurden;

  assert.equal(withPeak.score, withoutPeak.score);
  assert.equal(withPeak.scorePercent, withoutPeak.scorePercent);
  assert.equal(withPeak.timeOfMeasureAvailable, true);
  assert.equal(withoutPeak.timeOfMeasureAvailable, false);
  assert.equal(withoutPeak.peakThermalHour, null);
  assert.match(withoutPeak.peakTimeEvidenceNote, /burden is unchanged/i);
});

test("never invents a directional zone when FortyGuard is uniform and LOW confidence", () => {
  const plan = generateSubdivisionLayouts(southPhoenixGeometry(), climate, brief);

  assert.equal(plan.historicalBurden.thermalZoningMode, "site-wide");
  assert.equal(plan.historicalBurden.directionalClaim, null);
  assert.match(plan.historicalBurden.spatialNote, /thermally uniform at FortyGuard resolution/i);
  for (const variant of plan.variants) {
    assert.equal(variant.climatePerformance.spatialTreatment, "site-wide");
    assert.equal(variant.climatePerformance.directionalClaim, null);
    assert.match(variant.warnings.join(" "), /No directional thermal claim/i);
    assert.doesNotMatch(variant.assumptions.join(" "), /cooler (north|south|east|west)|preferred (north|south|east|west)/i);
  }
});

test("gates layout geometry inside a rotated trapezoid", () => {
  const geometry = southPhoenixGeometry();
  const plan = generateSubdivisionLayouts(geometry, climate, brief);
  for (const variant of plan.variants) {
    for (const lot of variant.lots) assert.ok(lot.polygon.every((point) => pointInPolygon(point, geometry.localBoundary!, 0.1)));
    for (const dwelling of variant.dwellings) assert.ok(dwelling.footprint.every((point) => pointInPolygon(point, geometry.localBoundary!, 0.1)));
    for (const road of variant.roads) assert.ok(road.polygon.every((point) => pointInPolygon(point, geometry.localBoundary!, 0.1)));
    for (const openSpace of variant.openSpaces) assert.ok(openSpace.polygon.every((point) => pointInPolygon(point, geometry.localBoundary!, 0.1)));
    for (const tree of variant.trees) assert.ok(pointInPolygon(tree.point, geometry.localBoundary!, 0.1));
  }
});

test("also supports an axis-aligned rectangular Forma Site Limit", () => {
  const areaSqFt = 359_376;
  const depthMeters = areaSqFt / SQFT_PER_SQM / 220;
  const geometry = southPhoenixGeometry();
  geometry.localBoundary = [[0, 0], [220, 0], [220, depthMeters], [0, depthMeters], [0, 0]];
  const plan = generateSubdivisionLayouts(geometry, climate, brief);

  assert.equal(plan.variants.length, 3);
  assert.ok(plan.variants.every((variant) => variant.metrics.lotCount >= 55));
  assert.ok(plan.variants.every((variant) => variant.lots.every((lot) => lot.polygon.every((point) => pointInPolygon(point, geometry.localBoundary!, 0.1)))));
});
