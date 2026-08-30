import {
  BlobNotFoundError,
  BlobPreconditionFailedError,
  del as blobDelete,
  get as blobGet,
  put as blobPut,
} from "@vercel/blob";
import { isAbsolute, relative } from "node:path";
import type { PersistenceAdapter } from "./persistence.ts";
import { normalizeRuntimeKey, type RuntimeBucket } from "../worker/shims/runtime-store.ts";

type BlobGetResult = Awaited<ReturnType<typeof blobGet>>;
type BlobPutResult = Awaited<ReturnType<typeof blobPut>>;

export interface BlobOperations {
  delete(pathname: string): Promise<void>;
  get(pathname: string): Promise<BlobGetResult>;
  put(
    pathname: string,
    value: string | ArrayBuffer,
    options: { allowOverwrite: boolean; ifMatch?: string },
  ): Promise<BlobPutResult>;
}

const vercelBlobOperations: BlobOperations = {
  async delete(pathname) {
    await blobDelete(pathname);
  },
  async get(pathname) {
    return blobGet(pathname, { access: "private", useCache: false });
  },
  async put(pathname, value, options) {
    return blobPut(pathname, value, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: options.allowOverwrite,
      cacheControlMaxAge: 60,
      contentType: "application/json; charset=utf-8",
      ...(options.ifMatch ? { ifMatch: options.ifMatch } : {}),
    });
  },
};

function blobPath(value: string): string {
  return `sitemorph/${normalizeRuntimeKey(value)}`;
}

function toArrayBuffer(value: ArrayBufferView): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function body(value: string | ArrayBuffer | ArrayBufferView): string | ArrayBuffer {
  return ArrayBuffer.isView(value) ? toArrayBuffer(value) : value;
}

function missing(path: string): Error & { code: string } {
  return Object.assign(new Error(`Vercel Blob cache entry not found: ${path}`), { code: "ENOENT" });
}

export function createVercelBlobBucket(operations: BlobOperations = vercelBlobOperations): RuntimeBucket {
  const bucket: RuntimeBucket = {
    async get(key) {
      try {
        const result = await operations.get(blobPath(key));
        if (!result || result.statusCode !== 200) return null;
        const text = await new Response(result.stream).text();
        return { etag: result.blob.etag, async text() { return text; } };
      } catch (error) {
        if (error instanceof BlobNotFoundError) return null;
        throw error;
      }
    },

    async put(key, value, options = {}) {
      const condition = (options.onlyIf ?? {}) as { etagDoesNotMatch?: string; etagMatches?: string };
      const createOnly = condition.etagDoesNotMatch === "*";
      const ifMatch = typeof condition.etagMatches === "string" ? condition.etagMatches : undefined;
      try {
        const result = await operations.put(blobPath(key), body(value), {
          allowOverwrite: !createOnly,
          ...(ifMatch ? { ifMatch } : {}),
        });
        return { etag: result.etag };
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError) return null;
        if (createOnly) {
          const existing = await bucket.get(key);
          if (existing) return null;
        }
        throw error;
      }
    },

    async delete(key) {
      try {
        await operations.delete(blobPath(key));
      } catch (error) {
        if (!(error instanceof BlobNotFoundError)) throw error;
      }
    },
  };
  return bucket;
}

function persistencePath(path: string): string {
  const candidate = relative(process.cwd(), path);
  const scoped = !candidate.startsWith("..") && !isAbsolute(candidate) ? candidate : path;
  return `runtime-files/${normalizeRuntimeKey(scoped).replaceAll(":", "")}`;
}

export function createVercelBlobPersistence(bucket: RuntimeBucket): PersistenceAdapter {
  return {
    async mkdir() {
      // Vercel Blob is key-based and does not require directory creation.
    },
    async readFile(path) {
      const object = await bucket.get(persistencePath(path));
      if (!object) throw missing(path);
      return object.text();
    },
    async rename(source, destination) {
      const sourceKey = persistencePath(source);
      const object = await bucket.get(sourceKey);
      if (!object) throw missing(source);
      await bucket.put(persistencePath(destination), await object.text());
      await bucket.delete(sourceKey);
    },
    async writeFile(path, value) {
      await bucket.put(persistencePath(path), value);
    },
  };
}
