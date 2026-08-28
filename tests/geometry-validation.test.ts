import assert from "node:assert/strict";
import test from "node:test";

import { assertFootprintInsideSite, boundsOverlap, pointInPolygon, polygonBounds, polygonInsidePolygon, projectTriangleMeshToFootprint } from "../src/utils/geometry-validation.ts";

const site: Array<[number, number]> = [[0, 0], [100, 0], [100, 100], [60, 100], [60, 50], [0, 50]];

test("accepts points on a Site Limit edge and footprints wholly inside", () => {
  assert.equal(pointInPolygon([0, 20], site), true);
  assert.equal(polygonInsidePolygon([[10, 10], [50, 10], [50, 40], [10, 40]], site), true);
  assert.doesNotThrow(() => assertFootprintInsideSite([[10, 10], [50, 10], [50, 40], [10, 40]], site));
});

test("rejects an edge that crosses outside a concave Site Limit", () => {
  const crossing: Array<[number, number]> = [[10, 10], [90, 10], [90, 90], [50, 40]];
  assert.equal(polygonInsidePolygon(crossing, site), false);
  assert.throws(() => assertFootprintInsideSite(crossing, site), /outside the selected Site Limit/);
});

test("filters obstacle bounds to the selected-site vicinity", () => {
  assert.equal(boundsOverlap(polygonBounds(site), polygonBounds([[90, 90], [110, 90], [110, 110], [90, 110]])), true);
  assert.equal(boundsOverlap(polygonBounds(site), polygonBounds([[200, 200], [210, 200], [210, 210], [200, 210]])), false);
});

test("derives a closed floor-stack footprint from recursive triangle geometry", () => {
  const mesh = new Float32Array([
    10, 20, 0, 40, 20, 0, 40, 60, 0,
    10, 20, 0, 40, 60, 0, 10, 60, 0,
    10, 20, 12, 40, 60, 12, 40, 20, 12,
  ]);
  const footprint = projectTriangleMeshToFootprint(mesh);
  assert.deepEqual(footprint, [[10, 20], [40, 20], [40, 60], [10, 60], [10, 20]]);
});

test("rejects triangle meshes that cannot form an area", () => {
  const mesh = new Float32Array([0, 0, 0, 1, 1, 0, 2, 2, 0]);
  assert.deepEqual(projectTriangleMeshToFootprint(mesh), []);
});
