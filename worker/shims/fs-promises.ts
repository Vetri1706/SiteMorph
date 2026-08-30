import { getRuntimeBucket, normalizeRuntimeKey } from "./runtime-store.ts";

function missing(path: string): Error & { code: string } {
  return Object.assign(new Error(`Hosted cache entry not found: ${path}`), { code: "ENOENT" });
}

export async function mkdir(): Promise<void> {
  // R2 is key-based and does not require directories.
}

export async function readFile(path: string): Promise<string> {
  const object = await getRuntimeBucket().get(normalizeRuntimeKey(path));
  if (!object) throw missing(path);
  return object.text();
}

export async function writeFile(path: string, value: string | ArrayBuffer | ArrayBufferView): Promise<void> {
  await getRuntimeBucket().put(normalizeRuntimeKey(path), value);
}

export async function rename(source: string, destination: string): Promise<void> {
  const bucket = getRuntimeBucket();
  const sourceKey = normalizeRuntimeKey(source);
  const object = await bucket.get(sourceKey);
  if (!object) throw missing(source);
  await bucket.put(normalizeRuntimeKey(destination), await object.text());
  await bucket.delete(sourceKey);
}
