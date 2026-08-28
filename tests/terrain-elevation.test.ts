import assert from "node:assert/strict";
import test from "node:test";

import { resolveTerrainBaseElevation, terrainSamplePoints } from "../src/utils/terrain-elevation.ts";

const footprint: Array<[number, number]> = [[0, 0], [20, 0], [20, 10], [0, 10], [0, 0]];

test("samples the footprint center, corners and edge midpoints without duplicating the closing point", () => {
  const samples = terrainSamplePoints(footprint);
  assert.equal(samples.length, 9);
  assert.deepEqual(samples[0], [10, 5]);
});

test("places the mass at the highest readable terrain elevation under its footprint", async () => {
  const elevation = await resolveTerrainBaseElevation(footprint, async ([x, y]) => 326 + x / 20 + y / 20, 0);
  assert.equal(elevation, 327.5);
});

test("uses the Site Limit terrain fallback if Forma elevation sampling is unavailable", async () => {
  const elevation = await resolveTerrainBaseElevation(footprint, async () => { throw new Error("unavailable"); }, 326.75);
  assert.equal(elevation, 326.75);
});
