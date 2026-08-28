import type { DesignBrief } from "../types";

export interface ResolvedBuildingProgram {
  mainFloorCount: number;
  grossFloorAreaSqFt: number;
  mezzanineAreaSqFt: number;
  fullFloorCount: number;
  partialTopFloorAreaSqFt: number;
  geometryLevelCount: number;
}

export function resolveBuildingProgram(brief: DesignBrief, footprintSqFt: number): ResolvedBuildingProgram {
  const mainFloorCount = Math.max(1, Math.round(brief.floors || 1));
  const fullFloorCapacitySqFt = footprintSqFt * (mainFloorCount === 1 ? 2 : mainFloorCount);
  const requestedGrossSqFt = brief.totalAreaSqFt > 0 ? brief.totalAreaSqFt : fullFloorCapacitySqFt;
  if (requestedGrossSqFt < footprintSqFt) {
    throw new Error("Total gross area cannot be smaller than the target footprint.");
  }
  if (requestedGrossSqFt > fullFloorCapacitySqFt) {
    throw new Error(mainFloorCount === 1
      ? "The requested one-floor concept needs more than one additional partial level. Increase the floor count or footprint."
      : "Total gross area exceeds the requested floor capacity. Increase the floor count or footprint.");
  }
  const exactFullFloorCount = Math.floor(requestedGrossSqFt / footprintSqFt);
  const remainder = requestedGrossSqFt - exactFullFloorCount * footprintSqFt;
  const fullFloorCount = Math.max(1, exactFullFloorCount);
  const partialTopFloorAreaSqFt = remainder > 0 ? remainder : 0;
  const geometryLevelCount = fullFloorCount + (partialTopFloorAreaSqFt > 0 ? 1 : 0);
  const mezzanineAreaSqFt = mainFloorCount === 1 ? partialTopFloorAreaSqFt : 0;
  return { mainFloorCount, grossFloorAreaSqFt: requestedGrossSqFt, mezzanineAreaSqFt, fullFloorCount, partialTopFloorAreaSqFt, geometryLevelCount };
}
