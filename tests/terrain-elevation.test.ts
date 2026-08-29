import assert from "node:assert/strict";
import test from "node:test";

import { pointInPolygon } from "../src/utils/geometry-validation.ts";
import { resolveTerrainBaseElevation, sampleTerrainBaseElevation, terrainSamplePoints } from "../src/utils/terrain-elevation.ts";

const footprint: Array<[number, number]> = [[0, 0], [20, 0], [20, 10], [0, 10], [0, 0]];

test("densely samples the clipped footprint without duplicating the closing point", () => {
  const samples = terrainSamplePoints(footprint);
  assert.ok(samples.length > 9);
  assert.ok(samples.every((point) => pointInPolygon(point, footprint)));
  assert.equal(new Set(samples.map(([x, y]) => `${x}:${y}`)).size, samples.length);
});

test("clips grid samples out of a concave footprint notch", () => {
  const concave: Array<[number, number]> = [[0, 0], [20, 0], [20, 8], [8, 8], [8, 20], [0, 20], [0, 0]];
  const samples = terrainSamplePoints(concave);
  assert.ok(samples.length > 9);
  assert.ok(samples.every((point) => pointInPolygon(point, concave)));
  assert.ok(!samples.some(([x, y]) => x > 8 && y > 8));
});

test("places the mass at the highest readable terrain elevation under its footprint", async () => {
  const elevation = await resolveTerrainBaseElevation(footprint, async ([x, y]) => 326 + x / 20 + y / 20);
  assert.equal(elevation, 327.5);
});

test("retries transient terrain failures with bounded requests before accepting the footprint", async () => {
  const attempts = new Map<string, number>();
  const result = await sampleTerrainBaseElevation(footprint, async ([x, y]) => {
    const key = `${x}:${y}`;
    const count = (attempts.get(key) ?? 0) + 1;
    attempts.set(key, count);
    if (count === 1) throw new Error("transient");
    return 326 + x / 20 + y / 20;
  });
  assert.equal(result.elevationMeters, 327.5);
  assert.equal(result.successfulSampleCount, result.requestedSampleCount);
  assert.ok([...attempts.values()].every((count) => count === 2));
});

test("fails closed if even one footprint sample remains unavailable", async () => {
  await assert.rejects(
    sampleTerrainBaseElevation(footprint, async ([x, y]) => {
      if (x === 20 && y === 10) throw new Error("unavailable high point");
      return 326 + x / 20 + y / 20;
    }),
    /incomplete grade coverage could place it below the site/,
  );
});

test("fails closed if Forma returns no real terrain sample", async () => {
  await assert.rejects(
    resolveTerrainBaseElevation(footprint, async () => { throw new Error("unavailable"); }),
    /No building was added because incomplete grade coverage/,
  );
});

test("rejects a degenerate footprint before calling Forma terrain", async () => {
  let calls = 0;
  await assert.rejects(
    resolveTerrainBaseElevation([[0, 0], [10, 0], [20, 0]], async () => {
      calls += 1;
      return 326;
    }),
    /not a valid polygon/,
  );
  assert.equal(calls, 0);
});
