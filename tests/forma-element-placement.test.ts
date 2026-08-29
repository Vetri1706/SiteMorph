import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSingleSiteMorphOwnedRoot,
  isPathWithinOwnedRoot,
  listSiteMorphOwnedRootPaths,
  removeOtherSiteMorphOwnedRoots,
  rollbackSiteMorphOwnedRoot,
  SITEMORPH_OWNERSHIP_NAMESPACE,
  tagSiteMorphElementUrn,
  verifyPersistedFormaElementPlacement,
} from "../src/services/forma-element-placement.service.ts";

type TestChild = { key: string; name?: string; properties?: Record<string, unknown> };
const marker = { [SITEMORPH_OWNERSHIP_NAMESPACE]: { owned: true, schemaVersion: 1 }, category: "building" };

function placementClient(options: {
  worldX?: number;
  worldY?: number;
  worldZ?: number;
  meshZ?: number;
  children?: TestChild[];
  removeFailures?: number;
  updateFailures?: number;
} = {}) {
  let children = options.children ?? [{ key: "current", name: "SiteMorph — Office", properties: marker }];
  const removed: string[] = [];
  let persistCount = 0;
  let removeCount = 0;
  let updateCount = 0;
  return {
    client: {
      elements: {
        async getByPath({ path }: { path: string }) {
          if (path === "root") return { element: { urn: "root", children }, elements: {} };
          const key = path.replace(/^root\//, "");
          const child = children.find((candidate) => candidate.key === key);
          if (!child) throw new Error(`Missing child ${path}`);
          return { element: { urn: `urn:${key}`, properties: child.properties }, elements: {} };
        },
        async getWorldTransform() {
          return { transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, options.worldX ?? 10, options.worldY ?? 20, options.worldZ ?? 326.75, 1] };
        },
        async editProperties({ urn }: { urn: string }) {
          return { urn: `${urn}:owned` };
        },
      },
      geometry: {
        async getTriangles() {
          const z = options.meshZ ?? 326.75;
          return new Float32Array([0, 0, z, 1, 0, z, 0, 1, z + 4]);
        },
      },
      proposal: {
        async awaitProposalPersisted() { persistCount += 1; },
        async removeElement({ path }: { path: string }) {
          removeCount += 1;
          if (removeCount <= (options.removeFailures ?? 0)) throw new Error("temporary rollback failure");
          removed.push(path);
          const key = path.replace(/^root\//, "");
          children = children.filter((child) => child.key !== key);
        },
        async updateElements({ operations }: { operations: Array<{ type: "remove"; path: string }> }) {
          updateCount += 1;
          if (updateCount <= (options.updateFailures ?? 0)) throw new Error("temporary proposal update failure");
          for (const operation of operations) {
            removed.push(operation.path);
            const key = operation.path.replace(/^root\//, "");
            children = children.filter((child) => child.key !== key);
          }
          return operations.map(() => undefined);
        },
      },
    },
    removed,
    persistCount: () => persistCount,
    removeCount: () => removeCount,
    updateCount: () => updateCount,
  };
}

test("identifies tagged roots and only category-checked legacy SiteMorph roots", async () => {
  const { client } = placementClient({
    children: [
      { key: "old", name: "SiteMorph — Warehouse", properties: { category: "building" } },
      { key: "old-plural", name: "SiteMorph — Retail", properties: { category: "buildings" } },
      { key: "tagged", name: "Renamed by user", properties: marker },
      { key: "site", name: "Site Limit" },
      { key: "lookalike", name: "SiteMorph — User option", properties: { category: "site_limit" } },
    ],
  });
  assert.deepEqual(await listSiteMorphOwnedRootPaths(client as never), ["root/old", "root/old-plural", "root/tagged"]);
  assert.equal(isPathWithinOwnedRoot("root/old/floor-1", ["root/old"]), true);
  assert.equal(isPathWithinOwnedRoot("root/site", ["root/old"]), false);
});

test("adds a namespaced ownership marker before proposal insertion", async () => {
  const { client } = placementClient();
  assert.equal(await tagSiteMorphElementUrn(client as never, "urn:floor-stack" as never), "urn:floor-stack:owned");
});

test("removes every stale owned root after a verified root is generated", async () => {
  const { client, removed, persistCount } = placementClient({
    children: [
      { key: "old-zero", name: "SiteMorph — Warehouse", properties: { category: "building" } },
      { key: "current", name: "SiteMorph — Office · revised", properties: marker },
      { key: "other", name: "Existing Building" },
    ],
  });
  const stale = await removeOtherSiteMorphOwnedRoots(client as never, "root/current");
  assert.deepEqual(stale, ["root/old-zero"]);
  assert.deepEqual(removed, ["root/old-zero"]);
  assert.ok(persistCount() >= 1);
  assert.deepEqual(await listSiteMorphOwnedRootPaths(client as never), ["root/current"]);
});

test("retries batch cleanup instead of leaving a visible duplicate after one transient failure", async () => {
  const { client, removed, updateCount } = placementClient({
    updateFailures: 1,
    children: [
      { key: "old", name: "SiteMorph — Retail", properties: { category: "building" } },
      { key: "current", name: "SiteMorph — Retail · retained", properties: marker },
    ],
  });
  const stale = await removeOtherSiteMorphOwnedRoots(client as never, "root/current", { maxAttempts: 2, retryDelayMs: 0 });
  assert.deepEqual(stale, ["root/old"]);
  assert.deepEqual(removed, ["root/old"]);
  assert.equal(updateCount(), 2);
});

test("retries rollback and verifies the rejected tagged root is absent", async () => {
  const { client, removed, removeCount } = placementClient({ removeFailures: 1 });
  await rollbackSiteMorphOwnedRoot(client as never, "root/current", { maxAttempts: 2, retryDelayMs: 0 });
  assert.equal(removeCount(), 2);
  assert.deepEqual(removed, ["root/current"]);
  assert.deepEqual(await listSiteMorphOwnedRootPaths(client as never), []);
});

test("surfaces a rollback-blocked error instead of silently leaving a tagged root", async () => {
  const { client } = placementClient({ removeFailures: 2 });
  await assert.rejects(
    rollbackSiteMorphOwnedRoot(client as never, "root/current", { maxAttempts: 2, retryDelayMs: 0 }),
    /could not roll back the rejected proposal root root\/current.*Remove it before Revit handoff/i,
  );
});

test("verifies persisted world-transform and generated mesh base against sampled terrain", async () => {
  const { client } = placementClient();
  const result = await verifyPersistedFormaElementPlacement(client as never, "root/current", {
    terrainBaseElevationMeters: 326.75,
    terrainSampleCount: 18,
    expectedCenterXMeters: 10,
    expectedCenterYMeters: 20,
  }, { maxAttempts: 1 });
  assert.equal(result.worldTransformXMeters, 10);
  assert.equal(result.worldTransformYMeters, 20);
  assert.equal(result.worldTransformElevationMeters, 326.75);
  assert.equal(result.meshBaseElevationMeters, 326.75);
  assert.equal(result.terrainSampleCount, 18);
});

test("fails closed when the persisted transform remains at zero", async () => {
  const { client } = placementClient({ worldZ: 0 });
  await assert.rejects(
    verifyPersistedFormaElementPlacement(client as never, "root/current", {
      terrainBaseElevationMeters: 326.75,
      terrainSampleCount: 18,
      expectedCenterXMeters: 10,
      expectedCenterYMeters: 20,
    }, { maxAttempts: 1 }),
    /Persisted world-transform elevation 0\.000 m does not match sampled terrain/,
  );
});

test("fails closed when the persisted transform is horizontally displaced", async () => {
  const { client } = placementClient({ worldX: 410 });
  await assert.rejects(
    verifyPersistedFormaElementPlacement(client as never, "root/current", {
      terrainBaseElevationMeters: 326.75,
      terrainSampleCount: 18,
      expectedCenterXMeters: 10,
      expectedCenterYMeters: 20,
    }, { maxAttempts: 1 }),
    /Persisted world-transform X coordinate 410\.000 m does not match expected 10\.000 m/,
  );
});

test("fails closed when the generated mesh base is vertically displaced", async () => {
  const { client } = placementClient({ meshZ: 0 });
  await assert.rejects(
    verifyPersistedFormaElementPlacement(client as never, "root/current", {
      terrainBaseElevationMeters: 326.75,
      terrainSampleCount: 18,
      expectedCenterXMeters: 10,
      expectedCenterYMeters: 20,
    }, { maxAttempts: 1 }),
    /Generated mesh base elevation 0\.000 m does not match sampled terrain/,
  );
});

test("Revit ownership preflight blocks duplicate SiteMorph roots", () => {
  assert.throws(
    () => assertSingleSiteMorphOwnedRoot(["root/current", "root/stale-zero"], "root/current"),
    /2 SiteMorph-owned proposal roots remain/,
  );
});
