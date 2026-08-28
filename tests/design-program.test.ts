import assert from "node:assert/strict";
import test from "node:test";

import type { DesignBrief } from "../src/types/index.ts";
import { resolveBuildingProgram } from "../src/utils/design-program.ts";

const warehouse: DesignBrief = {
  buildingType: "Climate-controlled distribution warehouse",
  totalAreaSqFt: 85000,
  program: [
    { name: "Warehouse / logistics", areaSqFt: 78000 },
    { name: "Office / mezzanine", areaSqFt: 7000 },
  ],
  floors: 1,
  targetFootprintSqFt: 78000,
  maximumHeightFt: 36,
  requiredParking: 60,
  loadingDocks: 12,
  preferredAccessRoad: "E Broadway Rd",
  priority: "Balanced",
};

test("preserves the 85k warehouse brief as a 78k main floor plus 7k mezzanine", () => {
  assert.deepEqual(resolveBuildingProgram(warehouse, 78000), {
    mainFloorCount: 1,
    grossFloorAreaSqFt: 85000,
    mezzanineAreaSqFt: 7000,
    fullFloorCount: 1,
    partialTopFloorAreaSqFt: 7000,
    geometryLevelCount: 2,
  });
});

test("builds an exact three-level hospital stack with two full floors and one partial top floor", () => {
  const hospital = resolveBuildingProgram({ ...warehouse, buildingType: "Hospital", totalAreaSqFt: 130000, floors: 3, targetFootprintSqFt: 48000 }, 48000);
  assert.deepEqual(hospital, {
    mainFloorCount: 3,
    grossFloorAreaSqFt: 130000,
    mezzanineAreaSqFt: 0,
    fullFloorCount: 2,
    partialTopFloorAreaSqFt: 34000,
    geometryLevelCount: 3,
  });
});

test("rejects a gross area smaller than its footprint", () => {
  assert.throws(() => resolveBuildingProgram({ ...warehouse, totalAreaSqFt: 70000 }, 78000), /cannot be smaller/);
});
