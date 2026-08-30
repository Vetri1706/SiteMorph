import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyOptionalEvidenceFailure,
  requiredNewActivityCount,
} from "../server/full-evidence-policy.ts";

test("an approved full first run reserves three enrichment activities after the thermal set", () => {
  assert.equal(requiredNewActivityCount(12, true, false), 15);
  assert.equal(requiredNewActivityCount(12, false, false), 12);
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
