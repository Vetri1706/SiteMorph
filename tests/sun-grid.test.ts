import assert from "node:assert/strict";
import test from "node:test";

import { decodeSunGroundGrid } from "../src/utils/sun-grid.ts";

test("decodes Uint8 Sun sample counts using Forma positions per hour", () => {
  const decoded = decodeSunGroundGrid(new Uint8Array([0, 64, 128, 224]), new Uint8Array([1, 1, 1, 1]), 16);
  assert.deepEqual(decoded.hours, [0, 4, 8, 14]);
  assert.match(decoded.note, /16 positions per hour/);
});

test("keeps Float32 Sun grids in hours and applies the validity mask", () => {
  const decoded = decodeSunGroundGrid(new Float32Array([2.5, 8.25, 30]), new Uint8Array([1, 1, 0]), 16);
  assert.deepEqual(decoded.hours, [2.5, 8.25]);
});

test("fails closed when a valid sample cannot represent daily hours", () => {
  assert.throws(() => decodeSunGroundGrid(new Uint8Array([255]), undefined, 4), /implausible daily Sun value/);
});
