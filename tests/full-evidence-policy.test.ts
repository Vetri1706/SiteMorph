import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyOptionalEvidenceFailure,
  CORE_THERMAL_ACTIVITY_COUNT,
  FULL_EVIDENCE_ACTIVITY_COUNT,
  OPTIONAL_EVIDENCE_ACTIVITY_COUNT,
  requiredNewActivityCount,
} from "../server/full-evidence-policy.ts";

test("an approved full first run reserves three enrichment activities after the thermal set", () => {
  assert.equal(CORE_THERMAL_ACTIVITY_COUNT, 12);
  assert.equal(OPTIONAL_EVIDENCE_ACTIVITY_COUNT, 3);
  assert.equal(FULL_EVIDENCE_ACTIVITY_COUNT, 15);
  assert.equal(requiredNewActivityCount(CORE_THERMAL_ACTIVITY_COUNT, true, false), FULL_EVIDENCE_ACTIVITY_COUNT);
  assert.equal(requiredNewActivityCount(CORE_THERMAL_ACTIVITY_COUNT, false, false), CORE_THERMAL_ACTIVITY_COUNT);
});

test("cache-only reruns never reserve or submit missing enrichment activities", () => {
  assert.equal(requiredNewActivityCount(0, true, true), 0);
  assert.equal(requiredNewActivityCount(4, true, true), 4);
});

test("saved enrichment work distinguishes resumable, unsubmitted, and hard failures", () => {
  assert.equal(classifyOptionalEvidenceFailure(Object.assign(new Error("still running"), { status: 504 })), "pending");
  assert.equal(classifyOptionalEvidenceFailure(Object.assign(new Error("0-activity limit was reached"), { status: 429 })), "missing");
  assert.equal(classifyOptionalEvidenceFailure(Object.assign(new Error("provider rejected activity"), { status: 502 })), "hard");
});
