import assert from "node:assert/strict";
import test from "node:test";
import { settleRunningAnalysisSteps } from "../src/utils/analysis-state.ts";
import type { AnalysisStep } from "../src/types/index.ts";

const steps: AnalysisStep[] = [
  { id: "geometry", label: "Geometry", status: "completed" },
  { id: "heatmap", label: "Climate evidence", status: "running" },
  { id: "persistence", label: "Persistence", status: "pending" },
  { id: "street", label: "Street", status: "skipped" },
];

test("a stopped status check never leaves a step visually running", () => {
  const settled = settleRunningAnalysisSteps(steps, "pending");
  assert.deepEqual(settled.map((step) => step.status), ["completed", "pending", "pending", "skipped"]);
  assert.ok(settled.every((step) => step.status !== "running"));
});

test("a hard failure marks only the active step as failed", () => {
  const settled = settleRunningAnalysisSteps(steps, "failed");
  assert.deepEqual(settled.map((step) => step.status), ["completed", "failed", "pending", "skipped"]);
});
