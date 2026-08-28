import assert from "node:assert/strict";
import test from "node:test";

import type { DesignBrief } from "../src/types/index.ts";
import { createProgramPlan } from "../src/utils/program-plan.ts";
import { createSiteLayoutPlan } from "../src/utils/site-layout.ts";

const baseBrief: DesignBrief = {
  buildingType: "Climate-controlled logistics / distribution facility",
  totalAreaSqFt: 70_000,
  program: [],
  floors: 1,
  targetFootprintSqFt: 65_000,
  maximumHeightFt: 38,
  requiredParking: 45,
  loadingDocks: 8,
  preferredAccessRoad: "Primary road along north site edge",
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

const siteBoundary: Array<[number, number]> = [[0, 0], [150, 0], [150, 100], [0, 100], [0, 0]];
const buildingFootprint: Array<[number, number]> = [[45, 35], [105, 35], [105, 65], [45, 65], [45, 35]];

test("creates a typology-aware Forma terrain layout with parking, access and operations", () => {
  const programPlan = createProgramPlan(baseBrief, mass);
  const layout = createSiteLayoutPlan({ siteBoundary, buildingFootprint, programPlan });

  assert.equal(layout.schemaVersion, "sitemorph.site-layout.v1");
  assert.equal(layout.typology, "logistics");
  assert.equal(layout.parkingRequirement, 45);
  assert.equal(layout.parkingStatus, "resolved-concept");
  assert.ok(layout.parkingConceptCapacity >= 45);
  assert.equal(layout.accessLabel, "Primary road along north site edge");
  assert.ok(layout.zones.some((zone) => zone.kind === "parking"));
  assert.ok(layout.zones.some((zone) => zone.label === "Truck court / maneuvering zone"));
  assert.ok(layout.zones.some((zone) => zone.label === "Shaded loading canopy"));
  assert.match(layout.disclaimer, /preliminary/i);
});

test("uses healthcare arrival language and never substitutes warehouse operations", () => {
  const hospitalBrief: DesignBrief = {
    ...baseBrief,
    buildingType: "Acute-care hospital",
    totalAreaSqFt: 130_000,
    floors: 4,
    targetFootprintSqFt: 40_000,
    loadingDocks: 2,
  };
  const programPlan = createProgramPlan(hospitalBrief, { ...mass, footprintSqFt: 40_000, grossFloorAreaSqFt: 130_000, aspectRatio: 1.2 });
  const layout = createSiteLayoutPlan({ siteBoundary, buildingFootprint, programPlan });
  const labels = layout.zones.map((zone) => zone.label).join(" ");

  assert.equal(layout.typology, "healthcare");
  assert.match(labels, /Emergency access \/ patient drop-off/i);
  assert.match(labels, /Covered patient \/ ambulance arrival/i);
  assert.doesNotMatch(labels, /truck court|loading canopy|warehouse/i);
});

test("reports constrained parking instead of pretending the full requirement fits", () => {
  const tightSite: Array<[number, number]> = [[0, 0], [80, 0], [80, 60], [0, 60], [0, 0]];
  const tightBuilding: Array<[number, number]> = [[8, 10], [72, 10], [72, 50], [8, 50], [8, 10]];
  const programPlan = createProgramPlan({ ...baseBrief, requiredParking: 200 }, mass);
  const layout = createSiteLayoutPlan({ siteBoundary: tightSite, buildingFootprint: tightBuilding, programPlan });

  assert.equal(layout.parkingStatus, "space-constrained");
  assert.ok(layout.parkingConceptCapacity < 200);
});
