import climateMock from "../mocks/climate-dna.json";
import type { ClimateDNA, FortyGuardUsage, SiteAnalysisResponse, SiteGeometry } from "../types";
import { appConfig, delay } from "../utils/config";
import { hasVisibleSatelliteContext } from "../utils/satellite-context";

export interface FortyGuardServiceContract {
  analyzeSite(geometry: SiteGeometry, thresholdCelsius: number, siteTimezone?: string, cacheOnly?: boolean): Promise<SiteAnalysisResponse>;
  getUsage(): Promise<FortyGuardUsage>;
}

export class FortyGuardServiceError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "FortyGuardServiceError";
  }
}

async function responseError(response: Response, fallback: string): Promise<FortyGuardServiceError> {
  const raw = await response.text().catch(() => "");
  let payload: { code?: string; error?: string } = {};
  try { payload = raw ? JSON.parse(raw) as typeof payload : {}; } catch { /* The backend may have returned an asset-host 404. */ }
  const routeMissing = response.status === 404 && !payload.error;
  return new FortyGuardServiceError(
    payload.error ?? (routeMissing ? "The hosted SiteMorph analysis backend is not connected. No FortyGuard request was started." : fallback),
    payload.code ?? (routeMissing ? "BACKEND_ROUTE_MISSING" : "REQUEST_FAILED"),
    response.status,
  );
}

async function fetchWithDeadline(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
  timeoutMessage: string,
  timeoutCode: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new FortyGuardServiceError(timeoutMessage, timeoutCode, 408);
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function asSavedUsage(usage: FortyGuardUsage): FortyGuardUsage {
  return { ...usage, source: "saved", stale: true };
}

class FortyGuardService implements FortyGuardServiceContract {
  async getUsage(): Promise<FortyGuardUsage> {
    if (appConfig.mockMode) {
      return { creditsRemaining: 1_742_430 };
    }
    const storageKey = "sitemorph.fortyguard-usage.v1";
    try {
      const response = await fetchWithDeadline(
        `${appConfig.backendUrl}/fortyguard/usage`,
        undefined,
        8_000,
        "The live FortyGuard balance check timed out.",
        "USAGE_TIMEOUT",
      );
      if (!response.ok) {
        throw await responseError(response, "FortyGuard credit usage is unavailable");
      }
      const usage = (await response.json()) as FortyGuardUsage;
      try { window.localStorage.setItem(storageKey, JSON.stringify(usage)); } catch { /* Storage is an optional fallback. */ }
      return usage;
    } catch (error) {
      try {
        const saved = window.localStorage.getItem(storageKey);
        if (saved) return asSavedUsage(JSON.parse(saved) as FortyGuardUsage);
      } catch { /* Preserve the original reporting error. */ }
      try {
        const response = await fetchWithDeadline(
          "/fortyguard-usage-snapshot.json",
          { cache: "no-store" },
          4_000,
          "The saved FortyGuard balance could not be loaded in time.",
          "USAGE_SNAPSHOT_TIMEOUT",
        );
        if (response.ok) {
          const usage = asSavedUsage((await response.json()) as FortyGuardUsage);
          try { window.localStorage.setItem(storageKey, JSON.stringify(usage)); } catch { /* Storage is optional. */ }
          return usage;
        }
      } catch { /* Preserve the original reporting error when every fallback is unavailable. */ }
      throw error;
    }
  }

  async analyzeSite(geometry: SiteGeometry, thresholdCelsius: number, siteTimezone?: string, cacheOnly = false): Promise<SiteAnalysisResponse> {
    if (appConfig.mockMode) {
      await delay(840);
      return { climateDNA: climateMock as ClimateDNA, mapData: {} };
    }
    const startedAt = performance.now();
    console.info("[SiteMorph analysis] request started", { cacheOnly });
    let response: Response;
    try {
      response = await fetchWithDeadline(
        `${appConfig.backendUrl}/site/analyze`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ geometry: geometry.geojson, thresholdCelsius, siteTimezone, cacheOnly }),
        },
        cacheOnly ? 15_000 : 300_000,
        cacheOnly
          ? "Saved Climate DNA check timed out after 15 seconds. No new FortyGuard activity was created; try checking the saved result again."
          : "The initial Climate DNA run exceeded five minutes and was stopped. Check the saved result before starting anything new.",
        cacheOnly ? "CACHE_CHECK_TIMEOUT" : "ANALYSIS_REQUEST_TIMEOUT",
      );
    } catch (error) {
      console.warn("[SiteMorph analysis] request failed", {
        cacheOnly,
        durationMs: Math.round(performance.now() - startedAt),
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    if (!response.ok) {
      throw await responseError(response, response.status === 422 ? "Site Outside Supported Coverage" : "FortyGuard site analysis failed");
    }
    const result = (await response.json()) as SiteAnalysisResponse;
    if (appConfig.requiredSatelliteContext && !hasVisibleSatelliteContext(result.climateDNA.surface)) {
      const message = cacheOnly
        ? "No complete saved analysis with visible satellite context exists yet. No FortyGuard request was started."
        : "FortyGuard did not return renderable satellite context for this Site Limit. SiteMorph stopped before presenting incomplete Climate DNA.";
      throw new FortyGuardServiceError(
        message,
        cacheOnly ? "SAVED_ANALYSIS_MISSING" : "SATELLITE_CONTEXT_MISSING",
        cacheOnly ? 404 : 502,
      );
    }
    console.info("[SiteMorph analysis] request completed", { cacheOnly, durationMs: Math.round(performance.now() - startedAt), source: result.cache?.source ?? "unknown" });
    return result;
  }
}

export const fortyGuardService = new FortyGuardService();
