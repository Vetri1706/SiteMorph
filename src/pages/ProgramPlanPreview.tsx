import { ProgramPlanDiagram } from "../components/design/ProgramPlanDiagram";
import type { DesignBrief } from "../types";
import { createProgramPlan } from "../utils/program-plan";

const logisticsBrief: DesignBrief = {
  buildingType: "Climate-Controlled Logistics / Distribution Facility",
  totalAreaSqFt: 70_000,
  floors: 1,
  targetFootprintSqFt: 65_000,
  maximumHeightFt: 38,
  requiredParking: 48,
  loadingDocks: 12,
  preferredAccessRoad: "North access edge",
  priority: "Balanced",
  program: [
    { name: "Warehouse hall", areaSqFt: 60_000 },
    { name: "Office / administration", areaSqFt: 5_000 },
  ],
};

const healthcareBrief: DesignBrief = {
  buildingType: "Acute-Care Community Hospital",
  totalAreaSqFt: 130_000,
  floors: 3,
  targetFootprintSqFt: 48_000,
  maximumHeightFt: 62,
  requiredParking: 260,
  loadingDocks: 3,
  preferredAccessRoad: "Primary road along north site edge",
  priority: "Thermal Performance",
  program: [],
};

export function ProgramPlanPreview() {
  const hospital = new URLSearchParams(window.location.search).get("planPreview") === "hospital";
  const brief = hospital ? healthcareBrief : logisticsBrief;
  const mass = hospital
    ? { footprintSqFt: 48_000, grossFloorAreaSqFt: 130_000, mezzanineAreaSqFt: 82_000, heightFt: 62, aspectRatio: 1.45, orientationLabel: "East–west long axis" }
    : { footprintSqFt: 65_000, grossFloorAreaSqFt: 70_000, mezzanineAreaSqFt: 5_000, heightFt: 38, aspectRatio: 1.6, orientationLabel: "East–west long axis" };
  const approved = createProgramPlan(brief, mass, { officeMezzanineSide: "east" });
  return <main className="program-plan-preview">
    <header>
      <span>SiteMorph preliminary spatial program</span>
      <h1>{brief.buildingType}</h1>
      <p>Dimensioned program plan · Forma proposal remains the native Revit transfer source</p>
    </header>
    <ProgramPlanDiagram plan={approved} title="Approved program/site plan" />
  </main>;
}
