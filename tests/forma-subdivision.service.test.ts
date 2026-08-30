import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSubdivisionFootprintMatches,
  buildSubdivisionTerrainSamplePlan,
  prepareSubdivisionElements,
  resolveSubdivisionTerrainPlacements,
} from "../src/services/forma-subdivision.service.ts";
import { SITEMORPH_OWNERSHIP_NAMESPACE, tagSiteMorphElementUrn } from "../src/services/forma-element-placement.service.ts";
import type { SubdivisionVariant } from "../src/types/subdivision.ts";

const siteBoundary: Array<[number, number]> = [[-5, -5], [35, -5], [35, 20], [-5, 20], [-5, -5]];

function variantWithDwellings(dwellings: SubdivisionVariant["dwellings"]): SubdivisionVariant {
  return {
    id: "balanced",
    strategy: "balanced-neighborhood",
    label: "Balanced neighborhood",
    rank: 1,
    axis: { origin: [0, 0], vector: [1, 0], angleDegrees: 0, basis: "Forma Site Limit dominant axis" },
    lots: [],
    dwellings,
    dwellingGroups: [],
    roads: [],
    trees: [],
    openSpaces: [],
    metrics: {
      siteAreaSqFt: 10_000,
      subdivisionLotAreaSqFt: 8_000,
      roadAndPathAreaSqFt: 2_000,
      dwellingFootprintAreaSqFt: dwellings.reduce((sum, dwelling) => sum + dwelling.footprintSqFt, 0),
      totalDwellingGfaSqFt: dwellings.reduce((sum, dwelling) => sum + dwelling.grossFloorAreaSqFt, 0),
      averageLotAreaSqFt: 4_000,
      averageDwellingGfaSqFt: 2_153,
      lotCount: dwellings.length,
      dwellingCount: dwellings.length,
      landEfficiencyPercent: 80,
      openLandPercent: 20,
      parkingProvision: dwellings.length * 2,
      treeCount: 4,
      estimatedCanopyCoveragePercent: 10,
    },
    climatePerformance: {
      source: "FortyGuard × SiteMorph plan mitigation",
      historicalBurdenScore: 0.8,
      mitigationMultiplier: 0.75,
      residualHeatRiskScore: 0.6,
      resilienceScore: 40,
      formula: "test",
      factors: [],
      spatialTreatment: "site-wide",
      directionalClaim: null,
    },
    scoreBreakdown: { totalScore: 80, climateWeightPercent: 50, formula: "test", components: [] },
    assumptions: [],
    warnings: [],
    provenance: [],
  };
}

function dwelling(id: string, lotId: string, groupId: string, footprint: Array<[number, number]>) {
  const footprintSqFt = 100 * 10.7639104167;
  return {
    id,
    lotId,
    groupId,
    footprint,
    footprintSqFt,
    grossFloorAreaSqFt: footprintSqFt * 2,
    floors: 2,
    heightMeters: 6.4,
  };
}

test("tags each native dwelling URN with auditable schema-v2 run ownership", async () => {
  let mergePatch: Record<string, Record<string, unknown> | null> | undefined;
  const Forma = {
    elements: {
      async editProperties(request: { urn: string; propertiesJsonMergePatch: Record<string, Record<string, unknown> | null> }) {
        mergePatch = request.propertiesJsonMergePatch;
        return { urn: `${request.urn}:tagged` };
      },
    },
  };
  const tagged = await tagSiteMorphElementUrn(Forma as never, "urn:dwelling", {
    schemaVersion: 2,
    runId: "subdivision-balanced-123",
    role: "subdivision-dwelling",
    itemId: "dwelling-001",
  });
  assert.equal(tagged, "urn:dwelling:tagged");
  assert.deepEqual(mergePatch?.[SITEMORPH_OWNERSHIP_NAMESPACE], {
    owned: true,
    schemaVersion: 2,
    runId: "subdivision-balanced-123",
    role: "subdivision-dwelling",
    itemId: "dwelling-001",
  });
});

test("prepares one top-level native floor stack per dwelling with local CCW floors", () => {
  const variant = variantWithDwellings([
    // Clockwise input proves the SDK polygon is normalized before creation.
    dwelling("dwelling-001", "lot-001", "group-a", [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]),
  ]);
  const [prepared] = prepareSubdivisionElements(variant, siteBoundary);
  assert.equal(prepared.itemId, "dwelling-001");
  assert.equal(prepared.floors.length, 2);
  assert.deepEqual(prepared.transform.slice(12, 15), [5, 5, 0]);
  assert.match(prepared.name, /^SiteMorph — Balanced neighborhood · Dwelling 01$/);
  const floor = prepared.floors[0].polygon;
  const twiceArea = floor.slice(0, -1).reduce((sum, [x, y], index) => {
    const next = floor[(index + 1) % (floor.length - 1)];
    return sum + x * next[1] - next[0] * y;
  }, 0);
  assert.ok(twiceArea > 0);
  assert.deepEqual(floor[0], floor.at(-1));
});

test("deduplicates and globally caps terrain samples while retaining coverage for every footprint", () => {
  const prepared = prepareSubdivisionElements(variantWithDwellings([
    dwelling("dwelling-001", "lot-001", "group-a", [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]),
    dwelling("dwelling-002", "lot-002", "group-b", [[10, 0], [20, 0], [20, 10], [10, 10], [10, 0]]),
  ]), siteBoundary);
  const plan = buildSubdivisionTerrainSamplePlan(prepared, 20);
  assert.ok(plan.samples.length <= 20);
  assert.equal(new Set(plan.samples.map((sample) => sample.key)).size, plan.samples.length);
  assert.ok(prepared.every((element) => plan.sampleKeysByItem[element.itemId].length > 0));
  assert.ok(plan.samples.some((sample) => sample.itemIds.length === 2), "shared boundary samples should be requested only once");
});

test("samples each unique terrain point once and resolves an actual Z for every dwelling", async () => {
  const prepared = prepareSubdivisionElements(variantWithDwellings([
    dwelling("dwelling-001", "lot-001", "group-a", [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]),
    dwelling("dwelling-002", "lot-002", "group-b", [[10, 0], [20, 0], [20, 10], [10, 10], [10, 0]]),
  ]), siteBoundary);
  const plan = buildSubdivisionTerrainSamplePlan(prepared, 30);
  const calls = new Map<string, number>();
  const placements = await resolveSubdivisionTerrainPlacements(prepared, plan, async ([x, y]) => {
    const key = `${x.toFixed(5)}:${y.toFixed(5)}`;
    calls.set(key, (calls.get(key) ?? 0) + 1);
    return 320 + x * 0.1 + y * 0.01;
  });
  assert.equal(calls.size, plan.samples.length);
  assert.ok([...calls.values()].every((count) => count === 1));
  assert.equal(placements.length, 2);
  assert.ok(placements.every((placement) => placement.terrainSampleCount > 0));
  assert.ok(placements.every((placement) => placement.transform[14] === placement.terrainBaseElevationMeters));
  assert.ok(placements[1].terrainBaseElevationMeters > placements[0].terrainBaseElevationMeters);
});

test("fails before materialization when one deduplicated terrain point remains unavailable", async () => {
  const prepared = prepareSubdivisionElements(variantWithDwellings([
    dwelling("dwelling-001", "lot-001", "group-a", [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]),
  ]), siteBoundary);
  const plan = buildSubdivisionTerrainSamplePlan(prepared, 12);
  const failedKey = plan.samples[0].key;
  await assert.rejects(
    resolveSubdivisionTerrainPlacements(prepared, plan, async (point) => {
      if (`${point[0].toFixed(5)}:${point[1].toFixed(5)}` === failedKey) throw new Error("terrain unavailable");
      return 325;
    }),
    /No dwellings were added/,
  );
});

test("verifies persisted footprints and rejects displaced geometry", () => {
  const expected: Array<[number, number]> = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const accepted = assertSubdivisionFootprintMatches(
    [[0.02, 0.01], [10.02, 0.01], [10.02, 10.01], [0.02, 10.01], [0.02, 0.01]],
    expected,
  );
  assert.ok(accepted.centroidDistanceMeters < 0.05);
  assert.throws(
    () => assertSubdivisionFootprintMatches([[2, 0], [12, 0], [12, 10], [2, 10], [2, 0]], expected),
    /Persisted dwelling footprint differs/,
  );
});

test("rejects a dwelling whose native floor-stack GFA would not match the declared program", () => {
  const invalid = dwelling("dwelling-001", "lot-001", "group-a", [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]);
  invalid.grossFloorAreaSqFt = 5_000;
  assert.throws(
    () => prepareSubdivisionElements(variantWithDwellings([invalid]), siteBoundary),
    /cannot be represented by its 2-storey footprint/,
  );
});
