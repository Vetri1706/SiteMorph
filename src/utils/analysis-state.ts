import type { AnalysisStep } from "../types";

export type AnalysisStepSettlement = "pending" | "failed";

export function settleRunningAnalysisSteps(
  steps: AnalysisStep[],
  settlement: AnalysisStepSettlement,
): AnalysisStep[] {
  return steps.map((step) => step.status === "running" ? { ...step, status: settlement } : step);
}

const thermalDependentStepIds = new Set(["persistence", "exceedance", "peak-time", "ranking"]);

export function markNoThermalCoverageSteps(steps: AnalysisStep[]): AnalysisStep[] {
  return steps.map((step) => {
    if (step.id === "geometry") return { ...step, status: "completed" };
    if (step.id === "heatmap") {
      return {
        ...step,
        status: "failed",
        detail: "0 FortyGuard polygon tiles returned · saved activity IDs retained",
      };
    }
    if (thermalDependentStepIds.has(step.id)) {
      return { ...step, status: "skipped", detail: "Skipped · no thermal tiles available" };
    }
    return step.status === "pending" || step.status === "running"
      ? { ...step, status: "skipped", detail: "Skipped · core climate evidence unavailable" }
      : step;
  });
}
