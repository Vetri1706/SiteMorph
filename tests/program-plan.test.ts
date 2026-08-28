import assert from "node:assert/strict";
import test from "node:test";

import type { DesignBrief } from "../src/types/index.ts";
import { createProgramPlan } from "../src/utils/program-plan.ts";

const requirements: DesignBrief = {
  buildingType: "Climate-controlled logistics / distribution facility",
  totalAreaSqFt: 70_000,
  program: [],
  floors: 1,
  targetFootprintSqFt: 65_000,
  maximumHeightFt: 38,
  requiredParking: 48,
  loadingDocks: 12,
  preferredAccessRoad: "North access road",
  priority: "Balanced",
};

const mass = {
  footprintSqFt: 65_000,
  grossFloorAreaSqFt: 70_000,
  mezzanineAreaSqFt: 5_000,
  heightFt: 38,
  aspectRatio: 1.6,
  orientationLabel: "East–west long axis",
};

test("creates a dimensioned preliminary program plan from the generated mass and exact requirements", () => {
  const plan = createProgramPlan(requirements, mass, { officeMezzanineSide: "North strip" });
  const office = plan.zones.find((zone) => zone.id === "upper-program")!;
  const service = plan.zones.find((zone) => zone.id === "service-core")!;

  assert.equal(plan.schemaVersion, "sitemorph.program-plan.v2");
  assert.equal(plan.typology, "logistics");
  assert.ok(Math.abs(plan.buildingWidthFt * plan.buildingDepthFt - 65_000) < 50);
  assert.equal(plan.operations.itemCount, 12);
  assert.equal(plan.operations.itemLabel, "loading dock");
  assert.equal(plan.parking.requiredSpaces, 48);
  assert.equal(plan.access.preferredRoad, "North access road");
  assert.equal(office.areaSqFt, 5_000);
  assert.equal(office.side, "north");
  assert.equal(service.source, "typology-template");
  assert.match(plan.disclaimer, /not a permit floor plan/i);
});

test("makes the office relocation and changed aspect ratio visible in the tested plan", () => {
  const initial = createProgramPlan(requirements, mass, { officeMezzanineSide: "North strip" });
  const tested = createProgramPlan(requirements, { ...mass, aspectRatio: 2.2 }, { officeMezzanineSide: "East side" });
  const initialOffice = initial.zones.find((zone) => zone.id === "upper-program")!;
  const testedOffice = tested.zones.find((zone) => zone.id === "upper-program")!;

  assert.equal(initialOffice.side, "north");
  assert.equal(testedOffice.side, "east");
  assert.notEqual(initial.buildingWidthFt, tested.buildingWidthFt);
  assert.notEqual(initialOffice.widthFt, testedOffice.widthFt);
});

test("uses a healthcare template instead of substituting a warehouse when program details are empty", () => {
  const healthcare = createProgramPlan({ ...requirements, buildingType: "Acute-care hospital", loadingDocks: 3 }, { ...mass, grossFloorAreaSqFt: 130_000, mezzanineAreaSqFt: 65_000 });
  assert.equal(healthcare.typology, "healthcare");
  assert.equal(healthcare.programStatus, "typology-template");
  assert.ok(healthcare.zones.some((zone) => zone.id === "clinical-care"));
  assert.ok(!healthcare.zones.some((zone) => zone.id === "warehouse"));
  assert.equal(healthcare.operations.edgeLabel, "North patient and emergency arrival");
  assert.equal(healthcare.operations.itemLabel, "service bay");
  assert.match(healthcare.programSummary, /not itemized/i);
});
