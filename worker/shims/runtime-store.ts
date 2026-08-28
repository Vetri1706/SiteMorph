type RuntimeObjectBody = {
  etag?: string;
  text(): Promise<string>;
};

export type RuntimeBucket = {
  get(key: string): Promise<RuntimeObjectBody | null>;
  put(key: string, value: string | ArrayBuffer | ArrayBufferView, options?: Record<string, unknown>): Promise<unknown>;
  delete(key: string): Promise<void>;
};

let activeBucket: RuntimeBucket | undefined;

export function bindRuntimeBucket(bucket: RuntimeBucket): void {
  activeBucket = bucket;
}

export function getRuntimeBucket(): RuntimeBucket {
  if (!activeBucket) throw new Error("SiteMorph hosted cache binding is unavailable");
  return activeBucket;
}

export function normalizeRuntimeKey(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/+/, "").replaceAll(/\/{2,}/g, "/");
}
