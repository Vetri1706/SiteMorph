import type { Feature, FeatureCollection, Polygon } from "geojson";
import type { Coordinate, RankedThermalTile, SiteZone, ThermalZoneClass, TileThermalSample } from "../src/types";

export interface DailyThermalMaps {
  date: string;
  tcm: FeatureCollection<Polygon>;
  persistence: FeatureCollection<Polygon>;
  exceedance: FeatureCollection<Polygon>;
  timeOfMeasure: FeatureCollection<Polygon>;
}

export interface RankedThermalResult {
  tiles: RankedThermalTile[];
  mapData: FeatureCollection<Polygon>;
  zones: SiteZone[];
  separable: boolean;
}

interface TileAccumulator {
  id: string;
  centroid: Coordinate;
  geometry: Polygon;
  samples: TileThermalSample[];
  coolestDates: Set<string>;
  hottestDates: Set<string>;
  coolerThanMeanDates: Set<string>;
  hotterThanMeanDates: Set<string>;
}

const ZONE_ORDER: ThermalZoneClass[] = ["preferred", "moderate", "avoid"];

function normalizedKey(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function propertyNumber(feature: Feature<Polygon>, keys: string[]): number | undefined {
  const accepted = new Set(keys.map(normalizedKey));
  for (const [key, rawValue] of Object.entries(feature.properties ?? {})) {
    if (!accepted.has(normalizedKey(key))) continue;
    const value = Number(rawValue);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

function polygonCentroid(geometry: Polygon): Coordinate {
  const ring = geometry.coordinates[0] ?? [];
  const openRing = ring.length > 1 && ring[0][0] === ring.at(-1)?.[0] && ring[0][1] === ring.at(-1)?.[1]
    ? ring.slice(0, -1)
    : ring;
  if (!openRing.length) return { longitude: 0, latitude: 0 };
  return {
    longitude: openRing.reduce((sum, point) => sum + point[0], 0) / openRing.length,
    latitude: openRing.reduce((sum, point) => sum + point[1], 0) / openRing.length,
  };
}

function tileKey(geometry: Polygon): string {
  const centroid = polygonCentroid(geometry);
  return `${centroid.longitude.toFixed(6)},${centroid.latitude.toFixed(6)}`;
}

function featureIndex(collection: FeatureCollection<Polygon>): Map<string, Feature<Polygon>> {
  return new Map(collection.features.map((feature) => [tileKey(feature.geometry), feature]));
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function rounded(value: number, digits = 1): number {
  return Number(value.toFixed(digits));
}

function modalHour(values: number[]): number {
  const counts = new Map<number, number>();
  for (const value of values) {
    const hour = Math.max(0, Math.min(23, Math.round(value)));
    counts.set(hour, (counts.get(hour) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
}

function peakHourConsistency(values: number[]): number {
  if (!values.length) return 0;
  const counts = new Map<number, number>();
  values.forEach((value) => {
    const hour = Math.max(0, Math.min(23, Math.round(value)));
    counts.set(hour, (counts.get(hour) ?? 0) + 1);
  });
  return Math.round((Math.max(...counts.values()) / values.length) * 100);
}

function lowerIsBetter(value: number, minimum: number, maximum: number): number {
  if (maximum - minimum < 1e-6) return 0.5;
  return 1 - (value - minimum) / (maximum - minimum);
}

function directionFor(centroid: Coordinate, siteCentroid: Coordinate): string {
  const dx = centroid.longitude - siteCentroid.longitude;
  const dy = centroid.latitude - siteCentroid.latitude;
  const magnitude = Math.hypot(dx, dy);
  if (magnitude < 1e-7) return "Central";
  const horizontal = dx >= 0 ? "East" : "West";
  const vertical = dy >= 0 ? "North" : "South";
  if (Math.abs(dx) > Math.abs(dy) * 2) return horizontal;
  if (Math.abs(dy) > Math.abs(dx) * 2) return vertical;
  return `${vertical}-${horizontal}`;
}

function classify(score: number, separable: boolean): ThermalZoneClass {
  if (!separable) return "moderate";
  if (score >= 66.7) return "preferred";
  if (score < 33.3) return "avoid";
  return "moderate";
}

function zoneName(zoneClass: ThermalZoneClass): string {
  if (zoneClass === "preferred") return "Preferred Build Zone";
  if (zoneClass === "avoid") return "Avoid Zone";
  return "Moderate Zone";
}

export function rankThermalTiles(dailyMaps: DailyThermalMaps[]): RankedThermalResult {
  const accumulators = new Map<string, TileAccumulator>();

  for (const daily of dailyMaps) {
    const persistence = featureIndex(daily.persistence);
    const exceedance = featureIndex(daily.exceedance);
    const timeOfMeasure = featureIndex(daily.timeOfMeasure);
    const dailySamples: Array<{ key: string; sample: TileThermalSample; feature: Feature<Polygon> }> = [];

    for (const tcmFeature of daily.tcm.features) {
      const key = tileKey(tcmFeature.geometry);
      const persistenceFeature = persistence.get(key);
      const exceedanceFeature = exceedance.get(key);
      const timeFeature = timeOfMeasure.get(key);
      const meanTemperature = propertyNumber(tcmFeature, ["average_temperature", "temperature", "tcm", "value"]);
      const maxTemperature = propertyNumber(tcmFeature, ["max_temperature"]) ?? meanTemperature;
      const minTemperature = propertyNumber(tcmFeature, ["min_temperature"]) ?? meanTemperature;
      const persistenceHours = persistenceFeature ? propertyNumber(persistenceFeature, ["value", "persistence"]) : undefined;
      const exceedanceHours = exceedanceFeature ? propertyNumber(exceedanceFeature, ["value", "exceedance"]) : undefined;
      const peakHourUtc = timeFeature ? propertyNumber(timeFeature, ["value", "time_of_measure", "peak_hour"]) : undefined;
      if ([meanTemperature, maxTemperature, minTemperature, persistenceHours, exceedanceHours, peakHourUtc].some((value) => value === undefined)) continue;
      dailySamples.push({
        key,
        feature: tcmFeature,
        sample: {
          date: daily.date,
          meanTemperatureCelsius: meanTemperature!,
          maxTemperatureCelsius: maxTemperature!,
          minTemperatureCelsius: minTemperature!,
          persistenceHours: persistenceHours!,
          exceedanceHours: exceedanceHours!,
          peakHourUtc: peakHourUtc!,
        },
      });
    }

    const temperatures = dailySamples.map((entry) => entry.sample.meanTemperatureCelsius).sort((a, b) => a - b);
    const dailyRange = temperatures.length ? temperatures.at(-1)! - temperatures[0] : 0;
    const dailyMean = average(temperatures);
    const coolestCutoff = temperatures[Math.max(0, Math.ceil(temperatures.length * 0.2) - 1)];
    const hottestCutoff = temperatures[Math.min(temperatures.length - 1, Math.floor(temperatures.length * 0.75))];

    for (const entry of dailySamples) {
      const accumulator = accumulators.get(entry.key) ?? {
        id: `tile-${entry.key}`,
        centroid: polygonCentroid(entry.feature.geometry),
        geometry: entry.feature.geometry,
        samples: [],
        coolestDates: new Set<string>(),
        hottestDates: new Set<string>(),
        coolerThanMeanDates: new Set<string>(),
        hotterThanMeanDates: new Set<string>(),
      };
      accumulator.samples.push(entry.sample);
      if (dailyRange >= 0.05 && coolestCutoff !== undefined && entry.sample.meanTemperatureCelsius <= coolestCutoff) {
        accumulator.coolestDates.add(daily.date);
      }
      if (dailyRange >= 0.05 && hottestCutoff !== undefined && entry.sample.meanTemperatureCelsius >= hottestCutoff) {
        accumulator.hottestDates.add(daily.date);
      }
      if (entry.sample.meanTemperatureCelsius < dailyMean - 0.025) accumulator.coolerThanMeanDates.add(daily.date);
      if (entry.sample.meanTemperatureCelsius > dailyMean + 0.025) accumulator.hotterThanMeanDates.add(daily.date);
      accumulators.set(entry.key, accumulator);
    }
  }

  const aggregates = [...accumulators.values()].map((tile) => ({
    tile,
    meanTemperatureCelsius: average(tile.samples.map((sample) => sample.meanTemperatureCelsius)),
    maxTemperatureCelsius: Math.max(...tile.samples.map((sample) => sample.maxTemperatureCelsius)),
    minTemperatureCelsius: Math.min(...tile.samples.map((sample) => sample.minTemperatureCelsius)),
    persistenceHours: average(tile.samples.map((sample) => sample.persistenceHours)),
    maxPersistenceHours: Math.max(...tile.samples.map((sample) => sample.persistenceHours)),
    exceedanceHours: average(tile.samples.map((sample) => sample.exceedanceHours)),
    peakHourUtc: modalHour(tile.samples.map((sample) => sample.peakHourUtc)),
  }));
  if (!aggregates.length) throw new Error("FortyGuard returned no tiles shared by all four thermal analytics");

  const temperatures = aggregates.map((tile) => tile.meanTemperatureCelsius);
  const persistence = aggregates.map((tile) => tile.persistenceHours);
  const exceedance = aggregates.map((tile) => tile.exceedanceHours);
  const ranges = {
    temperature: [Math.min(...temperatures), Math.max(...temperatures)] as const,
    persistence: [Math.min(...persistence), Math.max(...persistence)] as const,
    exceedance: [Math.min(...exceedance), Math.max(...exceedance)] as const,
  };

  const preliminary = aggregates.map((entry) => ({
    ...entry,
    score: 100 * (
      0.40 * lowerIsBetter(entry.meanTemperatureCelsius, ...ranges.temperature)
      + 0.35 * lowerIsBetter(entry.persistenceHours, ...ranges.persistence)
      + 0.25 * lowerIsBetter(entry.exceedanceHours, ...ranges.exceedance)
    ),
  }));
  const scoreRange = Math.max(...preliminary.map((entry) => entry.score)) - Math.min(...preliminary.map((entry) => entry.score));
  const separable = scoreRange >= 8 && (
    ranges.temperature[1] - ranges.temperature[0] >= 0.2
    || ranges.persistence[1] - ranges.persistence[0] >= 1
    || ranges.exceedance[1] - ranges.exceedance[0] >= 1
  );

  const tiles: RankedThermalTile[] = preliminary.map((entry) => ({
    id: entry.tile.id,
    centroid: entry.tile.centroid,
    meanTemperatureCelsius: rounded(entry.meanTemperatureCelsius),
    maxTemperatureCelsius: rounded(entry.maxTemperatureCelsius),
    minTemperatureCelsius: rounded(entry.minTemperatureCelsius),
    persistenceHours: rounded(entry.persistenceHours),
    maxPersistenceHours: rounded(entry.maxPersistenceHours),
    exceedanceHours: rounded(entry.exceedanceHours),
    peakHourUtc: entry.peakHourUtc,
    thermalScore: rounded(entry.score, 0),
    classification: classify(entry.score, separable),
    coolestQuintileCount: entry.tile.coolestDates.size,
    hottestQuartileCount: entry.tile.hottestDates.size,
    coolerThanSiteMeanCount: entry.tile.coolerThanMeanDates.size,
    hotterThanSiteMeanCount: entry.tile.hotterThanMeanDates.size,
    peakHourConsistencyPercent: peakHourConsistency(entry.tile.samples.map((sample) => sample.peakHourUtc)),
    sampleCount: entry.tile.samples.length,
    samples: entry.tile.samples.map((sample) => ({
      ...sample,
      meanTemperatureCelsius: rounded(sample.meanTemperatureCelsius),
      maxTemperatureCelsius: rounded(sample.maxTemperatureCelsius),
      minTemperatureCelsius: rounded(sample.minTemperatureCelsius),
      persistenceHours: rounded(sample.persistenceHours),
      exceedanceHours: rounded(sample.exceedanceHours),
      peakHourUtc: Math.round(sample.peakHourUtc),
    })),
  })).sort((a, b) => b.thermalScore - a.thermalScore);

  const aggregateById = new Map(preliminary.map((entry) => [entry.tile.id, entry]));
  const mapData: FeatureCollection<Polygon> = {
    type: "FeatureCollection",
    features: tiles.map((tile) => ({
      type: "Feature",
      geometry: aggregateById.get(tile.id)!.tile.geometry,
      properties: {
        tile_id: tile.id,
        zone_class: tile.classification,
        thermal_score: tile.thermalScore,
        mean_temperature_celsius: tile.meanTemperatureCelsius,
        max_temperature_celsius: tile.maxTemperatureCelsius,
        min_temperature_celsius: tile.minTemperatureCelsius,
        persistence_hours: tile.persistenceHours,
        max_persistence_hours: tile.maxPersistenceHours,
        exceedance_hours: tile.exceedanceHours,
        peak_hour_utc: tile.peakHourUtc,
        coolest_quintile_count: tile.coolestQuintileCount,
        hottest_quartile_count: tile.hottestQuartileCount,
        cooler_than_site_mean_count: tile.coolerThanSiteMeanCount,
        hotter_than_site_mean_count: tile.hotterThanSiteMeanCount,
        peak_hour_consistency_percent: tile.peakHourConsistencyPercent,
        sample_count: tile.sampleCount,
      },
    })),
  };

  const siteCentroid = {
    longitude: average(tiles.map((tile) => tile.centroid.longitude)),
    latitude: average(tiles.map((tile) => tile.centroid.latitude)),
  };
  const siteMaximums = {
    temperature: Math.max(...tiles.map((tile) => tile.meanTemperatureCelsius)),
    persistence: Math.max(...tiles.map((tile) => tile.persistenceHours)),
    exceedance: Math.max(...tiles.map((tile) => tile.exceedanceHours)),
  };
  const zones = ZONE_ORDER.flatMap((zoneClass): SiteZone[] => {
    const zoneTiles = tiles.filter((tile) => tile.classification === zoneClass);
    if (!zoneTiles.length) return [];
    const centroid = {
      longitude: average(zoneTiles.map((tile) => tile.centroid.longitude)),
      latitude: average(zoneTiles.map((tile) => tile.centroid.latitude)),
    };
    const meanTemperature = average(zoneTiles.map((tile) => tile.meanTemperatureCelsius));
    const meanPersistence = average(zoneTiles.map((tile) => tile.persistenceHours));
    const meanExceedance = average(zoneTiles.map((tile) => tile.exceedanceHours));
    const coolestCount = Math.round(average(zoneTiles.map((tile) => tile.coolestQuintileCount)));
    const coolerThanMeanCount = Math.round(average(zoneTiles.map((tile) => tile.coolerThanSiteMeanCount)));
    const hottestCount = Math.round(average(zoneTiles.map((tile) => tile.hottestQuartileCount)));
    const peakConsistency = Math.round(average(zoneTiles.map((tile) => tile.peakHourConsistencyPercent)));
    const sampleCount = Math.max(...zoneTiles.map((tile) => tile.sampleCount));
    const evidence = separable ? [
      `${rounded(siteMaximums.temperature - meanTemperature)} °C cooler than the site's warmest tile average`,
      `${rounded(siteMaximums.persistence - meanPersistence)} h less persistence than the site maximum`,
      `${rounded(siteMaximums.exceedance - meanExceedance)} h less exceedance than the site maximum`,
      `Cooler than the site average on ${coolerThanMeanCount} of ${sampleCount} sampled dates`,
      `Among the coolest 20% on ${coolestCount} of ${sampleCount} hot-season dates`,
      `Among the hottest 25% on ${hottestCount} of ${sampleCount} hot-season dates`,
      `Peak-hour consistency ${peakConsistency}%`,
    ] : [
      "The parcel is thermally uniform at FortyGuard resolution",
      "Use site-wide heat constraints and let Forma optimize internal building placement",
    ];
    return [{
      id: `zone-${zoneClass}`,
      name: separable ? zoneName(zoneClass) : "No Reliable Separation",
      direction: separable ? directionFor(centroid, siteCentroid) : "Whole site",
      climateSuitability: Math.round(average(zoneTiles.map((tile) => tile.thermalScore))),
      evidence,
      recommendedFor: zoneClass === "preferred" ? ["Primary building footprints"] : zoneClass === "avoid" ? ["Landscape", "Thermal buffers"] : ["Secondary or flexible uses"],
      elementPath: "",
      sourceTileIds: zoneTiles.map((tile) => tile.id),
    }];
  });

  return { tiles, mapData, zones, separable };
}
