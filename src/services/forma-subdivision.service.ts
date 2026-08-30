import type { FormaPlacementVerification, SiteGeometry } from "../types";
import type { SubdivisionDwelling, SubdivisionVariant } from "../types/subdivision";
import { assertFootprintInsideSite, polygonBounds, projectTriangleMeshToFootprint, type Point2D } from "../utils/geometry-validation.ts";
import { decodeSunGroundGrid } from "../utils/sun-grid.ts";
import { terrainSamplePoints } from "../utils/terrain-elevation.ts";
import {
  assertElevationMatchesTerrain,
  listSiteMorphOwnedRootPaths,
  meshBaseElevationMeters,
  PLACEMENT_ELEVATION_TOLERANCE_METERS,
  SITEMORPH_ELEMENT_NAME_PREFIX,
  SITEMORPH_OWNERSHIP_NAMESPACE,
  tagSiteMorphElementUrn,
} from "./forma-element-placement.service.ts";
import {
  buildPersistentSubdivisionContextProposalOperation,
  createPersistentSubdivisionContext,
  verifyPersistentSubdivisionContext,
  type PersistentSubdivisionContext,
} from "./forma-subdivision-context.service.ts";
import type { getFormaClient } from "./forma.service.ts";

const SQFT_PER_SQM = 10.7639104167;
const MAX_GLOBAL_TERRAIN_SAMPLES = 512;
const MAX_CONCURRENT_TERRAIN_REQUESTS = 8;
const MAX_CONCURRENT_VERIFICATIONS = 6;
const TERRAIN_SAMPLE_ATTEMPTS = 3;

type FormaClient = Awaited<ReturnType<typeof getFormaClient>>;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

export interface PreparedSubdivisionElement {
  itemId: string;
  lotId: string;
  groupId: string;
  name: string;
  floors: Array<{ polygon: Point2D[]; height: number }>;
  transform: number[];
  projectFootprint: Point2D[];
  footprintSqFt: number;
  grossFloorAreaSqFt: number;
  storyCount: number;
  heightMeters: number;
}

export interface SubdivisionTerrainSample {
  key: string;
  point: Point2D;
  itemIds: string[];
}

export interface SubdivisionTerrainSamplePlan {
  samples: SubdivisionTerrainSample[];
  sampleKeysByItem: Record<string, string[]>;
  maximumSampleCount: number;
}

export interface ResolvedSubdivisionPlacement extends PreparedSubdivisionElement {
  terrainBaseElevationMeters: number;
  terrainSampleCount: number;
}

export interface GeneratedSubdivisionElement {
  itemId: string;
  lotId: string;
  groupId: string;
  elementPath: string;
  name: string;
  footprintSqFt: number;
  grossFloorAreaSqFt: number;
  floors: number;
  heightMeters: number;
  projectFootprint: Point2D[];
  footprintSource: "direct-footprint" | "recursive-mesh";
  placement: FormaPlacementVerification;
}

export interface SubdivisionNativeAnalysis {
  type: "sun";
  selectedElementPath: string;
  status: "succeeded" | "native-result-only" | "failed";
  analysisId?: string;
  metricSource: "ground-grid" | "native-status-only" | "unavailable";
  meanSunHours?: number;
  maxSunHours?: number;
  note: string;
}

export interface GeneratedSubdivisionResult {
  schemaVersion: 3;
  runId: string;
  variantId: string;
  variantLabel: string;
  generatedAt: string;
  elementPaths: string[];
  proposalElementPaths: string[];
  elements: GeneratedSubdivisionElement[];
  persistentContext: PersistentSubdivisionContext;
  totalGrossFloorAreaSqFt: number;
  terrainSampleCount: number;
  terrainVerificationCount: number;
  removedPreviousPaths: string[];
  nativeAnalysis: SubdivisionNativeAnalysis;
  designImageDataUrl?: string;
}

interface FootprintComparison {
  areaDeltaRatio: number;
  centroidDistanceMeters: number;
  maximumBoundsDeltaMeters: number;
}

function openRing(points: Point2D[]): Point2D[] {
  if (points.length > 1 && points[0][0] === points.at(-1)?.[0] && points[0][1] === points.at(-1)?.[1]) {
    return points.slice(0, -1);
  }
  return [...points];
}

function signedArea(points: Point2D[]): number {
  const ring = openRing(points);
  return ring.reduce((sum, [x, y], index) => {
    const next = ring[(index + 1) % ring.length];
    return sum + x * next[1] - next[0] * y;
  }, 0) / 2;
}

function polygonArea(points: Point2D[]): number {
  return Math.abs(signedArea(points));
}

function polygonCentroid(points: Point2D[]): Point2D {
  const ring = openRing(points);
  const area = signedArea(ring);
  if (ring.length < 3 || Math.abs(area) < 0.0001) throw new Error("A subdivision dwelling footprint must be a non-degenerate polygon.");
  let weightedX = 0;
  let weightedY = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [x, y] = ring[index];
    const next = ring[(index + 1) % ring.length];
    const cross = x * next[1] - next[0] * y;
    weightedX += (x + next[0]) * cross;
    weightedY += (y + next[1]) * cross;
  }
  const scale = 1 / (6 * area);
  return [weightedX * scale, weightedY * scale];
}

function closeCounterClockwise(points: Point2D[]): Point2D[] {
  const ring = openRing(points);
  if (ring.length < 3 || ring.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) {
    throw new Error("A subdivision dwelling footprint must contain at least three finite coordinates.");
  }
  if (Math.abs(signedArea(ring)) < 0.0001) throw new Error("A subdivision dwelling footprint must have positive area.");
  const oriented = signedArea(ring) > 0 ? ring : [...ring].reverse();
  return [...oriented, oriented[0]];
}

function stableItemNumber(index: number, total: number): string {
  return String(index + 1).padStart(Math.max(2, String(total).length), "0");
}

function prepareDwelling(dwelling: SubdivisionDwelling, index: number, total: number, variantLabel: string): PreparedSubdivisionElement {
  if (!dwelling.id || !dwelling.lotId || !dwelling.groupId) throw new Error("Every subdivision dwelling requires stable dwelling, lot, and group identifiers.");
  if (!Number.isInteger(dwelling.floors) || dwelling.floors < 1) throw new Error(`Dwelling ${dwelling.id} requires a positive whole-number floor count.`);
  if (!Number.isFinite(dwelling.heightMeters) || dwelling.heightMeters <= 0) throw new Error(`Dwelling ${dwelling.id} requires a positive height.`);
  if (!Number.isFinite(dwelling.grossFloorAreaSqFt) || dwelling.grossFloorAreaSqFt <= 0) throw new Error(`Dwelling ${dwelling.id} requires a positive gross floor area.`);
  const projectFootprint = closeCounterClockwise(dwelling.footprint);
  const center = polygonCentroid(projectFootprint);
  const localFootprint = closeCounterClockwise(projectFootprint.map(([x, y]) => [x - center[0], y - center[1]] as Point2D));
  const measuredFootprintSqFt = polygonArea(projectFootprint) * SQFT_PER_SQM;
  const declaredFootprintSqFt = Number.isFinite(dwelling.footprintSqFt) && dwelling.footprintSqFt > 0
    ? dwelling.footprintSqFt
    : measuredFootprintSqFt;
  if (Math.abs(measuredFootprintSqFt - declaredFootprintSqFt) / Math.max(1, declaredFootprintSqFt) > 0.05) {
    throw new Error(`Dwelling ${dwelling.id} footprint geometry differs from its declared area by more than 5%.`);
  }
  const generatedGrossFloorAreaSqFt = measuredFootprintSqFt * dwelling.floors;
  if (Math.abs(generatedGrossFloorAreaSqFt - dwelling.grossFloorAreaSqFt) / Math.max(1, dwelling.grossFloorAreaSqFt) > 0.05) {
    throw new Error(`Dwelling ${dwelling.id} gross floor area cannot be represented by its ${dwelling.floors}-storey footprint within 5%.`);
  }
  const levelHeight = dwelling.heightMeters / dwelling.floors;
  return {
    itemId: dwelling.id,
    lotId: dwelling.lotId,
    groupId: dwelling.groupId,
    name: `${SITEMORPH_ELEMENT_NAME_PREFIX} ${variantLabel} · Dwelling ${stableItemNumber(index, total)}`,
    floors: Array.from({ length: dwelling.floors }, () => ({ polygon: localFootprint, height: levelHeight })),
    transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, center[0], center[1], 0, 1],
    projectFootprint,
    footprintSqFt: Number(declaredFootprintSqFt.toFixed(1)),
    grossFloorAreaSqFt: Number(dwelling.grossFloorAreaSqFt.toFixed(1)),
    storyCount: dwelling.floors,
    heightMeters: dwelling.heightMeters,
  };
}

export function prepareSubdivisionElements(variant: SubdivisionVariant, siteBoundary: Point2D[]): PreparedSubdivisionElement[] {
  if (!variant.id || !variant.label) throw new Error("A subdivision variant requires a stable id and label before materialization.");
  if (!variant.dwellings.length) throw new Error("The selected subdivision variant contains no dwellings to materialize.");
  const ids = new Set<string>();
  const items = variant.dwellings.map((dwelling, index) => {
    if (ids.has(dwelling.id)) throw new Error(`Subdivision dwelling id ${dwelling.id} is duplicated.`);
    ids.add(dwelling.id);
    const prepared = prepareDwelling(dwelling, index, variant.dwellings.length, variant.label);
    assertFootprintInsideSite(prepared.projectFootprint, siteBoundary);
    return prepared;
  });
  return items;
}

function pointKey([x, y]: Point2D): string {
  return `${x.toFixed(5)}:${y.toFixed(5)}`;
}

export function buildSubdivisionTerrainSamplePlan(
  elements: PreparedSubdivisionElement[],
  maximumSampleCount = MAX_GLOBAL_TERRAIN_SAMPLES,
): SubdivisionTerrainSamplePlan {
  if (!elements.length) throw new Error("Terrain sampling requires at least one subdivision dwelling.");
  if (elements.length > maximumSampleCount) {
    throw new Error(`Subdivision materialization is limited to ${maximumSampleCount} dwellings so every footprint receives a real terrain sample.`);
  }
  const candidates = elements.map((element) => {
    const points = terrainSamplePoints(element.projectFootprint);
    if (!points.length) throw new Error(`Dwelling ${element.itemId} does not expose a valid terrain-sampling footprint.`);
    return { itemId: element.itemId, points, cursor: 0 };
  });
  const samplesByKey = new Map<string, SubdivisionTerrainSample>();
  const sampleKeysByItem: Record<string, string[]> = Object.fromEntries(elements.map((element) => [element.itemId, []]));

  const registerNext = (candidate: (typeof candidates)[number]): boolean => {
    if (candidate.cursor >= candidate.points.length) return false;
    const point = candidate.points[candidate.cursor];
    candidate.cursor += 1;
    const key = pointKey(point);
    const existing = samplesByKey.get(key);
    if (existing) {
      if (!existing.itemIds.includes(candidate.itemId)) existing.itemIds.push(candidate.itemId);
    } else if (samplesByKey.size < maximumSampleCount) {
      samplesByKey.set(key, { key, point, itemIds: [candidate.itemId] });
    } else {
      return false;
    }
    if (!sampleKeysByItem[candidate.itemId].includes(key)) sampleKeysByItem[candidate.itemId].push(key);
    return true;
  };

  // One centroid sample per footprint is mandatory; remaining samples are
  // allocated round-robin so one large lot cannot consume the global budget.
  for (const candidate of candidates) registerNext(candidate);
  let madeProgress = true;
  while (samplesByKey.size < maximumSampleCount && madeProgress) {
    madeProgress = false;
    for (const candidate of candidates) {
      if (samplesByKey.size >= maximumSampleCount) break;
      madeProgress = registerNext(candidate) || madeProgress;
    }
  }
  if (Object.values(sampleKeysByItem).some((keys) => keys.length === 0)) {
    throw new Error("Every subdivision footprint must retain at least one deduplicated terrain sample.");
  }
  return { samples: [...samplesByKey.values()], sampleKeysByItem, maximumSampleCount };
}

async function mapWithConcurrency<T, R>(values: T[], concurrency: number, mapper: (value: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function resolveSubdivisionTerrainPlacements(
  elements: PreparedSubdivisionElement[],
  plan: SubdivisionTerrainSamplePlan,
  getElevationAt: (point: Point2D) => Promise<number>,
): Promise<ResolvedSubdivisionPlacement[]> {
  const elevations = new Map<string, number>();
  await mapWithConcurrency(plan.samples, MAX_CONCURRENT_TERRAIN_REQUESTS, async (sample) => {
    let resolved: number | undefined;
    for (let attempt = 0; attempt < TERRAIN_SAMPLE_ATTEMPTS; attempt += 1) {
      try {
        const elevation = await getElevationAt(sample.point);
        if (Number.isFinite(elevation)) {
          resolved = elevation;
          break;
        }
      } catch {
        // Retry only this exact, deduplicated point.
      }
    }
    if (resolved === undefined) {
      throw new Error(`Forma did not return terrain elevation for subdivision sample ${sample.key} after ${TERRAIN_SAMPLE_ATTEMPTS} attempts. No dwellings were added.`);
    }
    elevations.set(sample.key, resolved);
    return resolved;
  });
  return elements.map((element) => {
    const keys = plan.sampleKeysByItem[element.itemId] ?? [];
    const values = keys.map((key) => elevations.get(key)).filter((value): value is number => Number.isFinite(value));
    if (values.length !== keys.length || !values.length) {
      throw new Error(`Dwelling ${element.itemId} does not have complete real terrain coverage. No dwellings were added.`);
    }
    const terrainBaseElevationMeters = Number(Math.max(...values).toFixed(3));
    const transform = [...element.transform];
    transform[14] = terrainBaseElevationMeters;
    return { ...element, transform, terrainBaseElevationMeters, terrainSampleCount: values.length };
  });
}

function compareFootprints(actual: Point2D[], expected: Point2D[]): FootprintComparison {
  const actualArea = polygonArea(actual);
  const expectedArea = polygonArea(expected);
  const actualCenter = polygonCentroid(actual);
  const expectedCenter = polygonCentroid(expected);
  const actualBounds = polygonBounds(actual);
  const expectedBounds = polygonBounds(expected);
  return {
    areaDeltaRatio: Math.abs(actualArea - expectedArea) / Math.max(0.01, expectedArea),
    centroidDistanceMeters: Math.hypot(actualCenter[0] - expectedCenter[0], actualCenter[1] - expectedCenter[1]),
    maximumBoundsDeltaMeters: Math.max(
      Math.abs(actualBounds.minX - expectedBounds.minX),
      Math.abs(actualBounds.maxX - expectedBounds.maxX),
      Math.abs(actualBounds.minY - expectedBounds.minY),
      Math.abs(actualBounds.maxY - expectedBounds.maxY),
    ),
  };
}

export function assertSubdivisionFootprintMatches(actual: Point2D[], expected: Point2D[], toleranceMeters = 0.5): FootprintComparison {
  const comparison = compareFootprints(actual, expected);
  if (comparison.areaDeltaRatio > 0.05
    || comparison.centroidDistanceMeters > toleranceMeters
    || comparison.maximumBoundsDeltaMeters > toleranceMeters) {
    throw new Error(`Persisted dwelling footprint differs from its generated outline (area delta ${(comparison.areaDeltaRatio * 100).toFixed(1)}%, centroid delta ${comparison.centroidDistanceMeters.toFixed(2)} m, bounds delta ${comparison.maximumBoundsDeltaMeters.toFixed(2)} m).`);
  }
  return comparison;
}

function assertCoordinate(label: string, actual: number, expected: number, toleranceMeters: number): void {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > toleranceMeters) {
    throw new Error(`${label} ${Number.isFinite(actual) ? actual.toFixed(3) : "is not finite"} does not match expected ${expected.toFixed(3)} within ${toleranceMeters.toFixed(2)} m.`);
  }
}

async function verifyElement(
  Forma: FormaClient,
  element: ResolvedSubdivisionPlacement,
  path: string,
  expectedName: string,
  runId: string,
  siteBoundary: Point2D[],
): Promise<GeneratedSubdivisionElement> {
  if (!/^root\/[^/]+$/.test(path)) throw new Error(`Forma returned a non-top-level subdivision path: ${path}`);
  const [{ transform }, mesh, directFootprint, elementResponse] = await Promise.all([
    Forma.elements.getWorldTransform({ path }),
    Forma.geometry.getTriangles({ path }),
    Forma.geometry.getFootprint({ path }).catch(() => undefined),
    Forma.elements.getByPath({ path, recursive: true }),
  ]);
  const marker = elementResponse.element.properties?.[SITEMORPH_OWNERSHIP_NAMESPACE] as Record<string, unknown> | undefined;
  if (marker?.owned !== true
    || marker.schemaVersion !== 2
    || marker.runId !== runId
    || marker.role !== "subdivision-dwelling"
    || marker.itemId !== element.itemId) {
    throw new Error(`Persisted dwelling ${element.itemId} is missing its SiteMorph schema-v2 ownership metadata.`);
  }
  const tolerance = PLACEMENT_ELEVATION_TOLERANCE_METERS;
  const worldX = Number(transform[12]);
  const worldY = Number(transform[13]);
  const worldZ = Number(transform[14]);
  assertCoordinate("Persisted subdivision X", worldX, element.transform[12], tolerance);
  assertCoordinate("Persisted subdivision Y", worldY, element.transform[13], tolerance);
  assertElevationMatchesTerrain("Persisted subdivision world-transform", worldZ, element.terrainBaseElevationMeters, tolerance);
  const meshZ = meshBaseElevationMeters(mesh);
  assertElevationMatchesTerrain("Persisted subdivision mesh base", meshZ, element.terrainBaseElevationMeters, tolerance);

  const direct = directFootprint?.type === "Polygon" ? directFootprint.coordinates.map(([x, y]) => [x, y] as Point2D) : [];
  const projected = projectTriangleMeshToFootprint(mesh);
  let footprint: Point2D[] | undefined;
  let footprintSource: GeneratedSubdivisionElement["footprintSource"] | undefined;
  for (const candidate of [
    { points: direct, source: "direct-footprint" as const },
    { points: projected, source: "recursive-mesh" as const },
  ]) {
    if (candidate.points.length < 3) continue;
    try {
      assertSubdivisionFootprintMatches(candidate.points, element.projectFootprint);
      assertFootprintInsideSite(candidate.points, siteBoundary);
      footprint = candidate.points;
      footprintSource = candidate.source;
      break;
    } catch {
      // The floor-stack parent can expose a local footprint while its recursive
      // mesh is project-space. Try both, but never fall back to an unverified outline.
    }
  }
  if (!footprint || !footprintSource) throw new Error(`Forma did not expose a persisted footprint matching dwelling ${element.itemId}.`);
  return {
    itemId: element.itemId,
    lotId: element.lotId,
    groupId: element.groupId,
    elementPath: path,
    name: expectedName,
    footprintSqFt: element.footprintSqFt,
    grossFloorAreaSqFt: element.grossFloorAreaSqFt,
    floors: element.storyCount,
    heightMeters: element.heightMeters,
    projectFootprint: footprint,
    footprintSource,
    placement: {
      terrainBaseElevationMeters: element.terrainBaseElevationMeters,
      terrainSampleCount: element.terrainSampleCount,
      expectedCenterXMeters: element.transform[12],
      expectedCenterYMeters: element.transform[13],
      worldTransformXMeters: Number(worldX.toFixed(3)),
      worldTransformYMeters: Number(worldY.toFixed(3)),
      worldTransformElevationMeters: Number(worldZ.toFixed(3)),
      meshBaseElevationMeters: meshZ,
      toleranceMeters: tolerance,
      verifiedAt: new Date().toISOString(),
    },
  };
}

function ownershipMarker(element: { properties?: Record<string, unknown> }): Record<string, unknown> | undefined {
  const marker = element.properties?.[SITEMORPH_OWNERSHIP_NAMESPACE];
  return marker && typeof marker === "object" ? marker as Record<string, unknown> : undefined;
}

async function listRunPaths(Forma: FormaClient, runId: string): Promise<string[]> {
  const { element } = await Forma.elements.getByPath({ path: "root" });
  const matches = await Promise.all((element.children ?? []).map(async (child) => {
    const path = `root/${child.key}`;
    const response = await Forma.elements.getByPath({ path }).catch(() => undefined);
    return response && ownershipMarker(response.element)?.runId === runId ? path : undefined;
  }));
  return matches.filter((path): path is string => Boolean(path));
}

async function rollbackRun(Forma: FormaClient, runId: string, knownPaths: string[]): Promise<void> {
  // A batch proposal update can partially succeed before returning an error.
  // Wait for any accepted operations before discovering every root owned by
  // this run, otherwise a late-persisting context root could be orphaned.
  await Forma.proposal.awaitProposalPersisted().catch(() => undefined);
  const discovered = await listRunPaths(Forma, runId).catch(() => []);
  const paths = [...new Set([...knownPaths, ...discovered])];
  if (!paths.length) return;
  await Forma.proposal.updateElements({ operations: paths.map((path) => ({ type: "remove" as const, path })) });
  await Forma.proposal.awaitProposalPersisted();
  const remaining = await listRunPaths(Forma, runId);
  if (remaining.length) throw new Error(`SiteMorph could not roll back ${remaining.length} subdivision element${remaining.length === 1 ? "" : "s"}.`);
}

function makeRunId(variantId: string): string {
  const random = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10);
  return `subdivision-${variantId}-${Date.now().toString(36)}-${random}`;
}

async function verifyRun(
  Forma: FormaClient,
  placements: ResolvedSubdivisionPlacement[],
  paths: string[],
  runId: string,
  siteBoundary: Point2D[],
): Promise<GeneratedSubdivisionElement[]> {
  const { element: root } = await Forma.elements.getByPath({ path: "root" });
  const namesByPath = new Map((root.children ?? []).map((child) => [`root/${child.key}`, child.name]));
  for (let index = 0; index < paths.length; index += 1) {
    if (namesByPath.get(paths[index]) !== placements[index].name) {
      throw new Error(`Forma did not persist the expected top-level name for dwelling ${placements[index].itemId}.`);
    }
  }
  return mapWithConcurrency(placements, MAX_CONCURRENT_VERIFICATIONS, (placement, index) => (
    verifyElement(Forma, placement, paths[index], placement.name, runId, siteBoundary)
  ));
}

async function waitForSunAnalysis(Forma: FormaClient, analysisId: string, selectedElementPath: string): Promise<SubdivisionNativeAnalysis> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (attempt > 0) await delay(2_000);
    const analysis = await Forma.analysis.getSunAnalysis({ analysisId });
    if (analysis.status === "FAILED" || analysis.status === "STOPPED") {
      return {
        type: "sun",
        selectedElementPath,
        status: "failed",
        analysisId,
        metricSource: "unavailable",
        note: `Forma Sun analysis ${analysis.status.toLowerCase()}; the verified subdivision geometry remains in the proposal.`,
      };
    }
    if (analysis.status !== "SUCCEEDED") continue;
    try {
      const grid = await Forma.analysis.getGroundGrid({ analysis });
      if (!grid) {
        return {
          type: "sun",
          selectedElementPath,
          status: "native-result-only",
          analysisId,
          metricSource: "native-status-only",
          note: "Forma completed the Site-Limit Sun analysis, but its embedded result exposed no readable ground grid.",
        };
      }
      const decoded = decodeSunGroundGrid(grid.grid, grid.mask, analysis.parameters.sunPositionsPerHour);
      return {
        type: "sun",
        selectedElementPath,
        status: "succeeded",
        analysisId,
        metricSource: "ground-grid",
        meanSunHours: Number((decoded.hours.reduce((sum, value) => sum + value, 0) / decoded.hours.length).toFixed(1)),
        maxSunHours: Number(Math.max(...decoded.hours).toFixed(1)),
        note: decoded.note,
      };
    } catch (error) {
      return {
        type: "sun",
        selectedElementPath,
        status: "native-result-only",
        analysisId,
        metricSource: "native-status-only",
        note: `Forma completed the Site-Limit Sun analysis, but SiteMorph rejected its ground-grid metrics: ${error instanceof Error ? error.message : "unreadable result"}`,
      };
    }
  }
  return {
    type: "sun",
    selectedElementPath,
    status: "failed",
    analysisId,
    metricSource: "unavailable",
    note: "Forma Sun analysis did not resolve within two minutes; the verified subdivision geometry remains in the proposal.",
  };
}

async function triggerSingleSunAnalysis(Forma: FormaClient, siteLimitPath: string): Promise<SubdivisionNativeAnalysis> {
  try {
    const analysis = await Forma.analysis.triggerSun({ selectedElementPaths: [siteLimitPath], month: 6, date: 21 });
    return await waitForSunAnalysis(Forma, analysis.analysisId, siteLimitPath);
  } catch (error) {
    return {
      type: "sun",
      selectedElementPath: siteLimitPath,
      status: "failed",
      metricSource: "unavailable",
      note: `SiteMorph retained the verified subdivision, but Forma could not start its one Site-Limit Sun analysis: ${error instanceof Error ? error.message : "unknown analysis error"}`,
    };
  }
}

async function captureSubdivisionImage(
  Forma: FormaClient,
  siteBoundary: Point2D[],
  elements: GeneratedSubdivisionElement[],
): Promise<string | undefined> {
  const previous = await Forma.camera.getCurrent();
  const outline = polygonBounds(siteBoundary);
  const centerX = (outline.minX + outline.maxX) / 2;
  const centerY = (outline.minY + outline.maxY) / 2;
  const span = Math.max(outline.maxX - outline.minX, outline.maxY - outline.minY, 60);
  const highest = Math.max(...elements.map((element) => element.placement.terrainBaseElevationMeters + element.heightMeters));
  let switchedPerspective = false;
  try {
    if (previous.type !== "perspective") {
      await Forma.camera.switchPerspective();
      switchedPerspective = true;
    }
    await Forma.camera.move({
      position: { x: centerX - span, y: centerY - span, z: highest + span * 0.9 },
      target: { x: centerX, y: centerY, z: highest - Math.max(2, span * 0.08) },
      transitionTimeMs: 0,
    });
    const canvas = await Forma.camera.capture({ width: 1200, height: 720 });
    return canvas.toDataURL("image/png");
  } catch {
    return undefined;
  } finally {
    await Forma.camera.move({ position: previous.position, target: previous.target, transitionTimeMs: 0 }).catch(() => undefined);
    if (switchedPerspective) await Forma.camera.switchPerspective().catch(() => undefined);
  }
}

export class FormaSubdivisionService {
  async materialize(variant: SubdivisionVariant, geometry: SiteGeometry): Promise<GeneratedSubdivisionResult> {
    const siteBoundary = geometry.localBoundary;
    if (!siteBoundary?.length) throw new Error("The selected Forma Site Limit has no local boundary for subdivision materialization.");
    const { getFormaClient: connectToForma } = await import("./forma.service.ts");
    const Forma = await connectToForma();
    if (!(await Forma.getCanEdit())) throw new Error("This Forma project is read-only. Edit access is required to generate a subdivision.");
    const prepared = prepareSubdivisionElements(variant, siteBoundary);
    const previousOwnedPaths = await listSiteMorphOwnedRootPaths(Forma);
    const terrainPlan = buildSubdivisionTerrainSamplePlan(prepared);
    const placements = await resolveSubdivisionTerrainPlacements(
      prepared,
      terrainPlan,
      ([x, y]) => Forma.terrain.getElevationAt({ x, y }),
    );
    const runId = makeRunId(variant.id);
    let newPaths: string[] = [];
    let verified: GeneratedSubdivisionElement[];
    let persistentContext: PersistentSubdivisionContext;
    try {
      const contextCreation = await createPersistentSubdivisionContext(Forma, variant, runId);
      const { urns } = await Forma.elements.floorStack.createFromFloorsBatch(
        placements.map((placement) => ({ floors: placement.floors })),
      );
      if (urns.length !== placements.length) {
        throw new Error(`Forma created ${urns.length} floor-stack URNs for ${placements.length} requested dwellings.`);
      }
      const ownedUrns = await Promise.all(urns.map((urn, index) => tagSiteMorphElementUrn(Forma, urn, {
        schemaVersion: 2,
        runId,
        role: "subdivision-dwelling",
        itemId: placements[index].itemId,
      })));
      const dwellingOperations = ownedUrns.map((urn, index) => ({
          type: "add" as const,
          urn,
          transform: placements[index].transform,
          name: placements[index].name,
      }));
      const added = await Forma.proposal.updateElements({
        operations: [
          ...dwellingOperations,
          buildPersistentSubdivisionContextProposalOperation(contextCreation.expected),
        ],
      });
      // Retain every returned path before validating the batch response so a
      // partial result can still be rolled back deterministically.
      newPaths = added.map((result) => result?.path).filter((path): path is string => Boolean(path));
      if (added.length !== placements.length + 1) {
        throw new Error(`Forma returned ${added.length} proposal results for ${placements.length + 1} subdivision operations.`);
      }
      const dwellingPaths = added.slice(0, placements.length).map((result, index) => {
        if (!result?.path) throw new Error(`Forma did not return a proposal path for dwelling ${placements[index].itemId}.`);
        return result.path;
      });
      const contextPath = added.at(-1)?.path;
      if (!contextPath) throw new Error("Forma did not return a proposal path for the persistent subdivision context.");
      if (new Set([...dwellingPaths, contextPath]).size !== placements.length + 1) {
        throw new Error("Forma returned duplicate subdivision proposal paths.");
      }

      // All dwellings are inserted as one batch, followed by one shared
      // persistence barrier before any transform or geometry is accepted.
      await Forma.proposal.awaitProposalPersisted();
      [verified, persistentContext] = await Promise.all([
        verifyRun(Forma, placements, dwellingPaths, runId, siteBoundary),
        verifyPersistentSubdivisionContext(Forma, contextPath, contextCreation.expected, runId),
      ]);
    } catch (error) {
      try {
        await rollbackRun(Forma, runId, newPaths);
      } catch (rollbackError) {
        throw new Error(`Subdivision generation failed (${error instanceof Error ? error.message : "unknown error"}) and rollback also failed (${rollbackError instanceof Error ? rollbackError.message : "unknown error"}).`);
      }
      throw error;
    }

    // Only a completely persisted and verified run may replace earlier
    // SiteMorph-owned proposal roots.
    const currentOwnedPaths = await listSiteMorphOwnedRootPaths(Forma);
    const stalePaths = previousOwnedPaths.filter((path) => currentOwnedPaths.includes(path) && !newPaths.includes(path));
    if (stalePaths.length) {
      try {
        await Forma.proposal.updateElements({ operations: stalePaths.map((path) => ({ type: "remove" as const, path })) });
        await Forma.proposal.awaitProposalPersisted();
      } catch (error) {
        try {
          await rollbackRun(Forma, runId, newPaths);
        } catch (rollbackError) {
          throw new Error(`The new subdivision was verified, but stale SiteMorph cleanup failed (${error instanceof Error ? error.message : "unknown error"}) and rollback also failed (${rollbackError instanceof Error ? rollbackError.message : "unknown error"}).`);
        }
        throw new Error(`The new subdivision was rolled back because earlier SiteMorph roots could not be removed: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }

    const nativeAnalysis = await triggerSingleSunAnalysis(Forma, geometry.elementPath);
    const designImageDataUrl = await captureSubdivisionImage(Forma, siteBoundary, verified);
    return {
      schemaVersion: 3,
      runId,
      variantId: variant.id,
      variantLabel: variant.label,
      generatedAt: new Date().toISOString(),
      elementPaths: verified.map((element) => element.elementPath),
      proposalElementPaths: [...verified.map((element) => element.elementPath), persistentContext.elementPath],
      elements: verified,
      persistentContext,
      totalGrossFloorAreaSqFt: Number(verified.reduce((sum, element) => sum + element.grossFloorAreaSqFt, 0).toFixed(1)),
      terrainSampleCount: terrainPlan.samples.length,
      terrainVerificationCount: verified.length,
      removedPreviousPaths: stalePaths,
      nativeAnalysis,
      designImageDataUrl,
    };
  }
}

export const formaSubdivisionService = new FormaSubdivisionService();
