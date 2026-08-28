import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import type { ClimateDNA, FortyGuardUsage, RiskLevel, SiteAnalysisResponse } from "../src/types";
import { activityCacheKey, analysisCacheKey } from "./cache-key";
import { rankThermalTiles } from "./ranking";

type AnalyticType = "tcm" | "persistence" | "exceedance" | "time_of_measure";

interface FortyGuardConfig {
  apiKey?: string;
  fallbackApiKeys?: string[];
  baseUrl: string;
  analysisDates: string[];
  granularity: 60 | 80 | 100;
  pollIntervalMs: number;
  maxPollAttempts: number;
  maxNewActivities: number;
  includeOptionalEvidence: boolean;
  cacheVersion?: string;
}

const preferredApiKeyIndex = new WeakMap<FortyGuardConfig, number>();

function configuredApiKeys(config: FortyGuardConfig): string[] {
  return [config.apiKey, ...(config.fallbackApiKeys ?? [])]
    .map((key) => key?.trim())
    .filter((key, index, keys): key is string => Boolean(key) && keys.indexOf(key) === index);
}

function shouldRotateApiKey(status: number, message: string): boolean {
  if (status === 401 || status === 402) return true;
  // A 429 is a temporary request-rate signal unless the provider supplies a
  // documented structured exhaustion code. Never fan a paid POST across keys
  // based on free-form 429 text.
  if (status !== 403) return false;
  const credentialFailure = /(?:api[\s_-]*key|credential|token).*(?:invalid|expired|revoked|disabled|inactive|unauthorized)/i.test(message)
    || /(?:invalid|expired|revoked|disabled|inactive|unauthorized).*(?:api[\s_-]*key|credential|token)/i.test(message);
  const unavailableCredits = /(?:credit\s+balance|credits?).*(?:exhaust|deplet|insufficient|not\s+enough|no\s+remaining|none\s+remaining|zero|\b0\b|limit[^.]*?(?:reach|exceed))/i.test(message)
    || /(?:exhaust|deplet|insufficient|not\s+enough|no\s+remaining|none\s+remaining|zero|\b0\b).*(?:credit\s+balance|credits?)/i.test(message);
  return credentialFailure || unavailableCredits;
}

interface FortyGuardFetchOptions {
  bodyForApiKey?: (apiKey: string) => BodyInit | null;
  startKeyIndex?: number;
  onApiKeySelected?: (keyIndex: number) => void;
}

interface AnalyzeBody {
  geometry?: Feature<Polygon>;
  thresholdCelsius?: number;
  siteTimezone?: string;
  cacheOnly?: boolean;
}

interface FortyGuardResult {
  activityId: string;
  mapData: FeatureCollection<Polygon>;
  statsData: Record<string, unknown>;
}

interface HistoricalResult {
  date: string;
  results: Record<AnalyticType, FortyGuardResult>;
}

interface OptionalEvidenceResult {
  activityId: string;
  result: Record<string, unknown>;
}

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<AnalyzeBody> {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new HttpError(413, "Request body is too large");
  }
  try {
    return JSON.parse(raw) as AnalyzeBody;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function findObject(value: unknown, candidateKeys: string[]): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const candidates = new Set(candidateKeys.map(normalizeKey));
  for (const [key, child] of Object.entries(record)) {
    if (candidates.has(normalizeKey(key)) && child && typeof child === "object" && !Array.isArray(child)) {
      return child as Record<string, unknown>;
    }
  }
  return undefined;
}

function findNumber(value: unknown, candidateKeys: string[]): number | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidates = new Set(candidateKeys.map(normalizeKey));
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (candidates.has(normalizeKey(key))) {
      const number = typeof child === "number" ? child : Number(child);
      if (Number.isFinite(number)) return number;
    }
  }
  return undefined;
}

function findDeepValue(value: unknown, candidateKeys: string[]): unknown {
  if (!value || typeof value !== "object") return undefined;
  const candidates = new Set(candidateKeys.map(normalizeKey));
  const records = Array.isArray(value) ? value : [value];
  for (const item of records) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      if (candidates.has(normalizeKey(key))) return child;
    }
  }
  for (const item of records) {
    if (!item || typeof item !== "object") continue;
    const children = Array.isArray(item) ? item : Object.values(item as Record<string, unknown>);
    for (const child of children) {
      const match = findDeepValue(child, candidateKeys);
      if (match !== undefined) return match;
    }
  }
  return undefined;
}

function findDeepNumber(value: unknown, candidateKeys: string[]): number | undefined {
  const match = findDeepValue(value, candidateKeys);
  const number = typeof match === "number" ? match : Number(match);
  return Number.isFinite(number) ? number : undefined;
}

function findDeepString(value: unknown, candidateKeys: string[]): string | undefined {
  const match = findDeepValue(value, candidateKeys);
  return typeof match === "string" && match.trim() ? match.trim() : undefined;
}

function metricNumber(value: unknown, candidateKeys: string[]): number | undefined {
  const match = findDeepValue(value, candidateKeys);
  const values = Array.isArray(match) ? match : [match];
  const numbers = values.map((item) => typeof item === "number" ? item : Number(item)).filter(Number.isFinite);
  return numbers.length ? mean(numbers) : undefined;
}

function roundedMetric(value: number | undefined, fallback = 0): number {
  return Number((value ?? fallback).toFixed(1));
}

function optionalRoundedMetric(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Number(value.toFixed(1));
}

function percentageMetric(value: unknown, candidateKeys: string[]): number {
  const raw = metricNumber(value, candidateKeys) ?? 0;
  return Number((raw >= 0 && raw <= 1 ? raw * 100 : raw).toFixed(1));
}

function imageDataUrl(value: unknown): string | undefined {
  const candidate = Array.isArray(value) ? value.find((item) => typeof item === "string" && item.length > 0) : value;
  if (typeof candidate !== "string" || !candidate.trim()) return undefined;
  if (candidate.startsWith("data:image/")) return candidate;
  const mimeType = candidate.startsWith("/9j/") ? "image/jpeg" : "image/png";
  return `data:${mimeType};base64,${candidate}`;
}

function featureNumbers(result: FortyGuardResult, candidateKeys: string[]): number[] {
  return result.mapData.features
    .map((feature) => findNumber(feature.properties, candidateKeys))
    .filter((value): value is number => value !== undefined);
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function summarize(result: FortyGuardResult, analyticType: AnalyticType): { minimum: number; maximum: number; mean: number; values: number[] } {
  if (analyticType === "tcm") {
    const stats = findObject(result.statsData, ["Temperature_stats", "temperature stats", "stats"]) ?? result.statsData;
    const values = featureNumbers(result, ["average_temperature", "temperature", "tcm", "value"]);
    const minima = featureNumbers(result, ["min_temperature"]);
    const maxima = featureNumbers(result, ["max_temperature"]);
    return {
      // FortyGuard temperature_stats describes tile averages. The per-tile min/max
      // properties preserve the actual modeled thermal range across the AOI.
      minimum: minima.length ? Math.min(...minima) : findNumber(stats, ["Minimum", "min"]) ?? (values.length ? Math.min(...values) : 0),
      maximum: maxima.length ? Math.max(...maxima) : findNumber(stats, ["Maximum", "max"]) ?? (values.length ? Math.max(...values) : 0),
      mean: findNumber(stats, ["Mean", "average", "avg"]) ?? mean(values),
      values,
    };
  }

  const values = featureNumbers(result, ["value", analyticType]);
  return {
    minimum: findNumber(result.statsData, ["Minimum", "min"]) ?? (values.length ? Math.min(...values) : 0),
    maximum: findNumber(result.statsData, ["Maximum", "max"]) ?? (values.length ? Math.max(...values) : 0),
    mean: findNumber(result.statsData, ["Mean", "average", "avg"]) ?? mean(values),
    values,
  };
}

function risk(value: number, moderate: number, high: number): RiskLevel {
  return value >= high ? "HIGH" : value >= moderate ? "MODERATE" : "LOW";
}

function localPeakHour(utcHour: number, analysisDate: string, timezone: string): string {
  try {
    const instant = new Date(`${analysisDate}T${String(utcHour).padStart(2, "0")}:00:00Z`);
    return new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(instant);
  } catch {
    return `${String(utcHour).padStart(2, "0")}:00 UTC`;
  }
}

function createClimateDesignBrief(climateDNA: ClimateDNA, separable: boolean): ClimateDNA["designBrief"] {
  const impervious = climateDNA.surface?.imperviousPercent;
  const canopy = climateDNA.surface?.canopyVegetationPercent;
  const wetBulb = climateDNA.environmental?.wetBulbCelsius;
  const streetTrees = climateDNA.street?.available ? climateDNA.street.treePercent : undefined;
  const priorities: ClimateDNA["designBrief"]["priorities"] = [
    {
      label: "Cooling resilience",
      level: climateDNA.profile.thermalExposure === "HIGH" || climateDNA.profile.persistence === "HIGH" ? "Critical" : "High",
      reason: `Hot-season exposure is ${climateDNA.profile.thermalExposure.toLowerCase()} with ${climateDNA.thermal.longestPersistenceHours} h maximum continuous persistence.`,
    },
    {
      label: "Impervious-surface reduction",
      level: impervious !== undefined && impervious >= 60 ? "High" : "Moderate",
      reason: impervious === undefined ? "Satellite surface evidence is not yet available." : `${impervious}% of the sampled surface is impervious.`,
    },
    {
      label: "Canopy and shading intervention",
      level: canopy !== undefined && canopy < 20 ? "High" : "Moderate",
      reason: canopy === undefined ? "Satellite canopy evidence is not yet available." : `Canopy and vegetation cover is ${canopy}%.`,
    },
    {
      label: "Outdoor worker heat mitigation",
      level: wetBulb !== undefined && wetBulb >= 24 ? "Critical" : "High",
      reason: wetBulb === undefined ? "Persistent Phoenix heat makes exposed loading and worker areas a priority." : `Representative wet-bulb temperature is ${wetBulb} °C.`,
    },
  ];
  return {
    thermalZoningConfidence: separable ? "HIGH" : "LOW",
    summary: separable
      ? "FortyGuard supports relative thermal placement guidance within this parcel. Forma should validate the resulting massing with native design analyses."
      : "The parcel is thermally uniform at FortyGuard resolution. Apply heat constraints site-wide and let Forma optimize internal placement, massing, sun, wind, and microclimate performance.",
    priorities,
    siteWideConstraints: [
      "Do not spatially zone the building from FortyGuard alone when thermal separation is unreliable.",
      "Minimize west-facing heat-sensitive and continuously occupied program.",
      "Shade loading, queuing, pedestrian, and outdoor worker areas.",
      impervious !== undefined ? `Reduce or shade the ${impervious}% impervious-surface burden.` : "Measure impervious cover before fixing the landscape and parking strategy.",
      streetTrees !== undefined ? `Respond to the ${streetTrees}% street-edge tree signal at access points.` : "Verify shade and access conditions at parcel street edges.",
    ],
    formaActions: [
      "Generate one requirements-driven building mass.",
      "Run Forma sun analysis on the generated geometry.",
      "Use Forma wind and microclimate tools for design-performance validation.",
      "Revise the mass once using measured Forma results.",
    ],
  };
}

function normalizeMapData(value: unknown): FeatureCollection<Polygon> {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!parsed || typeof parsed !== "object" || (parsed as { type?: string }).type !== "FeatureCollection") {
    throw new HttpError(502, "FortyGuard completed without GeoJSON map_data");
  }
  const features = (parsed as FeatureCollection).features.filter(
    (feature): feature is Feature<Polygon> => feature.geometry?.type === "Polygon",
  );
  if (!features.length) throw new HttpError(502, "FortyGuard map_data contains no polygon tiles");
  return { type: "FeatureCollection", features };
}

function normalizeClimateDNA(
  history: HistoricalResult[],
  thresholdCelsius: number,
  config: FortyGuardConfig,
  siteTimezone: string,
): { climateDNA: ClimateDNA; rankedTiles: SiteAnalysisResponse["rankedTiles"]; rankedMapData: FeatureCollection<Polygon> } {
  const ranking = rankThermalTiles(history.map((sample) => ({
    date: sample.date,
    tcm: sample.results.tcm.mapData,
    persistence: sample.results.persistence.mapData,
    exceedance: sample.results.exceedance.mapData,
    timeOfMeasure: sample.results.time_of_measure.mapData,
  })));
  const temperatureSummaries = history.map((sample) => summarize(sample.results.tcm, "tcm"));
  const persistenceValues = history.flatMap((sample) => summarize(sample.results.persistence, "persistence").values);
  const exceedanceValues = history.flatMap((sample) => summarize(sample.results.exceedance, "exceedance").values);
  const peakHours = history.flatMap((sample) => summarize(sample.results.time_of_measure, "time_of_measure").values)
    .map((value) => Math.max(0, Math.min(23, Math.round(value))));
  const peakCounts = new Map<number, number>();
  peakHours.forEach((hour) => peakCounts.set(hour, (peakCounts.get(hour) ?? 0) + 1));
  const peakHour = [...peakCounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
  const temperatureValues = temperatureSummaries.flatMap((summary) => summary.values);
  const temperatureMean = mean(temperatureValues);
  const temperatureMinimum = Math.min(...temperatureSummaries.map((summary) => summary.minimum));
  const temperatureMaximum = Math.max(...temperatureSummaries.map((summary) => summary.maximum));
  const preferredCount = ranking.tiles.filter((tile) => tile.classification === "preferred").length;
  const avoidCount = ranking.tiles.filter((tile) => tile.classification === "avoid").length;
  const preferredZone = ranking.separable ? ranking.zones.find((zone) => zone.id === "zone-preferred") : undefined;
  const dateLabel = `${history.length} hot-season dates · ${history[0].date} → ${history.at(-1)!.date}`;
  const activityId = history[0].results.tcm.activityId;

  const climateDNA: ClimateDNA = {
    id: `fg-${activityId}`,
    generatedAt: new Date().toISOString(),
    activityId,
    activityIds: {
      heat: history.map((sample) => ({
        date: sample.date,
        tcm: sample.results.tcm.activityId,
        persistence: sample.results.persistence.activityId,
        exceedance: sample.results.exceedance.activityId,
        timeOfMeasure: sample.results.time_of_measure.activityId,
      })),
    },
    profile: {
      thermalExposure: risk(temperatureMean, thresholdCelsius - 3, thresholdCelsius),
      persistence: risk(Math.max(...persistenceValues), 3, 6),
      ...(preferredZone ? { recommendedBuildZone: preferredZone.direction } : {}),
    },
    layers: [
      { id: "ranked-zones", name: ranking.separable ? "Ranked Build Zones" : "Site-wide Thermal Coverage", description: ranking.separable ? "Relative hot-season thermal suitability" : "Uniform 60 m evidence extended across the selected Site Limit", available: true, overlayType: "sdk" },
      { id: "temperature", name: "Temperature", description: "Mean hot-season FortyGuard TCM", available: true, unit: "°C", overlayType: "sdk" },
      { id: "persistence", name: "Persistent Heat", description: "Mean persistence across hot-season dates", available: true, unit: "h", overlayType: "sdk" },
      { id: "exceedance", name: "Threshold Exceedance", description: "Mean exceedance across hot-season dates", available: true, unit: "h", overlayType: "sdk" },
      { id: "peak-time", name: "Peak Thermal Hour", description: "Modal hot-season peak hour", available: true, unit: "UTC", overlayType: "sdk" },
    ],
    thermal: {
      meanCelsius: Number(temperatureMean.toFixed(1)),
      maxCelsius: Number(temperatureMaximum.toFixed(1)),
      minCelsius: Number(temperatureMinimum.toFixed(1)),
      peakThermalHour: localPeakHour(peakHour, history.at(-1)!.date, siteTimezone),
      peakThermalHourUtc: `${String(peakHour).padStart(2, "0")}:00 UTC`,
      peakThermalTimeZone: siteTimezone,
      thresholdCelsius,
      hoursAboveThreshold: Math.round(mean(exceedanceValues)),
      longestPersistenceHours: Math.round(Math.max(...persistenceValues)),
      meanPersistenceHours: Math.round(mean(persistenceValues)),
      hotZonePercent: Math.round((avoidCount / ranking.tiles.length) * 100),
      coolZonePercent: Math.round((preferredCount / ranking.tiles.length) * 100),
    },
    designBrief: {} as ClimateDNA["designBrief"],
    zones: ranking.zones,
    constraints: [],
    provenance: {
      thermal: {
        source: "fortyguard",
        label: `FortyGuard TCM, persistence, exceedance, and time of measure across ${history.length} hot-season dates`,
        dateRange: dateLabel,
        resolution: `${config.granularity} m`,
        confidence: "Direct model output aggregated by SiteMorph",
      },
      zones: {
        source: "sitemorph",
        label: ranking.separable ? "Relative tile suitability ranked within this Forma Site Limit" : "No reliable spatial separation in the sampled thermal evidence",
        dateRange: dateLabel,
        resolution: `${config.granularity} m`,
        confidence: ranking.separable ? "Explainable weighted normalization" : "Insufficient within-site differentiation",
        derivedFrom: ["40% lower mean temperature", "35% lower persistence", "25% lower exceedance"],
      },
    },
  };
  climateDNA.designBrief = createClimateDesignBrief(climateDNA, ranking.separable);
  return { climateDNA, rankedTiles: ranking.tiles, rankedMapData: ranking.mapData };
}

function validateGeometry(feature: Feature<Polygon> | undefined): FeatureCollection<Polygon> {
  const ring = feature?.geometry?.coordinates?.[0];
  if (!feature || feature.geometry.type !== "Polygon" || !ring || ring.length < 4) {
    throw new HttpError(422, "A valid Forma Site Limit GeoJSON polygon is required");
  }
  const first = ring[0];
  const last = ring.at(-1);
  if (!last || first[0] !== last[0] || first[1] !== last[1]) {
    throw new HttpError(422, "The Site Limit polygon ring must be closed");
  }
  if (ring.some(([longitude, latitude]) => Math.abs(longitude) > 180 || Math.abs(latitude) > 90)) {
    throw new HttpError(422, "Site Limit coordinates must be WGS84 longitude/latitude");
  }
  return { type: "FeatureCollection", features: [feature] };
}

type CachedActivityKind = "heat" | "optional";
type CachedActivityStatus = "pending" | "completed" | "failed";

interface PersistedActivityEntry {
  schema: "sitemorph.fortyguard-activity.v1";
  key: string;
  kind: CachedActivityKind;
  status: CachedActivityStatus;
  activityId: string;
  credentialSlot?: number;
  savedAt: string;
  result?: FortyGuardResult | OptionalEvidenceResult;
  error?: string;
}

const ACTIVITY_CACHE_DIR = resolve(process.cwd(), ".sitemorph-cache", "fortyguard-activities");

class ActivityBudget {
  private submitted = 0;

  constructor(private readonly maximum: number) {}

  claim(label: string): void {
    if (this.submitted >= this.maximum) {
      throw new HttpError(429, `Credit Saver stopped before ${label}: the ${this.maximum}-activity limit was reached.`);
    }
    this.submitted += 1;
  }
}

async function readPersistedActivity(key: string): Promise<PersistedActivityEntry | undefined> {
  try {
    const raw = await readFile(resolve(ACTIVITY_CACHE_DIR, `${key}.json`), "utf8");
    const entry = JSON.parse(raw) as PersistedActivityEntry;
    return entry.schema === "sitemorph.fortyguard-activity.v1" && entry.key === key ? entry : undefined;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") return undefined;
    throw error;
  }
}

async function writePersistedActivity(entry: PersistedActivityEntry): Promise<void> {
  await mkdir(ACTIVITY_CACHE_DIR, { recursive: true });
  const destination = resolve(ACTIVITY_CACHE_DIR, `${entry.key}.json`);
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(entry), "utf8");
  await rename(temporary, destination);
}

function heatActivityKey(
  analyticType: AnalyticType,
  analysisDate: string,
  geometry: Feature<Polygon>,
  thresholdCelsius: number,
  config: FortyGuardConfig,
): string {
  return activityCacheKey(geometry, `heatmap:${analyticType}`, {
    analysisDate,
    granularity: config.granularity,
    ...(analyticType === "persistence" || analyticType === "exceedance" ? { thresholdCelsius } : {}),
  }, config.cacheVersion);
}

function optionalActivityKey(
  path: "/env_params" | "/satellite" | "/streetview",
  geometry: Feature<Polygon>,
  body: Record<string, unknown>,
  config: FortyGuardConfig,
): string {
  return activityCacheKey(geometry, path, body, config.cacheVersion);
}

async function fortyGuardFetch(
  config: FortyGuardConfig,
  path: string,
  init?: RequestInit,
  options: FortyGuardFetchOptions = {},
): Promise<Record<string, unknown>> {
  const apiKeys = configuredApiKeys(config);
  if (!apiKeys.length) throw new HttpError(503, "FORTYGUARD_API_KEY is not configured on the SiteMorph backend");
  const isReadRequest = !init?.method || init.method === "GET";
  const attempts = isReadRequest ? 3 : 1;
  const requestedKeyIndex = Number.isInteger(options.startKeyIndex) ? Number(options.startKeyIndex) : undefined;
  const initialKeyIndex = Math.max(0, Math.min(requestedKeyIndex ?? preferredApiKeyIndex.get(config) ?? 0, apiKeys.length - 1));
  for (let keyIndex = initialKeyIndex; keyIndex < apiKeys.length; keyIndex += 1) {
    const apiKey = apiKeys[keyIndex];
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(`${config.baseUrl}${path}`, {
          ...init,
          ...(options.bodyForApiKey ? { body: options.bodyForApiKey(apiKey) } : {}),
          signal: init?.signal ?? AbortSignal.timeout(30_000),
          headers: { "Content-Type": "application/json", "api-key": apiKey, ...init?.headers },
        });
      } catch (error) {
        if (attempt + 1 < attempts) {
          await wait(500 * (attempt + 1));
          continue;
        }
        // A network failure can occur after a paid submission was accepted. Never
        // try another key when the upstream outcome is ambiguous.
        throw new HttpError(502, "FortyGuard network request failed; automatic resubmission is blocked");
      }

      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (response.ok) {
        preferredApiKeyIndex.set(config, Math.max(preferredApiKeyIndex.get(config) ?? 0, keyIndex));
        options.onApiKeySelected?.(keyIndex);
        return payload;
      }
      const message = findDeepString(payload, ["message", "error", "detail", "description"])
        ?? `FortyGuard request failed (${response.status})`;
      if (shouldRotateApiKey(response.status, message) && keyIndex + 1 < apiKeys.length) break;
      if (isReadRequest && (response.status === 429 || response.status >= 500) && attempt + 1 < attempts) {
        await wait(500 * (attempt + 1));
        continue;
      }
      if (response.status === 401) throw new HttpError(502, "FortyGuard rejected the configured server credentials");
      if (response.status === 402 || shouldRotateApiKey(response.status, message)) {
        throw new HttpError(502, "FortyGuard credits or credentials are unavailable for this analysis");
      }
      if (response.status === 403) throw new HttpError(502, "FortyGuard denied this analysis");
      if (response.status === 429) throw new HttpError(429, "FortyGuard temporarily rate limited this analysis");
      if (response.status >= 500) throw new HttpError(502, "FortyGuard service is temporarily unavailable");
      throw new HttpError(response.status, "FortyGuard rejected this analysis request");
    }
  }
  throw new HttpError(502, "FortyGuard credits or credentials are unavailable for this analysis");
}

async function runAnalysis(
  analyticType: AnalyticType,
  analysisDate: string,
  polygonAoi: FeatureCollection<Polygon>,
  thresholdCelsius: number,
  config: FortyGuardConfig,
  budget: ActivityBudget,
  pollAttempts = config.maxPollAttempts,
): Promise<FortyGuardResult> {
  const geometry = polygonAoi.features[0];
  const key = heatActivityKey(analyticType, analysisDate, geometry, thresholdCelsius, config);
  const cached = await readPersistedActivity(key);
  if (cached?.status === "completed" && cached.result && "mapData" in cached.result) {
    return cached.result as FortyGuardResult;
  }
  if (cached?.status === "failed") {
    throw new HttpError(502, cached.error ?? `Saved FortyGuard ${analyticType} activity failed`);
  }

  let activityId = cached?.activityId;
  let credentialSlot = cached?.credentialSlot;
  if (!activityId) {
    budget.claim(`${analyticType} for ${analysisDate}`);
    const uncertainMessage = `FortyGuard ${analyticType} submission outcome is unknown for ${analysisDate}; automatic resubmission is blocked.`;
    await writePersistedActivity({
      schema: "sitemorph.fortyguard-activity.v1",
      key,
      kind: "heat",
      status: "failed",
      activityId: "",
      savedAt: new Date().toISOString(),
      error: uncertainMessage,
    });
    const submission = await fortyGuardFetch(config, "/heatmap", {
      method: "POST",
      body: JSON.stringify({
        polygon_aoi: polygonAoi,
        date_time: { start_date: analysisDate, filter_type: 3 },
        granularity: config.granularity,
        analytic_type: analyticType,
        ...(analyticType === "persistence" || analyticType === "exceedance" ? { threshold: thresholdCelsius, direction: "above" } : {}),
      }),
    }, {
      onApiKeySelected: (keyIndex) => { credentialSlot = keyIndex; },
    });
    const submissionData = submission.data as Record<string, unknown> | undefined;
    activityId = String(submissionData?.activity_id ?? "");
    if (!activityId) throw new HttpError(502, `FortyGuard ${analyticType} submission for ${analysisDate} returned no activity_id`);
    await writePersistedActivity({
      schema: "sitemorph.fortyguard-activity.v1",
      key,
      kind: "heat",
      status: "pending",
      activityId,
      credentialSlot,
      savedAt: new Date().toISOString(),
    });
  }

  for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
    if (attempt > 0) await wait(config.pollIntervalMs);
    let payload: Record<string, unknown>;
    try {
      const previousSlot = credentialSlot;
      payload = await fortyGuardFetch(config, `/status/${encodeURIComponent(activityId)}`, undefined, {
        startKeyIndex: credentialSlot,
        onApiKeySelected: (keyIndex) => { credentialSlot = keyIndex; },
      });
      if (credentialSlot !== previousSlot) {
        await writePersistedActivity({ schema: "sitemorph.fortyguard-activity.v1", key, kind: "heat", status: "pending", activityId, credentialSlot, savedAt: new Date().toISOString() });
      }
    } catch (error) {
      if (error instanceof HttpError && error.status === 404 && attempt < Math.min(3, pollAttempts - 1)) continue;
      throw error;
    }
    const data = payload.data as Record<string, unknown> | undefined;
    const status = String(data?.status ?? payload.message ?? "").toLowerCase();
    if (status === "failed" || status === "error") {
      const message = `FortyGuard ${analyticType} activity for ${analysisDate} failed (${activityId})`;
      await writePersistedActivity({ schema: "sitemorph.fortyguard-activity.v1", key, kind: "heat", status: "failed", activityId, credentialSlot, savedAt: new Date().toISOString(), error: message });
      throw new HttpError(502, message);
    }
    if (status === "completed" || status === "succeeded") {
      const result = data?.result as Record<string, unknown> | undefined;
      const completed: FortyGuardResult = {
        activityId,
        mapData: normalizeMapData(result?.map_data),
        statsData: (result?.stats_data as Record<string, unknown> | undefined) ?? {},
      };
      await writePersistedActivity({ schema: "sitemorph.fortyguard-activity.v1", key, kind: "heat", status: "completed", activityId, credentialSlot, savedAt: new Date().toISOString(), result: completed });
      return completed;
    }
  }
  throw new HttpError(504, `FortyGuard ${analyticType} activity for ${analysisDate} is still running (${activityId}). Retry will resume this saved activity without a new charge.`);
}

async function runOptionalEvidence(
  path: "/env_params" | "/satellite" | "/streetview",
  label: string,
  body: Record<string, unknown>,
  geometry: Feature<Polygon>,
  config: FortyGuardConfig,
  budget: ActivityBudget,
  pollAttempts = config.maxPollAttempts,
): Promise<OptionalEvidenceResult> {
  const key = optionalActivityKey(path, geometry, body, config);
  const cached = await readPersistedActivity(key);
  if (cached?.status === "completed" && cached.result && "result" in cached.result) {
    return cached.result as OptionalEvidenceResult;
  }
  if (cached?.status === "failed") throw new HttpError(502, cached.error ?? `Saved FortyGuard ${label} activity failed`);
  let activityId = cached?.activityId;
  let credentialSlot = cached?.credentialSlot;
  if (!activityId) {
    budget.claim(label);
    const uncertainMessage = `FortyGuard ${label} submission outcome is unknown; automatic resubmission is blocked.`;
    await writePersistedActivity({ schema: "sitemorph.fortyguard-activity.v1", key, kind: "optional", status: "failed", activityId: "", savedAt: new Date().toISOString(), error: uncertainMessage });
    const submission = await fortyGuardFetch(config, path, { method: "POST", body: JSON.stringify(body) }, {
      onApiKeySelected: (keyIndex) => { credentialSlot = keyIndex; },
    });
    const submissionData = submission.data as Record<string, unknown> | undefined;
    activityId = String(submissionData?.activity_id ?? "");
    if (!activityId) throw new HttpError(502, `FortyGuard ${label} submission returned no activity_id`);
    await writePersistedActivity({ schema: "sitemorph.fortyguard-activity.v1", key, kind: "optional", status: "pending", activityId, credentialSlot, savedAt: new Date().toISOString() });
  }
  for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
    if (attempt > 0) await wait(config.pollIntervalMs);
    const previousSlot = credentialSlot;
    const payload = await fortyGuardFetch(config, `/status/${encodeURIComponent(activityId)}`, undefined, {
      startKeyIndex: credentialSlot,
      onApiKeySelected: (keyIndex) => { credentialSlot = keyIndex; },
    });
    if (credentialSlot !== previousSlot) {
      await writePersistedActivity({ schema: "sitemorph.fortyguard-activity.v1", key, kind: "optional", status: "pending", activityId, credentialSlot, savedAt: new Date().toISOString() });
    }
    const data = payload.data as Record<string, unknown> | undefined;
    const status = String(data?.status ?? payload.message ?? "").toLowerCase();
    if (status === "failed" || status === "error") {
      const message = `FortyGuard ${label} activity failed (${activityId})`;
      await writePersistedActivity({ schema: "sitemorph.fortyguard-activity.v1", key, kind: "optional", status: "failed", activityId, credentialSlot, savedAt: new Date().toISOString(), error: message });
      throw new HttpError(502, message);
    }
    if (status === "completed" || status === "succeeded") {
      const completed: OptionalEvidenceResult = { activityId, result: (data?.result as Record<string, unknown> | undefined) ?? {} };
      await writePersistedActivity({ schema: "sitemorph.fortyguard-activity.v1", key, kind: "optional", status: "completed", activityId, credentialSlot, savedAt: new Date().toISOString(), result: completed });
      return completed;
    }
  }
  throw new HttpError(504, `FortyGuard ${label} activity is still running (${activityId}). Retry will resume this saved activity without a new charge.`);
}

function applyEnvironmentalEvidence(climateDNA: ClimateDNA, evidence: OptionalEvidenceResult): void {
  const locations = findDeepValue(evidence.result, ["locations"]);
  const location = Array.isArray(locations) && locations[0] && typeof locations[0] === "object" ? locations[0] : evidence.result;
  const airQualityIndexUs = metricNumber(location, ["aqi_us"]);
  const environmental = {
    relativeHumidityPercent: optionalRoundedMetric(metricNumber(location, ["relative_humidity_percent"])),
    heatIndexCelsius: optionalRoundedMetric(metricNumber(location, ["heat_index_celsius"])),
    apparentTemperatureCelsius: optionalRoundedMetric(metricNumber(location, ["apparent_temperature_celsius"])),
    wetBulbCelsius: optionalRoundedMetric(metricNumber(location, ["wet_bulb_temperature_celsius"])),
    cloudCoverPercent: optionalRoundedMetric(metricNumber(location, ["cloud_cover_metric", "cloud_cover_percent"])),
    precipitationMm: optionalRoundedMetric(metricNumber(location, ["precipitation_mm"])),
    elevationMeters: optionalRoundedMetric(metricNumber(location, ["elevation"])),
    ...(airQualityIndexUs !== undefined && airQualityIndexUs >= 0 ? { airQualityIndexUs: roundedMetric(airQualityIndexUs) } : {}),
  };
  if (Object.values(environmental).some((value) => value !== undefined)) {
    climateDNA.environmental = environmental;
    climateDNA.provenance.environmental = { source: "fortyguard", label: "FortyGuard Environmental Parameters at the Forma Site Limit centroid", confidence: "Direct model output", resolution: "Site centroid" };
  }
  const solar = {
    ghiWm2: optionalRoundedMetric(metricNumber(location, ["ghi"])),
    dniWm2: optionalRoundedMetric(metricNumber(location, ["dni"])),
    dhiWm2: optionalRoundedMetric(metricNumber(location, ["dhi"])),
  };
  if (Object.values(solar).some((value) => value !== undefined)) {
    climateDNA.solar = solar;
    climateDNA.provenance.solar = { source: "fortyguard", label: "FortyGuard solar irradiance context", confidence: "Direct model output", resolution: "Site centroid" };
  }
}

function applySatelliteEvidence(climateDNA: ClimateDNA, evidence: OptionalEvidenceResult): void {
  const segmentation = findDeepValue(evidence.result, ["segmentation"]);
  const segments = findDeepValue(segmentation, ["segments"]) ?? segmentation ?? {};
  const treePercent = percentageMetric(segments, ["tree", "trees", "tree_percent", "tree_percentage"]);
  const vegetationPercent = percentageMetric(segments, ["vegetation", "vegetation_percent", "vegetation_percentage"]);
  const grassPercent = percentageMetric(segments, ["grass", "grass_percent", "grass_percentage"]);
  const buildingPercent = percentageMetric(segments, ["building", "buildings", "building_percent", "building_percentage"]);
  const roadPercent = percentageMetric(segments, ["road", "roads", "road_percent", "road_percentage"]);
  const pavementPercent = percentageMetric(segments, ["pavement", "paved", "pavement_percent", "pavement_percentage"]);
  const bareGroundPercent = percentageMetric(segments, ["bare_ground", "bareground", "earth", "bare_ground_percent"]);
  const otherPercent = percentageMetric(segments, ["other", "unknown", "other_percent"]);
  climateDNA.surface = {
    treePercent,
    vegetationPercent,
    grassPercent,
    buildingPercent,
    roadPercent,
    pavementPercent,
    bareGroundPercent,
    otherPercent,
    canopyVegetationPercent: Number(Math.min(100, treePercent + vegetationPercent + grassPercent).toFixed(1)),
    imperviousPercent: Number(Math.min(100, buildingPercent + roadPercent + pavementPercent).toFixed(1)),
    originalImageDataUrl: imageDataUrl(findDeepValue(evidence.result, ["orignal_image", "original_image"])),
    segmentedImageDataUrl: imageDataUrl(findDeepValue(segmentation, ["image_content", "segmented_image"])),
    imageYear: Math.round(metricNumber(evidence.result, ["image_year"]) ?? 0) || undefined,
  };
  climateDNA.profile.vegetation = climateDNA.surface.canopyVegetationPercent < 15 ? "LOW" : climateDNA.surface.canopyVegetationPercent < 30 ? "MODERATE" : "HIGH";
  climateDNA.provenance.surface = { source: "fortyguard", label: "FortyGuard satellite surface segmentation", confidence: "Direct model segmentation", resolution: "Site centroid context" };
}

function unavailableStreetEvidence(climateDNA: ClimateDNA, label: string): void {
  climateDNA.street = { treePercent: 0, skyPercent: 0, buildingPercent: 0, roadPercent: 0, sidewalkPercent: 0, earthPercent: 0, streetOpennessProxyPercent: 0, available: false, status: "unavailable", sampleLabel: "North access edge" };
  climateDNA.provenance.street = { source: "fortyguard", label, confidence: "Skipped — imagery unavailable" };
}

function deferredStreetEvidence(climateDNA: ClimateDNA): void {
  climateDNA.street = { treePercent: 0, skyPercent: 0, buildingPercent: 0, roadPercent: 0, sidewalkPercent: 0, earthPercent: 0, streetOpennessProxyPercent: 0, available: false, status: "deferred", sampleLabel: "North access edge" };
  climateDNA.provenance.street = {
    source: "fortyguard",
    label: "Street-view evidence deferred by Credit Saver mode",
    confidence: "Deferred — no FortyGuard request made",
  };
}

function applyStreetEvidence(climateDNA: ClimateDNA, evidence: OptionalEvidenceResult): void {
  const front = findDeepValue(evidence.result, ["front"]);
  const segments = findDeepValue(front, ["segments"]) ?? {};
  const originalImageDataUrl = imageDataUrl(findDeepValue(front, ["original_image"]));
  const segmentedImageDataUrl = imageDataUrl(findDeepValue(front, ["segmented_image", "image_content"]));
  const treePercent = percentageMetric(segments, ["tree", "trees", "tree_percent"]);
  const skyPercent = percentageMetric(segments, ["sky", "sky_percent"]);
  const buildingPercent = percentageMetric(segments, ["building", "buildings", "building_percent"]);
  const roadPercent = percentageMetric(segments, ["road", "roads", "road_percent"]);
  const sidewalkPercent = percentageMetric(segments, ["sidewalk", "sidewalk_percent"]);
  const earthPercent = percentageMetric(segments, ["earth", "bare_ground", "ground"]);
  const available = Boolean(originalImageDataUrl || segmentedImageDataUrl || treePercent || skyPercent || buildingPercent || roadPercent);
  climateDNA.street = {
    treePercent,
    skyPercent,
    buildingPercent,
    roadPercent,
    sidewalkPercent,
    earthPercent,
    streetOpennessProxyPercent: Number(Math.min(100, treePercent + skyPercent).toFixed(1)),
    available,
    status: available ? "available" : "unavailable",
    originalImageDataUrl,
    segmentedImageDataUrl,
    imageDate: findDeepString(front, ["image_date"]),
    sampleLabel: "North access edge",
  };
  climateDNA.provenance.street = { source: "fortyguard", label: "FortyGuard street-view segmentation at the north access edge", confidence: available ? "Direct model segmentation" : "Skipped — imagery unavailable" };
}

function applyDesignConstraints(climateDNA: ClimateDNA): void {
  const impervious = climateDNA.surface?.imperviousPercent;
  const canopy = climateDNA.surface?.canopyVegetationPercent;
  climateDNA.constraints = [
    { id: "sitewide-thermal", category: "Placement", title: "Thermal placement rule", value: climateDNA.designBrief.thermalZoningConfidence === "LOW" ? "No parcel sub-zone preference" : "Use supported relative zones", why: climateDNA.designBrief.summary, evidenceIds: ["fortyguard-hot-season", "thermal-zoning-confidence"] },
    { id: "cooling-resilience", category: "Building", title: "Cooling resilience", value: "Critical", why: `Hot-season exposure is ${climateDNA.profile.thermalExposure} and maximum persistence is ${climateDNA.thermal.longestPersistenceHours} h.`, evidenceIds: ["tcm", "persistence", "exceedance"] },
    { id: "worker-mitigation", category: "Building", title: "Outdoor worker areas", value: "Shade and active heat mitigation required", why: "Loading, queuing, and pedestrian work areas remain exposed to the parcel-wide historical heat burden.", evidenceIds: ["tcm", "persistence", "street"] },
    { id: "surface-reduction", category: "Envelope / Landscape", title: "Impervious-surface reduction", value: impervious === undefined ? "Measure before design freeze" : `${impervious}% existing/sample burden`, why: impervious === undefined ? "Satellite segmentation was unavailable." : "Reduce exposed paving with canopy, high-albedo surfaces, and shaded circulation.", evidenceIds: ["satellite-segmentation"] },
    { id: "canopy", category: "Envelope / Landscape", title: "Canopy and shade", value: canopy === undefined ? "High priority" : `${canopy}% current canopy/vegetation`, why: "Prioritize shade at west façades, loading aprons, and walking routes.", evidenceIds: ["satellite-segmentation", "street-segmentation"] },
  ];
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function countMissingHeatActivities(
  dates: string[],
  geometry: Feature<Polygon>,
  thresholdCelsius: number,
  config: FortyGuardConfig,
): Promise<number> {
  let missing = 0;
  for (const date of dates) {
    for (const analyticType of ["tcm", "persistence", "exceedance", "time_of_measure"] as const) {
      const key = heatActivityKey(analyticType, date, geometry, thresholdCelsius, config);
      if (!(await readPersistedActivity(key))) missing += 1;
    }
  }
  return missing;
}

async function analyzeSite(body: AnalyzeBody, config: FortyGuardConfig): Promise<SiteAnalysisResponse> {
  if (!configuredApiKeys(config).length) throw new HttpError(503, "FORTYGUARD_API_KEY is not configured on the SiteMorph backend");
  const polygonAoi = validateGeometry(body.geometry);
  const thresholdCelsius = body.thresholdCelsius ?? 35;
  if (!config.analysisDates.length) throw new HttpError(503, "No representative FortyGuard analysis dates are configured");
  const missingHeatActivities = await countMissingHeatActivities(config.analysisDates, polygonAoi.features[0], thresholdCelsius, config);
  const optionalReserve = config.includeOptionalEvidence ? 3 : 0;
  const activityLimit = body.cacheOnly ? 0 : config.maxNewActivities;
  const pollAttempts = body.cacheOnly ? 1 : config.maxPollAttempts;
  if (missingHeatActivities + optionalReserve > activityLimit) {
    const message = body.cacheOnly
      ? `No complete saved analysis exists yet. ${missingHeatActivities + optionalReserve} activities have not been submitted; no FortyGuard request was started.`
      : `Credit Saver blocked this run before submission: ${missingHeatActivities + optionalReserve} new FortyGuard activities are required, above the configured limit of ${activityLimit}.`;
    throw new HttpError(body.cacheOnly ? 404 : 409, message);
  }
  const budget = new ActivityBudget(activityLimit);
  const history = await mapWithConcurrency(config.analysisDates, 2, async (date): Promise<HistoricalResult> => {
    const [tcm, persistence, exceedance, timeOfMeasure] = await Promise.all([
      runAnalysis("tcm", date, polygonAoi, thresholdCelsius, config, budget, pollAttempts),
      runAnalysis("persistence", date, polygonAoi, thresholdCelsius, config, budget, pollAttempts),
      runAnalysis("exceedance", date, polygonAoi, thresholdCelsius, config, budget, pollAttempts),
      runAnalysis("time_of_measure", date, polygonAoi, thresholdCelsius, config, budget, pollAttempts),
    ]);
    return { date, results: { tcm, persistence, exceedance, time_of_measure: timeOfMeasure } };
  });
  const normalized = normalizeClimateDNA(history, thresholdCelsius, config, body.siteTimezone || "UTC");
  const representative = history.reduce((best, sample) => summarize(sample.results.tcm, "tcm").maximum > summarize(best.results.tcm, "tcm").maximum ? sample : best);
  const representativeTemperature = summarize(representative.results.tcm, "tcm").mean;
  const ring = body.geometry!.geometry.coordinates[0];
  const openRing = ring[0][0] === ring.at(-1)?.[0] && ring[0][1] === ring.at(-1)?.[1] ? ring.slice(0, -1) : ring;
  const longitude = mean(openRing.map((point) => point[0]));
  const latitude = mean(openRing.map((point) => point[1]));
  const northLatitude = Math.max(...openRing.map((point) => point[1]));
  if (config.includeOptionalEvidence) {
    const [environmental, satellite, street] = await Promise.allSettled([
      runOptionalEvidence("/env_params", "environmental parameters", {
        latitude,
        longitude,
        temperature: representativeTemperature,
        date_time: { start_date: representative.date, filter_type: 3 },
      }, polygonAoi.features[0], config, budget),
      runOptionalEvidence("/satellite", "satellite segmentation", {
        sat: { latitude, longitude },
        date_time: { start_date: representative.date, filter_type: 3 },
        granularity: config.granularity,
      }, polygonAoi.features[0], config, budget),
      runOptionalEvidence("/streetview", "street-view segmentation", {
        latitude: northLatitude,
        longitude,
        vertical_angle: 0,
        horizontal_angle: 90,
        back_view: true,
      }, polygonAoi.features[0], config, budget),
    ]);
    if (environmental.status === "fulfilled") {
      applyEnvironmentalEvidence(normalized.climateDNA, environmental.value);
      if (normalized.climateDNA.activityIds) normalized.climateDNA.activityIds.environmental = environmental.value.activityId;
    }
    if (satellite.status === "fulfilled") {
      applySatelliteEvidence(normalized.climateDNA, satellite.value);
      if (normalized.climateDNA.activityIds) normalized.climateDNA.activityIds.satellite = satellite.value.activityId;
    }
    if (street.status === "fulfilled") {
      applyStreetEvidence(normalized.climateDNA, street.value);
      if (normalized.climateDNA.activityIds) normalized.climateDNA.activityIds.street = street.value.activityId;
    } else unavailableStreetEvidence(normalized.climateDNA, "FortyGuard street-view imagery unavailable at the sampled north access edge");
  } else {
    deferredStreetEvidence(normalized.climateDNA);
  }
  const separable = normalized.climateDNA.designBrief.thermalZoningConfidence !== "LOW";
  normalized.climateDNA.designBrief = createClimateDesignBrief(normalized.climateDNA, separable);
  applyDesignConstraints(normalized.climateDNA);
  return {
    climateDNA: normalized.climateDNA,
    rankedTiles: normalized.rankedTiles,
    mapData: {
      "ranked-zones": normalized.rankedMapData,
      temperature: mapDataForMetric(normalized.rankedMapData, "mean_temperature_celsius"),
      persistence: mapDataForMetric(normalized.rankedMapData, "persistence_hours"),
      exceedance: mapDataForMetric(normalized.rankedMapData, "exceedance_hours"),
      "peak-time": mapDataForMetric(normalized.rankedMapData, "peak_hour_utc"),
    },
  };
}

function mapDataForMetric(
  mapData: FeatureCollection<Polygon>,
  property: "mean_temperature_celsius" | "persistence_hours" | "exceedance_hours" | "peak_hour_utc",
): FeatureCollection<Polygon> {
  return {
    type: "FeatureCollection",
    features: mapData.features.map((feature) => ({
      ...feature,
      properties: { ...feature.properties, value: feature.properties?.[property], metric: property },
    })),
  };
}

async function fetchFortyGuardUsage(config: FortyGuardConfig): Promise<FortyGuardUsage> {
  if (!configuredApiKeys(config).length) throw new HttpError(503, "FORTYGUARD_API_KEY is not configured on the SiteMorph backend");
  const payload = await fortyGuardFetch(config, "/system/fetch-api-key-usage", {
    method: "POST",
    // FortyGuard requires the key in this endpoint's JSON body as well as the
    // standard api-key header. This request remains backend-only.
  }, { bodyForApiKey: (apiKey) => JSON.stringify({ api_key: apiKey }) });
  const creditsTotal = findDeepNumber(payload, ["total_available_credits", "total_credits", "credits_total", "credit_limit", "monthly_credits", "allocated_credits"]);
  const creditsUsed = findDeepNumber(payload, ["cycle_credits_used", "used_credits", "credits_used", "credits_consumed", "consumed_credits", "usage_credits"]);
  const reportedRemaining = findDeepNumber(payload, ["cycle_remaining_credits", "total_remaining_credits", "remaining_credits", "credits_remaining", "available_credits", "credit_balance", "remaining"]);
  const creditsRemaining = reportedRemaining ?? (creditsTotal !== undefined && creditsUsed !== undefined ? creditsTotal - creditsUsed : undefined);
  if (creditsRemaining === undefined) {
    throw new HttpError(502, "FortyGuard usage response did not include a remaining credit balance");
  }
  return {
    creditsRemaining: Math.max(0, Math.round(creditsRemaining)),
    ...(creditsUsed !== undefined ? { creditsUsed: Math.max(0, Math.round(creditsUsed)) } : {}),
    ...(creditsTotal !== undefined ? { creditsTotal: Math.max(0, Math.round(creditsTotal)) } : {}),
    ...(findDeepString(payload, ["plan_type", "plan", "plan_name", "subscription_plan", "subscription_name"]) ? { plan: findDeepString(payload, ["plan_type", "plan", "plan_name", "subscription_plan", "subscription_name"]) } : {}),
    ...(findDeepString(payload, ["credits_reset_date", "reset_date", "resets_at", "billing_cycle_end"]) ? { resetsAt: findDeepString(payload, ["credits_reset_date", "reset_date", "resets_at", "billing_cycle_end"]) } : {}),
  };
}

interface PersistedAnalysisEntry {
  schema: "sitemorph.fortyguard-cache.v1";
  key: string;
  savedAt: string;
  result: SiteAnalysisResponse;
}

interface PersistedUsageEntry {
  schema: "sitemorph.fortyguard-usage.v1";
  savedAt: string;
  result: FortyGuardUsage;
}

const ANALYSIS_CACHE_DIR = resolve(process.cwd(), ".sitemorph-cache", "fortyguard");
const USAGE_CACHE_PATH = resolve(process.cwd(), ".sitemorph-cache", "fortyguard-usage.json");

function withCacheMetadata(
  result: SiteAnalysisResponse,
  source: NonNullable<SiteAnalysisResponse["cache"]>["source"],
  key: string,
  savedAt: string,
  persisted: boolean,
): SiteAnalysisResponse {
  const rankedMapData = result.mapData["ranked-zones"];
  const streetDeferred = result.climateDNA.provenance.street?.label.toLowerCase().includes("deferred");
  const climateDNA = streetDeferred ? {
    ...result.climateDNA,
    street: result.climateDNA.street ? { ...result.climateDNA.street, status: "deferred" as const } : result.climateDNA.street,
    provenance: {
      ...result.climateDNA.provenance,
      street: result.climateDNA.provenance.street ? {
        ...result.climateDNA.provenance.street,
        confidence: "Deferred — no FortyGuard request made",
      } : result.climateDNA.provenance.street,
    },
  } : result.climateDNA;
  const mapData = rankedMapData ? {
    ...result.mapData,
    temperature: mapDataForMetric(rankedMapData, "mean_temperature_celsius"),
    persistence: mapDataForMetric(rankedMapData, "persistence_hours"),
    exceedance: mapDataForMetric(rankedMapData, "exceedance_hours"),
    "peak-time": mapDataForMetric(rankedMapData, "peak_hour_utc"),
  } : result.mapData;
  return { ...result, climateDNA, mapData, cache: { source, key, savedAt, persisted } };
}

async function readPersistentAnalysis(key: string): Promise<PersistedAnalysisEntry | undefined> {
  try {
    const raw = await readFile(resolve(ANALYSIS_CACHE_DIR, `${key}.json`), "utf8");
    const entry = JSON.parse(raw) as PersistedAnalysisEntry;
    return entry.schema === "sitemorph.fortyguard-cache.v1" && entry.key === key ? entry : undefined;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") return undefined;
    throw error;
  }
}

async function writePersistentAnalysis(entry: PersistedAnalysisEntry): Promise<void> {
  await mkdir(ANALYSIS_CACHE_DIR, { recursive: true });
  const destination = resolve(ANALYSIS_CACHE_DIR, `${entry.key}.json`);
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(entry), "utf8");
  await rename(temporary, destination);
}

async function readPersistentUsage(): Promise<PersistedUsageEntry | undefined> {
  try {
    const entry = JSON.parse(await readFile(USAGE_CACHE_PATH, "utf8")) as PersistedUsageEntry;
    return entry.schema === "sitemorph.fortyguard-usage.v1" ? entry : undefined;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") return undefined;
    throw error;
  }
}

async function writePersistentUsage(entry: PersistedUsageEntry): Promise<void> {
  await mkdir(resolve(process.cwd(), ".sitemorph-cache"), { recursive: true });
  const temporary = `${USAGE_CACHE_PATH}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(entry), "utf8");
  await rename(temporary, USAGE_CACHE_PATH);
}

export function createSiteAnalyzeMiddleware(config: FortyGuardConfig) {
  const cache = new Map<string, { savedAt: string; result: SiteAnalysisResponse; persisted: boolean }>();
  const inFlight = new Map<string, Promise<{ savedAt: string; result: SiteAnalysisResponse; persisted: boolean }>>();
  let usageCache: { expiresAt: number; result: FortyGuardUsage } | undefined;
  return async (request: IncomingMessage, response: ServerResponse, next: () => void): Promise<void> => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/api/fortyguard/usage") {
      if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        sendJson(response, 405, { error: "Method not allowed" });
        return;
      }
      try {
        if (!usageCache || usageCache.expiresAt <= Date.now()) {
          const liveResult = await fetchFortyGuardUsage(config);
          const savedAt = new Date().toISOString();
          const result: FortyGuardUsage = { ...liveResult, source: "live", savedAt, stale: false };
          usageCache = { expiresAt: Date.now() + 60_000, result };
          try {
            await writePersistentUsage({ schema: "sitemorph.fortyguard-usage.v1", savedAt, result: liveResult });
          } catch (persistError) {
            console.error("SiteMorph could not persist the FortyGuard usage snapshot", persistError);
          }
        }
        sendJson(response, 200, usageCache.result);
      } catch (error) {
        const saved = await readPersistentUsage().catch(() => undefined);
        if (saved) {
          const result: FortyGuardUsage = { ...saved.result, source: "saved", savedAt: saved.savedAt, stale: true };
          usageCache = { expiresAt: Date.now() + 60_000, result };
          sendJson(response, 200, result);
        } else {
          const status = error instanceof HttpError ? error.status : 500;
          const message = error instanceof Error ? error.message : "FortyGuard credit usage failed";
          sendJson(response, status, { error: message });
        }
      }
      return;
    }
    if (url.pathname !== "/api/site/analyze") {
      next();
      return;
    }
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }
    try {
      const body = await readJson(request);
      const cacheKey = analysisCacheKey(body, config);
      const cached = cache.get(cacheKey);
      if (cached) {
        sendJson(response, 200, withCacheMetadata(cached.result, "memory", cacheKey, cached.savedAt, cached.persisted));
        return;
      }
      const persisted = await readPersistentAnalysis(cacheKey);
      if (persisted) {
        cache.set(cacheKey, { savedAt: persisted.savedAt, result: persisted.result, persisted: true });
        sendJson(response, 200, withCacheMetadata(persisted.result, "persistent", cacheKey, persisted.savedAt, true));
        return;
      }
      let pending = inFlight.get(cacheKey);
      if (!pending) {
        pending = (async () => {
          const result = await analyzeSite(body, config);
          const savedAt = new Date().toISOString();
          let savedToDisk = true;
          try {
            await writePersistentAnalysis({ schema: "sitemorph.fortyguard-cache.v1", key: cacheKey, savedAt, result });
          } catch (error) {
            savedToDisk = false;
            console.error("SiteMorph could not persist the FortyGuard analysis cache", error);
          }
          const entry = { savedAt, result, persisted: savedToDisk };
          cache.set(cacheKey, entry);
          return entry;
        })();
        inFlight.set(cacheKey, pending);
      }
      try {
        const completed = await pending;
        sendJson(response, 200, withCacheMetadata(completed.result, "live", cacheKey, completed.savedAt, completed.persisted));
      } finally {
        inFlight.delete(cacheKey);
      }
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : "Site analysis failed";
      sendJson(response, status, { error: message });
    }
  };
}
