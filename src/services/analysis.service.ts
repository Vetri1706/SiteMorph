import analysisMock from "../mocks/forma-analysis.json";
import type { DesignCandidate, FormaAnalysis } from "../types";
import { appConfig, delay } from "../utils/config";

export interface AnalysisServiceContract {
  requestAnalysis(candidate: DesignCandidate): Promise<FormaAnalysis>;
  readAnalyses(): Promise<FormaAnalysis[]>;
}

class AnalysisService implements AnalysisServiceContract {
  async requestAnalysis(candidate: DesignCandidate): Promise<FormaAnalysis> {
    if (appConfig.mockMode) {
      await delay(720);
      const analysis = (analysisMock as FormaAnalysis[]).find((item) => item.candidateId === candidate.id);
      if (!analysis) throw new Error("No precomputed Forma analysis exists for this candidate");
      return analysis;
    }
    const response = await fetch(`${appConfig.backendUrl}/forma/analyses/${candidate.externalDesignId}`, { method: "POST" });
    if (!response.ok) throw new Error("Forma analysis request failed");
    return (await response.json()) as FormaAnalysis;
  }

  async readAnalyses(): Promise<FormaAnalysis[]> {
    if (appConfig.mockMode) return analysisMock as FormaAnalysis[];
    const response = await fetch(`${appConfig.backendUrl}/forma/analyses`);
    if (!response.ok) throw new Error("Forma analyses unavailable");
    return (await response.json()) as FormaAnalysis[];
  }
}

export const analysisService = new AnalysisService();
