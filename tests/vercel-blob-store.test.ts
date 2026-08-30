import assert from "node:assert/strict";
import test from "node:test";
import { BlobPreconditionFailedError } from "@vercel/blob";
import {
  createVercelBlobBucket,
  createVercelBlobPersistence,
  type BlobOperations,
} from "../server/vercel-blob-store.ts";

class MemoryBlobOperations implements BlobOperations {
  private readonly values = new Map<string, { etag: string; value: string }>();
  private revision = 0;

  async delete(pathname: string): Promise<void> {
    this.values.delete(pathname);
  }

  async get(pathname: string): ReturnType<BlobOperations["get"]> {
    const entry = this.values.get(pathname);
    if (!entry) return null;
    return {
      statusCode: 200,
      stream: new Response(entry.value).body!,
      headers: new Headers(),
      blob: {
        url: `https://blob.test/${pathname}`,
        downloadUrl: `https://blob.test/${pathname}?download=1`,
        pathname,
        contentDisposition: "attachment",
        cacheControl: "private, max-age=0",
        uploadedAt: new Date(0),
        etag: entry.etag,
        contentType: "application/json",
        size: entry.value.length,
      },
    };
  }

  async put(
    pathname: string,
    value: string | ArrayBuffer,
    options: { allowOverwrite: boolean; ifMatch?: string },
  ): ReturnType<BlobOperations["put"]> {
    const existing = this.values.get(pathname);
    if (options.ifMatch && existing?.etag !== options.ifMatch) throw new BlobPreconditionFailedError();
    if (!options.allowOverwrite && existing) throw new Error("blob already exists");
    const text = typeof value === "string" ? value : new TextDecoder().decode(value);
    const etag = `etag-${++this.revision}`;
    this.values.set(pathname, { etag, value: text });
    return {
      url: `https://blob.test/${pathname}`,
      downloadUrl: `https://blob.test/${pathname}?download=1`,
      pathname,
      contentType: "application/json",
      contentDisposition: "attachment",
      etag,
    };
  }
}

test("Vercel Blob bucket preserves create-only and ETag compare-and-set semantics", async () => {
  const bucket = createVercelBlobBucket(new MemoryBlobOperations());
  const created = await bucket.put("hosted/quota.json", "{\"used\":12}", {
    onlyIf: { etagDoesNotMatch: "*" },
  });
  assert.ok(created);
  assert.equal(await bucket.put("hosted/quota.json", "{\"used\":24}", {
    onlyIf: { etagDoesNotMatch: "*" },
  }), null);

  const current = await bucket.get("hosted/quota.json");
  assert.equal(await current?.text(), "{\"used\":12}");
  assert.ok(current?.etag);

  const updated = await bucket.put("hosted/quota.json", "{\"used\":0}", {
    onlyIf: { etagMatches: current!.etag! },
  });
  assert.ok(updated);
  assert.equal(await bucket.put("hosted/quota.json", "{\"used\":24}", {
    onlyIf: { etagMatches: current!.etag! },
  }), null);
});

test("Vercel Blob persistence performs refresh-safe temporary-file renames", async () => {
  const bucket = createVercelBlobBucket(new MemoryBlobOperations());
  const persistence = createVercelBlobPersistence(bucket);
  const source = `${process.cwd()}/.sitemorph-cache/result.tmp`;
  const destination = `${process.cwd()}/.sitemorph-cache/result.json`;
  await persistence.writeFile(source, "{\"saved\":true}");
  await persistence.rename(source, destination);
  assert.equal(await persistence.readFile(destination), "{\"saved\":true}");
  await assert.rejects(() => persistence.readFile(source), { code: "ENOENT" });
});
