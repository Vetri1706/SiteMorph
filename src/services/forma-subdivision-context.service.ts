import type { CreateElementV2 } from "forma-embedded-view-sdk/integrate-elements";
import type { SubdivisionPoint, SubdivisionTreePoint, SubdivisionVariant } from "../types/subdivision";
import { SITEMORPH_ELEMENT_NAME_PREFIX, SITEMORPH_OWNERSHIP_NAMESPACE } from "./forma-element-placement.service.ts";
import type { getFormaClient } from "./forma.service.ts";

const DEFAULT_TERRAIN_ATTEMPTS = 3;
const DEFAULT_TERRAIN_CONCURRENCY = 8;
const DEFAULT_VERIFICATION_ATTEMPTS = 4;
const DEFAULT_VERIFICATION_CONCURRENCY = 6;
const DEFAULT_VERIFICATION_TOLERANCE_METERS = 0.35;
const NOMINAL_TREE_CANOPY_DIAMETER_METERS = 4;
const NOMINAL_TREE_HEIGHT_METERS = 5.05;

export const SUBDIVISION_TREE_MODEL_VERSION = "sitemorph.low-poly-tree.v2-y-up" as const;
const TREE_TEMPLATE_NAME = `${SITEMORPH_ELEMENT_NAME_PREFIX} Upright low-poly concept tree`;

export const SUBDIVISION_CONTEXT_SCHEMA_VERSION = 3 as const;
export const SUBDIVISION_CONTEXT_ROLE = "subdivision-planning-concept" as const;
export const SUBDIVISION_CONTEXT_MODEL_VERSION = "sitemorph.subdivision-context.v3" as const;
export const SUBDIVISION_CONTEXT_DISCLAIMER =
  "Preliminary SiteMorph planning context only. Roads, paths, open space, lot outlines, and trees are not surveyed, code-verified, civil design, planting design, or validated BIM.";

type FormaClient = Awaited<ReturnType<typeof getFormaClient>>;
type Urn = Awaited<ReturnType<FormaClient["integrateElements"]["createElementV2"]>>["urn"];

type PolygonGeometry = {
  type: "Polygon";
  coordinates: SubdivisionPoint[][];
};

export type SubdivisionTerrainShapeKind =
  | "access-road"
  | "pedestrian-path"
  | "shared-green"
  | "heat-relief-corridor"
  | "lot-outline";

export interface SubdivisionTerrainShapeFeature {
  type: "Feature";
  id: string;
  geometry: PolygonGeometry;
  properties: {
    fill: { color: string; opacity: number };
    stroke: { color: string; lineWidth: number };
  };
}

export interface SubdivisionTerrainShape {
  type: "FeatureCollection";
  features: SubdivisionTerrainShapeFeature[];
}

export interface SubdivisionContextFeatureCounts {
  accessRoads: number;
  pedestrianPaths: number;
  sharedGreens: number;
  heatReliefCorridors: number;
  lotOutlines: number;
}

export interface TreePrimitiveMesh {
  positions: number[];
  indices: number[];
  material: "trunk" | "canopy";
}

export interface SubdivisionTreeTemplateMesh {
  trunk: TreePrimitiveMesh;
  canopy: TreePrimitiveMesh;
  nominalCanopyDiameterMeters: number;
  heightMeters: number;
}

export interface ResolvedSubdivisionTreePlacement {
  id: string;
  childKey: string;
  point: SubdivisionPoint;
  terrainElevationMeters: number;
  canopyDiameterMeters: number;
  scale: number;
  rotationRadians: number;
  transform: [
    number, number, number, number,
    number, number, number, number,
    number, number, number, number,
    number, number, number, number,
  ];
  role: SubdivisionTreePoint["role"];
  provenance: SubdivisionTreePoint["provenance"];
}

export interface SubdivisionTreeTerrainOptions {
  attempts?: number;
  concurrency?: number;
  retryDelayMs?: number;
}

export interface PersistentSubdivisionContextSpec {
  schemaVersion: typeof SUBDIVISION_CONTEXT_SCHEMA_VERSION;
  role: typeof SUBDIVISION_CONTEXT_ROLE;
  runId: string;
  variantId: string;
  variantLabel: string;
  name: string;
  terrainShape: SubdivisionTerrainShape;
  featureCounts: SubdivisionContextFeatureCounts;
  treePlacements: ResolvedSubdivisionTreePlacement[];
  treeTemplateUrn?: string;
  disclaimer: typeof SUBDIVISION_CONTEXT_DISCLAIMER;
}

export interface CreatedPersistentSubdivisionContext extends PersistentSubdivisionContextSpec {
  urn: string;
  treeTemplateUrn?: string;
  treeTemplateGlbByteLength: number;
  terrainSampleCount: number;
}

export interface PreparedPersistentSubdivisionContext {
  variantId: string;
  variantLabel: string;
  terrainShape: SubdivisionTerrainShape;
  featureCounts: SubdivisionContextFeatureCounts;
  treePlacements: ResolvedSubdivisionTreePlacement[];
  terrainSampleCount: number;
  treeTriangleCount: number;
  disclaimer: typeof SUBDIVISION_CONTEXT_DISCLAIMER;
  createRootRequest(runId: string, treeModelUrn?: string): CreateElementV2;
}

export interface PersistentSubdivisionContextCreation {
  urn: string;
  expected: CreatedPersistentSubdivisionContext;
  treeModelUrn?: string;
}

/** Stable auditable result stored by the subdivision materialization workflow. */
export interface PersistentSubdivisionContext {
  elementPath: string;
  name: string;
  status: "persisted-concept-context";
  modelVersion: typeof SUBDIVISION_CONTEXT_MODEL_VERSION;
  persistedAt: string;
  roadFeatureCount: number;
  pedestrianPathFeatureCount: number;
  openSpaceFeatureCount: number;
  lotOutlineFeatureCount: number;
  treeCount: number;
  treeTerrainSampleCount: number;
  treeTerrainVerificationCount: number;
  treeTriangleCount: number;
  treeModelUrn?: string;
  disclaimer: typeof SUBDIVISION_CONTEXT_DISCLAIMER;
}

export interface PersistentSubdivisionContextVerification {
  elementPath: string;
  terrainShapeFeatureCount: number;
  treePlacementCount: number;
  verifiedAt: string;
}

export interface PersistentSubdivisionContextVerificationOptions {
  attempts?: number;
  concurrency?: number;
  retryDelayMs?: number;
  toleranceMeters?: number;
}

interface TreeTemplateRecord {
  urn: Urn;
  glbByteLength: number;
}

const treeTemplateByClient = new WeakMap<object, Promise<TreeTemplateRecord>>();

function delay(milliseconds: number): Promise<void> {
  return milliseconds > 0
    ? new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds))
    : Promise.resolve();
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!values.length) return [];
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function openRing(points: SubdivisionPoint[]): SubdivisionPoint[] {
  if (points.length > 1 && points[0][0] === points.at(-1)?.[0] && points[0][1] === points.at(-1)?.[1]) {
    return points.slice(0, -1);
  }
  return [...points];
}

function closeRing(points: SubdivisionPoint[], label: string): SubdivisionPoint[] {
  const ring = openRing(points);
  if (ring.length < 3 || ring.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) {
    throw new Error(`${label} requires at least three finite project-local coordinates.`);
  }
  const twiceArea = ring.reduce((sum, [x, y], index) => {
    const next = ring[(index + 1) % ring.length];
    return sum + x * next[1] - next[0] * y;
  }, 0);
  if (Math.abs(twiceArea) < 0.0001) throw new Error(`${label} cannot use a degenerate polygon.`);
  return [...ring, ring[0]];
}

function terrainStyle(kind: SubdivisionTerrainShapeKind): Pick<SubdivisionTerrainShapeFeature["properties"], "fill" | "stroke"> {
  switch (kind) {
    case "access-road":
      return {
        fill: { color: "#65717D", opacity: 0.92 },
        stroke: { color: "#DDE6EC", lineWidth: 0.45 },
      };
    case "pedestrian-path":
      return {
        fill: { color: "#67C7C0", opacity: 0.58 },
        stroke: { color: "#178F89", lineWidth: 0.25 },
      };
    case "shared-green":
      return {
        fill: { color: "#83B968", opacity: 0.46 },
        stroke: { color: "#397A43", lineWidth: 0.35 },
      };
    case "heat-relief-corridor":
      return {
        fill: { color: "#57A86A", opacity: 0.52 },
        stroke: { color: "#176E47", lineWidth: 0.45 },
      };
    case "lot-outline":
      return {
        fill: { color: "#CDE2C3", opacity: 0.08 },
        stroke: { color: "#477A57", lineWidth: 0.18 },
      };
  }
}

function terrainFeature(id: string, kind: SubdivisionTerrainShapeKind, polygon: SubdivisionPoint[]): SubdivisionTerrainShapeFeature {
  return {
    type: "Feature",
    id,
    geometry: { type: "Polygon", coordinates: [closeRing(polygon, `${kind} ${id}`)] },
    // TerrainShape has a strict provider schema; provenance and limitations
    // live on the owned root instead of being repeated as unsupported feature
    // fields that the Forma ingest service could reject.
    properties: terrainStyle(kind),
  };
}

/**
 * Builds persistent terrain-draped context from the deterministic subdivision
 * output. It deliberately contains no building footprints and no raster layer:
 * native Forma dwelling floor stacks remain the authoritative design geometry.
 */
export function buildSubdivisionTerrainShape(variant: SubdivisionVariant): {
  terrainShape: SubdivisionTerrainShape;
  featureCounts: SubdivisionContextFeatureCounts;
} {
  const features: SubdivisionTerrainShapeFeature[] = [];
  const featureCounts: SubdivisionContextFeatureCounts = {
    accessRoads: 0,
    pedestrianPaths: 0,
    sharedGreens: 0,
    heatReliefCorridors: 0,
    lotOutlines: 0,
  };

  // Keep the draw order intentional: subtle lots first, then greens, then the
  // road/path network so the persistent Forma plan remains legible from above.
  variant.lots.forEach((lot) => {
    features.push(terrainFeature(lot.id, "lot-outline", lot.polygon));
    featureCounts.lotOutlines += 1;
  });
  variant.openSpaces.forEach((space) => {
    const kind = space.kind;
    features.push(terrainFeature(space.id, kind, space.polygon));
    if (kind === "shared-green") featureCounts.sharedGreens += 1;
    else featureCounts.heatReliefCorridors += 1;
  });
  variant.roads.forEach((road) => {
    features.push(terrainFeature(road.id, road.kind, road.polygon));
    if (road.kind === "access-road") featureCounts.accessRoads += 1;
    else featureCounts.pedestrianPaths += 1;
  });

  return { terrainShape: { type: "FeatureCollection", features }, featureCounts };
}

function appendTriangle(indices: number[], a: number, b: number, c: number): void {
  indices.push(a, b, c);
}

/** Clean-room, faceted tree geometry used as a single reusable Forma template. */
export function buildLowPolySubdivisionTreeMesh(): SubdivisionTreeTemplateMesh {
  const trunkPositions: number[] = [];
  const trunkIndices: number[] = [];
  const trunkSides = 8;
  const trunkHeight = 2.45;
  for (let ring = 0; ring < 2; ring += 1) {
    const z = ring * trunkHeight;
    const radius = ring === 0 ? 0.22 : 0.16;
    for (let segment = 0; segment < trunkSides; segment += 1) {
      const angle = (Math.PI * 2 * segment) / trunkSides;
      trunkPositions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, z);
    }
  }
  const bottomCenter = trunkPositions.length / 3;
  trunkPositions.push(0, 0, 0);
  const topCenter = trunkPositions.length / 3;
  trunkPositions.push(0, 0, trunkHeight);
  for (let segment = 0; segment < trunkSides; segment += 1) {
    const next = (segment + 1) % trunkSides;
    appendTriangle(trunkIndices, segment, next, trunkSides + segment);
    appendTriangle(trunkIndices, next, trunkSides + next, trunkSides + segment);
    appendTriangle(trunkIndices, bottomCenter, next, segment);
    appendTriangle(trunkIndices, topCenter, trunkSides + segment, trunkSides + next);
  }

  const canopyPositions: number[] = [];
  const canopyIndices: number[] = [];
  const canopySegments = 10;
  const topIndex = 0;
  canopyPositions.push(0, 0, 5.05);
  const rings = [
    { radius: 1.18, z: 4.55, rotation: 0 },
    { radius: 2, z: 3.72, rotation: Math.PI / canopySegments },
    { radius: 1.55, z: 2.82, rotation: 0 },
  ];
  rings.forEach((ring) => {
    for (let segment = 0; segment < canopySegments; segment += 1) {
      const angle = ring.rotation + (Math.PI * 2 * segment) / canopySegments;
      canopyPositions.push(Math.cos(angle) * ring.radius, Math.sin(angle) * ring.radius, ring.z);
    }
  });
  const bottomIndex = canopyPositions.length / 3;
  canopyPositions.push(0, 0, 2.28);
  const ringStart = (ring: number) => 1 + ring * canopySegments;
  for (let segment = 0; segment < canopySegments; segment += 1) {
    const next = (segment + 1) % canopySegments;
    appendTriangle(canopyIndices, topIndex, ringStart(0) + segment, ringStart(0) + next);
    for (let ring = 0; ring < rings.length - 1; ring += 1) {
      appendTriangle(canopyIndices, ringStart(ring) + segment, ringStart(ring + 1) + segment, ringStart(ring) + next);
      appendTriangle(canopyIndices, ringStart(ring) + next, ringStart(ring + 1) + segment, ringStart(ring + 1) + next);
    }
    appendTriangle(canopyIndices, bottomIndex, ringStart(rings.length - 1) + next, ringStart(rings.length - 1) + segment);
  }
  return {
    trunk: { positions: trunkPositions, indices: trunkIndices, material: "trunk" },
    canopy: { positions: canopyPositions, indices: canopyIndices, material: "canopy" },
    nominalCanopyDiameterMeters: NOMINAL_TREE_CANOPY_DIAMETER_METERS,
    heightMeters: NOMINAL_TREE_HEIGHT_METERS,
  };
}

function align4(value: number): number {
  return (value + 3) & ~3;
}

function bounds3(positions: number[]): { min: number[]; max: number[] } {
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[index + axis]);
      max[axis] = Math.max(max[axis], positions[index + axis]);
    }
  }
  return { min, max };
}

/**
 * glTF 2.0 is right-handed with +Y up, while Forma project geometry is +Z up.
 * Rotating (x, y, z) -> (x, z, -y) at the file boundary lets Forma's glTF
 * importer convert the linked model back to the intended upright Z-up tree.
 */
function formaZUpToGltfYUp(positions: number[]): number[] {
  const converted = new Array<number>(positions.length);
  for (let index = 0; index < positions.length; index += 3) {
    converted[index] = positions[index];
    converted[index + 1] = positions[index + 2];
    converted[index + 2] = -positions[index + 1];
  }
  return converted;
}

/** Serializes the clean-room Z-up tree into a standards-compliant Y-up binary glTF. */
export function buildLowPolySubdivisionTreeGlb(mesh = buildLowPolySubdivisionTreeMesh()): ArrayBuffer {
  const primitives = [mesh.trunk, mesh.canopy];
  const binaryParts: Uint8Array[] = [];
  const bufferViews: Array<Record<string, number>> = [];
  const accessors: Array<Record<string, unknown>> = [];
  let byteOffset = 0;

  primitives.forEach((primitive) => {
    const gltfPositions = formaZUpToGltfYUp(primitive.positions);
    const positions = new Float32Array(gltfPositions);
    const positionBytes = new Uint8Array(positions.buffer);
    const alignedPositionLength = align4(positionBytes.byteLength);
    const paddedPositions = new Uint8Array(alignedPositionLength);
    paddedPositions.set(positionBytes);
    const positionView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: positionBytes.byteLength, target: 34962 });
    binaryParts.push(paddedPositions);
    byteOffset += alignedPositionLength;
    const positionAccessor = accessors.length;
    accessors.push({
      bufferView: positionView,
      componentType: 5126,
      count: gltfPositions.length / 3,
      type: "VEC3",
      ...bounds3(gltfPositions),
    });

    const indices = new Uint16Array(primitive.indices);
    const indexBytes = new Uint8Array(indices.buffer);
    const alignedIndexLength = align4(indexBytes.byteLength);
    const paddedIndices = new Uint8Array(alignedIndexLength);
    paddedIndices.set(indexBytes);
    const indexView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: indexBytes.byteLength, target: 34963 });
    binaryParts.push(paddedIndices);
    byteOffset += alignedIndexLength;
    accessors.push({
      bufferView: indexView,
      componentType: 5123,
      count: primitive.indices.length,
      type: "SCALAR",
      min: [Math.min(...primitive.indices)],
      max: [Math.max(...primitive.indices)],
    });
    void positionAccessor;
  });

  const gltf = {
    asset: {
      version: "2.0",
      generator: "SiteMorph clean-room low-poly vegetation",
      extras: {
        modelVersion: SUBDIVISION_TREE_MODEL_VERSION,
        upAxis: "Y",
        sourceAxis: "Forma Z-up",
      },
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "SiteMorph concept tree", mesh: 0 }],
    meshes: [{
      name: "Recognizable faceted tree",
      primitives: [
        { attributes: { POSITION: 0 }, indices: 1, material: 0 },
        { attributes: { POSITION: 2 }, indices: 3, material: 1 },
      ],
    }],
    materials: [
      {
        name: "Trunk",
        doubleSided: true,
        pbrMetallicRoughness: { baseColorFactor: [0.36, 0.22, 0.12, 1], metallicFactor: 0, roughnessFactor: 0.96 },
      },
      {
        name: "Faceted green canopy",
        doubleSided: true,
        pbrMetallicRoughness: { baseColorFactor: [0.12, 0.56, 0.24, 1], metallicFactor: 0, roughnessFactor: 0.88 },
      },
    ],
    buffers: [{ byteLength: byteOffset }],
    bufferViews,
    accessors,
  };

  const encodedJson = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLength = align4(encodedJson.byteLength);
  const binaryLength = binaryParts.reduce((sum, bytes) => sum + bytes.byteLength, 0);
  const totalLength = 12 + 8 + jsonLength + 8 + binaryLength;
  const glb = new ArrayBuffer(totalLength);
  const view = new DataView(glb);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  const jsonTarget = new Uint8Array(glb, 20, jsonLength);
  jsonTarget.fill(0x20);
  jsonTarget.set(encodedJson);
  const binaryHeader = 20 + jsonLength;
  view.setUint32(binaryHeader, binaryLength, true);
  view.setUint32(binaryHeader + 4, 0x004e4942, true);
  const binaryTarget = new Uint8Array(glb, binaryHeader + 8, binaryLength);
  let cursor = 0;
  binaryParts.forEach((part) => {
    binaryTarget.set(part, cursor);
    cursor += part.byteLength;
  });
  return glb;
}

function pointKey([x, y]: SubdivisionPoint): string {
  return `${x.toFixed(5)}:${y.toFixed(5)}`;
}

function treeChildKey(index: number, total: number): string {
  return `tree-${String(index + 1).padStart(Math.max(3, String(total).length), "0")}`;
}

function treeTransform(
  [x, y]: SubdivisionPoint,
  z: number,
  scale: number,
  rotationRadians: number,
): ResolvedSubdivisionTreePlacement["transform"] {
  const cosine = Math.cos(rotationRadians) * scale;
  const sine = Math.sin(rotationRadians) * scale;
  return [
    cosine, sine, 0, 0,
    -sine, cosine, 0, 0,
    0, 0, scale, 0,
    x, y, z, 1,
  ];
}

function deterministicTreeRotation(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Number((((hash >>> 0) / 0xffffffff) * Math.PI * 2).toFixed(6));
}

/** Resolves every conceptual tree against real Forma terrain with bounded work. */
export async function resolveSubdivisionTreePlacements(
  trees: SubdivisionTreePoint[],
  getElevationAt: (point: SubdivisionPoint) => Promise<number>,
  options: SubdivisionTreeTerrainOptions = {},
): Promise<ResolvedSubdivisionTreePlacement[]> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? DEFAULT_TERRAIN_ATTEMPTS));
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_TERRAIN_CONCURRENCY));
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 80);
  const ids = new Set<string>();
  const uniquePoints = new Map<string, SubdivisionPoint>();
  trees.forEach((tree) => {
    if (!tree.id || ids.has(tree.id)) throw new Error(`Concept tree id ${tree.id || "(missing)"} is duplicated or unavailable.`);
    ids.add(tree.id);
    if (tree.point.some((coordinate) => !Number.isFinite(coordinate))) throw new Error(`Concept tree ${tree.id} has non-finite project coordinates.`);
    if (!Number.isFinite(tree.canopyDiameterMeters) || tree.canopyDiameterMeters <= 0) throw new Error(`Concept tree ${tree.id} requires a positive canopy diameter.`);
    uniquePoints.set(pointKey(tree.point), tree.point);
  });

  const elevations = new Map<string, number>();
  await mapWithConcurrency([...uniquePoints.entries()], concurrency, async ([key, point]) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const elevation = await getElevationAt(point);
        if (!Number.isFinite(elevation)) throw new Error("non-finite terrain elevation");
        elevations.set(key, Number(elevation.toFixed(3)));
        return;
      } catch (error) {
        lastError = error;
        if (attempt + 1 < attempts) await delay(retryDelayMs * (attempt + 1));
      }
    }
    const detail = lastError instanceof Error ? lastError.message : "unknown terrain error";
    throw new Error(`Forma did not return terrain elevation for concept tree ${key} after ${attempts} attempts: ${detail}. No persistent context was created.`);
  });

  return trees.map((tree, index) => {
    const sampledElevation = elevations.get(pointKey(tree.point));
    if (!Number.isFinite(sampledElevation)) throw new Error(`Concept tree ${tree.id} does not have verified terrain elevation.`);
    const terrainElevationMeters = sampledElevation as number;
    const scale = Number(Math.max(0.55, Math.min(1.8, tree.canopyDiameterMeters / NOMINAL_TREE_CANOPY_DIAMETER_METERS)).toFixed(4));
    const rotationRadians = deterministicTreeRotation(tree.id);
    return {
      id: tree.id,
      childKey: treeChildKey(index, trees.length),
      point: [...tree.point],
      terrainElevationMeters,
      canopyDiameterMeters: tree.canopyDiameterMeters,
      scale,
      rotationRadians,
      transform: treeTransform(tree.point, terrainElevationMeters, scale, rotationRadians),
      role: tree.role,
      provenance: tree.provenance,
    };
  });
}

async function ensureTreeTemplate(Forma: FormaClient): Promise<TreeTemplateRecord> {
  const clientKey = Forma as object;
  let pending = treeTemplateByClient.get(clientKey);
  if (!pending) {
    pending = (async () => {
      const glb = buildLowPolySubdivisionTreeGlb();
      const upload = await Forma.integrateElements.uploadFile({ data: glb });
      const created = await Forma.integrateElements.createElementV2({
        properties: {
          category: "vegetation",
          name: TREE_TEMPLATE_NAME,
          elementProvider: "SiteMorph",
          virtual: true,
          noiseIgnore: true,
          treatAsVegetationInWindAnalysis: false,
          "sitemorph:planningAssumption": {
            kind: "concept-tree-template",
            modelVersion: SUBDIVISION_TREE_MODEL_VERSION,
            gltfUpAxis: "Y",
            source: "SiteMorph clean-room geometry",
            disclaimer: SUBDIVISION_CONTEXT_DISCLAIMER,
          },
        },
        representations: {
          volumeMesh: { type: "linked", blobId: upload.blobId },
        },
      });
      return { urn: created.urn, glbByteLength: glb.byteLength };
    })();
    treeTemplateByClient.set(clientKey, pending);
    pending.catch(() => treeTemplateByClient.delete(clientKey));
  }
  return pending;
}

export function buildPersistentSubdivisionContextRequest(
  variant: SubdivisionVariant,
  runId: string,
  terrainShape: SubdivisionTerrainShape,
  treePlacements: ResolvedSubdivisionTreePlacement[],
  treeTemplateUrn?: string,
): CreateElementV2 {
  if (!runId.trim()) throw new Error("Persistent subdivision context requires a stable run id.");
  if (treePlacements.length && !treeTemplateUrn) throw new Error("Persistent subdivision trees require a reusable vegetation template URN.");
  const name = `${SITEMORPH_ELEMENT_NAME_PREFIX} ${variant.label} · Persistent planning context`;
  return {
    properties: {
      category: "sitemorph_concept",
      name,
      elementProvider: "SiteMorph",
      virtual: true,
      noiseIgnore: true,
      [SITEMORPH_OWNERSHIP_NAMESPACE]: {
        owned: true,
        schemaVersion: SUBDIVISION_CONTEXT_SCHEMA_VERSION,
        runId,
        role: SUBDIVISION_CONTEXT_ROLE,
      },
      "sitemorph:subdivisionContext": {
        variantId: variant.id,
        variantLabel: variant.label,
        source: "SiteMorph deterministic planning concept",
        treeModelVersion: SUBDIVISION_TREE_MODEL_VERSION,
        treeCount: treePlacements.length,
        featureCounts: {
          accessRoads: variant.roads.filter((road) => road.kind === "access-road").length,
          pedestrianPaths: variant.roads.filter((road) => road.kind === "pedestrian-path").length,
          openSpaces: variant.openSpaces.length,
          lotOutlines: variant.lots.length,
        },
        disclaimer: SUBDIVISION_CONTEXT_DISCLAIMER,
      },
    },
    representations: {
      terrainShape: { type: "embedded-json", data: terrainShape },
    },
    children: treePlacements.map((tree) => ({
      urn: treeTemplateUrn as Urn,
      key: tree.childKey,
      transform: tree.transform,
    })),
  };
}

function instantiatedTreeTriangleCount(treeCount: number): number {
  if (!treeCount) return 0;
  const mesh = buildLowPolySubdivisionTreeMesh();
  return ((mesh.trunk.indices.length + mesh.canopy.indices.length) / 3) * treeCount;
}

/** Prepares persistent context without uploading or mutating the Forma proposal. */
export async function preparePersistentSubdivisionContext(
  variant: SubdivisionVariant,
  getElevationAt: (point: SubdivisionPoint) => Promise<number>,
  options: SubdivisionTreeTerrainOptions = {},
): Promise<PreparedPersistentSubdivisionContext> {
  const { terrainShape, featureCounts } = buildSubdivisionTerrainShape(variant);
  const treePlacements = await resolveSubdivisionTreePlacements(variant.trees, getElevationAt, options);
  const terrainSampleCount = new Set(treePlacements.map((tree) => pointKey(tree.point))).size;
  return {
    variantId: variant.id,
    variantLabel: variant.label,
    terrainShape,
    featureCounts,
    treePlacements,
    terrainSampleCount,
    treeTriangleCount: instantiatedTreeTriangleCount(treePlacements.length),
    disclaimer: SUBDIVISION_CONTEXT_DISCLAIMER,
    createRootRequest: (runId, treeModelUrn) => buildPersistentSubdivisionContextRequest(
      variant,
      runId,
      terrainShape,
      treePlacements,
      treeModelUrn,
    ),
  };
}

/**
 * Uploads/creates one reusable tree template, then creates one persistent
 * subdivision context root. The caller adds the returned root URN to the
 * proposal in the same transaction as the native dwelling floor stacks.
 */
export async function createPersistentSubdivisionContextElement(
  Forma: FormaClient,
  variant: SubdivisionVariant,
  runId: string,
  options: SubdivisionTreeTerrainOptions = {},
): Promise<CreatedPersistentSubdivisionContext> {
  const prepared = await preparePersistentSubdivisionContext(
    variant,
    ([x, y]) => Forma.terrain.getElevationAt({ x, y }),
    options,
  );
  const template = prepared.treePlacements.length ? await ensureTreeTemplate(Forma) : undefined;
  const request = prepared.createRootRequest(runId, template?.urn);
  const created = await Forma.integrateElements.createElementV2(request);
  return {
    schemaVersion: SUBDIVISION_CONTEXT_SCHEMA_VERSION,
    role: SUBDIVISION_CONTEXT_ROLE,
    runId,
    variantId: variant.id,
    variantLabel: variant.label,
    name: request.properties?.name as string,
    terrainShape: prepared.terrainShape,
    featureCounts: prepared.featureCounts,
    treePlacements: prepared.treePlacements,
    treeTemplateUrn: template?.urn,
    urn: created.urn,
    treeTemplateGlbByteLength: template?.glbByteLength ?? 0,
    terrainSampleCount: prepared.terrainSampleCount,
    disclaimer: SUBDIVISION_CONTEXT_DISCLAIMER,
  };
}

export async function createPersistentSubdivisionContext(
  Forma: FormaClient,
  variant: SubdivisionVariant,
  runId: string,
  options: SubdivisionTreeTerrainOptions = {},
): Promise<PersistentSubdivisionContextCreation> {
  const expected = await createPersistentSubdivisionContextElement(Forma, variant, runId, options);
  return { urn: expected.urn, expected, treeModelUrn: expected.treeTemplateUrn };
}

export function buildPersistentSubdivisionContextProposalOperation(
  context: Pick<CreatedPersistentSubdivisionContext, "urn" | "name">,
): {
  type: "add";
  urn: string;
  name: string;
  transform: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
} {
  return {
    type: "add",
    urn: context.urn,
    name: context.name,
    transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  };
}

export function assertSubdivisionTreePlacementMatches(
  actualTransform: ArrayLike<number>,
  expected: ResolvedSubdivisionTreePlacement,
  toleranceMeters = DEFAULT_VERIFICATION_TOLERANCE_METERS,
): void {
  if (actualTransform.length < 16) throw new Error(`Persisted concept tree ${expected.id} has no readable world transform.`);
  const checks = [
    { label: "X", actual: Number(actualTransform[12]), expected: expected.point[0], tolerance: toleranceMeters },
    { label: "Y", actual: Number(actualTransform[13]), expected: expected.point[1], tolerance: toleranceMeters },
    { label: "terrain Z", actual: Number(actualTransform[14]), expected: expected.terrainElevationMeters, tolerance: toleranceMeters },
    ...[0, 1, 2, 4, 5, 6, 8, 9, 10].map((index) => ({
      label: `linear transform[${index}]`,
      actual: Number(actualTransform[index]),
      expected: expected.transform[index],
      tolerance: 0.02,
    })),
    { label: "homogeneous transform[3]", actual: Number(actualTransform[3]), expected: 0, tolerance: 0.001 },
    { label: "homogeneous transform[7]", actual: Number(actualTransform[7]), expected: 0, tolerance: 0.001 },
    { label: "homogeneous transform[11]", actual: Number(actualTransform[11]), expected: 0, tolerance: 0.001 },
    { label: "homogeneous transform[15]", actual: Number(actualTransform[15]), expected: 1, tolerance: 0.001 },
  ];
  checks.forEach((check) => {
    if (!Number.isFinite(check.actual) || Math.abs(check.actual - check.expected) > check.tolerance) {
      throw new Error(
        `Persisted concept tree ${expected.id} ${check.label} ${Number.isFinite(check.actual) ? check.actual.toFixed(3) : "is non-finite"} does not match expected ${check.expected.toFixed(3)} within ${check.tolerance.toFixed(2)}.`,
      );
    }
  });
}

/**
 * Verifies the imported linked mesh, not just its instance transform. This
 * catches axis mistakes where a standards-compliant glTF is persisted at the
 * correct terrain point but Forma displays the tree lying on its side.
 */
export function assertSubdivisionTreeMeshIsUpright(
  mesh: ArrayLike<number>,
  expected: ResolvedSubdivisionTreePlacement,
  toleranceMeters = DEFAULT_VERIFICATION_TOLERANCE_METERS,
): void {
  if (mesh.length < 9 || mesh.length % 3 !== 0) {
    throw new Error(`Persisted concept tree ${expected.id} exposes no readable triangle geometry.`);
  }
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let index = 0; index < mesh.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const coordinate = Number(mesh[index + axis]);
      if (!Number.isFinite(coordinate)) {
        throw new Error(`Persisted concept tree ${expected.id} exposes non-finite triangle geometry.`);
      }
      min[axis] = Math.min(min[axis], coordinate);
      max[axis] = Math.max(max[axis], coordinate);
    }
  }

  const verticalSpan = max[2] - min[2];
  const horizontalSpan = Math.max(max[0] - min[0], max[1] - min[1]);
  const expectedHeight = NOMINAL_TREE_HEIGHT_METERS * expected.scale;
  const expectedCanopyDiameter = NOMINAL_TREE_CANOPY_DIAMETER_METERS * expected.scale;
  const heightTolerance = Math.max(toleranceMeters, expectedHeight * 0.08);
  const canopyTolerance = Math.max(toleranceMeters, expectedCanopyDiameter * 0.12);
  if (Math.abs(min[2] - expected.terrainElevationMeters) > toleranceMeters) {
    throw new Error(
      `Persisted concept tree ${expected.id} mesh base ${min[2].toFixed(3)} m does not meet sampled terrain ${expected.terrainElevationMeters.toFixed(3)} m.`,
    );
  }
  if (Math.abs(verticalSpan - expectedHeight) > heightTolerance
    || Math.abs(horizontalSpan - expectedCanopyDiameter) > canopyTolerance
    || verticalSpan <= horizontalSpan * 1.05) {
    throw new Error(
      `Persisted concept tree ${expected.id} is not upright: vertical span ${verticalSpan.toFixed(3)} m, horizontal span ${horizontalSpan.toFixed(3)} m, expected height ${expectedHeight.toFixed(3)} m and canopy ${expectedCanopyDiameter.toFixed(3)} m.`,
    );
  }
}

function readOwnershipMarker(properties: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const marker = properties?.[SITEMORPH_OWNERSHIP_NAMESPACE];
  return marker && typeof marker === "object" && !Array.isArray(marker)
    ? marker as Record<string, unknown>
    : undefined;
}

/** Verifies that the context root and every terrain-sampled tree persisted. */
export async function verifyPersistentSubdivisionContext(
  Forma: FormaClient,
  elementPath: string,
  expected: CreatedPersistentSubdivisionContext,
  runIdOrOptions: string | PersistentSubdivisionContextVerificationOptions = expected.runId,
  providedOptions: PersistentSubdivisionContextVerificationOptions = {},
): Promise<PersistentSubdivisionContext> {
  const runId = typeof runIdOrOptions === "string" ? runIdOrOptions : expected.runId;
  const options = typeof runIdOrOptions === "string" ? providedOptions : runIdOrOptions;
  const attempts = Math.max(1, Math.floor(options.attempts ?? DEFAULT_VERIFICATION_ATTEMPTS));
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_VERIFICATION_CONCURRENCY));
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 180);
  const toleranceMeters = options.toleranceMeters ?? DEFAULT_VERIFICATION_TOLERANCE_METERS;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (!/^root\/[^/]+$/.test(elementPath)) throw new Error(`the context path ${elementPath} is not a top-level proposal element`);
      await Forma.proposal.awaitProposalPersisted();
      const { element } = await Forma.elements.getByPath({ path: elementPath });
      if (element.properties?.name !== expected.name
        || element.properties?.category !== "sitemorph_concept"
        || element.properties?.virtual !== true) {
        throw new Error("the proposal root is missing its expected name, category, or virtual analysis boundary");
      }
      const marker = readOwnershipMarker(element.properties as Record<string, unknown> | undefined);
      if (marker?.owned !== true
        || marker.schemaVersion !== SUBDIVISION_CONTEXT_SCHEMA_VERSION
        || marker.runId !== runId
        || marker.role !== SUBDIVISION_CONTEXT_ROLE) {
        throw new Error("the proposal root is missing SiteMorph schema-v3 subdivision-context ownership");
      }
      const terrainShape = element.representations?.terrainShape;
      const featureCount = terrainShape?.type === "embedded-json"
        && typeof terrainShape.data === "object"
        && terrainShape.data !== null
        && Array.isArray((terrainShape.data as { features?: unknown[] }).features)
        ? (terrainShape.data as { features: unknown[] }).features.length
        : -1;
      if (featureCount !== expected.terrainShape.features.length) {
        throw new Error(`the persisted terrain context exposes ${featureCount} of ${expected.terrainShape.features.length} expected features`);
      }
      const children = element.children ?? [];
      if (children.length !== expected.treePlacements.length) {
        throw new Error(`the persisted context exposes ${children.length} of ${expected.treePlacements.length} expected tree instances`);
      }
      const childKeys = new Set(children.map((child) => child.key));
      if (expected.treePlacements.some((tree) => !childKeys.has(tree.childKey))) {
        throw new Error("one or more persistent tree instances are missing from the context root");
      }
      if (expected.treeTemplateUrn && children.some((child) => child.urn !== expected.treeTemplateUrn)) {
        throw new Error("one or more persistent tree instances do not reference the verified SiteMorph tree model");
      }
      await mapWithConcurrency(expected.treePlacements, concurrency, async (tree) => {
        const { transform } = await Forma.elements.getWorldTransform({ path: `${elementPath}/${tree.childKey}` });
        assertSubdivisionTreePlacementMatches(transform, tree, toleranceMeters);
      });
      if (expected.treePlacements.length) {
        const firstTree = expected.treePlacements[0];
        const mesh = await Forma.geometry.getTriangles({ path: `${elementPath}/${firstTree.childKey}` });
        assertSubdivisionTreeMeshIsUpright(mesh, firstTree, toleranceMeters);
      }
      const persistedAt = new Date().toISOString();
      return {
        elementPath,
        name: expected.name,
        status: "persisted-concept-context",
        modelVersion: SUBDIVISION_CONTEXT_MODEL_VERSION,
        persistedAt,
        roadFeatureCount: expected.featureCounts.accessRoads,
        pedestrianPathFeatureCount: expected.featureCounts.pedestrianPaths,
        openSpaceFeatureCount: expected.featureCounts.sharedGreens + expected.featureCounts.heatReliefCorridors,
        lotOutlineFeatureCount: expected.featureCounts.lotOutlines,
        treeCount: expected.treePlacements.length,
        treeTerrainSampleCount: expected.terrainSampleCount,
        treeTerrainVerificationCount: expected.treePlacements.length,
        treeTriangleCount: instantiatedTreeTriangleCount(expected.treePlacements.length),
        treeModelUrn: expected.treeTemplateUrn,
        disclaimer: SUBDIVISION_CONTEXT_DISCLAIMER,
      };
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await delay(retryDelayMs * (attempt + 1));
    }
  }
  const detail = lastError instanceof Error ? lastError.message : "unknown persistence error";
  throw new Error(`SiteMorph rejected the persistent subdivision context because verification failed: ${detail}`);
}
