import assert from "node:assert/strict";
import test from "node:test";

import { evaluateSunIntervention } from "../src/utils/design-intervention.ts";

test("accepts a revision only when Forma measures a real mean-sun improvement", () => {
  assert.deepEqual(evaluateSunIntervention({ meanHours: 8.1, maxHours: 10 }, { meanHours: 7.8, maxHours: 9.9 }), {
    accepted: true,
    reason: "mean-improved",
    meanDeltaHours: 0.3,
    maxDeltaHours: 0.1,
  });
});

test("rejects an unchanged result instead of calling it equal-or-better", () => {
  assert.deepEqual(evaluateSunIntervention({ meanHours: 8.1, maxHours: 10 }, { meanHours: 8.1, maxHours: 10 }), {
    accepted: false,
    reason: "no-measured-improvement",
    meanDeltaHours: 0,
    maxDeltaHours: 0,
  });
});

test("rejects an intervention that Forma completed without readable metrics", () => {
  assert.deepEqual(evaluateSunIntervention({}, {}), { accepted: false, reason: "metrics-unavailable" });
});
