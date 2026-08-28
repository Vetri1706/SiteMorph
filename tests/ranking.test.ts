import assert from "node:assert/strict";
import test from "node:test";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import { rankThermalTiles, type DailyThermalMaps } from "../server/ranking.ts";

function tile(index: number, properties: Record<string, number>): Feature<Polygon> {
  const west = -112.08 + index * 0.001;
  const south = 33.40;
  return {
    type: "Feature",
    properties: { tile_id: index, ...properties },
    geometry: {
      type: "Polygon",
      coordinates: [[[west, south], [west + 0.0008, south], [west + 0.0008, south + 0.0008], [west, south + 0.0008], [west, south]]],
    },
  };
}

function collection(features: Feature<Polygon>[]): FeatureCollection<Polygon> {
  return { type: "FeatureCollection", features };
}

function sample(date: string, offset = 0, equal = false): DailyThermalMaps {
  const values = [0, 1, 2, 3, 4].map((index) => equal ? 2 : index);
  return {
    date,
    tcm: collection(values.map((value, index) => tile(index, {
      average_temperature: 30 + offset + value,
      min_temperature: 24 + offset + value,
      max_temperature: 38 + offset + value,
    }))),
    persistence: collection(values.map((value, index) => tile(index, { value: 2 + value }))),
    exceedance: collection(values.map((value, index) => tile(index, { value: 4 + value }))),
    timeOfMeasure: collection(values.map((_value, index) => tile(index, { value: 15 + (index % 2) }))),
  };
}

test("ranks repeated relative tile performance with explainable zone classes", () => {
  const result = rankThermalTiles([
    sample("2024-01-15", -10),
    sample("2024-04-15", -3),
    sample("2024-07-15", 5),
    sample("2024-08-15", 4),
    sample("2024-10-15", 0),
  ]);

  assert.equal(result.separable, true);
  assert.equal(result.tiles.length, 5);
  assert.equal(result.tiles[0].classification, "preferred");
  assert.equal(result.tiles[0].thermalScore, 100);
  assert.equal(result.tiles[0].coolestQuintileCount, 5);
  assert.equal(result.tiles[0].hottestQuartileCount, 0);
  assert.equal(result.tiles[0].coolerThanSiteMeanCount, 5);
  assert.equal(result.tiles.at(-1)?.hotterThanSiteMeanCount, 5);
  assert.equal(result.tiles.at(-1)?.hottestQuartileCount, 5);
  assert.equal(result.tiles.at(-1)?.classification, "avoid");
  assert.deepEqual(result.zones.map((zone) => zone.id), ["zone-preferred", "zone-moderate", "zone-avoid"]);
  assert.equal(result.mapData.features[0].properties?.zone_class, "preferred");
});

test("does not invent a preferred direction when the tiles do not separate", () => {
  const result = rankThermalTiles([
    sample("2024-01-15", -10, true),
    sample("2024-04-15", -3, true),
    sample("2024-07-15", 5, true),
    sample("2024-08-15", 4, true),
    sample("2024-10-15", 0, true),
  ]);

  assert.equal(result.separable, false);
  assert.ok(result.tiles.every((tile) => tile.classification === "moderate"));
  assert.equal(result.zones.length, 1);
  assert.equal(result.zones[0].name, "No Reliable Separation");
  assert.equal(result.zones[0].direction, "Whole site");
  assert.equal(result.zones[0].coolestQuintileCount, undefined);
});
