import { createSiteAnalyzeMiddleware } from "../server/fortyguard";
import { bindGuardedFetch } from "./shims/fetch";
import { bindRuntimeBucket, type RuntimeBucket } from "./shims/runtime-store";

type HostedEnv = {
  ASSETS: { fetch(request: Request): Promise<Response> };
  CACHE: RuntimeBucket;
  FORTYGUARD_API_KEY?: string;
  FORTYGUARD_FALLBACK_API_KEYS?: string;
  FORTYGUARD_API_URL?: string;
  FORTYGUARD_ANALYSIS_DATES?: string;
  FORTYGUARD_GRANULARITY?: string;
  FORTYGUARD_POLL_INTERVAL_MS?: string;
  FORTYGUARD_MAX_POLL_ATTEMPTS?: string;
  FORTYGUARD_CACHE_VERSION?: string;
  SITEMORPH_HOSTED_ACTIVITY_BUDGET?: string;
  SITEMORPH_ALLOWED_ORIGINS?: string;
};

type AnalyzeBody = {
  geometry?: {
    type?: string;
    geometry?: { type?: string; coordinates?: unknown };
  };
  thresholdCelsius?: number;
  siteTimezone?: string;
  cacheOnly?: boolean;
};

type Middleware = (request: unknown, response: unknown, next: () => void) => Promise<void>;

const DEFAULT_DATES = ["2023-07-15", "2024-07-15", "2025-07-15"];
const HOSTED_RUN_ACTIVITY_LIMIT = 12;
const MAX_BODY_BYTES = 100_000;
const MAX_POLYGON_VERTICES = 250;
const MAX_SITE_AREA_SQUARE_METERS = 25_000_000;

let middlewareSignature = "";
let middleware: Middleware | undefined;
let middlewareConfig: ReturnType<typeof runtimeConfig> | undefined;

class NodeRequestAdapter {
  method: string;
  url: string;

  constructor(private readonly request: Request, private readonly bodyText: string) {
    this.method = request.method;
    const url = new URL(request.url);
    this.url = `${url.pathname}${url.search}`;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<string> {
    if (this.bodyText) yield this.bodyText;
  }
}

class NodeResponseAdapter {
  statusCode = 200;
  private readonly headers = new Headers();
  private body = "";

  setHeader(name: string, value: string | number | readonly string[]): void {
    this.headers.set(name, Array.isArray(value) ? value.join(", ") : String(value));
  }

  end(value?: unknown): void {
    if (value !== undefined) this.body += typeof value === "string" ? value : String(value);
  }

  toResponse(): Response {
    return new Response(this.body, { status: this.statusCode, headers: this.headers });
  }
}

function json(status: number, body: unknown, origin?: string): Response {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function configuredDates(env: HostedEnv): string[] {
  const dates = (env.FORTYGUARD_ANALYSIS_DATES ?? DEFAULT_DATES.join(","))
    .split(",")
    .map((date) => date.trim())
    .filter((date, index, values) => /^\d{4}-\d{2}-\d{2}$/.test(date) && values.indexOf(date) === index)
    .slice(0, 3);
  return dates.length === 3 ? dates : DEFAULT_DATES;
}

function runtimeConfig(env: HostedEnv) {
  const baseUrl = (env.FORTYGUARD_API_URL || "https://api.fortyguard.com/v1").replace(/\/$/, "");
  const granularityValue = Number(env.FORTYGUARD_GRANULARITY);
  const granularity = [60, 80, 100].includes(granularityValue) ? granularityValue as 60 | 80 | 100 : 60;
  const pollInterval = Math.max(500, Math.min(5_000, Number(env.FORTYGUARD_POLL_INTERVAL_MS) || 2_000));
  // Hosted requests must never long-poll inside one Cloudflare invocation.
  // One sweep persists every completed activity; the client can safely check
  // again later without submitting or paying for another activity.
  const pollAttempts = 1;
  const fallbackApiKeys = (env.FORTYGUARD_FALLBACK_API_KEYS ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  return {
    apiKey: env.FORTYGUARD_API_KEY,
    fallbackApiKeys,
    baseUrl,
    analysisDates: configuredDates(env),
    granularity,
    pollIntervalMs: pollInterval,
    maxPollAttempts: pollAttempts,
    maxNewActivities: HOSTED_RUN_ACTIVITY_LIMIT,
    includeOptionalEvidence: false,
    cacheVersion: env.FORTYGUARD_CACHE_VERSION || "hosted-v1",
  };
}

function getMiddleware(env: HostedEnv): Middleware {
  const config = runtimeConfig(env);
  const signature = JSON.stringify({
    keyPresent: Boolean(config.apiKey),
    fallbackKeyCount: config.fallbackApiKeys.length,
    baseUrl: config.baseUrl,
    dates: config.analysisDates,
    granularity: config.granularity,
    pollIntervalMs: config.pollIntervalMs,
    maxPollAttempts: config.maxPollAttempts,
    cacheVersion: config.cacheVersion,
  });
  const credentialsChanged = !middlewareConfig
    || middlewareConfig.apiKey !== config.apiKey
    || middlewareConfig.fallbackApiKeys.length !== config.fallbackApiKeys.length
    || middlewareConfig.fallbackApiKeys.some((key, index) => key !== config.fallbackApiKeys[index]);
  if (!middleware || middlewareSignature !== signature || credentialsChanged) {
    middlewareConfig = config;
    middleware = createSiteAnalyzeMiddleware(middlewareConfig) as Middleware;
    middlewareSignature = signature;
  }
  bindGuardedFetch({ baseUrl: config.baseUrl, granularity: config.granularity, cacheVersion: config.cacheVersion });
  return middleware;
}

async function invokeBackend(request: Request, env: HostedEnv, bodyText = ""): Promise<Response> {
  bindRuntimeBucket(env.CACHE);
  const nodeRequest = new NodeRequestAdapter(request, bodyText);
  const nodeResponse = new NodeResponseAdapter();
  let passedThrough = false;
  await getMiddleware(env)(nodeRequest, nodeResponse, () => { passedThrough = true; });
  return passedThrough ? json(404, { code: "API_ROUTE_NOT_FOUND", error: "API route not found" }) : nodeResponse.toResponse();
}

function samePoint(left: number[], right: number[]): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function orientation(a: number[], b: number[], c: number[]): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function intersects(a: number[], b: number[], c: number[], d: number[]): boolean {
  const first = orientation(a, b, c);
  const second = orientation(a, b, d);
  const third = orientation(c, d, a);
  const fourth = orientation(c, d, b);
  return ((first > 0 && second < 0) || (first < 0 && second > 0))
    && ((third > 0 && fourth < 0) || (third < 0 && fourth > 0));
}

function polygonSelfIntersects(ring: number[][]): boolean {
  const segmentCount = ring.length - 1;
  for (let left = 0; left < segmentCount; left += 1) {
    for (let right = left + 1; right < segmentCount; right += 1) {
      if (Math.abs(left - right) <= 1 || (left === 0 && right === segmentCount - 1)) continue;
      if (intersects(ring[left], ring[left + 1], ring[right], ring[right + 1])) return true;
    }
  }
  return false;
}

function approximateAreaSquareMeters(ring: number[][]): number {
  const latitude = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
  const metersPerLongitudeDegree = 111_320 * Math.cos(latitude * Math.PI / 180);
  const metersPerLatitudeDegree = 110_540;
  let doubledArea = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index];
    const next = ring[index + 1];
    doubledArea += (current[0] * metersPerLongitudeDegree) * (next[1] * metersPerLatitudeDegree)
      - (next[0] * metersPerLongitudeDegree) * (current[1] * metersPerLatitudeDegree);
  }
  return Math.abs(doubledArea) / 2;
}

function validateAnalyzeBody(raw: string): AnalyzeBody {
  if (!raw || new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new Error("REQUEST_TOO_LARGE");
  }
  let body: AnalyzeBody;
  try {
    body = JSON.parse(raw) as AnalyzeBody;
  } catch {
    throw new Error("INVALID_JSON");
  }
  if (body.geometry?.type !== "Feature" || body.geometry.geometry?.type !== "Polygon") {
    throw new Error("INVALID_GEOMETRY");
  }
  const coordinates = body.geometry.geometry.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length !== 1 || !Array.isArray(coordinates[0])) {
    throw new Error("INVALID_GEOMETRY");
  }
  const ring = coordinates[0] as unknown[];
  if (ring.length < 4 || ring.length > MAX_POLYGON_VERTICES + 1) throw new Error("INVALID_GEOMETRY");
  const numericRing = ring.map((point) => {
    if (!Array.isArray(point) || point.length < 2) throw new Error("INVALID_GEOMETRY");
    const longitude = Number(point[0]);
    const latitude = Number(point[1]);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) {
      throw new Error("INVALID_GEOMETRY");
    }
    return [longitude, latitude];
  });
  if (!samePoint(numericRing[0], numericRing.at(-1)!)) throw new Error("INVALID_GEOMETRY");
  if (polygonSelfIntersects(numericRing)) throw new Error("SELF_INTERSECTING_GEOMETRY");
  const area = approximateAreaSquareMeters(numericRing);
  if (!Number.isFinite(area) || area < 10 || area > MAX_SITE_AREA_SQUARE_METERS) throw new Error("SITE_AREA_OUT_OF_RANGE");
  const timezone = typeof body.siteTimezone === "string" && body.siteTimezone.length <= 64 ? body.siteTimezone : "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error("INVALID_TIMEZONE");
  }
  return {
    geometry: body.geometry,
    thresholdCelsius: 35,
    siteTimezone: timezone,
    cacheOnly: body.cacheOnly === true,
  };
}

function canonicalRing(body: AnalyzeBody): number[][] {
  const source = (body.geometry?.geometry?.coordinates as number[][][] | undefined)?.[0] ?? [];
  const rounded = source.map(([longitude, latitude]) => [Number(longitude.toFixed(6)), Number(latitude.toFixed(6))]);
  const points = rounded.length > 1 && samePoint(rounded[0], rounded.at(-1)!) ? rounded.slice(0, -1) : rounded;
  const candidates: number[][][] = [];
  for (const direction of [points, [...points].reverse()]) {
    for (let index = 0; index < direction.length; index += 1) {
      candidates.push([...direction.slice(index), ...direction.slice(0, index)]);
    }
  }
  return candidates.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))[0] ?? points;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function analysisIdentity(body: AnalyzeBody, env: HostedEnv): Promise<string> {
  return sha256(JSON.stringify({
    schema: env.FORTYGUARD_CACHE_VERSION || "hosted-v1",
    geometry: canonicalRing(body),
    dates: configuredDates(env),
    granularity: [60, 80, 100].includes(Number(env.FORTYGUARD_GRANULARITY)) ? Number(env.FORTYGUARD_GRANULARITY) : 60,
    thresholdCelsius: 35,
    includeOptionalEvidence: false,
  }));
}

async function readObjectJson(bucket: RuntimeBucket, key: string): Promise<{ value: Record<string, unknown>; etag?: string } | undefined> {
  const object = await bucket.get(key);
  if (!object) return undefined;
  try {
    return { value: JSON.parse(await object.text()) as Record<string, unknown>, etag: object.etag };
  } catch {
    return undefined;
  }
}

async function conditionalPut(
  bucket: RuntimeBucket,
  key: string,
  value: Record<string, unknown>,
  condition: Record<string, string>,
): Promise<boolean> {
  const result = await bucket.put(key, JSON.stringify(value), { onlyIf: condition });
  return result !== null;
}

async function acquireAnalysisLock(bucket: RuntimeBucket, analysisId: string): Promise<{ key: string; token: string } | undefined> {
  const key = `hosted/locks/${analysisId}.json`;
  const token = crypto.randomUUID();
  const now = Date.now();
  const value = { token, expiresAt: now + 120_000 };
  const existing = await readObjectJson(bucket, key);
  if (!existing) {
    return await conditionalPut(bucket, key, value, { etagDoesNotMatch: "*" }) ? { key, token } : undefined;
  }
  if (Number(existing.value.expiresAt) <= now && existing.etag) {
    return await conditionalPut(bucket, key, value, { etagMatches: existing.etag }) ? { key, token } : undefined;
  }
  return undefined;
}

async function releaseAnalysisLock(bucket: RuntimeBucket, lock: { key: string; token: string }): Promise<void> {
  const existing = await readObjectJson(bucket, lock.key);
  if (!existing?.etag || existing.value.token !== lock.token) return;
  await conditionalPut(bucket, lock.key, { token: lock.token, expiresAt: 0 }, { etagMatches: existing.etag });
}

async function reserveHostedBudget(bucket: RuntimeBucket, analysisId: string, env: HostedEnv): Promise<boolean> {
  const reservationKey = `hosted/reservations/${analysisId}.json`;
  if (await bucket.get(reservationKey)) return true;
  const configured = Number(env.SITEMORPH_HOSTED_ACTIVITY_BUDGET);
  const limit = Math.max(0, Math.min(HOSTED_RUN_ACTIVITY_LIMIT, Number.isFinite(configured) ? Math.floor(configured) : HOSTED_RUN_ACTIVITY_LIMIT));
  const counterKey = "hosted/quota/lifetime-v1.json";
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const existing = await readObjectJson(bucket, counterKey);
    const used = Number(existing?.value.used ?? 0);
    if (used + HOSTED_RUN_ACTIVITY_LIMIT > limit) return false;
    const next = { used: used + HOSTED_RUN_ACTIVITY_LIMIT, limit, updatedAt: new Date().toISOString() };
    const condition = existing?.etag ? { etagMatches: existing.etag } : { etagDoesNotMatch: "*" };
    if (await conditionalPut(bucket, counterKey, next, condition)) {
      await bucket.put(reservationKey, JSON.stringify({ activities: HOSTED_RUN_ACTIVITY_LIMIT, reservedAt: new Date().toISOString() }));
      return true;
    }
  }
  return false;
}

function allowedOrigins(request: Request, env: HostedEnv): Set<string> {
  const current = new URL(request.url).origin;
  const configured = (env.SITEMORPH_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set([current, "http://127.0.0.1:4173", ...configured]);
}

function errorCode(status: number, message: string): string {
  if (status === 404 && message.includes("No complete saved analysis")) return "SAVED_ANALYSIS_MISSING";
  if (status === 504 || message.includes("still processing") || message.includes("still running")) return "JOB_PENDING";
  if (status === 409) return "ACTIVITY_LIMIT";
  if (status === 422) return "INVALID_SITE";
  if (status === 503) return "BACKEND_NOT_CONFIGURED";
  if (status >= 500) return "FORTYGUARD_UPSTREAM_ERROR";
  return "ANALYSIS_FAILED";
}

async function normalizedBackendResponse(response: Response, origin?: string): Promise<Response> {
  if (response.ok) {
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    if (origin) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Vary", "Origin");
    }
    return new Response(response.body, { status: response.status, headers });
  }
  const payload = await response.json().catch(() => ({})) as { error?: string };
  const raw = payload.error ?? "Site analysis failed";
  const code = errorCode(response.status, raw);
  const safeMessage = code === "FORTYGUARD_UPSTREAM_ERROR"
    ? "FortyGuard could not complete this analysis. No automatic resubmission will occur."
    : code === "JOB_PENDING"
      ? "The SiteMorph request has stopped. FortyGuard is still processing saved activities; check again later without starting new ones."
      : raw.replaceAll(/\s*\([A-Za-z0-9_-]{12,}\)/g, "");
  return json(response.status, { code, error: safeMessage }, origin);
}

async function handleAnalyze(request: Request, env: HostedEnv, origin: string): Promise<Response> {
  let body: AnalyzeBody;
  try {
    body = validateAnalyzeBody(await request.text());
  } catch (error) {
    const code = error instanceof Error ? error.message : "INVALID_REQUEST";
    const status = code === "REQUEST_TOO_LARGE" ? 413 : 422;
    return json(status, { code, error: "A valid, reasonably sized Forma Site Limit polygon is required." }, origin);
  }
  const requestUrl = new URL(request.url);
  const backendRequest = new Request(requestUrl, { method: "POST", headers: request.headers });
  const cacheBody = JSON.stringify({ ...body, cacheOnly: true });
  const cached = await invokeBackend(backendRequest, env, cacheBody);
  if (cached.ok || body.cacheOnly) return normalizedBackendResponse(cached, origin);
  const cachedPayload = await cached.clone().json().catch(() => ({})) as { error?: string };
  if (cached.status !== 404 || !cachedPayload.error?.includes("No complete saved analysis")) {
    return normalizedBackendResponse(cached, origin);
  }

  const analysisId = await analysisIdentity(body, env);
  const lock = await acquireAnalysisLock(env.CACHE, analysisId);
  if (!lock) {
    return json(409, {
      code: "ANALYSIS_ALREADY_RUNNING",
      error: "This Site Limit analysis is already running. Check the saved result shortly.",
    }, origin);
  }
  try {
    const recheck = await invokeBackend(backendRequest, env, cacheBody);
    if (recheck.ok) return normalizedBackendResponse(recheck, origin);
    if (!await reserveHostedBudget(env.CACHE, analysisId, env)) {
      return json(429, {
        code: "HOSTED_ACTIVITY_BUDGET_EXHAUSTED",
        error: "The hosted prototype's 12-activity first-run budget has been used. Saved Climate DNA remains available without new FortyGuard requests.",
      }, origin);
    }
    const paidBody = JSON.stringify({ ...body, cacheOnly: false });
    return normalizedBackendResponse(await invokeBackend(backendRequest, env, paidBody), origin);
  } finally {
    await releaseAnalysisLock(env.CACHE, lock);
  }
}

async function handleApi(request: Request, env: HostedEnv): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin") ?? "";
  const allowed = allowedOrigins(request, env);
  if (request.method === "OPTIONS") {
    if (!origin || !allowed.has(origin)) return json(403, { code: "ORIGIN_NOT_ALLOWED", error: "Origin not allowed" });
    const response = new Response(null, { status: 204, headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600",
      "Vary": "Origin",
    } });
    return response;
  }
  if (url.pathname === "/api/fortyguard/usage") {
    return json(503, {
      code: "USAGE_CHECK_DISABLED",
      error: "Public usage checks are disabled; SiteMorph preserves the last saved balance when available.",
    }, origin || undefined);
  }
  if (url.pathname !== "/api/site/analyze") return json(404, { code: "API_ROUTE_NOT_FOUND", error: "API route not found" }, origin || undefined);
  if (request.method !== "POST") return json(405, { code: "METHOD_NOT_ALLOWED", error: "Method not allowed" }, origin || undefined);
  if (!origin || !allowed.has(origin) || request.headers.get("Sec-Fetch-Site") !== "same-origin") {
    return json(403, { code: "ORIGIN_NOT_ALLOWED", error: "SiteMorph rejected this analysis request before contacting FortyGuard." });
  }
  return handleAnalyze(request, env, origin);
}

export default {
  async fetch(request: Request, env: HostedEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env);

    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");
    if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) return response;

    const indexUrl = new URL(request.url);
    indexUrl.pathname = "/index.html";
    indexUrl.search = "";
    return env.ASSETS.fetch(new Request(indexUrl, request));
  },
};
