export interface SunMetricSnapshot {
  meanHours?: number;
  maxHours?: number;
}

export interface SunInterventionDecision {
  accepted: boolean;
  reason: "mean-improved" | "peak-improved" | "no-measured-improvement" | "metrics-unavailable";
  meanDeltaHours?: number;
  maxDeltaHours?: number;
}

function roundedDelta(value: number): number {
  return Number(value.toFixed(1));
}

export function evaluateSunIntervention(
  initial: SunMetricSnapshot,
  tested: SunMetricSnapshot,
): SunInterventionDecision {
  if (initial.meanHours === undefined || tested.meanHours === undefined) {
    return { accepted: false, reason: "metrics-unavailable" };
  }
  const meanDeltaHours = roundedDelta(initial.meanHours - tested.meanHours);
  const maxDeltaHours = initial.maxHours === undefined || tested.maxHours === undefined
    ? undefined
    : roundedDelta(initial.maxHours - tested.maxHours);
  if (meanDeltaHours >= 0.1) return { accepted: true, reason: "mean-improved", meanDeltaHours, maxDeltaHours };
  if (meanDeltaHours >= 0 && maxDeltaHours !== undefined && maxDeltaHours >= 0.2) {
    return { accepted: true, reason: "peak-improved", meanDeltaHours, maxDeltaHours };
  }
  return { accepted: false, reason: "no-measured-improvement", meanDeltaHours, maxDeltaHours };
}
