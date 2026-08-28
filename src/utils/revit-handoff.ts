import type { ClimateDNA, DesignBrief, GeneratedBuilding, SiteContext, SiteGeometry } from "../types";
import { downloadJson, downloadText } from "./config";
import { buildDesignEvidence } from "./revit-plan-handoff";
import { createRevitObj } from "./revit-obj";

function safeBuildingName(building: GeneratedBuilding): string {
  return building.name.replaceAll(/[^a-zA-Z0-9_-]+/g, "-").replaceAll(/^-|-$/g, "") || "SiteMorph-Building";
}

export { buildDesignEvidence, buildRevitPlanHandoff } from "./revit-plan-handoff";

export function exportDesignEvidence(
  building: GeneratedBuilding,
  geometry: SiteGeometry,
  climate: ClimateDNA,
  requirements: DesignBrief,
  site: SiteContext | null,
): void {
  downloadJson(`${safeBuildingName(building)}-SiteMorph-Design-Evidence.json`, buildDesignEvidence(building, geometry, climate, requirements, site));
}

export function exportGenericObj(building: GeneratedBuilding): void {
  downloadText(`${safeBuildingName(building)}-Generic-Mass.obj`, createRevitObj(building), "model/obj;charset=utf-8");
}

/** @deprecated Use exportDesignEvidence. JSON is evidence, not a native Revit import. */
export const exportRevitPlanHandoff = exportDesignEvidence;
export const exportRevitHandoff = exportDesignEvidence;
