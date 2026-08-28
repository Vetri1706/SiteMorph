import type { ClimateDNA, DesignBrief, GeneratedBuilding, SiteContext, SiteGeometry } from "../types";
import { createProgramPlan } from "./program-plan.ts";

export function buildDesignEvidence(
  building: GeneratedBuilding,
  geometry: SiteGeometry,
  climate: ClimateDNA,
  requirements: DesignBrief,
  site: SiteContext | null,
) {
  const programPlan = building.programPlan ?? createProgramPlan(requirements, {
    footprintSqFt: building.footprintSqFt,
    grossFloorAreaSqFt: building.grossFloorAreaSqFt,
    mezzanineAreaSqFt: building.mezzanineAreaSqFt,
    heightFt: building.heightFt,
    aspectRatio: building.aspectRatio,
    orientationLabel: building.orientationLabel,
  }, { officeMezzanineSide: building.intervention?.outcome === "accepted" ? building.intervention.tested?.officeMezzanineSide : building.intervention?.initial.officeMezzanineSide });
  const upperZone = programPlan.zones.find((zone) => zone.level !== "ground");

  return {
    schema: "sitemorph.design-evidence.v3",
    handoffType: "design-evidence-sidecar",
    generatedAt: new Date().toISOString(),
    units: { plan: "feet", formaCoordinates: "meters" },
    nativeRevitTransfer: {
      source: "Autodesk Forma proposal",
      mode: "Revit add-in (Beta)",
      triggerAvailableToEmbeddedExtension: false,
      instructions: [
        "Open Proposals in Forma.",
        "Open the proposal three-dot menu.",
        "Choose Revit → Send to Revit add-in (Beta).",
        "In Revit, use Load From Forma.",
      ],
    },
    project: {
      id: site?.projectId,
      name: site?.projectName,
      proposal: site?.selectedProposal,
      siteLimitElementPath: geometry.elementPath,
      projection: geometry.projection,
      siteBoundaryWgs84: geometry.geojson,
    },
    plan: programPlan,
    levels: [
      { id: "level-01", name: "Ground Floor", elevationFt: 0, createsPlanView: true },
      ...(building.grossFloorAreaSqFt > building.footprintSqFt ? [{ id: "level-upper", name: upperZone?.name ?? "Upper Program Levels", elevationFt: Math.max(9, Math.min(14, Math.round(building.heightFt / Math.max(2, building.geometryLevelCount ?? 2)))), createsPlanView: true }] : []),
      { id: "roof", name: "Roof", elevationFt: building.heightFt, createsPlanView: false },
    ],
    buildingReference: {
      designLoopVersion: building.designLoopVersion,
      formaElementPath: building.elementPath,
      name: building.name,
      footprintProjectCoordinatesMeters: building.projectFootprint,
      footprintSqFt: building.footprintSqFt,
      grossFloorAreaSqFt: building.grossFloorAreaSqFt,
      mainFloors: building.floors,
      upperLevelAreaSqFt: building.upperFloorAreaSqFt ?? Math.max(0, building.grossFloorAreaSqFt - building.footprintSqFt),
      partialTopFloorAreaSqFt: building.partialTopFloorAreaSqFt,
      geometryLevelCount: building.geometryLevelCount,
      heightFt: building.heightFt,
      heightMeters: building.heightMeters,
      orientation: building.orientationLabel,
      aspectRatio: building.aspectRatio,
      siteCoveragePercent: building.siteCoveragePercent,
      placementSummary: building.placementSummary,
    },
    futureAutomationIntent: [
      ...programPlan.zones.map((zone) => ({
        planZoneId: zone.id,
        suggestedRevitCategories: zone.level === "ground" ? ["Floors", "Walls", "Rooms"] : ["Levels", "Floors", "Walls", "Rooms"],
        intent: `Develop the preliminary ${zone.name} zone as native BIM after discipline review.`,
      })),
      { planZoneId: "operations-edge", suggestedRevitCategories: ["Doors", "Generic Models"], intent: `Coordinate ${programPlan.operations.edgeLabel.toLowerCase()} and ${programPlan.operations.shelteredBandLabel.toLowerCase()}.` },
      { planZoneId: "parking", suggestedRevitCategories: ["Parking"], intent: "Reserve the required count; final stall geometry requires civil layout." },
    ],
    requirements,
    climateDesignBrief: climate.designBrief,
    constraints: climate.constraints,
    formaValidation: {
      sunAnalysisId: building.sunAnalysisId,
      status: building.sunStatus,
      metricSource: building.analysisMetricSource,
      meanGroundSunHours: building.meanSunHours,
      maximumGroundSunHours: building.maxSunHours,
      note: building.analysisNote,
      changeSummary: building.changeSummary,
      climateResponse: building.climateResponse,
    },
    siteMorphIntervention: building.intervention,
    evidenceNotes: [
      "Revit does not natively import this JSON. The Autodesk Forma proposal and Revit add-in are the actual transfer path.",
      "This file is an audit and future-automation sidecar containing the SiteMorph plan, requirements, climate decisions and Forma references.",
      "The 2D plan is preliminary spatial-program intelligence, not a permit or construction floor plan.",
      "The optional OBJ is generic reference geometry only and is not native BIM.",
    ],
  };
}

/** @deprecated Use buildDesignEvidence; retained for older saved links and tests. */
export const buildRevitPlanHandoff = buildDesignEvidence;
