import type { AnalysisStep } from "../types";

export type AnalysisStepSettlement = "pending" | "failed";

export function settleRunningAnalysisSteps(
  steps: AnalysisStep[],
  settlement: AnalysisStepSettlement,
): AnalysisStep[] {
  return steps.map((step) => step.status === "running" ? { ...step, status: settlement } : step);
}
