import assert from "node:assert/strict";
import test from "node:test";
import type { SurfaceSegmentation } from "../src/types/index.ts";
import { hasVisibleSatelliteContext } from "../src/utils/satellite-context.ts";

function surface(patch: Partial<SurfaceSegmentation> = {}): SurfaceSegmentation {
  return {
    treePercent: 0,
    vegetationPercent: 0,
    grassPercent: 0,
    buildingPercent: 0,
    roadPercent: 0,
    pavementPercent: 0,
    bareGroundPercent: 0,
    otherPercent: 0,
    canopyVegetationPercent: 0,
    imperviousPercent: 0,
    ...patch,
  };
}

test("satellite context requires renderable imagery rather than percentages alone", () => {
  assert.equal(hasVisibleSatelliteContext(undefined), false);
  assert.equal(hasVisibleSatelliteContext(surface()), false);
  assert.equal(hasVisibleSatelliteContext(surface({ originalImageDataUrl: " " })), false);
  assert.equal(hasVisibleSatelliteContext(surface({ originalImageDataUrl: "http://example.test/satellite.png" })), false);
});

test("either saved FortyGuard satellite image makes the context visibly reusable", () => {
  assert.equal(hasVisibleSatelliteContext(surface({ originalImageDataUrl: "data:image/png;base64,c291cmNl" })), true);
  assert.equal(hasVisibleSatelliteContext(surface({ segmentedImageDataUrl: "data:image/jpeg;base64,c2VnbWVudGVk" })), true);
  assert.equal(hasVisibleSatelliteContext(surface({ originalImageDataUrl: "https://cdn.example.test/signed/satellite-context" })), true);
});
