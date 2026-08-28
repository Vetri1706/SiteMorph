import type { ClimateDNA, SiteAnalysisResponse, SiteGeometry, ThermalMetrics } from "../types";
import { fortyGuardService } from "./fortyguard.service";

export interface ClimateServiceContract {
  analyze(geometry: SiteGeometry, thresholdCelsius: number, siteTimezone?: string, cacheOnly?: boolean): Promise<SiteAnalysisResponse>;
  recalculateThreshold(climate: ClimateDNA, thresholdCelsius: number): ClimateDNA;
}

class ClimateService implements ClimateServiceContract {
  async analyze(geometry: SiteGeometry, thresholdCelsius: number, siteTimezone?: string, cacheOnly = false): Promise<SiteAnalysisResponse> {
    return fortyGuardService.analyzeSite(geometry, thresholdCelsius, siteTimezone, cacheOnly);
  }

  recalculateThreshold(climate: ClimateDNA, thresholdCelsius: number): ClimateDNA {
    const difference = thresholdCelsius - climate.thermal.thresholdCelsius;
    const thermal: ThermalMetrics = {
      ...climate.thermal,
      thresholdCelsius,
      hoursAboveThreshold: Math.max(0, Math.round(climate.thermal.hoursAboveThreshold * Math.pow(0.81, difference))),
      longestPersistenceHours: Math.max(1, Math.round(climate.thermal.longestPersistenceHours - difference * 0.42)),
      hotZonePercent: Math.max(0, Math.min(100, Math.round(climate.thermal.hotZonePercent - difference * 3.2))),
      coolZonePercent: Math.max(0, Math.min(100, Math.round(climate.thermal.coolZonePercent + difference * 1.8))),
    };
    return { ...climate, thermal };
  }
}

export const climateService = new ClimateService();
