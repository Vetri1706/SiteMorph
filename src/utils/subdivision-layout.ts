import type { ClimateDNA, SiteGeometry } from "../types";
import type {
  FortyGuardBurdenInput,
  FortyGuardHistoricalBurden,
  SubdivisionBrief,
  SubdivisionClimatePerformance,
  SubdivisionDwelling,
  SubdivisionDwellingGroup,
  SubdivisionLayoutInput,
  SubdivisionLot,
  SubdivisionMetrics,
  SubdivisionOpenSpace,
  SubdivisionPlan,
  SubdivisionPoint,
  SubdivisionRoad,
  SubdivisionScoreBreakdown,
  SubdivisionScoreComponent,
  SubdivisionStrategy,
  SubdivisionTreePoint,
  SubdivisionVariant,
} from "../types/subdivision";
import { pointInPolygon } from "./geometry-validation.ts";

const FEET_PER_METER = 3.280839895;
const SQFT_PER_SQM = 10.7639104167;
const CONCEPT_TREE_CANOPY_SQFT = 300;

interface LocalFrame {
  origin: SubdivisionPoint;
  axis: SubdivisionPoint;
  angleDegrees: number;
  boundary: SubdivisionPoint[];
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
}

interface StrategyDefinition {
  strategy: SubdivisionStrategy;
  label: string;
  widthScale: number;
  depthScale: number;
  extraPerimeterMeters: number;
  corridorFractions: number[];
  canopyDeliveryFraction: number;
  shadeRouteMultiplier: number;
  spacingMultiplier: number;
  bandGapMeters: number;
}

interface LocalLotCandidate {
  rowId: SubdivisionLot["rowId"];
  bandIndex: number;
  roadId: string;
  column: number;
  polygon: SubdivisionPoint[];
  widthMeters: number;
  depthMeters: number;
}

interface LocalBandLayout {
  bandIndex: number;
  roadId: string;
  roadCenterV: number;
  roadSpan: [number, number];
  corridorColumns: number[];
  candidates: LocalLotCandidate[];
}

interface DraftVariant {
  definition: StrategyDefinition;
  lots: SubdivisionLot[];
  dwellings: SubdivisionDwelling[];
  dwellingGroups: SubdivisionDwellingGroup[];
  roads: SubdivisionRoad[];
  trees: SubdivisionTreePoint[];
  openSpaces: SubdivisionOpenSpace[];
  metrics: SubdivisionMetrics;
  climatePerformance: SubdivisionClimatePerformance;
  assumptions: string[];
  warnings: string[];
}

const STRATEGIES: StrategyDefinition[] = [
  {
    strategy: "compact-yield",
    label: "Compact yield",
    widthScale: 1,
    depthScale: 1.08,
    extraPerimeterMeters: 0,
    corridorFractions: [],
    canopyDeliveryFraction: 0.48,
    shadeRouteMultiplier: 0.92,
    spacingMultiplier: 0.95,
    bandGapMeters: 0.6,
  },
  {
    strategy: "balanced-neighborhood",
    label: "Balanced neighborhood",
    widthScale: 1.05,
    depthScale: 1.04,
    extraPerimeterMeters: 1.5,
    corridorFractions: [0.5],
    canopyDeliveryFraction: 0.72,
    shadeRouteMultiplier: 0.80,
    spacingMultiplier: 0.84,
    bandGapMeters: 3.5,
  },
  {
    strategy: "heat-resilient-neighborhood",
    label: "Heat-resilient neighborhood",
    widthScale: 1.10,
    depthScale: 1,
    extraPerimeterMeters: 3,
    corridorFractions: [0.33, 0.67],
    canopyDeliveryFraction: 1,
    shadeRouteMultiplier: 0.66,
    spacingMultiplier: 0.73,
    bandGapMeters: 7,
  },
];

const round = (value: number, digits = 2): number => Number(value.toFixed(digits));
const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value));
const feetToMeters = (value: number): number => value / FEET_PER_METER;
const sqmToSqft = (value: number): number => value * SQFT_PER_SQM;

function validatePositive(label: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive finite number.`);
}

function validateInputs(geometry: SiteGeometry, climate: ClimateDNA, brief: SubdivisionBrief): void {
  if (!geometry.localBoundary || geometry.localBoundary.length < 3) {
    throw new Error("A real Forma Site Limit local boundary is required for subdivision generation.");
  }
  validatePositive("Target lot area", brief.targetLotAreaSqFt);
  validatePositive("Minimum lot width", brief.minimumLotWidthFt);
  validatePositive("Dwelling GFA", brief.dwellingGfaSqFt);
  validatePositive("Floor count", brief.floors);
  validatePositive("Road width", brief.roadWidthFt);
  if (!Number.isInteger(brief.floors) || !Number.isInteger(brief.maxConnectedDwellings) || brief.maxConnectedDwellings < 1) {
    throw new Error("Floor count and maximum connected dwellings must be positive integers.");
  }
  if (!climate.thermal || !Number.isFinite(climate.thermal.meanCelsius)) {
    throw new Error("Real FortyGuard thermal metrics are required for subdivision generation.");
  }
}

function cleanBoundary(points: SubdivisionPoint[]): SubdivisionPoint[] {
  const clean = points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (clean.length > 3) {
    const first = clean[0];
    const last = clean.at(-1)!;
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6) clean.pop();
  }
  if (clean.length < 3) throw new Error("The Forma Site Limit does not contain a usable polygon.");
  return clean;
}

function polygonArea(points: SubdivisionPoint[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[(index + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

function polygonCentroid(points: SubdivisionPoint[]): SubdivisionPoint {
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[(index + 1) % points.length];
    const cross = x1 * y2 - x2 * y1;
    twiceArea += cross;
    x += (x1 + x2) * cross;
    y += (y1 + y2) * cross;
  }
  if (Math.abs(twiceArea) < 1e-8) {
    return [
      points.reduce((total, point) => total + point[0], 0) / points.length,
      points.reduce((total, point) => total + point[1], 0) / points.length,
    ];
  }
  return [x / (3 * twiceArea), y / (3 * twiceArea)];
}

function createLocalFrame(worldBoundary: SubdivisionPoint[]): LocalFrame {
  const origin = polygonCentroid(worldBoundary);
  let covarianceXX = 0;
  let covarianceYY = 0;
  let covarianceXY = 0;
  for (const [x, y] of worldBoundary) {
    const dx = x - origin[0];
    const dy = y - origin[1];
    covarianceXX += dx * dx;
    covarianceYY += dy * dy;
    covarianceXY += dx * dy;
  }
  let angle = 0.5 * Math.atan2(2 * covarianceXY, covarianceXX - covarianceYY);
  let axis: SubdivisionPoint = [Math.cos(angle), Math.sin(angle)];
  if (axis[0] < 0 || (Math.abs(axis[0]) < 1e-9 && axis[1] < 0)) {
    axis = [-axis[0], -axis[1]];
    angle += Math.PI;
  }
  const boundary = worldBoundary.map(([x, y]): SubdivisionPoint => {
    const dx = x - origin[0];
    const dy = y - origin[1];
    return [dx * axis[0] + dy * axis[1], -dx * axis[1] + dy * axis[0]];
  });
  const us = boundary.map(([u]) => u);
  const vs = boundary.map(([, v]) => v);
  return {
    origin,
    axis,
    angleDegrees: round((angle * 180) / Math.PI, 3),
    boundary,
    minU: Math.min(...us),
    maxU: Math.max(...us),
    minV: Math.min(...vs),
    maxV: Math.max(...vs),
  };
}

function toWorld(frame: LocalFrame, [u, v]: SubdivisionPoint): SubdivisionPoint {
  return [
    round(frame.origin[0] + u * frame.axis[0] - v * frame.axis[1], 4),
    round(frame.origin[1] + u * frame.axis[1] + v * frame.axis[0], 4),
  ];
}

function closePolygon(points: SubdivisionPoint[]): SubdivisionPoint[] {
  return [...points, points[0]];
}

function rectangle(u0: number, u1: number, v0: number, v1: number): SubdivisionPoint[] {
  return closePolygon([[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
}

function polygonGate(polygon: SubdivisionPoint[], boundary: SubdivisionPoint[]): boolean {
  const open = polygon.slice(0, -1);
  const samples = [...open];
  for (let index = 0; index < open.length; index += 1) {
    const start = open[index];
    const end = open[(index + 1) % open.length];
    samples.push([(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]);
  }
  samples.push([
    open.reduce((total, point) => total + point[0], 0) / open.length,
    open.reduce((total, point) => total + point[1], 0) / open.length,
  ]);
  return samples.every((point) => pointInPolygon(point, boundary, 0.08));
}

function findSafeHorizontalSpan(frame: LocalFrame, vMin: number, vMax: number): [number, number] | undefined {
  const step = clamp((frame.maxU - frame.minU) / 500, 0.25, 0.75);
  let currentStart: number | undefined;
  let best: [number, number] | undefined;
  for (let u = frame.minU; u <= frame.maxU + step / 2; u += step) {
    const safe = [vMin, (vMin + vMax) / 2, vMax].every((v) => pointInPolygon([u, v], frame.boundary, 0.08));
    if (safe && currentStart === undefined) currentStart = u;
    if ((!safe || u >= frame.maxU) && currentStart !== undefined) {
      const end = safe ? Math.min(u, frame.maxU) : u - step;
      if (!best || end - currentStart > best[1] - best[0]) best = [currentStart, end];
      currentStart = undefined;
    }
  }
  // A fully rectangular boundary can remain safe through the last sampled
  // value without the floating-point loop landing exactly on maxU.
  if (currentStart !== undefined) {
    const end = frame.maxU;
    if (!best || end - currentStart > best[1] - best[0]) best = [currentStart, end];
  }
  return best && best[1] - best[0] > 5 ? best : undefined;
}

function weightedGeometricMean(values: Array<{ value: number; weight: number }>): number {
  const totalWeight = values.reduce((total, item) => total + item.weight, 0);
  return Math.exp(values.reduce((total, item) => total + item.weight * Math.log(clamp(item.value, 0.02, 1)), 0) / totalWeight);
}

function timeOfMeasureAvailable(climate: ClimateDNA): boolean {
  const labels = [climate.thermal.peakThermalHour, climate.thermal.peakThermalHourUtc]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
  if (labels && !/unknown|unavailable|not available|n\/a/.test(labels)) return true;
  return Boolean(climate.activityIds?.heat?.some((activity) => activity.timeOfMeasure));
}

export function deriveFortyGuardHistoricalBurden(climate: ClimateDNA): FortyGuardHistoricalBurden {
  const meanPersistence = climate.thermal.meanPersistenceHours ?? climate.thermal.longestPersistenceHours;
  const timeAvailable = timeOfMeasureAvailable(climate);
  const peakThermalHour = timeAvailable && climate.thermal.peakThermalHour ? climate.thermal.peakThermalHour : null;
  const peakThermalHourUtc = timeAvailable && climate.thermal.peakThermalHourUtc ? climate.thermal.peakThermalHourUtc : null;
  const values: Array<Omit<FortyGuardBurdenInput, "source">> = [
    {
      id: "mean-temperature",
      label: "Hot-season mean temperature",
      value: climate.thermal.meanCelsius,
      unit: "°C",
      normalizedRisk: clamp((climate.thermal.meanCelsius - 20) / 25, 0, 1),
      weightPercent: 35,
    },
    {
      id: "mean-persistence",
      label: "Mean continuous persistence",
      value: meanPersistence,
      unit: "h",
      normalizedRisk: clamp(meanPersistence / 24, 0, 1),
      weightPercent: 25,
    },
    {
      id: "maximum-continuous-persistence",
      label: "Maximum continuous persistence",
      value: climate.thermal.longestPersistenceHours,
      unit: "h",
      normalizedRisk: clamp(climate.thermal.longestPersistenceHours / 24, 0, 1),
      weightPercent: 20,
    },
    {
      id: "mean-exceedance",
      label: `Mean exceedance above ${round(climate.thermal.thresholdCelsius, 1)} °C`,
      value: climate.thermal.hoursAboveThreshold,
      unit: "h",
      normalizedRisk: clamp(climate.thermal.hoursAboveThreshold / 24, 0, 1),
      weightPercent: 20,
    },
  ];
  const score = weightedGeometricMean(values.map((input) => ({ value: input.normalizedRisk, weight: input.weightPercent })));
  const uniform = climate.designBrief.thermalZoningConfidence === "LOW"
    || (climate.thermal.hotZonePercent === 0 && climate.thermal.coolZonePercent === 0)
    || climate.zones.length === 0;
  return {
    source: "FortyGuard historical thermal evidence",
    score: round(score, 4),
    scorePercent: round(score * 100, 1),
    evidenceGeneratedAt: climate.generatedAt,
    formula: "Weighted geometric mean: temperature 35% × mean persistence 25% × maximum continuous persistence 20% × mean exceedance 20%. Peak thermal hour is supporting evidence and is excluded from the numerical burden.",
    inputs: values.map((input) => ({ ...input, value: round(input.value, 2), normalizedRisk: round(input.normalizedRisk, 4), source: "FortyGuard" })),
    timeOfMeasureAvailable: timeAvailable,
    peakThermalHour,
    peakThermalHourUtc,
    peakTimeEvidenceNote: timeAvailable
      ? "FortyGuard peak thermal timing is retained as supporting evidence and evidence-completeness context; it does not increase or decrease the historical burden score."
      : "FortyGuard peak thermal timing was unavailable. The four-signal historical burden is unchanged; SiteMorph does not invent a peak hour.",
    thermalZoningMode: uniform ? "site-wide" : "tile-informed",
    directionalClaim: null,
    spatialNote: uniform
      ? "The parcel is thermally uniform at FortyGuard resolution. Use site-wide heat constraints and let Forma optimize internal building placement."
      : "The layout remains geometry-driven; any directional preference requires an auditable ranked-tile handoff and is not inferred by this subdivision engine.",
  };
}

function reservedColumns(columnCount: number, fractions: number[]): Set<number> {
  const result = new Set<number>();
  if (columnCount < 8) return result;
  for (const fraction of fractions) result.add(clamp(Math.round((columnCount - 1) * fraction), 1, columnCount - 2));
  return result;
}

function localBandAtCenter(
  frame: LocalFrame,
  definition: StrategyDefinition,
  brief: SubdivisionBrief,
  bandIndex: number,
  roadCenterV: number,
  targetDepth: number,
): LocalBandLayout | undefined {
  const roadHalf = feetToMeters(brief.roadWidthFt) / 2;
  const pathWidth = Math.max(0, feetToMeters(brief.pedestrianPathWidthFt));
  // The shared span must contain the carriageway and both pedestrian paths;
  // checking only the road corners can push path endpoints through a rotated
  // or tapered Site Limit.
  const span = findSafeHorizontalSpan(frame, roadCenterV - roadHalf - pathWidth, roadCenterV + roadHalf + pathWidth);
  if (!span) return undefined;
  const perimeter = feetToMeters(brief.setbacks.sitePerimeterFt) + definition.extraPerimeterMeters;
  const width = feetToMeters(brief.minimumLotWidthFt) * definition.widthScale;
  const minU = span[0] + perimeter;
  const maxU = span[1] - perimeter;
  const columnCount = Math.floor((maxU - minU) / width);
  if (columnCount < 2) return undefined;
  const usedWidth = columnCount * width;
  const firstU = minU + (maxU - minU - usedWidth) / 2;
  const reserved = reservedColumns(columnCount, definition.corridorFractions);
  const candidates: LocalLotCandidate[] = [];
  const roadId = `internal-access-road-${bandIndex + 1}`;
  const frontA = roadCenterV + roadHalf + pathWidth;
  const frontB = roadCenterV - roadHalf - pathWidth;
  for (let column = 0; column < columnCount; column += 1) {
    if (reserved.has(column)) continue;
    const u0 = firstU + column * width;
    const u1 = u0 + width;
    const rowAPolygon = rectangle(u0, u1, frontA, frontA + targetDepth);
    const rowBPolygon = rectangle(u0, u1, frontB - targetDepth, frontB);
    if (polygonGate(rowAPolygon, frame.boundary)) {
      candidates.push({ rowId: "row-a", bandIndex, roadId, column, polygon: rowAPolygon, widthMeters: width, depthMeters: targetDepth });
    }
    if (polygonGate(rowBPolygon, frame.boundary)) {
      candidates.push({ rowId: "row-b", bandIndex, roadId, column, polygon: rowBPolygon, widthMeters: width, depthMeters: targetDepth });
    }
  }
  if (candidates.length < 2) return undefined;
  return {
    bandIndex,
    roadId,
    roadCenterV,
    roadSpan: span,
    corridorColumns: [...reserved].sort((a, b) => a - b),
    candidates,
  };
}

function localBandLayouts(
  frame: LocalFrame,
  definition: StrategyDefinition,
  brief: SubdivisionBrief,
): { bands: LocalBandLayout[]; targetDepth: number } | undefined {
  const perimeter = feetToMeters(brief.setbacks.sitePerimeterFt) + definition.extraPerimeterMeters;
  const width = feetToMeters(brief.minimumLotWidthFt) * definition.widthScale;
  const requestedDepth = (brief.targetLotAreaSqFt / SQFT_PER_SQM) / width * definition.depthScale;
  const roadEnvelope = feetToMeters(brief.roadWidthFt) + 2 * Math.max(0, feetToMeters(brief.pedestrianPathWidthFt));
  const availableDepth = frame.maxV - frame.minV - 2 * perimeter;
  const requestedBandDepth = requestedDepth * 2 + roadEnvelope;
  let bandCount = Math.floor((availableDepth + definition.bandGapMeters) / (requestedBandDepth + definition.bandGapMeters));
  let targetDepth = requestedDepth;

  // Preserve a useful single-band fallback for unusually shallow Site Limits,
  // but never shrink a requested lot row below 72% of its target depth.
  if (bandCount < 1) {
    bandCount = 1;
    targetDepth = (availableDepth - roadEnvelope) / 2;
    if (targetDepth < requestedDepth * 0.72) return undefined;
  }
  bandCount = Math.min(8, bandCount);
  const usedDepth = bandCount * (targetDepth * 2 + roadEnvelope) + (bandCount - 1) * definition.bandGapMeters;
  const firstBandBottom = frame.minV + perimeter + Math.max(0, (availableDepth - usedDepth) / 2);
  const roadOffset = targetDepth + Math.max(0, feetToMeters(brief.pedestrianPathWidthFt)) + feetToMeters(brief.roadWidthFt) / 2;
  const bands = Array.from({ length: bandCount }, (_, bandIndex) => {
    const bandBottom = firstBandBottom + bandIndex * (targetDepth * 2 + roadEnvelope + definition.bandGapMeters);
    return localBandAtCenter(frame, definition, brief, bandIndex, bandBottom + roadOffset, targetDepth);
  }).filter((band): band is LocalBandLayout => Boolean(band));
  return bands.length ? { bands, targetDepth } : undefined;
}

function createDwellingFootprint(
  candidate: LocalLotCandidate,
  brief: SubdivisionBrief,
): { polygon: SubdivisionPoint[]; footprintSqFt: number; constrained: boolean } {
  const side = feetToMeters(brief.setbacks.sideFt);
  const front = feetToMeters(brief.setbacks.frontFt);
  const rear = feetToMeters(brief.setbacks.rearFt);
  const open = candidate.polygon.slice(0, -1);
  const minU = Math.min(...open.map(([u]) => u));
  const maxU = Math.max(...open.map(([u]) => u));
  const minV = Math.min(...open.map(([, v]) => v));
  const maxV = Math.max(...open.map(([, v]) => v));
  const width = Math.max(2.8, maxU - minU - side * 2);
  const requestedFootprintSqm = brief.dwellingGfaSqFt / SQFT_PER_SQM / brief.floors;
  const maximumDepth = Math.max(3.5, maxV - minV - front - rear);
  const depth = Math.min(maximumDepth, requestedFootprintSqm / width);
  const constrained = depth + 0.05 < requestedFootprintSqm / width;
  if (candidate.rowId === "row-a") {
    return { polygon: rectangle(minU + side, minU + side + width, minV + front, minV + front + depth), footprintSqFt: sqmToSqft(width * depth), constrained };
  }
  return { polygon: rectangle(minU + side, minU + side + width, maxV - front - depth, maxV - front), footprintSqFt: sqmToSqft(width * depth), constrained };
}

function groupDwellings(lots: SubdivisionLot[], dwellings: SubdivisionDwelling[], brief: SubdivisionBrief): SubdivisionDwellingGroup[] {
  const attached = brief.dwellingType === "townhouse" || brief.dwellingType === "terrace";
  const maximum = attached ? brief.maxConnectedDwellings : 1;
  const groups: SubdivisionDwellingGroup[] = [];
  const rows = [...new Set(lots.map((lot) => `${lot.frontageRoadId}|${lot.rowId}`))].sort();
  for (const rowKey of rows) {
    const [roadId, rowId] = rowKey.split("|") as [string, SubdivisionLot["rowId"]];
    const row = lots.filter((lot) => lot.frontageRoadId === roadId && lot.rowId === rowId);
    for (let index = 0; index < row.length; index += maximum) {
      const groupLots = row.slice(index, index + maximum);
      const id = `group-${roadId.replace("internal-access-road-", "band-")}-${rowId}-${String(groups.length + 1).padStart(2, "0")}`;
      groups.push({ id, rowId, form: attached ? "attached-row" : "detached", lotIds: groupLots.map((lot) => lot.id), dwellingIds: groupLots.map((lot) => lot.dwellingId) });
      for (const dwelling of dwellings.filter((item) => groupLots.some((lot) => lot.dwellingId === item.id))) dwelling.groupId = id;
    }
  }
  return groups;
}

function pointInsideAny(point: SubdivisionPoint, polygons: SubdivisionPoint[][]): boolean {
  return polygons.some((polygon) => pointInPolygon(point, polygon, 0.02));
}

function makeTrees(
  frame: LocalFrame,
  definition: StrategyDefinition,
  brief: SubdivisionBrief,
  siteAreaSqFt: number,
  candidates: LocalLotCandidate[],
  dwellingPolygons: SubdivisionPoint[][],
  roadPolygons: SubdivisionPoint[][],
  corridorPolygons: SubdivisionPoint[][],
): SubdivisionTreePoint[] {
  const requiredForTarget = Math.max(1, Math.ceil((siteAreaSqFt * brief.treeCanopyTargetPercent / 100) / CONCEPT_TREE_CANOPY_SQFT));
  const targetCount = Math.ceil(requiredForTarget * definition.canopyDeliveryFraction);
  const candidatesPoints: Array<{ point: SubdivisionPoint; role: SubdivisionTreePoint["role"] }> = [];
  for (const lot of candidates) {
    const open = lot.polygon.slice(0, -1);
    const minU = Math.min(...open.map(([u]) => u));
    const maxU = Math.max(...open.map(([u]) => u));
    const minV = Math.min(...open.map(([, v]) => v));
    const maxV = Math.max(...open.map(([, v]) => v));
    const backV = lot.rowId === "row-a" ? maxV - 1.25 : minV + 1.25;
    const frontV = lot.rowId === "row-a" ? minV + 1 : maxV - 1;
    candidatesPoints.push({ point: [(minU + maxU) / 2, backV], role: "rear-yard-shade" });
    candidatesPoints.push({ point: [minU + (maxU - minU) * 0.22, frontV], role: "pedestrian-route-shade" });
  }
  for (const corridor of corridorPolygons) {
    const open = corridor.slice(0, -1);
    const minU = Math.min(...open.map(([u]) => u));
    const maxU = Math.max(...open.map(([u]) => u));
    const minV = Math.min(...open.map(([, v]) => v));
    const maxV = Math.max(...open.map(([, v]) => v));
    const width = maxU - minU;
    const depth = maxV - minV;
    if (width >= depth) {
      const rowCount = depth >= 9 ? 2 : 1;
      for (let row = 0; row < rowCount; row += 1) {
        const v = minV + depth * ((row + 1) / (rowCount + 1));
        for (let u = minU + 2.5; u <= maxU - 2.5; u += 5) {
          candidatesPoints.unshift({ point: [u, v], role: "shared-green-shade" });
        }
      }
    } else {
      const columnCount = width >= 9 ? 2 : 1;
      for (let column = 0; column < columnCount; column += 1) {
        const u = minU + width * ((column + 1) / (columnCount + 1));
        for (let v = minV + 2.5; v <= maxV - 2.5; v += 5) {
          candidatesPoints.unshift({ point: [u, v], role: "shared-green-shade" });
        }
      }
    }
  }
  const accepted: SubdivisionTreePoint[] = [];
  const seen = new Set<string>();
  for (const candidate of candidatesPoints) {
    if (accepted.length >= targetCount) break;
    const key = `${candidate.point[0].toFixed(2)}:${candidate.point[1].toFixed(2)}`;
    if (seen.has(key) || !pointInPolygon(candidate.point, frame.boundary, 0.1)) continue;
    if (pointInsideAny(candidate.point, dwellingPolygons) || pointInsideAny(candidate.point, roadPolygons)) continue;
    seen.add(key);
    accepted.push({
      id: `tree-${String(accepted.length + 1).padStart(3, "0")}`,
      point: toWorld(frame, candidate.point),
      canopyDiameterMeters: 6,
      role: candidate.role,
      provenance: "SiteMorph planning assumption",
    });
  }
  return accepted;
}

function makeOpenSpaces(
  frame: LocalFrame,
  definition: StrategyDefinition,
  bands: LocalBandLayout[],
  targetDepth: number,
  brief: SubdivisionBrief,
): { world: SubdivisionOpenSpace[]; local: SubdivisionPoint[][] } {
  const width = feetToMeters(brief.minimumLotWidthFt) * definition.widthScale;
  const roadHalf = feetToMeters(brief.roadWidthFt) / 2;
  const path = feetToMeters(brief.pedestrianPathWidthFt);
  const perimeter = feetToMeters(brief.setbacks.sitePerimeterFt) + definition.extraPerimeterMeters;
  const result: SubdivisionOpenSpace[] = [];
  const local: SubdivisionPoint[][] = [];

  const register = (polygon: SubdivisionPoint[], label: string): void => {
    if (!polygonGate(polygon, frame.boundary)) return;
    local.push(polygon);
    result.push({
      id: `green-${String(result.length + 1).padStart(2, "0")}`,
      kind: definition.strategy === "heat-resilient-neighborhood" ? "heat-relief-corridor" : "shared-green",
      label,
      polygon: polygon.map((point) => toWorld(frame, point)),
      areaSqFt: round(sqmToSqft(polygonArea(polygon.slice(0, -1))), 0),
    });
  };

  for (const band of bands) {
    const spanWidth = band.roadSpan[1] - band.roadSpan[0] - 2 * perimeter;
    const columnCount = Math.max(1, Math.floor(spanWidth / width));
    const usedWidth = columnCount * width;
    const firstU = band.roadSpan[0] + (band.roadSpan[1] - band.roadSpan[0] - usedWidth) / 2;
    for (const column of band.corridorColumns) {
      const u0 = firstU + column * width;
      const u1 = u0 + width;
      const frontA = band.roadCenterV + roadHalf + path;
      const frontB = band.roadCenterV - roadHalf - path;
      for (const polygon of [rectangle(u0, u1, frontA, frontA + targetDepth), rectangle(u0, u1, frontB - targetDepth, frontB)]) {
        register(
          polygon,
          definition.strategy === "heat-resilient-neighborhood"
            ? "Site-wide shaded heat-relief corridor"
            : "Shared neighborhood green",
        );
      }
    }
  }

  // The larger separation between street bands in the balanced and
  // heat-resilient options is an explicit shared landscape polygon. It is not
  // inferred from leftover private yards and therefore keeps the open-space
  // metric auditable.
  const sortedBands = [...bands].sort((first, second) => first.roadCenterV - second.roadCenterV);
  for (let index = 0; index < sortedBands.length - 1; index += 1) {
    const lower = sortedBands[index];
    const upper = sortedBands[index + 1];
    const gapMin = lower.roadCenterV + roadHalf + path + targetDepth;
    const gapMax = upper.roadCenterV - roadHalf - path - targetDepth;
    if (gapMax - gapMin < 1.5) continue;
    const span = findSafeHorizontalSpan(frame, gapMin, gapMax);
    if (!span) continue;
    const polygon = rectangle(span[0] + perimeter, span[1] - perimeter, gapMin, gapMax);
    if (polygon[1][0] <= polygon[0][0]) continue;
    register(
      polygon,
      definition.strategy === "heat-resilient-neighborhood"
        ? "Continuous shaded heat-relief green between residential bands"
        : "Shared green between residential bands",
    );
  }

  return { world: result, local };
}

function buildClimatePerformance(
  burden: FortyGuardHistoricalBurden,
  definition: StrategyDefinition,
  metrics: SubdivisionMetrics,
  brief: SubdivisionBrief,
): SubdivisionClimatePerformance {
  const canopyDelivery = clamp(metrics.estimatedCanopyCoveragePercent / Math.max(1, brief.treeCanopyTargetPercent), 0, 1.25);
  const openLandDelivery = clamp(metrics.openLandPercent / Math.max(1, brief.openLandTargetPercent || 15), 0, 1.25);
  const factors = [
    {
      id: "canopy" as const,
      label: "Distributed tree-canopy mitigation",
      riskMultiplier: clamp(1 - 0.35 * canopyDelivery, 0.58, 1),
      weightPercent: 35,
      evidence: `${metrics.treeCount} deterministic concept trees provide approximately ${metrics.estimatedCanopyCoveragePercent}% mature canopy coverage; species and survival are unverified.`,
    },
    {
      id: "pedestrian-shade" as const,
      label: "Pedestrian-route shade continuity",
      riskMultiplier: definition.shadeRouteMultiplier,
      weightPercent: 30,
      evidence: `${definition.label} applies a site-wide shaded-route multiplier; verify it with detailed landscape and Forma Sun analysis.`,
    },
    {
      id: "open-land" as const,
      label: "Explicit shared-open-space heat relief",
      riskMultiplier: clamp(1 - 0.22 * openLandDelivery, 0.70, 1),
      weightPercent: 20,
      evidence: `${metrics.openLandPercent}% of the site is drawn as explicit shared-green or heat-relief space; private lot yards are excluded.`,
    },
    {
      id: "dwelling-spacing" as const,
      label: "Dwelling spacing and heat-release separation",
      riskMultiplier: definition.spacingMultiplier,
      weightPercent: 15,
      evidence: `${definition.label} uses geometry-driven spacing; no unmeasured directional cool zone is assumed.`,
    },
  ].map((factor) => ({ ...factor, riskMultiplier: round(factor.riskMultiplier, 4) }));
  const mitigationMultiplier = weightedGeometricMean(factors.map((factor) => ({ value: factor.riskMultiplier, weight: factor.weightPercent })));
  const residualHeatRisk = burden.score * mitigationMultiplier;
  return {
    source: "FortyGuard × SiteMorph plan mitigation",
    historicalBurdenScore: burden.scorePercent,
    mitigationMultiplier: round(mitigationMultiplier, 4),
    residualHeatRiskScore: round(residualHeatRisk * 100, 1),
    resilienceScore: round((1 - residualHeatRisk) * 100, 1),
    formula: "Residual heat risk = FortyGuard historical burden × weighted geometric mean(canopy 35%, pedestrian shade 30%, open land 20%, dwelling spacing 15%).",
    factors,
    spatialTreatment: burden.thermalZoningMode,
    directionalClaim: null,
  };
}

function baseWarnings(geometry: SiteGeometry, burden: FortyGuardHistoricalBurden, geometryAreaSqFt: number): string[] {
  const warnings = [
    "Zoning and permitted land use are unverified.",
    "Fire access, emergency turning, and apparatus requirements are unverified.",
    "Parking ratios and stall geometry are unverified.",
    "Utility capacity and connection locations are unverified.",
    "Setbacks, dwelling density, open-space mandates, grading and drainage are user inputs or SiteMorph assumptions, not verified code requirements.",
  ];
  if (burden.thermalZoningMode === "site-wide") warnings.push(burden.spatialNote, "No directional thermal claim or preferred compass zone is made from uniform/LOW-confidence FortyGuard evidence.");
  if (!burden.timeOfMeasureAvailable) warnings.push("FortyGuard peak time-of-measure evidence is unavailable; evidence completeness is reduced, but the four-signal historical burden is unchanged and no peak hour is invented.");
  if (geometry.areaSqFt && Math.abs(geometry.areaSqFt - geometryAreaSqFt) / geometry.areaSqFt > 0.08) {
    warnings.push("The local-boundary area differs materially from Forma's reported Site Limit area; Forma's reported area is retained for metrics and the geometry remains preliminary.");
  }
  return warnings;
}

function buildDraft(
  frame: LocalFrame,
  definition: StrategyDefinition,
  geometry: SiteGeometry,
  brief: SubdivisionBrief,
  burden: FortyGuardHistoricalBurden,
  siteAreaSqFt: number,
): DraftVariant {
  const roadWidth = feetToMeters(brief.roadWidthFt);
  const pathWidth = feetToMeters(brief.pedestrianPathWidthFt);
  const layout = localBandLayouts(frame, definition, brief);
  if (!layout || layout.bands.flatMap((band) => band.candidates).length < 2) {
    throw new Error(`The selected Forma Site Limit cannot fit the ${definition.label.toLowerCase()} subdivision assumptions.`);
  }
  const roads: SubdivisionRoad[] = [];
  const localRoadPolygons: SubdivisionPoint[][] = [];
  for (const band of layout.bands) {
    const roadLocal = rectangle(band.roadSpan[0], band.roadSpan[1], band.roadCenterV - roadWidth / 2, band.roadCenterV + roadWidth / 2);
    localRoadPolygons.push(roadLocal);
    roads.push({
      id: band.roadId,
      kind: "access-road",
      label: `Preliminary internal access street ${band.bandIndex + 1}`,
      polygon: roadLocal.map((point) => toWorld(frame, point)),
      centerline: [toWorld(frame, [band.roadSpan[0], band.roadCenterV]), toWorld(frame, [band.roadSpan[1], band.roadCenterV])],
      widthMeters: round(roadWidth, 3),
      shaded: false,
    });
    const pathPolygons = pathWidth > 0
      ? [
          rectangle(band.roadSpan[0], band.roadSpan[1], band.roadCenterV + roadWidth / 2, band.roadCenterV + roadWidth / 2 + pathWidth),
          rectangle(band.roadSpan[0], band.roadSpan[1], band.roadCenterV - roadWidth / 2 - pathWidth, band.roadCenterV - roadWidth / 2),
        ]
      : [];
    for (const [sideIndex, polygon] of pathPolygons.entries()) {
      localRoadPolygons.push(polygon);
      roads.push({
        id: `pedestrian-path-${band.bandIndex + 1}-${sideIndex + 1}`,
        kind: "pedestrian-path",
        label: `Concept shaded pedestrian path · street ${band.bandIndex + 1}`,
        polygon: polygon.map((point) => toWorld(frame, point)),
        centerline: [
          toWorld(frame, [band.roadSpan[0], (polygon[0][1] + polygon[2][1]) / 2]),
          toWorld(frame, [band.roadSpan[1], (polygon[0][1] + polygon[2][1]) / 2]),
        ],
        widthMeters: round(pathWidth, 3),
        shaded: definition.strategy !== "compact-yield",
      });
    }
  }

  const lots: SubdivisionLot[] = [];
  const dwellings: SubdivisionDwelling[] = [];
  let constrainedFootprints = 0;
  const candidates = layout.bands
    .flatMap((band) => band.candidates)
    .sort((first, second) => first.bandIndex - second.bandIndex || first.rowId.localeCompare(second.rowId) || first.column - second.column);
  for (const candidate of candidates) {
    const sequence = lots.length + 1;
    const lotId = `lot-${String(sequence).padStart(3, "0")}`;
    const dwellingId = `dwelling-${String(sequence).padStart(3, "0")}`;
    const footprint = createDwellingFootprint(candidate, brief);
    if (footprint.constrained) constrainedFootprints += 1;
    lots.push({
      id: lotId,
      rowId: candidate.rowId,
      polygon: candidate.polygon.map((point) => toWorld(frame, point)),
      areaSqFt: round(sqmToSqft(candidate.widthMeters * candidate.depthMeters), 0),
      widthFt: round(candidate.widthMeters * FEET_PER_METER, 1),
      depthFt: round(candidate.depthMeters * FEET_PER_METER, 1),
      frontageRoadId: candidate.roadId,
      dwellingId,
    });
    dwellings.push({
      id: dwellingId,
      lotId,
      groupId: "pending",
      footprint: footprint.polygon.map((point) => toWorld(frame, point)),
      footprintSqFt: round(footprint.footprintSqFt, 0),
      grossFloorAreaSqFt: round(Math.min(brief.dwellingGfaSqFt, footprint.footprintSqFt * brief.floors), 0),
      floors: brief.floors,
      heightMeters: round(brief.floors * 3.2, 2),
    });
  }
  const groups = groupDwellings(lots, dwellings, brief);
  const openSpaces = makeOpenSpaces(frame, definition, layout.bands, layout.targetDepth, brief);
  const localDwellingPolygons = dwellings.map((dwelling) => dwelling.footprint.map(([x, y]) => {
    const dx = x - frame.origin[0];
    const dy = y - frame.origin[1];
    return [dx * frame.axis[0] + dy * frame.axis[1], -dx * frame.axis[1] + dy * frame.axis[0]] as SubdivisionPoint;
  }));
  const trees = makeTrees(frame, definition, brief, siteAreaSqFt, candidates, localDwellingPolygons, localRoadPolygons, openSpaces.local);

  const lotArea = lots.reduce((total, lot) => total + lot.areaSqFt, 0);
  const roadArea = roads.reduce((total, road) => total + sqmToSqft(polygonArea(road.polygon.slice(0, -1))), 0);
  const sharedOpenSpaceArea = openSpaces.world.reduce((total, space) => total + space.areaSqFt, 0);
  const footprintArea = dwellings.reduce((total, dwelling) => total + dwelling.footprintSqFt, 0);
  const totalGfa = dwellings.reduce((total, dwelling) => total + dwelling.grossFloorAreaSqFt, 0);
  const metrics: SubdivisionMetrics = {
    siteAreaSqFt: round(siteAreaSqFt, 0),
    subdivisionLotAreaSqFt: round(lotArea, 0),
    roadAndPathAreaSqFt: round(roadArea, 0),
    dwellingFootprintAreaSqFt: round(footprintArea, 0),
    totalDwellingGfaSqFt: round(totalGfa, 0),
    averageLotAreaSqFt: round(lotArea / lots.length, 0),
    averageDwellingGfaSqFt: round(totalGfa / dwellings.length, 0),
    lotCount: lots.length,
    dwellingCount: dwellings.length,
    landEfficiencyPercent: round((lotArea / siteAreaSqFt) * 100, 1),
    openLandPercent: round(clamp((sharedOpenSpaceArea / siteAreaSqFt) * 100, 0, 100), 1),
    parkingProvision: round(lots.length * brief.parkingSpacesPerDwelling, 1),
    treeCount: trees.length,
    estimatedCanopyCoveragePercent: round((trees.length * CONCEPT_TREE_CANOPY_SQFT / siteAreaSqFt) * 100, 1),
  };
  const climatePerformance = buildClimatePerformance(burden, definition, metrics, brief);
  const geometryAreaSqFt = sqmToSqft(polygonArea(frame.boundary));
  const warnings = baseWarnings(geometry, burden, geometryAreaSqFt);
  if (constrainedFootprints) warnings.push(`${constrainedFootprints} dwelling footprints were reduced to stay inside their lots; displayed GFA records the constrained result.`);
  if (trees.length < Math.ceil((siteAreaSqFt * brief.treeCanopyTargetPercent / 100) / CONCEPT_TREE_CANOPY_SQFT * definition.canopyDeliveryFraction)) {
    warnings.push("The concept could not place every target canopy point without intersecting dwellings or roads; the delivered canopy percentage is shown explicitly.");
  }
  return {
    definition,
    lots,
    dwellings,
    dwellingGroups: groups,
    roads,
    trees,
    openSpaces: openSpaces.world,
    metrics,
    climatePerformance,
    assumptions: [
      `${layout.bands.length} double-loaded internal street band${layout.bands.length === 1 ? "" : "s"} follow the selected Site Limit's dominant geometric axis; this is not a climate-direction claim.`,
      `${brief.targetLotAreaSqFt.toLocaleString("en-US")} ft² target lots, ${brief.minimumLotWidthFt.toLocaleString("en-US")} ft minimum width and all setbacks come from the explicit subdivision brief.`,
      "Open land is measured only from explicit shared-green and heat-relief polygons; private lot yards are not counted as public or communal open space.",
      `Each concept tree represents approximately ${CONCEPT_TREE_CANOPY_SQFT} ft² of mature canopy for comparison only; species, irrigation and survival are not designed.`,
      "Dwelling heights use a transparent 3.2 m/storey concept allowance; Forma terrain elevation must be sampled before native geometry is created.",
      "FortyGuard historical heat is applied site-wide when its native resolution cannot reliably separate the parcel; subsequent placement decisions belong to measured Forma Sun and Wind analyses.",
    ],
    warnings,
  };
}

function scoreVariant(draft: DraftVariant, maxLotCount: number, brief: SubdivisionBrief): SubdivisionScoreBreakdown {
  const targetOpen = Math.max(brief.openLandTargetPercent, 1);
  const targetLot = brief.targetLotAreaSqFt;
  const lotDeviation = Math.abs(draft.metrics.averageLotAreaSqFt - targetLot) / targetLot;
  const raw: Array<Omit<SubdivisionScoreComponent, "weightedScore">> = [
    {
      id: "fortyguard-climate",
      label: "FortyGuard-adjusted heat resilience",
      rawScore: draft.climatePerformance.resilienceScore,
      weightPercent: 50,
      source: "FortyGuard × SiteMorph",
      explanation: `${draft.climatePerformance.historicalBurdenScore}% historical burden is multiplied by visible canopy, shade, open-land and spacing risk factors.`,
    },
    {
      id: "development-yield",
      label: "Development yield",
      rawScore: round((draft.metrics.lotCount / Math.max(1, maxLotCount)) * 100, 1),
      weightPercent: 20,
      source: "SiteMorph derived",
      explanation: `${draft.metrics.lotCount} dwellings compared with the highest deterministic variant count of ${maxLotCount}.`,
    },
    {
      id: "lot-match",
      label: "Requested lot and dwelling match",
      rawScore: round(clamp((1 - lotDeviation) * 100, 0, 100), 1),
      weightPercent: 15,
      source: "SiteMorph derived",
      explanation: `${draft.metrics.averageLotAreaSqFt.toLocaleString("en-US")} ft² average versus the ${targetLot.toLocaleString("en-US")} ft² explicit target.`,
    },
    {
      id: "open-land",
      label: "Shared-open-space target delivery",
      rawScore: round(clamp((draft.metrics.openLandPercent / targetOpen) * 100, 0, 100), 1),
      weightPercent: 10,
      source: "SiteMorph derived",
      explanation: `${draft.metrics.openLandPercent}% explicit shared-green/heat-relief area against the ${brief.openLandTargetPercent}% input target; private yards are excluded and this is not a deep-soil or code calculation.`,
    },
    {
      id: "delivery-simplicity",
      label: "Native-Forma delivery simplicity",
      rawScore: round(clamp(100 - draft.dwellingGroups.length * 0.8 - draft.openSpaces.length * 1.5, 55, 100), 1),
      weightPercent: 5,
      source: "SiteMorph derived",
      explanation: `${draft.dwellingGroups.length} tracked dwelling groups and ${draft.openSpaces.length} explicit shared-green polygons.`,
    },
  ];
  const components = raw.map((component): SubdivisionScoreComponent => ({
    ...component,
    weightedScore: round(component.rawScore * component.weightPercent / 100, 2),
  }));
  return {
    totalScore: round(components.reduce((total, component) => total + component.weightedScore, 0), 1),
    climateWeightPercent: 50,
    formula: "50% FortyGuard-adjusted climate resilience + 20% yield + 15% requested-lot match + 10% open-land delivery + 5% native-Forma delivery simplicity.",
    components,
  };
}

export function generateSubdivisionLayouts(geometry: SiteGeometry, climate: ClimateDNA, brief: SubdivisionBrief): SubdivisionPlan;
export function generateSubdivisionLayouts(input: SubdivisionLayoutInput): SubdivisionPlan;
export function generateSubdivisionLayouts(
  geometryOrInput: SiteGeometry | SubdivisionLayoutInput,
  climateArg?: ClimateDNA,
  briefArg?: SubdivisionBrief,
): SubdivisionPlan {
  const geometry = "geometry" in geometryOrInput ? geometryOrInput.geometry : geometryOrInput;
  const climate = "geometry" in geometryOrInput ? geometryOrInput.climate : climateArg;
  const brief = "geometry" in geometryOrInput ? geometryOrInput.brief : briefArg;
  if (!climate || !brief) throw new Error("SiteGeometry, ClimateDNA and an explicit SubdivisionBrief are required.");
  validateInputs(geometry, climate, brief);
  const boundary = cleanBoundary(geometry.localBoundary!);
  const frame = createLocalFrame(boundary);
  const geometryAreaSqFt = sqmToSqft(polygonArea(boundary));
  const siteAreaSqFt = geometry.areaSqFt && geometry.areaSqFt > 0 ? geometry.areaSqFt : geometryAreaSqFt;
  const burden = deriveFortyGuardHistoricalBurden(climate);
  const drafts = STRATEGIES.map((definition) => buildDraft(frame, definition, geometry, brief, burden, siteAreaSqFt));
  const maxLotCount = Math.max(...drafts.map((draft) => draft.metrics.lotCount));
  const scored = drafts.map((draft) => ({ draft, score: scoreVariant(draft, maxLotCount, brief) }));
  const rankById = new Map(scored
    .slice()
    .sort((first, second) => second.score.totalScore - first.score.totalScore || first.draft.definition.strategy.localeCompare(second.draft.definition.strategy))
    .map((item, index) => [item.draft.definition.strategy, index + 1]));
  const variants: SubdivisionVariant[] = scored.map(({ draft, score }) => ({
    id: `${brief.id}-${draft.definition.strategy}`,
    strategy: draft.definition.strategy,
    label: draft.definition.label,
    rank: rankById.get(draft.definition.strategy)!,
    axis: {
      origin: frame.origin.map((value) => round(value, 4)) as SubdivisionPoint,
      vector: frame.axis.map((value) => round(value, 6)) as SubdivisionPoint,
      angleDegrees: frame.angleDegrees,
      basis: "Forma Site Limit dominant axis",
    },
    lots: draft.lots,
    dwellings: draft.dwellings,
    dwellingGroups: draft.dwellingGroups,
    roads: draft.roads,
    trees: draft.trees,
    openSpaces: draft.openSpaces,
    metrics: draft.metrics,
    climatePerformance: draft.climatePerformance,
    scoreBreakdown: score,
    assumptions: draft.assumptions,
    warnings: draft.warnings,
    provenance: [
      { field: "Site boundary and dominant axis", source: "Forma", detail: geometry.elementPath },
      { field: "Historical heat burden", source: "FortyGuard", detail: burden.formula },
      { field: "Lot, dwelling, road, path and canopy parameters", source: "User-confirmed input", detail: brief.id },
      { field: "Variant geometry, metrics and ranking", source: "SiteMorph derived", detail: "Deterministic clean-room constraint engine; no third-party geometry generator or paid AI API." },
    ],
  }));
  return {
    schemaVersion: "sitemorph.subdivision-plan.v1",
    source: "SiteMorph deterministic native-Forma subdivision engine",
    briefId: brief.id,
    siteElementPath: geometry.elementPath,
    siteAreaSqFt: round(siteAreaSqFt, 0),
    historicalBurden: burden,
    variants,
    disclaimer: "Preliminary climate-informed planning concepts only. Zoning, permitted use, density, setbacks, fire access, parking, utilities, drainage, grading, structure, market demand and entitlements remain unverified.",
  };
}
