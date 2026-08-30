import type { FormaPlacementVerification } from "../types";
import type { Urn } from "forma-elements";
import type { getFormaClient } from "./forma.service";

type FormaClient = Awaited<ReturnType<typeof getFormaClient>>;
type PlacementClient = Pick<FormaClient, "elements" | "geometry" | "proposal">;

export const SITEMORPH_ELEMENT_NAME_PREFIX = "SiteMorph —";
export const SITEMORPH_OWNERSHIP_NAMESPACE = "sitemorph:element";
export const PLACEMENT_ELEVATION_TOLERANCE_METERS = 0.25;

export interface SiteMorphOwnershipMetadata {
  schemaVersion?: 1 | 2 | 3;
  runId?: string;
  role?: string;
  itemId?: string;
}

interface PlacementVerificationOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
  toleranceMeters?: number;
}

interface PlacementExpectation {
  terrainBaseElevationMeters: number;
  terrainSampleCount: number;
  expectedCenterXMeters: number;
  expectedCenterYMeters: number;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function rootPath(key: string): string {
  return `root/${key}`;
}

export function isSiteMorphOwnedName(name: string | undefined): boolean {
  return Boolean(name?.startsWith(SITEMORPH_ELEMENT_NAME_PREFIX));
}

function hasSiteMorphOwnershipMarker(properties: Record<string, unknown> | undefined): boolean {
  const marker = properties?.[SITEMORPH_OWNERSHIP_NAMESPACE];
  return Boolean(marker && typeof marker === "object" && (marker as { owned?: unknown }).owned === true);
}

function isLegacySiteMorphBuilding(child: { name?: string; properties?: Record<string, unknown> }): boolean {
  const category = String(child.properties?.category ?? "").toLowerCase();
  return isSiteMorphOwnedName(child.name) && (category === "building" || category === "buildings" || category === "floorstack" || category === "floor-stack");
}

export function isPathWithinOwnedRoot(path: string, ownedRootPaths: string[]): boolean {
  return ownedRootPaths.some((ownedRoot) => path === ownedRoot || path.startsWith(`${ownedRoot}/`));
}

export async function listSiteMorphOwnedRootPaths(Forma: PlacementClient): Promise<string[]> {
  const { element } = await Forma.elements.getByPath({ path: "root" });
  const ownedPaths = await Promise.all((element.children ?? []).map(async (child) => {
    const path = rootPath(child.key);
    const { element: childElement } = await Forma.elements.getByPath({ path });
    return hasSiteMorphOwnershipMarker(childElement.properties)
      || isLegacySiteMorphBuilding({ name: child.name, properties: childElement.properties })
      ? path
      : undefined;
  }));
  return [...new Set(ownedPaths.filter((path): path is string => Boolean(path)))];
}

export async function tagSiteMorphElementUrn(
  Forma: PlacementClient,
  urn: string,
  metadata: SiteMorphOwnershipMetadata = {},
): Promise<Urn> {
  const tagged = await Forma.elements.editProperties({
    urn: urn as Urn,
    propertiesJsonMergePatch: {
      [SITEMORPH_OWNERSHIP_NAMESPACE]: {
        owned: true,
        schemaVersion: metadata.schemaVersion ?? 1,
        ...(metadata.runId ? { runId: metadata.runId } : {}),
        ...(metadata.role ? { role: metadata.role } : {}),
        ...(metadata.itemId ? { itemId: metadata.itemId } : {}),
      },
    },
  });
  return tagged.urn;
}

export function assertSingleSiteMorphOwnedRoot(ownedRootPaths: string[], expectedPath: string): void {
  const unique = [...new Set(ownedRootPaths)];
  if (unique.length > 1) {
    throw new Error(`Revit preflight blocked: ${unique.length} SiteMorph-owned proposal roots remain. Generate again or remove stale SiteMorph masses before Load From Forma.`);
  }
  if (unique.length === 0) {
    throw new Error("Revit preflight blocked: the generated building is not present as a canonically named SiteMorph proposal root.");
  }
  if (unique[0] !== expectedPath) {
    throw new Error("Revit preflight blocked: the saved SiteMorph building path does not match the sole owned proposal root.");
  }
}

export async function removeOtherSiteMorphOwnedRoots(
  Forma: PlacementClient,
  keepPath: string,
  options: { maxAttempts?: number; retryDelayMs?: number } = {},
): Promise<string[]> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 4);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 200);
  const removed = new Set<string>();
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await Forma.proposal.awaitProposalPersisted();
      const ownedRootPaths = await listSiteMorphOwnedRootPaths(Forma);
      if (!ownedRootPaths.includes(keepPath)) {
        throw new Error("the newly generated owned proposal root is not visible yet");
      }
      const stalePaths = ownedRootPaths.filter((path) => path !== keepPath);
      if (stalePaths.length) {
        await Forma.proposal.updateElements({ operations: stalePaths.map((path) => ({ type: "remove" as const, path })) });
        stalePaths.forEach((path) => removed.add(path));
        await Forma.proposal.awaitProposalPersisted();
      }
      assertSingleSiteMorphOwnedRoot(await listSiteMorphOwnedRootPaths(Forma), keepPath);
      return [...removed];
    } catch (error) {
      lastError = error;
      if (attempt + 1 < maxAttempts) await wait(retryDelayMs * (attempt + 1));
    }
  }
  const detail = lastError instanceof Error ? lastError.message : "unknown proposal cleanup error";
  throw new Error(`SiteMorph could not transactionally remove stale owned proposal roots: ${detail}`);
}

export async function rollbackSiteMorphOwnedRoot(
  Forma: PlacementClient,
  path: string,
  options: { maxAttempts?: number; retryDelayMs?: number } = {},
): Promise<void> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 4);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 200);
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const ownedBefore = await listSiteMorphOwnedRootPaths(Forma);
      if (!ownedBefore.includes(path)) return;
      await Forma.proposal.removeElement({ path });
      await Forma.proposal.awaitProposalPersisted();
      if (!(await listSiteMorphOwnedRootPaths(Forma)).includes(path)) return;
      throw new Error("the rejected proposal root is still visible after persistence");
    } catch (error) {
      lastError = error;
      if (attempt + 1 < maxAttempts) await wait(retryDelayMs * (attempt + 1));
    }
  }
  const detail = lastError instanceof Error ? lastError.message : "unknown rollback error";
  throw new Error(`SiteMorph could not roll back the rejected proposal root ${path}: ${detail}. Remove it before Revit handoff.`);
}

export function meshBaseElevationMeters(mesh: ArrayLike<number>): number {
  if (mesh.length < 9 || mesh.length % 3 !== 0) {
    throw new Error("Forma did not expose a readable generated mesh for elevation verification.");
  }
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 2; index < mesh.length; index += 3) {
    const z = mesh[index];
    if (!Number.isFinite(z)) throw new Error("Forma returned a non-finite generated mesh elevation.");
    minimum = Math.min(minimum, z);
  }
  if (!Number.isFinite(minimum)) throw new Error("Forma did not expose a finite generated mesh base elevation.");
  return Number(minimum.toFixed(3));
}

export function assertElevationMatchesTerrain(
  label: string,
  elevationMeters: number,
  terrainBaseElevationMeters: number,
  toleranceMeters = PLACEMENT_ELEVATION_TOLERANCE_METERS,
): void {
  if (!Number.isFinite(elevationMeters) || !Number.isFinite(terrainBaseElevationMeters)) {
    throw new Error(`Forma returned a non-finite ${label} elevation.`);
  }
  if (Math.abs(elevationMeters - terrainBaseElevationMeters) > toleranceMeters) {
    throw new Error(`${label} elevation ${elevationMeters.toFixed(3)} m does not match sampled terrain ${terrainBaseElevationMeters.toFixed(3)} m within ${toleranceMeters.toFixed(2)} m.`);
  }
}

function assertCoordinateMatchesExpected(label: string, actual: number, expected: number, toleranceMeters: number): void {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) throw new Error(`Forma returned a non-finite ${label} coordinate.`);
  if (Math.abs(actual - expected) > toleranceMeters) {
    throw new Error(`${label} coordinate ${actual.toFixed(3)} m does not match expected ${expected.toFixed(3)} m within ${toleranceMeters.toFixed(2)} m.`);
  }
}

async function readPlacementVerification(
  Forma: PlacementClient,
  path: string,
  expectation: PlacementExpectation,
  toleranceMeters: number,
): Promise<FormaPlacementVerification> {
  const [{ transform }, mesh] = await Promise.all([
    Forma.elements.getWorldTransform({ path }),
    Forma.geometry.getTriangles({ path }),
  ]);
  const worldTransformXMeters = Number(transform[12]);
  const worldTransformYMeters = Number(transform[13]);
  const worldTransformElevationMeters = Number(transform[14]);
  const meshElevationMeters = meshBaseElevationMeters(mesh);
  assertCoordinateMatchesExpected("Persisted world-transform X", worldTransformXMeters, expectation.expectedCenterXMeters, toleranceMeters);
  assertCoordinateMatchesExpected("Persisted world-transform Y", worldTransformYMeters, expectation.expectedCenterYMeters, toleranceMeters);
  assertElevationMatchesTerrain("Persisted world-transform", worldTransformElevationMeters, expectation.terrainBaseElevationMeters, toleranceMeters);
  assertElevationMatchesTerrain("Generated mesh base", meshElevationMeters, expectation.terrainBaseElevationMeters, toleranceMeters);
  return {
    terrainBaseElevationMeters: expectation.terrainBaseElevationMeters,
    terrainSampleCount: expectation.terrainSampleCount,
    expectedCenterXMeters: expectation.expectedCenterXMeters,
    expectedCenterYMeters: expectation.expectedCenterYMeters,
    worldTransformXMeters: Number(worldTransformXMeters.toFixed(3)),
    worldTransformYMeters: Number(worldTransformYMeters.toFixed(3)),
    worldTransformElevationMeters: Number(worldTransformElevationMeters.toFixed(3)),
    meshBaseElevationMeters: meshElevationMeters,
    toleranceMeters,
    verifiedAt: new Date().toISOString(),
  };
}

export async function verifyPersistedFormaElementPlacement(
  Forma: PlacementClient,
  path: string,
  expectation: PlacementExpectation,
  options: PlacementVerificationOptions = {},
): Promise<FormaPlacementVerification> {
  if (!Number.isFinite(expectation.terrainBaseElevationMeters)
    || !Number.isFinite(expectation.expectedCenterXMeters)
    || !Number.isFinite(expectation.expectedCenterYMeters)
    || expectation.terrainSampleCount < 1) {
    throw new Error("Forma placement verification requires at least one real terrain elevation sample.");
  }
  const maxAttempts = Math.max(1, options.maxAttempts ?? 4);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 250);
  const toleranceMeters = options.toleranceMeters ?? PLACEMENT_ELEVATION_TOLERANCE_METERS;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await Forma.proposal.awaitProposalPersisted();
      return await readPlacementVerification(Forma, path, expectation, toleranceMeters);
    } catch (error) {
      lastError = error;
      if (attempt + 1 < maxAttempts) await wait(retryDelayMs * (attempt + 1));
    }
  }
  const detail = lastError instanceof Error ? lastError.message : "unknown placement verification error";
  throw new Error(`SiteMorph rejected the generated Forma mass because its persisted elevation could not be verified: ${detail}`);
}
