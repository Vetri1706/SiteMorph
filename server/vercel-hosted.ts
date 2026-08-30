import hostedRuntime from "../worker/runtime.ts";
import { setPersistenceAdapter } from "./persistence.ts";
import { createVercelBlobBucket, createVercelBlobPersistence } from "./vercel-blob-store.ts";

const bucket = createVercelBlobBucket();
const persistence = createVercelBlobPersistence(bucket);
const unavailableAssets = {
  async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  },
};

function hostedEnvironment() {
  return {
    ASSETS: unavailableAssets,
    CACHE: bucket,
    FORTYGUARD_API_KEY: process.env.FORTYGUARD_API_KEY,
    FORTYGUARD_FALLBACK_API_KEYS: process.env.FORTYGUARD_FALLBACK_API_KEYS,
    FORTYGUARD_API_URL: process.env.FORTYGUARD_API_URL,
    FORTYGUARD_ANALYSIS_DATES: process.env.FORTYGUARD_ANALYSIS_DATES,
    FORTYGUARD_GRANULARITY: process.env.FORTYGUARD_GRANULARITY,
    FORTYGUARD_POLL_INTERVAL_MS: process.env.FORTYGUARD_POLL_INTERVAL_MS,
    FORTYGUARD_MAX_POLL_ATTEMPTS: process.env.FORTYGUARD_MAX_POLL_ATTEMPTS,
    FORTYGUARD_MAX_NEW_ACTIVITIES: process.env.FORTYGUARD_MAX_NEW_ACTIVITIES,
    FORTYGUARD_INCLUDE_OPTIONAL_EVIDENCE: process.env.FORTYGUARD_INCLUDE_OPTIONAL_EVIDENCE,
    FORTYGUARD_CACHE_VERSION: process.env.FORTYGUARD_CACHE_VERSION,
    SITEMORPH_HOSTED_ACTIVITY_BUDGET: process.env.SITEMORPH_HOSTED_ACTIVITY_BUDGET,
    SITEMORPH_ALLOWED_ORIGINS: process.env.SITEMORPH_ALLOWED_ORIGINS,
  };
}

function storageConfigured(): boolean {
  return Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
}

export async function handleVercelRequest(request: Request): Promise<Response> {
  if (!storageConfigured()) {
    return Response.json({
      code: "HOSTED_STORAGE_NOT_CONFIGURED",
      error: "SiteMorph persistent hosted storage is not configured. No FortyGuard request was started.",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  setPersistenceAdapter(persistence);
  return hostedRuntime.fetch(request, hostedEnvironment());
}
