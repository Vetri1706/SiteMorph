import assert from "node:assert/strict";
import test from "node:test";
import { markNoThermalCoverageSteps, settleRunningAnalysisSteps } from "../src/utils/analysis-state.ts";
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

test("a terminal no-coverage result fails climate evidence and skips dependent metrics", () => {
  const coverageSteps: AnalysisStep[] = [
    ...steps,
    { id: "exceedance", label: "Exceedance", status: "pending" },
    { id: "peak-time", label: "Peak time", status: "pending" },
    { id: "ranking", label: "Ranking", status: "pending" },
    { id: "environment", label: "Environment", status: "pending", optional: true },
  ];
  const settled = markNoThermalCoverageSteps(coverageSteps);
  assert.deepEqual(settled.map((step) => step.status), ["completed", "failed", "skipped", "skipped", "skipped", "skipped", "skipped", "skipped"]);
  assert.match(settled.find((step) => step.id === "heatmap")?.detail ?? "", /0 FortyGuard polygon tiles/);
  assert.ok(settled.filter((step) => ["persistence", "exceedance", "peak-time", "ranking"].includes(step.id)).every((step) => step.status === "skipped"));
});
