import { createHash } from "node:crypto";
import type { Feature, Polygon } from "geojson";

export interface AnalysisCacheKeyInput {
  geometry?: Feature<Polygon>;
  thresholdCelsius?: number;
  siteTimezone?: string;
}

export interface AnalysisCacheKeyConfig {
  analysisDates: string[];
  granularity: 60 | 80 | 100;
  includeOptionalEvidence?: boolean;
  cacheVersion?: string;
}

function canonicalRing(geometry: Feature<Polygon> | undefined): number[][] {
  const source = geometry?.geometry.coordinates[0] ?? [];
  const rounded = source.map(([longitude, latitude]) => [Number(longitude.toFixed(6)), Number(latitude.toFixed(6))]);
  const points = rounded.length > 1 && rounded[0][0] === rounded.at(-1)?.[0] && rounded[0][1] === rounded.at(-1)?.[1]
    ? rounded.slice(0, -1)
    : rounded;
  if (points.length < 3) return points;
  const candidates: number[][][] = [];
  for (const direction of [points, [...points].reverse()]) {
    for (let index = 0; index < direction.length; index += 1) {
      candidates.push([...direction.slice(index), ...direction.slice(0, index)]);
    }
  }
  return candidates.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))[0];
}

export function analysisCacheKey(body: AnalysisCacheKeyInput, config: AnalysisCacheKeyConfig): string {
  const descriptor = JSON.stringify({
    schema: config.cacheVersion || "v1",
    geometry: canonicalRing(body.geometry),
    thresholdCelsius: body.thresholdCelsius ?? 35,
    dates: config.analysisDates,
    granularity: config.granularity,
    includeOptionalEvidence: config.includeOptionalEvidence ?? false,
    siteTimezone: body.siteTimezone || "UTC",
  });
  return createHash("sha256").update(descriptor).digest("hex");
}

export function activityCacheKey(
  geometry: Feature<Polygon> | undefined,
  operation: string,
  parameters: Record<string, unknown>,
  cacheVersion = "v1",
): string {
  const descriptor = JSON.stringify({
    schema: cacheVersion,
    geometry: canonicalRing(geometry),
    operation,
    parameters,
  });
  return createHash("sha256").update(descriptor).digest("hex");
}
