import assert from "node:assert/strict";
import test from "node:test";

test("the Vercel handler module loads under Node ESM", async () => {
  const entrypoint = await import("../server/vercel-hosted.ts");
  assert.equal(typeof entrypoint.handleVercelRequest, "function");
});
