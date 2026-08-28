import climateMock from "../mocks/climate-dna.json";
import type { ClimateDNA, FortyGuardUsage, SiteAnalysisResponse, SiteGeometry } from "../types";
import { appConfig, delay } from "../utils/config";

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

class FortyGuardService implements FortyGuardServiceContract {
  async getUsage(): Promise<FortyGuardUsage> {
    if (appConfig.mockMode) {
      return { creditsRemaining: 1_742_430 };
    }
    const storageKey = "sitemorph.fortyguard-usage.v1";
    try {
      const response = await fetch(`${appConfig.backendUrl}/fortyguard/usage`);
      if (!response.ok) {
        throw await responseError(response, "FortyGuard credit usage is unavailable");
      }
      const usage = (await response.json()) as FortyGuardUsage;
      try { window.localStorage.setItem(storageKey, JSON.stringify(usage)); } catch { /* Storage is an optional fallback. */ }
      return usage;
    } catch (error) {
      try {
        const saved = window.localStorage.getItem(storageKey);
        if (saved) return { ...(JSON.parse(saved) as FortyGuardUsage), source: "saved", stale: true };
      } catch { /* Preserve the original reporting error. */ }
      throw error;
    }
  }

  async analyzeSite(geometry: SiteGeometry, thresholdCelsius: number, siteTimezone?: string, cacheOnly = false): Promise<SiteAnalysisResponse> {
    if (appConfig.mockMode) {
      await delay(840);
      return { climateDNA: climateMock as ClimateDNA, mapData: {} };
    }
    const response = await fetch(`${appConfig.backendUrl}/site/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ geometry: geometry.geojson, thresholdCelsius, siteTimezone, cacheOnly }),
    });
    if (!response.ok) {
      throw await responseError(response, response.status === 422 ? "Site Outside Supported Coverage" : "FortyGuard site analysis failed");
    }
    return (await response.json()) as SiteAnalysisResponse;
  }
}

export const fortyGuardService = new FortyGuardService();
