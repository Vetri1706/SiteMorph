import type { DesignBrief, ProgramPlan, ProgramPlanSide, ProgramPlanZone } from "../types";
import { detectBuildingTypology } from "./program-typology.ts";

interface ProgramPlanMass {
  footprintSqFt: number;
  grossFloorAreaSqFt: number;
  mezzanineAreaSqFt?: number;
  heightFt: number;
  aspectRatio: number;
  orientationLabel: string;
}

interface ProgramPlanOptions {
  officeMezzanineSide?: string;
  climateMoves?: string[];
}

const roundDimension = (value: number) => Number(value.toFixed(1));
const slug = (value: string, index: number) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `program-${index + 1}`;

function normalizeSide(value?: string): ProgramPlanSide {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.includes("east")) return "east";
  if (normalized.includes("south")) return "south";
  if (normalized.includes("west")) return "west";
  return "north";
}

function makeZone(
  id: string,
  name: string,
  role: ProgramPlanZone["role"],
  level: ProgramPlanZone["level"],
  areaSqFt: number,
  buildingWidthFt: number,
  source: ProgramPlanZone["source"],
  note: string,
  side?: ProgramPlanSide,
  levelCount?: number,
  dimensionAreaSqFt = areaSqFt,
  buildingDepthFt?: number,
): ProgramPlanZone {
  const widthFactor = role === "primary" ? 0.68 : role === "upper" ? 0.42 : 0.38;
  const widthFt = Math.max(18, Math.min(buildingWidthFt, buildingWidthFt * widthFactor));
  return {
    id,
    name,
    role,
    level,
    areaSqFt: Math.max(0, Math.round(areaSqFt)),
    widthFt: roundDimension(widthFt),
    depthFt: roundDimension(Math.max(1, Math.min(buildingDepthFt ?? Number.POSITIVE_INFINITY, dimensionAreaSqFt / widthFt))),
    side,
    levelCount,
    source,
    note,
  };
}

export function createProgramPlan(brief: DesignBrief, mass: ProgramPlanMass, options: ProgramPlanOptions = {}): ProgramPlan {
  const profile = detectBuildingTypology(brief.buildingType);
  const aspectRatio = Math.max(0.25, mass.aspectRatio || 1);
  const buildingWidthFt = Math.sqrt(Math.max(1, mass.footprintSqFt) * aspectRatio);
  const buildingDepthFt = Math.max(1, mass.footprintSqFt) / buildingWidthFt;
  const sensitiveProgramSide = normalizeSide(options.officeMezzanineSide);
  const upperAreaSqFt = Math.max(0, Math.round(mass.grossFloorAreaSqFt - mass.footprintSqFt));
  const upperLevelCount = upperAreaSqFt > 0 ? Math.ceil(upperAreaSqFt / Math.max(1, mass.footprintSqFt)) : 0;
  const representativeUpperAreaSqFt = upperLevelCount > 0 ? upperAreaSqFt / upperLevelCount : 0;
  const itemizedProgram = brief.program.filter((item) => item.areaSqFt > 0);
  const programTotal = itemizedProgram.reduce((total, item) => total + item.areaSqFt, 0);

  let groundZones: ProgramPlanZone[];
  if (programTotal > 0) {
    const groundTarget = Math.max(1, mass.footprintSqFt);
    groundZones = itemizedProgram.slice(0, 6).map((item, index) => {
      const allocatedGroundArea = item.areaSqFt / programTotal * groundTarget;
      const role: ProgramPlanZone["role"] = index === 0 ? "primary" : /service|utility|mechanical|core|circulation/i.test(item.name) ? "support" : "secondary";
      return makeZone(
        slug(item.name, index),
        item.name,
        role,
        "ground",
        allocatedGroundArea,
        buildingWidthFt,
        "requirement",
        `${item.areaSqFt.toLocaleString()} ft² requested gross program; shown here as a proportional preliminary ground allocation.`,
      );
    });
  } else {
    groundZones = profile.zones.map((zone) => makeZone(
      zone.id,
      zone.name,
      zone.role,
      "ground",
      mass.footprintSqFt * zone.ratio,
      buildingWidthFt,
      "typology-template",
      `Preliminary ${profile.label.toLowerCase()} planning ratio; replace with the project room/program schedule.`,
    ));
  }

  const upperZones = upperAreaSqFt > 0 ? [makeZone(
    "upper-program",
    profile.upperLevelLabel,
    "upper",
    upperLevelCount === 1 && upperAreaSqFt < mass.footprintSqFt ? "mezzanine" : "upper",
    upperAreaSqFt,
    buildingWidthFt,
    "gross-area-remainder",
    `Aggregate ${upperAreaSqFt.toLocaleString()} ft² derived from gross area minus the ground footprint across ${upperLevelCount} upper ${upperLevelCount === 1 ? "level" : "levels"}; dimensions show a representative level, not the aggregate area.`,
    sensitiveProgramSide,
    upperLevelCount,
    representativeUpperAreaSqFt,
    buildingDepthFt,
  )] : [];

  const itemCount = Math.max(0, Math.round(brief.loadingDocks));
  const operations = profile.operations;
  const programSummary = programTotal > 0
    ? `${itemizedProgram.length} itemized program ${itemizedProgram.length === 1 ? "area" : "areas"} · ${programTotal.toLocaleString()} ft² requested`
    : `Program not itemized · preliminary ${profile.label.toLowerCase()} template derived from the ${mass.grossFloorAreaSqFt.toLocaleString()} ft² gross target`;

  return {
    schemaVersion: "sitemorph.program-plan.v2",
    status: "preliminary",
    units: "feet",
    typology: profile.key,
    typologyLabel: profile.label,
    programStatus: programTotal > 0 ? "itemized" : "typology-template",
    programSummary,
    buildingWidthFt: roundDimension(buildingWidthFt),
    buildingDepthFt: roundDimension(buildingDepthFt),
    footprintSqFt: Math.round(mass.footprintSqFt),
    grossFloorAreaSqFt: Math.round(mass.grossFloorAreaSqFt),
    heightFt: mass.heightFt,
    aspectRatio: Number(aspectRatio.toFixed(2)),
    orientation: mass.orientationLabel,
    northEdgeUse: operations.edgeLabel,
    officeMezzanineSide: sensitiveProgramSide,
    zones: [...groundZones, ...upperZones],
    operations: {
      edgeLabel: operations.edgeLabel,
      itemCount,
      itemLabel: profile.key === "logistics" ? operations.itemLabel : itemCount > 0 ? "service bay" : operations.itemLabel,
      side: "north",
      approximateItemSpacingFt: itemCount > 0 ? roundDimension(buildingWidthFt / itemCount) : undefined,
      shelteredBandLabel: operations.shelteredBandLabel,
      shelteredBandDepthFt: operations.shelteredBandDepthFt,
      outdoorZoneLabel: operations.outdoorZoneLabel,
      outdoorZoneDepthFt: operations.outdoorZoneDepthFt,
      dimensionStatus: "concept-assumption",
    },
    parking: {
      requiredSpaces: Math.max(0, Math.round(brief.requiredParking)),
      status: brief.requiredParking > 0 ? "requirement" : "not-specified",
    },
    access: {
      preferredRoad: brief.preferredAccessRoad.trim() || "To be confirmed",
      status: brief.preferredAccessRoad.trim() ? "requirement" : "to-be-confirmed",
    },
    climateMoves: options.climateMoves ?? [
      `Keep the ${operations.edgeLabel.toLowerCase()} shaded and operationally clear.`,
      `Place the most heat-sensitive occupied program on the ${sensitiveProgramSide} side where the tested mass allows it.`,
      "Treat the west edge as an envelope, shade and service-buffer priority.",
    ],
    disclaimer: `Preliminary ${profile.label.toLowerCase()} program diagram, not a permit floor plan. Program ratios, sheltered-edge and outdoor-zone depths are SiteMorph concept assumptions and require planning, access, fire, structural, clinical/operational and civil verification as applicable.`,
  };
}
