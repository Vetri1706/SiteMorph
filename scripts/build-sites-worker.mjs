#!/usr/bin/env node
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fromRoot = (...parts) => path.join(root, ...parts);

await build({
  entryPoints: [fromRoot("worker", "runtime.ts")],
  outfile: fromRoot("dist", "server", "index.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  legalComments: "none",
  sourcemap: false,
  alias: {
    "node:crypto": fromRoot("worker", "shims", "crypto.ts"),
    "node:fs/promises": fromRoot("worker", "shims", "fs-promises.ts"),
    "node:path": fromRoot("worker", "shims", "path.ts"),
    "node:timers/promises": fromRoot("worker", "shims", "timers-promises.ts"),
  },
  inject: [
    fromRoot("worker", "shims", "process.ts"),
    fromRoot("worker", "shims", "fetch.ts"),
  ],
});

console.log("Prepared hosted SiteMorph API worker with persistent credit guards");
