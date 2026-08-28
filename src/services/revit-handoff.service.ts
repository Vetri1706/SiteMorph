import type { GeneratedBuilding, RevitHandoffReadiness, SiteGeometry } from "../types";
import { resolveFormaElementFootprint } from "./forma-element-footprint.service";
import { getFormaClient } from "./forma.service";

class RevitHandoffService {
  async prepare(building: GeneratedBuilding, geometry: SiteGeometry): Promise<RevitHandoffReadiness> {
    const boundary = geometry.localBoundary;
    if (!boundary?.length) throw new Error("The selected Site Limit has no readable boundary for Revit preflight.");
    const Forma = await getFormaClient();
    await Forma.proposal.awaitProposalPersisted();
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
      instructions: [
        "Open Proposals in Forma.",
        "Open this proposal’s three-dot menu.",
        "Choose Revit → Send to Revit add-in (Beta).",
        "In Revit, use Load From Forma to receive the proposal.",
      ],
    };
  }
}

export const revitHandoffService = new RevitHandoffService();
