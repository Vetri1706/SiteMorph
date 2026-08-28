import candidatesMock from "../mocks/candidates.json";
import type { ClimateDNA, DesignBrief, DesignCandidate } from "../types";
import { appConfig, delay } from "../utils/config";

export interface DesignGenerationService {
  generateCandidates(brief: DesignBrief, climate: ClimateDNA): Promise<DesignCandidate[]>;
  modifyCandidate(candidate: DesignCandidate): Promise<DesignCandidate>;
  activateCandidate(candidate: DesignCandidate): Promise<void>;
}

class DesignService implements DesignGenerationService {
  async generateCandidates(brief: DesignBrief, climate: ClimateDNA): Promise<DesignCandidate[]> {
    if (appConfig.mockMode) {
      await delay(1050);
      return candidatesMock as DesignCandidate[];
    }
    const response = await fetch(`${appConfig.backendUrl}/design/candidates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief, climateId: climate.id, constraints: climate.constraints }),
    });
    if (!response.ok) throw new Error("Design generation service unavailable");
    return (await response.json()) as DesignCandidate[];
  }

  async modifyCandidate(candidate: DesignCandidate): Promise<DesignCandidate> {
    if (appConfig.mockMode) {
      await delay(1100);
      return {
        ...candidate,
        id: "candidate-b2",
        label: "B2",
        name: "Balanced — Improved",
        externalDesignId: "forma_design_b2",
        orientationDegrees: candidate.orientationDegrees + 9,
        orientationLabel: "17° NE",
        isImproved: true,
        parentCandidateId: candidate.id,
        scores: { ...candidate.scores, overall: 91, microclimate: 92, sun: 94, wind: 84, energy: 89, climateFit: 93 },
      };
    }
    const response = await fetch(`${appConfig.backendUrl}/design/candidates/${candidate.id}/improve`, { method: "POST" });
    if (!response.ok) throw new Error("Candidate redesign failed");
    return (await response.json()) as DesignCandidate;
  }

  async activateCandidate(candidate: DesignCandidate): Promise<void> {
    if (appConfig.mockMode) {
      await delay(260);
      return;
    }
    const response = await fetch(`${appConfig.backendUrl}/design/candidates/${candidate.id}/activate`, { method: "POST" });
    if (!response.ok) throw new Error("Candidate could not be activated in Forma");
  }
}

export const designService = new DesignService();
