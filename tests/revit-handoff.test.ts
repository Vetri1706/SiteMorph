import assert from "node:assert/strict";
import test from "node:test";

import type { ClimateDNA, DesignBrief, GeneratedBuilding, SiteGeometry } from "../src/types/index.ts";
import { buildRevitPlanHandoff } from "../src/utils/revit-plan-handoff.ts";

const requirements = {
  buildingType: "Warehouse",
  totalAreaSqFt: 70_000,
  program: [],
  floors: 1,
  targetFootprintSqFt: 65_000,
  maximumHeightFt: 38,
  requiredParking: 48,
  loadingDocks: 12,
  preferredAccessRoad: "North access road",
  priority: "Balanced",
} satisfies DesignBrief;

const building = {
  elementPath: "proposal/building",
  name: "Warehouse",
  footprintSqFt: 65_000,
  grossFloorAreaSqFt: 70_000,
  mezzanineAreaSqFt: 5_000,
  heightFt: 38,
  heightMeters: 11.5824,
  floors: 1,
  revision: 2,
  siteCoveragePercent: 40.2,
  remainingSiteAreaSqFt: 96_822,
  aspectRatio: 1.6,
  orientationLabel: "East–west long axis",
  projectFootprint: [[0, 0], [100, 0], [100, 50], [0, 50], [0, 0]],
  placementSummary: "Inside Site Limit",
  sunAnalysisIds: ["sun-1"],
} satisfies GeneratedBuilding;

const geometry = { elementPath: "site-limit/1", geojson: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [] } } } as unknown as SiteGeometry;
const climate = { designBrief: { thermalZoningConfidence: "LOW", summary: "Uniform", priorities: [], siteWideConstraints: [], formaActions: [] }, constraints: [] } as unknown as ClimateDNA;

test("makes JSON an evidence sidecar and identifies the native Forma-to-Revit workflow", () => {
  const handoff = buildRevitPlanHandoff(building, geometry, climate, requirements, null);
  assert.equal(handoff.schema, "sitemorph.design-evidence.v3");
  assert.equal(handoff.handoffType, "design-evidence-sidecar");
  assert.equal(handoff.nativeRevitTransfer.mode, "Revit add-in (Beta)");
  assert.equal(handoff.nativeRevitTransfer.triggerAvailableToEmbeddedExtension, false);
  assert.equal(handoff.plan.operations.itemCount, 12);
  assert.equal(handoff.levels[0].name, "Ground Floor");
  assert.equal(handoff.levels[1].name, "Office / administration upper level");
  assert.ok(handoff.futureAutomationIntent.some((item) => item.planZoneId === "warehouse" && item.suggestedRevitCategories.includes("Walls")));
  assert.match(handoff.evidenceNotes[0], /does not natively import this JSON/i);
});
