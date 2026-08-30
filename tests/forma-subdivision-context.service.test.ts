import assert from "node:assert/strict";
import test from "node:test";

import {
  SUBDIVISION_CONTEXT_DISCLAIMER,
  SUBDIVISION_CONTEXT_MODEL_VERSION,
  SUBDIVISION_CONTEXT_ROLE,
  SUBDIVISION_TREE_MODEL_VERSION,
  assertSubdivisionTreeMeshIsUpright,
  assertSubdivisionTreePlacementMatches,
  buildLowPolySubdivisionTreeGlb,
  buildLowPolySubdivisionTreeMesh,
  buildPersistentSubdivisionContextProposalOperation,
  buildSubdivisionTerrainShape,
  createPersistentSubdivisionContext,
  preparePersistentSubdivisionContext,
  resolveSubdivisionTreePlacements,
  verifyPersistentSubdivisionContext,
} from "../src/services/forma-subdivision-context.service.ts";
import { SITEMORPH_OWNERSHIP_NAMESPACE } from "../src/services/forma-element-placement.service.ts";
import type { SubdivisionVariant } from "../src/types/subdivision.ts";

const polygon = (x: number, y: number, width: number, depth: number): Array<[number, number]> => [
  [x, y],
  [x + width, y],
  [x + width, y + depth],
  [x, y + depth],
  [x, y],
];

function variant(): SubdivisionVariant {
  return {
    id: "heat-resilient",
    strategy: "heat-resilient-neighborhood",
    label: "Heat-resilient neighborhood",
    rank: 1,
    axis: { origin: [0, 0], vector: [1, 0], angleDegrees: 0, basis: "Forma Site Limit dominant axis" },
    lots: [
      {
        id: "lot-001",
        rowId: "row-a",
        polygon: polygon(0, 0, 12, 20),
        areaSqFt: 2_583,
        widthFt: 39.4,
        depthFt: 65.6,
        frontageRoadId: "road-main",
        dwellingId: "dwelling-001",
      },
      {
        id: "lot-002",
        rowId: "row-b",
        polygon: polygon(14, 0, 12, 20),
        areaSqFt: 2_583,
        widthFt: 39.4,
        depthFt: 65.6,
        frontageRoadId: "road-main",
        dwellingId: "dwelling-002",
      },
    ],
    dwellings: [],
    dwellingGroups: [],
    roads: [
      {
        id: "road-main",
        kind: "access-road",
        label: "Preliminary internal street",
        polygon: polygon(0, 9, 30, 6),
        centerline: [[0, 12], [30, 12]],
        widthMeters: 6,
        shaded: false,
      },
      {
        id: "path-main",
        kind: "pedestrian-path",
        label: "Shaded pedestrian route",
        polygon: polygon(0, 7, 30, 1.8),
        centerline: [[0, 7.9], [30, 7.9]],
        widthMeters: 1.8,
        shaded: true,
      },
    ],
    trees: [
      {
        id: "tree-001",
        point: [4, 5],
        canopyDiameterMeters: 4,
        role: "rear-yard-shade",
        provenance: "SiteMorph planning assumption",
      },
      {
        id: "tree-002",
        point: [18, 6],
        canopyDiameterMeters: 5.2,
        role: "shared-green-shade",
        provenance: "SiteMorph planning assumption",
      },
    ],
    openSpaces: [
      { id: "green-001", kind: "shared-green", label: "Shared green", polygon: polygon(2, 22, 10, 8), areaSqFt: 861 },
      { id: "relief-001", kind: "heat-relief-corridor", label: "Heat relief", polygon: polygon(14, 22, 12, 5), areaSqFt: 646 },
    ],
    metrics: {
      siteAreaSqFt: 50_000,
      subdivisionLotAreaSqFt: 30_000,
      roadAndPathAreaSqFt: 8_000,
      dwellingFootprintAreaSqFt: 8_000,
      totalDwellingGfaSqFt: 16_000,
      averageLotAreaSqFt: 3_000,
      averageDwellingGfaSqFt: 1_900,
      lotCount: 2,
      dwellingCount: 2,
      landEfficiencyPercent: 80,
      openLandPercent: 30,
      parkingProvision: 4,
      treeCount: 2,
      estimatedCanopyCoveragePercent: 20,
    },
    climatePerformance: {
      source: "FortyGuard × SiteMorph plan mitigation",
      historicalBurdenScore: 0.81,
      mitigationMultiplier: 0.69,
      residualHeatRiskScore: 55.9,
      resilienceScore: 44.1,
      formula: "test",
      factors: [],
      spatialTreatment: "site-wide",
      directionalClaim: null,
    },
    scoreBreakdown: { totalScore: 61.2, climateWeightPercent: 50, formula: "test", components: [] },
    assumptions: [],
    warnings: [],
    provenance: [],
  };
}

function uprightTreeTriangles(
  tree: Awaited<ReturnType<typeof resolveSubdivisionTreePlacements>>[number],
): Float32Array {
  const [x, y] = tree.point;
  const base = tree.terrainElevationMeters;
  const height = 5.05 * tree.scale;
  const canopyDiameter = 4 * tree.scale;
  return new Float32Array([
    x - canopyDiameter / 2, y, base,
    x + canopyDiameter / 2, y, base,
    x, y, base + height,
  ]);
}

test("builds persistent terrain-shape features for roads, paths, greens, heat relief and lot outlines", () => {
  const built = buildSubdivisionTerrainShape(variant());
  assert.deepEqual(built.featureCounts, {
    accessRoads: 1,
    pedestrianPaths: 1,
    sharedGreens: 1,
    heatReliefCorridors: 1,
    lotOutlines: 2,
  });
  assert.equal(built.terrainShape.features.length, 6);
  assert.ok(built.terrainShape.features.every((feature) => feature.geometry.coordinates[0][0][0] === feature.geometry.coordinates[0].at(-1)?.[0]));
  assert.ok(built.terrainShape.features.every((feature) => Object.keys(feature.properties).every((key) => key === "fill" || key === "stroke")));
  const road = built.terrainShape.features.find((feature) => feature.id === "road-main");
  const green = built.terrainShape.features.find((feature) => feature.id === "green-001");
  assert.equal(road?.properties.fill.color, "#65717D");
  assert.equal(green?.properties.fill.color, "#83B968");
});

test("creates a recognizable faceted tree with a closed trunk and a wider elevated canopy", () => {
  const mesh = buildLowPolySubdivisionTreeMesh();
  for (const primitive of [mesh.trunk, mesh.canopy]) {
    assert.equal(primitive.positions.length % 3, 0);
    assert.equal(primitive.indices.length % 3, 0);
    assert.ok(primitive.indices.every((index) => index >= 0 && index < primitive.positions.length / 3));
  }
  const trunkZ = mesh.trunk.positions.filter((_, index) => index % 3 === 2);
  const canopyZ = mesh.canopy.positions.filter((_, index) => index % 3 === 2);
  const canopyRadial = mesh.canopy.positions.reduce<number[]>((values, value, index, positions) => {
    if (index % 3 === 0) values.push(Math.hypot(value, positions[index + 1]));
    return values;
  }, []);
  const trunkRadial = mesh.trunk.positions.reduce<number[]>((values, value, index, positions) => {
    if (index % 3 === 0) values.push(Math.hypot(value, positions[index + 1]));
    return values;
  }, []);
  assert.equal(Math.min(...trunkZ), 0);
  assert.ok(Math.max(...canopyZ) > Math.max(...trunkZ));
  assert.ok(Math.max(...canopyRadial) > Math.max(...trunkRadial) * 8);
  assert.equal(mesh.nominalCanopyDiameterMeters, 4);
});

test("serializes the tree as a valid GLB with separate brown-trunk and green-canopy materials", () => {
  const glb = buildLowPolySubdivisionTreeGlb();
  const view = new DataView(glb);
  assert.equal(view.getUint32(0, true), 0x46546c67);
  assert.equal(view.getUint32(4, true), 2);
  assert.equal(view.getUint32(8, true), glb.byteLength);
  const jsonLength = view.getUint32(12, true);
  assert.equal(view.getUint32(16, true), 0x4e4f534a);
  const jsonText = new TextDecoder().decode(new Uint8Array(glb, 20, jsonLength)).trimEnd();
  const document = JSON.parse(jsonText) as {
    asset: { version: string; extras: { modelVersion: string; upAxis: string; sourceAxis: string } };
    meshes: Array<{ primitives: unknown[] }>;
    nodes: Array<{ mesh: number; matrix?: number[]; rotation?: number[]; translation?: number[]; scale?: number[] }>;
    materials: Array<{ name: string; pbrMetallicRoughness: { baseColorFactor: number[] } }>;
    accessors: Array<{ bufferView: number; count: number; type: string; min: number[]; max: number[] }>;
    bufferViews: Array<{ byteOffset: number; byteLength: number }>;
  };
  assert.equal(document.asset.version, "2.0");
  assert.equal(document.asset.extras.modelVersion, SUBDIVISION_TREE_MODEL_VERSION);
  assert.equal(document.asset.extras.upAxis, "Y");
  assert.equal(document.meshes[0].primitives.length, 2);
  assert.deepEqual(document.nodes[0], { name: "SiteMorph concept tree", mesh: 0 });
  assert.deepEqual(document.materials.map((material) => material.name), ["Trunk", "Faceted green canopy"]);
  assert.ok(document.materials[1].pbrMetallicRoughness.baseColorFactor[1] > document.materials[1].pbrMetallicRoughness.baseColorFactor[0]);

  const binaryHeader = 20 + jsonLength;
  assert.equal(view.getUint32(binaryHeader + 4, true), 0x004e4942);
  const binaryStart = binaryHeader + 8;
  const sourceMesh = buildLowPolySubdivisionTreeMesh();
  [sourceMesh.trunk.positions, sourceMesh.canopy.positions].forEach((sourcePositions, primitiveIndex) => {
    const accessor = document.accessors[primitiveIndex * 2];
    const bufferView = document.bufferViews[accessor.bufferView];
    const serializedPositions = new Float32Array(glb.slice(
      binaryStart + bufferView.byteOffset,
      binaryStart + bufferView.byteOffset + bufferView.byteLength,
    ));
    assert.equal(serializedPositions.length, sourcePositions.length);
    for (let index = 0; index < sourcePositions.length; index += 3) {
      assert.ok(Math.abs(serializedPositions[index] - sourcePositions[index]) < 1e-6);
      assert.ok(Math.abs(serializedPositions[index + 1] - sourcePositions[index + 2]) < 1e-6);
      assert.ok(Math.abs(serializedPositions[index + 2] + sourcePositions[index + 1]) < 1e-6);
    }
  });
  assert.deepEqual(document.accessors[0].min, [-0.22, 0, -0.22]);
  assert.deepEqual(document.accessors[0].max, [0.22, 2.45, 0.22]);
  assert.equal(document.accessors[2].min[1], 2.28);
  assert.equal(document.accessors[2].max[1], 5.05);
});

test("rejects a persisted tree mesh that is lying on its side", async () => {
  const [tree] = await resolveSubdivisionTreePlacements(variant().trees.slice(0, 1), async () => 325, { retryDelayMs: 0 });
  assert.doesNotThrow(() => assertSubdivisionTreeMeshIsUpright(uprightTreeTriangles(tree), tree));
  const [x, y] = tree.point;
  const base = tree.terrainElevationMeters;
  const sideways = new Float32Array([
    x, y, base,
    x + 5.05 * tree.scale, y, base,
    x, y, base + 4 * tree.scale,
  ]);
  assert.throws(() => assertSubdivisionTreeMeshIsUpright(sideways, tree), /is not upright/);
});

test("deduplicates tree terrain points, retries bounded failures, and honors concurrency", async () => {
  const trees = [
    ...variant().trees,
    { ...variant().trees[0], id: "tree-003" },
  ];
  const calls = new Map<string, number>();
  let active = 0;
  let maximumActive = 0;
  const placements = await resolveSubdivisionTreePlacements(trees, async ([x, y]) => {
    const key = `${x}:${y}`;
    calls.set(key, (calls.get(key) ?? 0) + 1);
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    if (key === "18:6" && calls.get(key) === 1) throw new Error("transient terrain read");
    return 320 + x * 0.01 + y * 0.001;
  }, { attempts: 3, concurrency: 2, retryDelayMs: 0 });
  assert.equal(calls.size, 2, "duplicate tree points must share one terrain sample");
  assert.equal(calls.get("4:5"), 1);
  assert.equal(calls.get("18:6"), 2);
  assert.ok(maximumActive <= 2);
  assert.equal(placements.length, 3);
  assert.equal(placements[0].transform[12], 4);
  assert.equal(placements[0].transform[13], 5);
  assert.equal(placements[0].transform[14], placements[0].terrainElevationMeters);
  assert.equal(placements[1].scale, 1.3);
});

test("fails closed when real terrain remains unavailable", async () => {
  await assert.rejects(
    resolveSubdivisionTreePlacements(variant().trees, async () => {
      throw new Error("terrain unavailable");
    }, { attempts: 2, retryDelayMs: 0 }),
    /after 2 attempts.*No persistent context was created/,
  );
});

test("prepares a root request and verification expectations without mutating Forma", async () => {
  const prepared = await preparePersistentSubdivisionContext(variant(), async ([x, y]) => 300 + x + y, { retryDelayMs: 0 });
  assert.equal(prepared.terrainSampleCount, 2);
  assert.ok(prepared.treeTriangleCount > 0);
  const request = prepared.createRootRequest("run-123", "urn:adsk-forma-elements:integrate:project:tree:1");
  assert.equal(request.properties?.virtual, true);
  assert.equal(request.children?.length, 2);
  assert.equal(request.representations?.terrainShape.type, "embedded-json");
});

test("uploads one clean-room tree model and creates one schema-v3 virtual planning root with repeated instances", async () => {
  const createRequests: Array<Record<string, unknown>> = [];
  let uploaded: string | ArrayBuffer | undefined;
  let uploadCount = 0;
  const Forma = {
    terrain: {
      async getElevationAt({ x, y }: { x: number; y: number }) {
        return 321 + x * 0.01 + y * 0.001;
      },
    },
    integrateElements: {
      async uploadFile({ data }: { data: string | ArrayBuffer }) {
        uploadCount += 1;
        uploaded = data;
        return { fileId: "file-tree", blobId: "blob-tree" };
      },
      async createElementV2(request: Record<string, unknown>) {
        createRequests.push(request);
        return {
          urn: createRequests.length === 1
            ? "urn:adsk-forma-elements:integrate:project:tree-template:1"
            : "urn:adsk-forma-elements:integrate:project:context:1",
        };
      },
    },
  };
  const created = await createPersistentSubdivisionContext(Forma as never, variant(), "run-123", { retryDelayMs: 0 });
  assert.ok(uploaded instanceof ArrayBuffer);
  assert.equal(createRequests.length, 2);
  const template = createRequests[0] as {
    properties: Record<string, unknown>;
    representations: { volumeMesh: Record<string, unknown> };
  };
  assert.equal(template.properties.category, "vegetation");
  assert.equal(template.properties.virtual, true);
  assert.equal(template.properties.noiseIgnore, true);
  assert.equal(template.properties.treatAsVegetationInWindAnalysis, false);
  assert.deepEqual(template.representations.volumeMesh, { type: "linked", blobId: "blob-tree" });

  const root = createRequests[1] as {
    properties: Record<string, unknown>;
    representations: { terrainShape: { type: string; data: { features: unknown[] } } };
    children: Array<{ urn: string; key: string; transform: number[] }>;
  };
  assert.equal(root.properties.virtual, true);
  assert.deepEqual(root.properties[SITEMORPH_OWNERSHIP_NAMESPACE], {
    owned: true,
    schemaVersion: 3,
    runId: "run-123",
    role: SUBDIVISION_CONTEXT_ROLE,
  });
  assert.equal(root.representations.terrainShape.type, "embedded-json");
  assert.equal(root.representations.terrainShape.data.features.length, 6);
  assert.equal(root.children.length, 2);
  assert.ok(root.children.every((child) => child.urn === created.treeModelUrn));
  assert.equal(root.children[0].transform[14], created.expected.treePlacements[0].terrainElevationMeters);
  assert.equal(created.expected.treeTemplateGlbByteLength, (uploaded as ArrayBuffer).byteLength);
  assert.equal(created.urn, "urn:adsk-forma-elements:integrate:project:context:1");
  assert.equal(buildPersistentSubdivisionContextProposalOperation({ urn: created.urn, name: created.expected.name }).transform[15], 1);

  await createPersistentSubdivisionContext(Forma as never, variant(), "run-124", { retryDelayMs: 0 });
  assert.equal(uploadCount, 1, "the same SDK session must reuse one uploaded tree template");
  assert.equal(createRequests.length, 3, "the second run creates only its new context root");
});

test("verifies the persisted root and every terrain-elevated tree, returning the stable audit result", async () => {
  const prepared = await preparePersistentSubdivisionContext(variant(), async ([x, y]) => 322 + x * 0.01 + y * 0.001, { retryDelayMs: 0 });
  const treeModelUrn = "urn:adsk-forma-elements:integrate:project:tree-template:1";
  const request = prepared.createRootRequest("run-verify", treeModelUrn);
  const expected = {
    schemaVersion: 3 as const,
    role: SUBDIVISION_CONTEXT_ROLE,
    runId: "run-verify",
    variantId: variant().id,
    variantLabel: variant().label,
    name: request.properties?.name as string,
    terrainShape: prepared.terrainShape,
    featureCounts: prepared.featureCounts,
    treePlacements: prepared.treePlacements,
    treeTemplateUrn: treeModelUrn,
    urn: "urn:adsk-forma-elements:integrate:project:context:1",
    treeTemplateGlbByteLength: 2048,
    terrainSampleCount: prepared.terrainSampleCount,
    disclaimer: SUBDIVISION_CONTEXT_DISCLAIMER,
  };
  const rootPath = "root/context";
  const Forma = {
    proposal: { async awaitProposalPersisted() {} },
    geometry: {
      async getTriangles() {
        return uprightTreeTriangles(prepared.treePlacements[0]);
      },
    },
    elements: {
      async getByPath({ path }: { path: string }) {
        assert.equal(path, rootPath);
        return {
          element: {
            properties: request.properties,
            representations: request.representations,
            children: request.children?.map((child) => ({ key: child.key, urn: child.urn })),
          },
        };
      },
      async getWorldTransform({ path }: { path: string }) {
        const tree = prepared.treePlacements.find((placement) => path.endsWith(`/${placement.childKey}`));
        if (!tree) throw new Error("unexpected child path");
        return { transform: tree.transform };
      },
    },
  };
  const verified = await verifyPersistentSubdivisionContext(Forma as never, rootPath, expected, "run-verify", { retryDelayMs: 0 });
  assert.equal(verified.elementPath, rootPath);
  assert.equal(verified.status, "persisted-concept-context");
  assert.equal(verified.modelVersion, SUBDIVISION_CONTEXT_MODEL_VERSION);
  assert.equal(verified.roadFeatureCount, 1);
  assert.equal(verified.pedestrianPathFeatureCount, 1);
  assert.equal(verified.openSpaceFeatureCount, 2);
  assert.equal(verified.lotOutlineFeatureCount, 2);
  assert.equal(verified.treeCount, 2);
  assert.equal(verified.treeTerrainSampleCount, 2);
  assert.equal(verified.treeTerrainVerificationCount, 2);
  assert.ok(verified.treeTriangleCount > 0);
  assert.equal(verified.treeModelUrn, treeModelUrn);
  assert.equal(verified.disclaimer, SUBDIVISION_CONTEXT_DISCLAIMER);
});

test("persistent context verification rejects a sideways linked tree model", async () => {
  const prepared = await preparePersistentSubdivisionContext(variant(), async () => 325, { retryDelayMs: 0 });
  const treeModelUrn = "urn:adsk-forma-elements:integrate:project:tree-template:sideways";
  const request = prepared.createRootRequest("run-sideways", treeModelUrn);
  const expected = {
    schemaVersion: 3 as const,
    role: SUBDIVISION_CONTEXT_ROLE,
    runId: "run-sideways",
    variantId: variant().id,
    variantLabel: variant().label,
    name: request.properties?.name as string,
    terrainShape: prepared.terrainShape,
    featureCounts: prepared.featureCounts,
    treePlacements: prepared.treePlacements,
    treeTemplateUrn: treeModelUrn,
    urn: "urn:adsk-forma-elements:integrate:project:context:sideways",
    treeTemplateGlbByteLength: 2048,
    terrainSampleCount: prepared.terrainSampleCount,
    disclaimer: SUBDIVISION_CONTEXT_DISCLAIMER,
  };
  const firstTree = prepared.treePlacements[0];
  const [x, y] = firstTree.point;
  const base = firstTree.terrainElevationMeters;
  const Forma = {
    proposal: { async awaitProposalPersisted() {} },
    geometry: {
      async getTriangles() {
        return new Float32Array([
          x, y, base,
          x + 5.05 * firstTree.scale, y, base,
          x, y, base + 4 * firstTree.scale,
        ]);
      },
    },
    elements: {
      async getByPath() {
        return {
          element: {
            properties: request.properties,
            representations: request.representations,
            children: request.children?.map((child) => ({ key: child.key, urn: child.urn })),
          },
        };
      },
      async getWorldTransform({ path }: { path: string }) {
        const tree = prepared.treePlacements.find((placement) => path.endsWith(`/${placement.childKey}`));
        if (!tree) throw new Error("unexpected child path");
        return { transform: tree.transform };
      },
    },
  };
  await assert.rejects(
    verifyPersistentSubdivisionContext(Forma as never, "root/context-sideways", expected, "run-sideways", { attempts: 1, retryDelayMs: 0 }),
    /verification failed.*is not upright/,
  );
});

test("rejects a tree displaced from its sampled terrain placement", async () => {
  const [expected] = await resolveSubdivisionTreePlacements(variant().trees.slice(0, 1), async () => 325, { retryDelayMs: 0 });
  const displaced = [...expected.transform];
  displaced[12] += 2;
  assert.throws(() => assertSubdivisionTreePlacementMatches(displaced, expected), /does not match expected/);
  const tilted = [...expected.transform];
  tilted[9] = 0.3;
  assert.throws(() => assertSubdivisionTreePlacementMatches(tilted, expected), /linear transform\[9\].*does not match expected/);

  const prepared = await preparePersistentSubdivisionContext(variant(), async () => 325, { retryDelayMs: 0 });
  const request = prepared.createRootRequest("run-displaced", "urn:adsk-forma-elements:integrate:project:tree-template:1");
  const contextExpected = {
    schemaVersion: 3 as const,
    role: SUBDIVISION_CONTEXT_ROLE,
    runId: "run-displaced",
    variantId: variant().id,
    variantLabel: variant().label,
    name: request.properties?.name as string,
    terrainShape: prepared.terrainShape,
    featureCounts: prepared.featureCounts,
    treePlacements: prepared.treePlacements,
    treeTemplateUrn: "urn:adsk-forma-elements:integrate:project:tree-template:1",
    urn: "urn:adsk-forma-elements:integrate:project:context:1",
    treeTemplateGlbByteLength: 2048,
    terrainSampleCount: prepared.terrainSampleCount,
    disclaimer: SUBDIVISION_CONTEXT_DISCLAIMER,
  };
  const Forma = {
    proposal: { async awaitProposalPersisted() {} },
    geometry: {
      async getTriangles() {
        return uprightTreeTriangles(prepared.treePlacements[0]);
      },
    },
    elements: {
      async getByPath() {
        return {
          element: {
            properties: request.properties,
            representations: request.representations,
            children: request.children?.map((child) => ({ key: child.key, urn: child.urn })),
          },
        };
      },
      async getWorldTransform({ path }: { path: string }) {
        const tree = prepared.treePlacements.find((placement) => path.endsWith(`/${placement.childKey}`))!;
        const transform = [...tree.transform];
        if (tree === prepared.treePlacements[0]) transform[13] += 1.5;
        return { transform };
      },
    },
  };
  await assert.rejects(
    verifyPersistentSubdivisionContext(Forma as never, "root/context", contextExpected, "run-displaced", { attempts: 1, retryDelayMs: 0 }),
    /verification failed.*does not match expected/,
  );
});
