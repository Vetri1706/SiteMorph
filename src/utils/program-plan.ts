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

export function isConfirmedAccessRoad(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;
  return !/(^|\b)(confirm|confirmation|to be confirmed|tbd|unknown|not specified|not confirmed)(\b|$)|forma context/i.test(normalized);
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
  const boundedAreaSqFt = Math.max(0, dimensionAreaSqFt);
  let widthFt: number;
  let depthFt: number;
  if (buildingDepthFt && Number.isFinite(buildingDepthFt)) {
    if (level === "ground" || side === "east" || side === "west") {
      depthFt = buildingDepthFt;
      widthFt = boundedAreaSqFt / Math.max(1, depthFt);
    } else {
      widthFt = buildingWidthFt;
      depthFt = boundedAreaSqFt / Math.max(1, widthFt);
    }
    widthFt = Math.max(0.1, Math.min(buildingWidthFt, widthFt));
    depthFt = Math.max(0.1, Math.min(buildingDepthFt, depthFt));
  } else {
    const widthFactor = role === "primary" ? 0.68 : role === "upper" ? 0.42 : 0.38;
    widthFt = Math.max(18, Math.min(buildingWidthFt, buildingWidthFt * widthFactor));
    depthFt = Math.max(1, boundedAreaSqFt / widthFt);
  }
  return {
    id,
    name,
    role,
    level,
    areaSqFt: Math.max(0, Math.round(areaSqFt)),
    widthFt: roundDimension(widthFt),
    depthFt: roundDimension(depthFt),
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
  const planProgramItems = itemizedProgram.length > 6
    ? [
      ...itemizedProgram.slice(0, 5),
      { name: "Other itemized program", areaSqFt: itemizedProgram.slice(5).reduce((total, item) => total + item.areaSqFt, 0) },
    ]
    : itemizedProgram;

  let groundZones: ProgramPlanZone[];
  if (programTotal > 0) {
    const groundTarget = Math.max(1, mass.footprintSqFt);
    groundZones = planProgramItems.map((item, index) => {
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
        upperAreaSqFt === 0 && role === "primary" ? sensitiveProgramSide : undefined,
        undefined,
        allocatedGroundArea,
        buildingDepthFt,
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
      upperAreaSqFt === 0 && zone.role === "primary" ? sensitiveProgramSide : undefined,
      undefined,
      mass.footprintSqFt * zone.ratio,
      buildingDepthFt,
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
  const accessConfirmed = isConfirmedAccessRoad(brief.preferredAccessRoad);
  const interventionProgramLabel = upperAreaSqFt > 0 ? profile.upperLevelLabel : profile.occupiedProgramLabel;
  const interventionProgramLevel = upperAreaSqFt > 0 ? "upper" : "ground";
  const programSummary = programTotal > 0
    ? `${itemizedProgram.length} itemized program ${itemizedProgram.length === 1 ? "area" : "areas"} · ${programTotal.toLocaleString()} ft² requested${itemizedProgram.length > 6 ? " · smaller items grouped in the diagram" : ""}`
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
    interventionProgramLabel,
    interventionProgramLevel,
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
      preferredRoad: accessConfirmed ? brief.preferredAccessRoad.trim() : "To be confirmed",
      status: accessConfirmed ? "requirement" : "to-be-confirmed",
    },
    climateMoves: options.climateMoves ?? [
      `Keep the ${operations.edgeLabel.toLowerCase()} shaded and operationally clear.`,
      `Place the most heat-sensitive ${interventionProgramLabel.toLowerCase()} on the ${sensitiveProgramSide} side where the preliminary program diagram allows it.`,
      "Treat the west edge as an envelope, shade and service-buffer priority.",
    ],
    disclaimer: `Preliminary ${profile.label.toLowerCase()} program diagram, not a permit floor plan. Program ratios, sheltered-edge and outdoor-zone depths are SiteMorph concept assumptions and require planning, access, fire, structural, operational and civil verification as applicable.`,
  };
}

export function groundZonesInSpatialOrder(plan: ProgramPlan): ProgramPlanZone[] {
  const zones = plan.zones.filter((zone) => zone.level === "ground");
  const primaryIndex = zones.findIndex((zone) => zone.role === "primary" && (zone.side === "east" || zone.side === "west"));
  if (primaryIndex < 0) return zones;
  const primary = zones[primaryIndex];
  const others = zones.filter((_, index) => index !== primaryIndex);
  return primary.side === "east" ? [...others, primary] : [primary, ...others];
}

export function formatInterventionPlacement(value: string, plan: ProgramPlan): string {
  if (plan.access.status === "requirement") return value;
  return value
    .replace(/north[- ]west,?\s*access[- ]aligned/gi, "North-west concept placement · access unconfirmed")
    .replace(/an access[- ]aligned mass/gi, "a concept mass (access unconfirmed)")
    .replace(/access[- ]aligned mass/gi, "concept mass (access unconfirmed)")
    .replace(/north[- ]west access edge/gi, "north-west concept edge (access unconfirmed)")
    .replace(/access[- ]aligned/gi, "concept placement · access unconfirmed");
}

export function presentDesignNarrative(value: string | undefined, plan: ProgramPlan): string {
  if (!value) return "No design-decision narrative was recorded.";
  const label = plan.interventionProgramLabel.toLowerCase();
  const typologyAware = value
    .replace(/sensitive\s*\/\s*upper program/gi, label)
    .replace(/sensitive upper program/gi, label);
  return formatInterventionPlacement(typologyAware, plan);
}
