import type { ClimateDNA, ClimateResponseResult, GeneratedBuilding, SiteGeometry } from "../types";
import { buildClimateResponse, type ScalarAnalysisGrid } from "../utils/climate-response";
import { decodeSunGroundGrid } from "../utils/sun-grid";
import { getFormaClient } from "./forma.service";

const HEIGHT_MAP_SIZE = 500;
const HEIGHT_MAP_RESOLUTION = 1.5;
const TERRAIN_SAMPLE_SIZE = 13;

function polygonBounds(points: Array<[number, number]>): { centerX: number; centerY: number } {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return {
    centerX: (Math.min(...xs) + Math.max(...xs)) / 2,
    centerY: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

async function inBatches<T>(items: T[], size: number, task: (item: T) => Promise<number>): Promise<number[]> {
  const output: number[] = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(...await Promise.all(items.slice(index, index + size).map(task)));
  }
  return output;
}

function interpolateTerrain(samples: number[], sampleSize: number): Float32Array {
  const output = new Float32Array(HEIGHT_MAP_SIZE * HEIGHT_MAP_SIZE);
  for (let row = 0; row < HEIGHT_MAP_SIZE; row += 1) {
    const sampleY = (row / (HEIGHT_MAP_SIZE - 1)) * (sampleSize - 1);
    const top = Math.min(sampleSize - 1, Math.floor(sampleY));
    const bottom = Math.min(sampleSize - 1, top + 1);
    const yRatio = sampleY - top;
    for (let column = 0; column < HEIGHT_MAP_SIZE; column += 1) {
      const sampleX = (column / (HEIGHT_MAP_SIZE - 1)) * (sampleSize - 1);
      const left = Math.min(sampleSize - 1, Math.floor(sampleX));
      const right = Math.min(sampleSize - 1, left + 1);
      const xRatio = sampleX - left;
      const topValue = samples[top * sampleSize + left] * (1 - xRatio) + samples[top * sampleSize + right] * xRatio;
      const bottomValue = samples[bottom * sampleSize + left] * (1 - xRatio) + samples[bottom * sampleSize + right] * xRatio;
      output[row * HEIGHT_MAP_SIZE + column] = topValue * (1 - yRatio) + bottomValue * yRatio;
    }
  }
  return output;
}

function rasterizeProposalHeights(
  triangles: Float32Array,
  terrain: Float32Array,
  x0: number,
  y0: number,
): Float32Array {
  const combined = new Float32Array(terrain);
  const epsilon = -0.0001;
  for (let offset = 0; offset + 8 < triangles.length; offset += 9) {
    const x1 = triangles[offset];
    const y1 = triangles[offset + 1];
    const z1 = triangles[offset + 2];
    const x2 = triangles[offset + 3];
    const y2 = triangles[offset + 4];
    const z2 = triangles[offset + 5];
    const x3 = triangles[offset + 6];
    const y3 = triangles[offset + 7];
    const z3 = triangles[offset + 8];
    if (![x1, y1, z1, x2, y2, z2, x3, y3, z3].every(Number.isFinite)) continue;
    const denominator = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
    if (Math.abs(denominator) < 1e-8) continue;
    const minimumColumn = Math.max(0, Math.floor((Math.min(x1, x2, x3) - x0) / HEIGHT_MAP_RESOLUTION));
    const maximumColumn = Math.min(HEIGHT_MAP_SIZE - 1, Math.ceil((Math.max(x1, x2, x3) - x0) / HEIGHT_MAP_RESOLUTION));
    const minimumRow = Math.max(0, Math.floor((y0 - Math.max(y1, y2, y3)) / HEIGHT_MAP_RESOLUTION));
    const maximumRow = Math.min(HEIGHT_MAP_SIZE - 1, Math.ceil((y0 - Math.min(y1, y2, y3)) / HEIGHT_MAP_RESOLUTION));
    if (minimumColumn > maximumColumn || minimumRow > maximumRow) continue;
    for (let row = minimumRow; row <= maximumRow; row += 1) {
      const y = y0 - (row + 0.5) * HEIGHT_MAP_RESOLUTION;
      for (let column = minimumColumn; column <= maximumColumn; column += 1) {
        const x = x0 + (column + 0.5) * HEIGHT_MAP_RESOLUTION;
        const a = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / denominator;
        const b = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / denominator;
        const c = 1 - a - b;
        if (a < epsilon || b < epsilon || c < epsilon) continue;
        const z = a * z1 + b * z2 + c * z3;
        const index = row * HEIGHT_MAP_SIZE + column;
        if (z > combined[index]) combined[index] = z;
      }
    }
  }
  return combined;
}

function normalizeHeightMaps(terrain: Float32Array, combined: Float32Array) {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < terrain.length; index += 1) {
    minimum = Math.min(minimum, terrain[index], combined[index]);
    maximum = Math.max(maximum, terrain[index], combined[index]);
  }
  const range = Math.max(0.1, maximum - minimum);
  const normalize = (values: Float32Array) => Array.from(values, (value) => Math.round(((value - minimum) / range) * 255));
  return {
    terrainHeightArray: normalize(terrain),
    buildingAndTerrainHeightArray: normalize(combined),
    minHeight: minimum,
    maxHeight: maximum,
  };
}

async function loadSunGrid(
  Forma: Awaited<ReturnType<typeof getFormaClient>>,
  analysisId: string | undefined,
): Promise<ScalarAnalysisGrid | undefined> {
  if (!analysisId) return undefined;
  const analysis = await Forma.analysis.getSunAnalysis({ analysisId });
  if (analysis.status !== "SUCCEEDED") return undefined;
  const grid = await Forma.analysis.getGroundGrid({ analysis });
  if (!grid?.grid.length) return undefined;
  const decoded = decodeSunGroundGrid(grid.grid, grid.mask, analysis.parameters.sunPositionsPerHour);
  return {
    grid: decoded.grid,
    mask: decoded.mask,
    width: grid.width,
    height: grid.height,
    x0: grid.x0,
    y0: grid.y0,
    resolution: grid.resolution || Math.abs(grid.scale.x),
    analysisId,
  };
}

async function runRapidWind(
  Forma: Awaited<ReturnType<typeof getFormaClient>>,
  geometry: SiteGeometry,
): Promise<ScalarAnalysisGrid | undefined> {
  const boundary = geometry.localBoundary;
  if (!boundary?.length) return undefined;
  const { centerX, centerY } = polygonBounds(boundary);
  const physicalSize = HEIGHT_MAP_SIZE * HEIGHT_MAP_RESOLUTION;
  const x0 = centerX - physicalSize / 2;
  const y0 = centerY + physicalSize / 2;
  const sampleCoordinates = Array.from({ length: TERRAIN_SAMPLE_SIZE * TERRAIN_SAMPLE_SIZE }, (_, index) => {
    const row = Math.floor(index / TERRAIN_SAMPLE_SIZE);
    const column = index % TERRAIN_SAMPLE_SIZE;
    return {
      x: x0 + (column / (TERRAIN_SAMPLE_SIZE - 1)) * physicalSize,
      y: y0 - (row / (TERRAIN_SAMPLE_SIZE - 1)) * physicalSize,
    };
  });
  const [terrainSamples, proposalTriangles, parameters] = await Promise.all([
    inBatches(sampleCoordinates, 24, (point) => Forma.terrain.getElevationAt(point)),
    Forma.geometry.getTriangles(),
    Forma.predictiveAnalysis.getWindParameters(),
  ]);
  const terrain = interpolateTerrain(terrainSamples, TERRAIN_SAMPLE_SIZE);
  const combined = rasterizeProposalHeights(proposalTriangles, terrain, x0, y0);
  const prediction = await Forma.predictiveAnalysis.predictWind({
    heightMaps: normalizeHeightMaps(terrain, combined),
    windRose: { data: parameters.data, height: parameters.height },
    type: "comfort",
    roughness: parameters.roughness,
    comfortScale: "lawson_lddc",
  });
  if (!prediction.grid.length) return undefined;
  const resolution = Math.abs(prediction.scale.x || HEIGHT_MAP_RESOLUTION);
  return {
    grid: prediction.grid,
    width: prediction.width,
    height: prediction.height,
    x0: centerX - prediction.width * resolution / 2,
    y0: centerY + prediction.height * resolution / 2,
    resolution,
  };
}

class FormaClimateResponseService {
  async create(
    building: GeneratedBuilding,
    geometry: SiteGeometry,
    climate: ClimateDNA,
  ): Promise<ClimateResponseResult> {
    const Forma = await getFormaClient();
    const [sunResult, windResult] = await Promise.allSettled([
      loadSunGrid(Forma, building.sunAnalysisId),
      runRapidWind(Forma, geometry),
    ]);
    const sun = sunResult.status === "fulfilled" ? sunResult.value : undefined;
    const wind = windResult.status === "fulfilled" ? windResult.value : undefined;
    const response = buildClimateResponse({
      climate,
      siteBoundary: geometry.localBoundary ?? [],
      sun,
      wind,
    });
    if (!wind && windResult.status === "rejected") {
      response.summary.note += " Forma Rapid Wind could not be resolved from the current proposal geometry.";
    }
    return response;
  }
}

export const formaClimateResponseService = new FormaClimateResponseService();
