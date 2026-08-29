import type { ClimateDNA, ClimateResponseResult } from "../types";

export interface ScalarAnalysisGrid {
  grid: Float32Array | Uint8Array;
  mask?: Uint8Array;
  width: number;
  height: number;
  x0: number;
  y0: number;
  resolution: number;
  analysisId?: string;
}

export interface ClimateResponseInputs {
  climate: ClimateDNA;
  siteBoundary: Array<[number, number]>;
  sun?: ScalarAnalysisGrid;
  wind?: ScalarAnalysisGrid;
}

const FG_WEIGHT = 0.45;
const SUN_WEIGHT = 0.35;
const WIND_WEIGHT = 0.20;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function pointInPolygon(point: [number, number], polygon: Array<[number, number]>): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const [x, y] = polygon[index];
    const [previousX, previousY] = polygon[previous];
    if ((y > point[1]) !== (previousY > point[1])
      && point[0] < ((previousX - x) * (point[1] - y)) / (previousY - y) + x) inside = !inside;
  }
  return inside;
}

function validateDecodedSunGrid(source: ScalarAnalysisGrid): void {
  if (!(source.grid instanceof Float32Array)) {
    throw new Error("Forma Sun samples must be decoded to exposure hours before building a Climate Response.");
  }
  const expectedLength = source.width * source.height;
  if (!Number.isInteger(source.width) || source.width <= 0
    || !Number.isInteger(source.height) || source.height <= 0
    || source.grid.length !== expectedLength
    || (source.mask && source.mask.length !== expectedLength)) {
    throw new Error("Forma returned a ground Sun grid whose dimensions do not match its samples and mask.");
  }

  let validSamples = 0;
  for (let index = 0; index < source.grid.length; index += 1) {
    if (source.mask?.[index] === 0) continue;
    const value = Number(source.grid[index]);
    if (!Number.isFinite(value)) {
      throw new Error("Forma returned a non-finite ground Sun value without masking that cell.");
    }
    if (value < 0 || value > 24) {
      throw new Error(`Forma returned an implausible daily Sun value (${value.toFixed(2)} h).`);
    }
    validSamples += 1;
  }
  if (!validSamples) throw new Error("Forma returned no valid ground Sun samples.");
}

function sampleGrid(source: ScalarAnalysisGrid, x: number, y: number): number | undefined {
  const column = Math.floor((x - source.x0) / source.resolution);
  const row = Math.floor((source.y0 - y) / source.resolution);
  if (column < 0 || row < 0 || column >= source.width || row >= source.height) return undefined;
  const index = row * source.width + column;
  if (source.mask && source.mask[index] === 0) return undefined;
  const value = Number(source.grid[index]);
  return Number.isFinite(value) ? value : undefined;
}

export function historicalHeatBurden(climate: ClimateDNA): number {
  const temperature = clamp01((climate.thermal.meanCelsius - 25) / 20);
  const persistence = clamp01((climate.thermal.meanPersistenceHours ?? climate.thermal.longestPersistenceHours) / 24);
  const exceedance = clamp01(climate.thermal.hoursAboveThreshold / 24);
  return 0.40 * temperature + 0.35 * persistence + 0.25 * exceedance;
}

export function buildClimateResponse({ climate, siteBoundary, sun, wind }: ClimateResponseInputs): ClimateResponseResult {
  if (sun) validateDecodedSunGrid(sun);
  const target = sun ?? wind;
  if (!target) throw new Error("A readable Forma Sun or Wind grid is required for the hybrid Climate Response.");
  if (siteBoundary.length < 3) throw new Error("The Forma Site Limit boundary is required for the hybrid Climate Response.");

  const output = new Float32Array(target.width * target.height);
  const mask = new Uint8Array(output.length);
  const baseline = historicalHeatBurden(climate);
  let validCount = 0;
  let siteCellCount = 0;
  let sunCount = 0;
  let windCount = 0;
  let total = 0;
  let maximum = 0;

  for (let row = 0; row < target.height; row += 1) {
    for (let column = 0; column < target.width; column += 1) {
      const index = row * target.width + column;
      const x = target.x0 + (column + 0.5) * target.resolution;
      const y = target.y0 - (row + 0.5) * target.resolution;
      if (!pointInPolygon([x, y], siteBoundary)) continue;
      siteCellCount += 1;

      let weightedRisk = baseline * FG_WEIGHT;
      let activeWeight = FG_WEIGHT;
      const sunValue = sun ? sampleGrid(sun, x, y) : undefined;
      if (sunValue !== undefined) {
        weightedRisk += clamp01(sunValue / 12) * SUN_WEIGHT;
        activeWeight += SUN_WEIGHT;
        sunCount += 1;
      }
      const windValue = wind ? sampleGrid(wind, x, y) : undefined;
      if (windValue !== undefined) {
        // Forma Rapid Wind comfort values are 0–4, with lower values representing
        // better pedestrian conditions. The factor is therefore already risk-oriented.
        weightedRisk += clamp01(windValue / 4) * WIND_WEIGHT;
        activeWeight += WIND_WEIGHT;
        windCount += 1;
      }
      // A fine-grained response cell must be supported by at least one native
      // Forma grid. Historical FortyGuard evidence remains site-wide, but it
      // must not manufacture a fine raster where both native inputs are absent.
      if (sunValue === undefined && windValue === undefined) continue;
      const score = Number(((weightedRisk / activeWeight) * 100).toFixed(2));
      output[index] = score;
      mask[index] = 1;
      validCount += 1;
      total += score;
      maximum = Math.max(maximum, score);
    }
  }

  if (!validCount) throw new Error("Forma analysis grids did not overlap the selected Site Limit.");
  const coverage = (count: number) => Number(((count / Math.max(1, siteCellCount)) * 100).toFixed(1));
  const inputs: ClimateResponseResult["summary"]["inputs"] = [{
    id: "fortyguard-history",
    label: "FortyGuard hot-season historical burden",
    source: "fortyguard",
    configuredWeightPercent: FG_WEIGHT * 100,
    resolutionMeters: 60,
    coveragePercent: 100,
  }];
  if (sun) inputs.push({
    id: "forma-sun",
    label: "Forma native ground Sun exposure",
    source: "forma",
    configuredWeightPercent: SUN_WEIGHT * 100,
    analysisId: sun.analysisId,
    resolutionMeters: sun.resolution,
    coveragePercent: coverage(sunCount),
  });
  if (wind) inputs.push({
    id: "forma-wind",
    label: "Forma Rapid Wind comfort",
    source: "forma",
    configuredWeightPercent: WIND_WEIGHT * 100,
    analysisId: wind.analysisId,
    resolutionMeters: wind.resolution,
    coveragePercent: coverage(windCount),
  });

  const missing = [sun && sunCount > 0 ? null : "Sun", wind && windCount > 0 ? null : "Wind"].filter((item): item is string => Boolean(item));
  return {
    grid: {
      grid: output,
      mask,
      width: target.width,
      height: target.height,
      x0: target.x0,
      y0: target.y0,
      resolution: target.resolution,
    },
    summary: {
      generatedAt: new Date().toISOString(),
      status: missing.length ? "partial" : "complete",
      label: "Forma-resolved Climate Response",
      meanRiskScore: Number((total / validCount).toFixed(1)),
      maximumRiskScore: Number(maximum.toFixed(1)),
      resolutionMeters: target.resolution,
      historicalBaselineScore: Number((baseline * 100).toFixed(1)),
      inputs,
      formula: "45% FortyGuard historical burden + 35% Forma ground Sun + 20% Forma Rapid Wind comfort; available inputs are renormalized per valid cell.",
      note: missing.length
        ? `${missing.join(" and ")} grid unavailable. The response is partial and does not claim the missing native analysis.`
        : "All displayed spatial variation comes from Forma's geometry-responsive grids; FortyGuard contributes the parcel's historical baseline without fabricated sub-cell detail.",
    },
  };
}
