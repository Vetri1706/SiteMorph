import assert from "node:assert/strict";
import test from "node:test";

import type { ClimateDNA, SiteGeometry } from "../src/types/index.ts";
import { createSiteFitAssessment } from "../src/utils/site-fit-advisor.ts";

const climate: ClimateDNA = {
  id: "climate-test",
  generatedAt: "2026-08-28T00:00:00.000Z",
  activityId: "saved-fortyguard",
  profile: { thermalExposure: "HIGH", persistence: "HIGH" },
  layers: [],
  thermal: {
    meanCelsius: 37.5,
    maxCelsius: 42.5,
    minCelsius: 28.7,
    peakThermalHour: "11:00 PM MST",
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

function geometry(areaAcres: number): SiteGeometry {
  const widthMeters = 220;
  const areaSqFt = Math.round(areaAcres * 43_560);
  const depthMeters = areaSqFt / 10.7639104167 / widthMeters;
  return {
    elementPath: "proposal/site-limit",
    pointCount: 5,
    localBoundary: [[0, 0], [widthMeters, 0], [widthMeters, depthMeters], [0, depthMeters], [0, 0]],
    areaSqFt,
    areaAcres,
    centroid: { longitude: -112.07, latitude: 33.4 },
    bounds: { north: 33.41, east: -112.06, south: 33.39, west: -112.08 },
    geojson: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[-112.08, 33.39], [-112.06, 33.39], [-112.06, 33.41], [-112.08, 33.41], [-112.08, 33.39]]] } },
  };
}

test("returns deterministic, ranked and input-specific development briefs without an API", () => {
  const first = createSiteFitAssessment(geometry(8.25), climate);
  const second = createSiteFitAssessment(geometry(8.25), climate);

  assert.deepEqual(first, second);
  assert.equal(first.source, "deterministic-constraint-engine");
  assert.equal(first.options.length, 8);
  assert.deepEqual(first.options.map((option) => option.rank), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(first.options.every((option, index, options) => index === 0 || options[index - 1].score >= option.score));
  assert.ok(first.options.some((option) => option.typology === "logistics"));
  assert.ok(first.options.some((option) => option.typology === "residential"));
  assert.ok(first.options.some((option) => option.typology === "healthcare"));
});

test("keeps every suggested brief internally consistent and exposes missing feasibility evidence", () => {
  const assessment = createSiteFitAssessment(geometry(8.25), climate);
  for (const option of assessment.options) {
    const programTotal = option.brief.program.reduce((total, item) => total + item.areaSqFt, 0);
    assert.equal(programTotal, option.brief.totalAreaSqFt);
    assert.ok(option.brief.targetFootprintSqFt <= option.brief.totalAreaSqFt);
    assert.ok(option.brief.targetFootprintSqFt < assessment.siteAreaSqFt);
    assert.ok(option.brief.requiredParking > 0);
    assert.match(option.reasons.join(" "), /24 h maximum persistence/i);
  }
  assert.ok(assessment.missingEvidence.includes("Zoning and permitted land use"));
  assert.match(assessment.disclaimer, /does not determine highest-and-best use/i);
});

test("changes size outputs when the selected Site Limit changes", () => {
  const small = createSiteFitAssessment(geometry(2), climate);
  const large = createSiteFitAssessment(geometry(8.25), climate);
  const smallLogistics = small.options.find((option) => option.id === "logistics")!;
  const largeLogistics = large.options.find((option) => option.id === "logistics")!;

  assert.ok(largeLogistics.brief.targetFootprintSqFt > smallLogistics.brief.targetFootprintSqFt);
  assert.ok(largeLogistics.brief.totalAreaSqFt > smallLogistics.brief.totalAreaSqFt);
  assert.ok(largeLogistics.score > smallLogistics.score);
});

test("hospital and apartment choices produce different programs and dimensions", () => {
  const assessment = createSiteFitAssessment(geometry(8.25), climate);
  const healthcare = assessment.options.find((option) => option.id === "healthcare")!;
  const residential = assessment.options.find((option) => option.id === "residential")!;

  assert.match(healthcare.brief.buildingType, /Hospital/i);
  assert.ok(healthcare.brief.program.some((item) => /Clinical Care/i.test(item.name)));
  assert.match(residential.brief.buildingType, /Apartments/i);
  assert.ok(residential.brief.program.some((item) => /Residential Units/i.test(item.name)));
  assert.notEqual(healthcare.brief.requiredParking, residential.brief.requiredParking);
});
