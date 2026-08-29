import assert from "node:assert/strict";
import test from "node:test";

import { decodeSunGroundGrid } from "../src/utils/sun-grid.ts";

test("decodes Uint8 Sun sample counts using Forma positions per hour", () => {
  const decoded = decodeSunGroundGrid(new Uint8Array([0, 64, 128, 224]), new Uint8Array([1, 1, 1, 1]), 16);
  assert.deepEqual(decoded.hours, [0, 4, 8, 14]);
  assert.deepEqual(Array.from(decoded.grid), [0, 4, 8, 14]);
  assert.deepEqual(Array.from(decoded.mask), [1, 1, 1, 1]);
  assert.match(decoded.note, /16 positions per hour/);
});

test("keeps Float32 Sun grids in hours and applies the validity mask", () => {
  const decoded = decodeSunGroundGrid(new Float32Array([2.5, 8.25, 30]), new Uint8Array([1, 1, 0]), 16);
  assert.deepEqual(decoded.hours, [2.5, 8.25]);
  assert.deepEqual(Array.from(decoded.mask), [1, 1, 0]);
  assert.deepEqual(Array.from(decoded.grid).slice(0, 2), [2.5, 8.25]);
  assert.equal(Number.isNaN(decoded.grid[2]), true);
});

test("preserves full grid shape while masking non-finite cells", () => {
  const decoded = decodeSunGroundGrid(new Float32Array([1, Number.NaN, 12, Number.POSITIVE_INFINITY]), undefined, undefined);
  assert.equal(decoded.grid.length, 4);
  assert.deepEqual(decoded.hours, [1, 12]);
  assert.deepEqual(Array.from(decoded.mask), [1, 0, 1, 0]);
  assert.equal(Number.isNaN(decoded.grid[1]), true);
  assert.equal(Number.isNaN(decoded.grid[3]), true);
});

test("fails closed when an encoded sample decodes to 25.5 daily hours", () => {
  assert.throws(() => decodeSunGroundGrid(new Uint8Array([255]), undefined, 10), /implausible daily Sun value \(25\.50 h\)/);
});

test("fails closed when a Float32 sample reports 25.5 daily hours", () => {
  assert.throws(() => decodeSunGroundGrid(new Float32Array([25.5]), undefined, undefined), /implausible daily Sun value \(25\.50 h\)/);
});
