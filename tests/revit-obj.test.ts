import assert from "node:assert/strict";
import test from "node:test";

import type { GeneratedBuilding } from "../src/types/index.ts";
import { createRevitObj } from "../src/utils/revit-obj.ts";

const building: GeneratedBuilding = {
  elementPath: "proposal/warehouse",
  name: "Climate-controlled distribution warehouse",
  footprintSqFt: 78000,
  grossFloorAreaSqFt: 85000,
  mezzanineAreaSqFt: 7000,
  geometryLevelCount: 2,
  heightFt: 36,
  heightMeters: 10.9728,
  floors: 1,
  revision: 1,
  siteCoveragePercent: 21.7,
  remainingSiteAreaSqFt: 281376,
  aspectRatio: 2.2,
  orientationLabel: "East–west long axis",
  projectFootprint: [[0, 0], [126.26, 0], [126.26, 57.39], [0, 57.39], [0, 0]],
  placementSummary: "Inside the Site Limit",
  sunAnalysisIds: [],
};

test("exports separate main-floor and mezzanine prisms in meters", () => {
  const obj = createRevitObj(building);
  assert.match(obj, /# Units: meters/);
  assert.equal(obj.split("\n").filter((line) => line.startsWith("v ")).length, 16);
  assert.equal(obj.split("\n").filter((line) => line.startsWith("f ")).length, 16);
  assert.match(obj, /o Climate-controlled_distribution_warehouse/);
});
