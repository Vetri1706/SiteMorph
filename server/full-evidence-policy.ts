export const OPTIONAL_EVIDENCE_ACTIVITY_COUNT = 3;

export function requiredNewActivityCount(
  missingHeatActivities: number,
  includeOptionalEvidence: boolean,
  cacheOnly: boolean,
): number {
  return missingHeatActivities + (includeOptionalEvidence && !cacheOnly ? OPTIONAL_EVIDENCE_ACTIVITY_COUNT : 0);
}

export type OptionalEvidenceFailureKind = "pending" | "missing" | "hard";

export function classifyOptionalEvidenceFailure(error: unknown): OptionalEvidenceFailureKind {
  const status = error && typeof error === "object" && "status" in error ? Number(error.status) : undefined;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (status === 504 || message.includes("still running")) return "pending";
  if (status === 429 || message.includes("activity limit")) return "missing";
  return "hard";
}
