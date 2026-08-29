import type { GeneratedBuilding, RevitHandoffReadiness, SiteGeometry } from "../types";
import { polygonBounds } from "../utils/geometry-validation";
import { sampleTerrainBaseElevation } from "../utils/terrain-elevation";
import { resolveFormaElementFootprint } from "./forma-element-footprint.service";
import {
  assertElevationMatchesTerrain,
  assertSingleSiteMorphOwnedRoot,
  listSiteMorphOwnedRootPaths,
  verifyPersistedFormaElementPlacement,
} from "./forma-element-placement.service";
import { getFormaClient } from "./forma.service";

class RevitHandoffService {
  async prepare(building: GeneratedBuilding, geometry: SiteGeometry): Promise<RevitHandoffReadiness> {
    const boundary = geometry.localBoundary;
    if (!boundary?.length) throw new Error("The selected Site Limit has no readable boundary for Revit preflight.");
    const Forma = await getFormaClient();
    await Forma.proposal.awaitProposalPersisted();
    assertSingleSiteMorphOwnedRoot(await listSiteMorphOwnedRootPaths(Forma), building.elementPath);
    const savedBaseElevationMeters = building.baseElevationMeters;
    if (typeof savedBaseElevationMeters !== "number" || !Number.isFinite(savedBaseElevationMeters)) {
      throw new Error("Revit preflight blocked: the generated building has no verified terrain base elevation.");
    }
    const terrain = await sampleTerrainBaseElevation(
      building.projectFootprint,
      ([x, y]) => Forma.terrain.getElevationAt({ x, y }),
    );
    assertElevationMatchesTerrain("Saved building base", savedBaseElevationMeters, terrain.elevationMeters);
    const footprintBounds = polygonBounds(building.projectFootprint);
    const placement = await verifyPersistedFormaElementPlacement(Forma, building.elementPath, {
      terrainBaseElevationMeters: terrain.elevationMeters,
      terrainSampleCount: terrain.successfulSampleCount,
      expectedCenterXMeters: (footprintBounds.minX + footprintBounds.maxX) / 2,
      expectedCenterYMeters: (footprintBounds.minY + footprintBounds.maxY) / 2,
    });
    await resolveFormaElementFootprint(Forma, building.elementPath, building.projectFootprint, boundary);
    await Forma.render.elementColors.clearAll();
    await Forma.render.elementColors.set({ pathsToColor: new Map([[building.elementPath, "#18b8aa"]]) });
    const proposalId = await Forma.proposal.getId();
    return {
      proposalId,
      formaElementPath: building.elementPath,
      preparedAt: new Date().toISOString(),
      transferMode: "forma-revit-addin-beta",
      placementVerified: true,
      placement,
      instructions: [
        "Start from a new blank Revit file for this transfer; do not Load From Forma directly into an existing production model.",
        "Open Proposals in Forma.",
        "Open this proposal’s three-dot menu.",
        "Choose Revit → Send to Revit add-in (Beta).",
        "In the blank Revit file, use Load From Forma once to receive this proposal.",
        "For an existing Revit model, keep the loaded file as a wrapper and use Link Revit; use Bind Link only after coordinate and elevation review.",
      ],
    };
  }
}

export const revitHandoffService = new RevitHandoffService();
