import proj4 from "proj4";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import type { GeometryData } from "forma-embedded-view-sdk/render";
import type { ClimateLayerId, ClimateResponseResult, SiteAnalysisResponse, SiteGeometry, SiteZone } from "../types";
import { appConfig, delay } from "../utils/config";
import { getFormaClient } from "./forma.service";

export interface OverlayState {
  activeLayer: ClimateLayerId | null;
  visible: boolean;
  mode: "mock" | "forma";
}

export interface FormaOverlayServiceContract {
  setAnalysisResult(result: SiteAnalysisResponse, geometry: SiteGeometry): void;
  setClimateResponse(result: ClimateResponseResult, geometry: SiteGeometry): void;
  clearClimateResponse(): void;
  addHeatLayer(layer: ClimateLayerId): Promise<OverlayState>;
  addPersistenceLayer(): Promise<OverlayState>;
  addVegetationLayer(): Promise<OverlayState>;
  toggleLayer(layer: ClimateLayerId): Promise<OverlayState>;
  focusZone(zone: SiteZone): Promise<void>;
  clearLayers(): Promise<OverlayState>;
}

const WGS84 = "EPSG:4326";
const GROUND_TEXTURE_NAME = "sitemorph-climate-overlay";

interface ProjectedTile {
  feature: Feature<Polygon>;
  points: Array<[number, number]>;
  centroid: [number, number];
  color: [number, number, number, number];
}

interface GroundTextureData {
  canvas: HTMLCanvasElement;
  position: { x: number; y: number; z: number };
  scale: { x: number; y: number };
  tiles: ProjectedTile[];
  minimum: number;
  maximum: number;
}

function scaleRangeForLayer(layer: ClimateLayerId, observedMinimum: number, observedMaximum: number): [number, number] {
  if (layer === "climate-response") return [0, 100];
  if (layer === "temperature") return [Math.min(20, Math.floor(observedMinimum)), Math.max(45, Math.ceil(observedMaximum))];
  if (layer === "persistence" || layer === "exceedance") return [0, Math.max(24, Math.ceil(observedMaximum))];
  if (layer === "peak-time") return [0, 23];
  return [observedMinimum, observedMaximum];
}

function featureValue(feature: Feature<Polygon>, layer: ClimateLayerId): number | undefined {
  const properties = feature.properties ?? {};
  const preferredKeys = layer === "temperature"
    ? ["mean_temperature_celsius", "average_temperature", "temperature", "tcm", "value"]
    : layer === "persistence"
      ? ["persistence_hours", "value", "persistence"]
      : layer === "exceedance"
        ? ["exceedance_hours", "value", "exceedance"]
        : layer === "peak-time"
          ? ["peak_hour_utc", "value", "time_of_measure"]
          : layer === "ranked-zones"
            ? ["thermal_score"]
            : ["value", layer];
  for (const preferred of preferredKeys) {
    const normalizedPreferred = preferred.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
    const entry = Object.entries(properties).find(([key]) => key.toLowerCase().replaceAll(/[^a-z0-9]/g, "") === normalizedPreferred);
    if (entry) {
      const value = Number(entry[1]);
      if (Number.isFinite(value)) return value;
    }
  }
  return undefined;
}

function thermalColor(ratio: number): [number, number, number, number] {
  const clamped = Math.max(0, Math.min(1, ratio));
  const low = [49, 130, 189];
  const middle = [254, 224, 139];
  const high = [215, 48, 39];
  const start = clamped < 0.5 ? low : middle;
  const end = clamped < 0.5 ? middle : high;
  const localRatio = clamped < 0.5 ? clamped * 2 : (clamped - 0.5) * 2;
  return [
    Math.round(start[0] + (end[0] - start[0]) * localRatio),
    Math.round(start[1] + (end[1] - start[1]) * localRatio),
    Math.round(start[2] + (end[2] - start[2]) * localRatio),
    245,
  ];
}

function interpolateColor(ratio: number, low: number[], high: number[]): [number, number, number, number] {
  const clamped = Math.max(0, Math.min(1, ratio));
  return [
    Math.round(low[0] + (high[0] - low[0]) * clamped),
    Math.round(low[1] + (high[1] - low[1]) * clamped),
    Math.round(low[2] + (high[2] - low[2]) * clamped),
    245,
  ];
}

function layerColor(layer: ClimateLayerId, ratio: number, zoneClass: unknown): [number, number, number, number] {
  if (layer === "climate-response") return thermalColor(ratio);
  if (layer === "ranked-zones") return rankedZoneColor(zoneClass);
  if (layer === "persistence") return interpolateColor(ratio, [255, 211, 92], [190, 34, 34]);
  if (layer === "exceedance") return interpolateColor(ratio, [56, 189, 248], [126, 34, 206]);
  if (layer === "peak-time") return interpolateColor(ratio, [20, 92, 184], [236, 72, 153]);
  return thermalColor(ratio);
}

function rankedZoneColor(zoneClass: unknown): [number, number, number, number] {
  if (zoneClass === "preferred") return [40, 167, 99, 245];
  if (zoneClass === "avoid") return [220, 68, 55, 245];
  return [232, 166, 49, 245];
}

function colorbarForLayer(layer: ClimateLayerId, minimum: number, maximum: number): { colors: string[]; labels: string[]; labelPosition: "center"; unit?: string } {
  if (layer === "climate-response") return { colors: ["#3182bd", "#5bc0be", "#fee08b", "#f46d43", "#d73027"], labels: ["0", "25", "50", "75", "100"], labelPosition: "center", unit: "index" };
  if (layer === "ranked-zones") {
    return { colors: ["#28a763", "#e8a631", "#dc4437"], labels: ["Preferred", "Moderate", "Avoid"], labelPosition: "center" };
  }
  const format = (value: number) => Number(value.toFixed(1)).toString();
  const labels = [format(minimum), "", "", "", format(maximum)];
  if (layer === "persistence") return { colors: ["#ffd35c", "#efae45", "#df8138", "#cb512e", "#be2222"], labels, labelPosition: "center", unit: "h" };
  if (layer === "exceedance") return { colors: ["#38bdf8", "#4799e3", "#5c72d2", "#704abe", "#7e22ce"], labels, labelPosition: "center", unit: "h" };
  if (layer === "peak-time") return { colors: ["#145cb8", "#514fb9", "#8c43b7", "#c33bb0", "#ec4899"], labels, labelPosition: "center", unit: "UTC" };
  return { colors: ["#3182bd", "#8ecae6", "#fee08b", "#f46d43", "#d73027"], labels, labelPosition: "center", unit: "°C" };
}

function projectFeature(feature: Feature<Polygon>, geometry: SiteGeometry): Array<[number, number]> {
  if (!geometry.projection) return [];
  const { projString, refPoint } = geometry.projection;
  const ring = feature.geometry.coordinates[0] ?? [];
  return ring.map(([longitude, latitude]) => {
    const [projectX, projectY] = proj4(WGS84, projString, [longitude, latitude]);
    return [projectX - refPoint[0], projectY - refPoint[1]];
  });
}

function polygonCentroid(points: Array<[number, number]>): [number, number] {
  const openPoints = points.length > 1
    && points[0][0] === points.at(-1)?.[0]
    && points[0][1] === points.at(-1)?.[1]
    ? points.slice(0, -1)
    : points;
  if (!openPoints.length) return [0, 0];
  return [
    openPoints.reduce((sum, point) => sum + point[0], 0) / openPoints.length,
    openPoints.reduce((sum, point) => sum + point[1], 0) / openPoints.length,
  ];
}

function fillNearestTileCoverage(
  context: CanvasRenderingContext2D,
  tiles: ProjectedTile[],
  bounds: { minX: number; maxY: number },
  metersPerPixel: number,
  width: number,
  height: number,
): void {
  // FortyGuard's 60 m output can contain only the cells sampled inside a small
  // parcel. Extend the nearest real cell through edge gaps so the texture covers
  // the complete Forma Site Limit. This changes coverage, never the measured
  // values or the relative zone classification.
  const sampleSize = 4;
  let activeColor = "";
  for (let py = 0; py < height; py += sampleSize) {
    const y = bounds.maxY - (py + sampleSize / 2) * metersPerPixel;
    for (let px = 0; px < width; px += sampleSize) {
      const x = bounds.minX + (px + sampleSize / 2) * metersPerPixel;
      let nearest = tiles[0];
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const tile of tiles) {
        const dx = tile.centroid[0] - x;
        const dy = tile.centroid[1] - y;
        const distance = dx * dx + dy * dy;
        if (distance < nearestDistance) {
          nearest = tile;
          nearestDistance = distance;
        }
      }
      const color = `rgba(${nearest.color[0]}, ${nearest.color[1]}, ${nearest.color[2]}, ${nearest.color[3] / 255})`;
      if (color !== activeColor) {
        context.fillStyle = color;
        activeColor = color;
      }
      context.fillRect(px, py, sampleSize, sampleSize);
    }
  }
}

function buildGroundTexture(mapData: FeatureCollection<Polygon>, geometry: SiteGeometry, layer: ClimateLayerId): GroundTextureData {
  if (!geometry.projection) throw new Error("Forma project projection is unavailable for the heatmap overlay");
  const values = mapData.features.map((feature) => featureValue(feature, layer)).filter((value): value is number => value !== undefined);
  const observedMinimum = values.length ? Math.min(...values) : 0;
  const observedMaximum = values.length ? Math.max(...values) : 1;
  const [minimum, maximum] = scaleRangeForLayer(layer, observedMinimum, observedMaximum);
  const tiles = mapData.features.flatMap((feature): ProjectedTile[] => {
    const points = projectFeature(feature, geometry);
    if (points.length < 4) return [];
    const value = featureValue(feature, layer);
    const ratio = value === undefined || maximum === minimum ? 0.55 : (value - minimum) / (maximum - minimum);
    return [{ feature, points, centroid: polygonCentroid(points), color: layerColor(layer, ratio, feature.properties?.zone_class) }];
  });
  if (!tiles.length) throw new Error("FortyGuard map_data contains no renderable thermal tiles");

  const aoiPoints = geometry.localBoundary?.length
    ? geometry.localBoundary
    : projectFeature(geometry.geojson as unknown as Feature<Polygon>, geometry);
  if (aoiPoints.length < 3) throw new Error("Forma Site Limit boundary is unavailable for overlay placement");
  const xs = aoiPoints.map(([x]) => x);
  const ys = aoiPoints.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const metersPerPixel = Math.max(0.25, Math.max(maxX - minX, maxY - minY) / 1024);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil((maxX - minX) / metersPerPixel));
  canvas.height = Math.max(1, Math.ceil((maxY - minY) / metersPerPixel));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas rendering is unavailable for the Forma ground overlay");
  context.clearRect(0, 0, canvas.width, canvas.height);

  // FortyGuard returns complete 60 m cells around the AOI. Anchor the texture
  // to the exact Forma Site Limit and clip away every part outside that boundary.
  context.save();
  context.beginPath();
  aoiPoints.forEach(([x, y], index) => {
    const px = (x - minX) / metersPerPixel;
    const py = (maxY - y) / metersPerPixel;
    if (index === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  });
  context.closePath();
  context.clip();

  fillNearestTileCoverage(context, tiles, { minX, maxY }, metersPerPixel, canvas.width, canvas.height);

  for (const tile of tiles) {
    context.beginPath();
    tile.points.forEach(([x, y], index) => {
      const px = (x - minX) / metersPerPixel;
      const py = (maxY - y) / metersPerPixel;
      if (index === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    });
    context.closePath();
    context.fillStyle = `rgba(${tile.color[0]}, ${tile.color[1]}, ${tile.color[2]}, ${tile.color[3] / 255})`;
    context.fill();
  }
  context.restore();

  return {
    canvas,
    position: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: 100 },
    scale: { x: metersPerPixel, y: metersPerPixel },
    tiles,
    minimum,
    maximum,
  };
}

function buildClimateResponseTexture(result: ClimateResponseResult): GroundTextureData {
  const { grid } = result;
  const canvas = document.createElement("canvas");
  canvas.width = grid.width;
  canvas.height = grid.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas rendering is unavailable for the hybrid climate response.");
  const image = context.createImageData(grid.width, grid.height);
  for (let index = 0; index < grid.grid.length; index += 1) {
    if (grid.mask[index] === 0) continue;
    const value = Number(grid.grid[index]);
    if (!Number.isFinite(value)) continue;
    const color = layerColor("climate-response", value / 100, undefined);
    const offset = index * 4;
    image.data[offset] = color[0];
    image.data[offset + 1] = color[1];
    image.data[offset + 2] = color[2];
    image.data[offset + 3] = 224;
  }
  context.putImageData(image, 0, 0);
  return {
    canvas,
    position: {
      x: grid.x0 + grid.width * grid.resolution / 2,
      y: grid.y0 - grid.height * grid.resolution / 2,
      z: 100,
    },
    scale: { x: grid.resolution, y: grid.resolution },
    tiles: [],
    minimum: 0,
    maximum: 100,
  };
}

function buildTileMesh(mapData: FeatureCollection<Polygon>, geometry: SiteGeometry, layer: ClimateLayerId): GeometryData {
  if (!geometry.projection) throw new Error("Forma project projection is unavailable for the heatmap overlay");
  const values = mapData.features.map((feature) => featureValue(feature, layer)).filter((value): value is number => value !== undefined);
  const observedMinimum = values.length ? Math.min(...values) : 0;
  const observedMaximum = values.length ? Math.max(...values) : 1;
  const [minimum, maximum] = scaleRangeForLayer(layer, observedMinimum, observedMaximum);
  const positions: number[] = [];
  const colors: number[] = [];
  const normals: number[] = [];
  const { projString, refPoint } = geometry.projection;

  for (const feature of mapData.features) {
    const rawRing = feature.geometry.coordinates[0];
    if (!rawRing || rawRing.length < 4) continue;
    const ring = rawRing[0][0] === rawRing.at(-1)?.[0] && rawRing[0][1] === rawRing.at(-1)?.[1]
      ? rawRing.slice(0, -1)
      : rawRing;
    const projectedPoints = ring.map(([longitude, latitude]) => {
      const [projectX, projectY] = proj4(WGS84, projString, [longitude, latitude]);
      return [projectX - refPoint[0], projectY - refPoint[1], geometry.overlayElevation ?? 1.5] as [number, number, number];
    });
    const signedArea = projectedPoints.reduce((sum, point, index) => {
      const next = projectedPoints[(index + 1) % projectedPoints.length];
      return sum + point[0] * next[1] - next[0] * point[1];
    }, 0);
    const localPoints = signedArea >= 0 ? projectedPoints : projectedPoints.reverse();
    const value = featureValue(feature, layer);
    const ratio = value === undefined || maximum === minimum ? 0.55 : (value - minimum) / (maximum - minimum);
    const color = layerColor(layer, ratio, feature.properties?.zone_class);

    for (let index = 1; index < localPoints.length - 1; index += 1) {
      for (const point of [localPoints[0], localPoints[index], localPoints[index + 1]]) {
        positions.push(...point);
        colors.push(...color);
        normals.push(0, 0, 1);
      }
    }
  }

  if (!positions.length) throw new Error("FortyGuard map_data contains no renderable thermal tiles");
  return { position: new Float32Array(positions), color: new Uint8Array(colors), normal: new Float32Array(normals) };
}

class FormaOverlayService implements FormaOverlayServiceContract {
  private state: OverlayState = { activeLayer: null, visible: false, mode: appConfig.mockMode ? "mock" : "forma" };
  private sceneOverlayId: string | null = null;
  private groundTextureActive = false;
  private hiddenSitePath: string | null = null;
  private mapData: SiteAnalysisResponse["mapData"] = {};
  private geometry: SiteGeometry | null = null;
  private climateResponse: ClimateResponseResult | null = null;

  setAnalysisResult(result: SiteAnalysisResponse, geometry: SiteGeometry): void {
    this.mapData = result.mapData;
    this.geometry = geometry;
    this.climateResponse = null;
  }

  setClimateResponse(result: ClimateResponseResult, geometry: SiteGeometry): void {
    this.climateResponse = result;
    this.geometry = geometry;
  }

  clearClimateResponse(): void {
    this.climateResponse = null;
  }

  async addHeatLayer(layer: ClimateLayerId): Promise<OverlayState> {
    return this.activate(layer);
  }

  async addPersistenceLayer(): Promise<OverlayState> {
    return this.activate("persistence");
  }

  async addVegetationLayer(): Promise<OverlayState> {
    return this.activate("vegetation");
  }

  async toggleLayer(layer: ClimateLayerId): Promise<OverlayState> {
    if (this.state.activeLayer === layer && this.state.visible) return this.clearLayers();
    return this.activate(layer);
  }

  async focusZone(zone: SiteZone): Promise<void> {
    if (appConfig.mockMode) {
      await delay(240);
      return;
    }
    if (!this.geometry) throw new Error("Forma site geometry is unavailable");
    const rankedZones = this.mapData["ranked-zones"];
    if (!rankedZones) throw new Error("Ranked zone map_data is unavailable");
    const tileIds = new Set(zone.sourceTileIds);
    const selected: FeatureCollection<Polygon> = {
      type: "FeatureCollection",
      features: rankedZones.features.filter((feature) => tileIds.has(String(feature.properties?.tile_id ?? ""))),
    };
    if (!selected.features.length) throw new Error(`${zone.name} has no renderable FortyGuard tiles`);
    const Forma = await getFormaClient();
    await this.renderGroundLayer(Forma, selected, this.geometry, "ranked-zones");
    this.state = { ...this.state, activeLayer: "ranked-zones", visible: true };
  }

  async clearLayers(): Promise<OverlayState> {
    if (appConfig.mockMode) await delay(120);
    else {
      const Forma = await getFormaClient();
      await Forma.render.elementColors.clearAll();
      await Forma.colorbar.remove().catch(() => undefined);
      if (this.groundTextureActive) {
        await Forma.terrain.groundTexture.remove({ name: GROUND_TEXTURE_NAME }).catch(() => undefined);
        this.groundTextureActive = false;
      }
      if (this.sceneOverlayId) {
        await Forma.render.remove({ id: this.sceneOverlayId });
        this.sceneOverlayId = null;
      }
      if (this.hiddenSitePath) {
        await Forma.render.unhideElement({ path: this.hiddenSitePath }).catch(() => undefined);
        this.hiddenSitePath = null;
      }
    }
    this.state = { ...this.state, activeLayer: null, visible: false };
    return this.state;
  }

  private async activate(layer: ClimateLayerId): Promise<OverlayState> {
    if (appConfig.mockMode) await delay(240);
    else {
      if (layer !== "climate-response" && layer !== "ranked-zones" && layer !== "temperature" && layer !== "persistence" && layer !== "exceedance" && layer !== "peak-time") {
        throw new Error(`${layer} is not part of the core FortyGuard analysis yet`);
      }
      if (layer === "climate-response") {
        if (!this.climateResponse || !this.geometry) throw new Error("Forma-resolved Climate Response is unavailable");
        const Forma = await getFormaClient();
        await this.renderClimateResponseLayer(Forma, this.climateResponse, this.geometry);
        this.state = { ...this.state, activeLayer: layer, visible: true };
        return this.state;
      }
      const mapData = this.mapData[layer];
      if (!mapData || !this.geometry) throw new Error(`${layer} map_data is unavailable`);
      const Forma = await getFormaClient();
      await this.renderGroundLayer(Forma, mapData, this.geometry, layer);
    }
    this.state = { ...this.state, activeLayer: layer, visible: true };
    return this.state;
  }

  private async renderGroundLayer(
    Forma: Awaited<ReturnType<typeof getFormaClient>>,
    mapData: FeatureCollection<Polygon>,
    geometry: SiteGeometry,
    layer: ClimateLayerId,
  ): Promise<void> {
    await Forma.render.elementColors.clearAll();
    const texture = buildGroundTexture(mapData, geometry, layer);
    await Forma.terrain.groundTexture.remove({ name: GROUND_TEXTURE_NAME }).catch(() => undefined);
    await Forma.terrain.groundTexture.add({
      name: GROUND_TEXTURE_NAME,
      canvas: texture.canvas,
      position: texture.position,
      scale: texture.scale,
    });
    this.groundTextureActive = true;
    await Forma.colorbar.add(colorbarForLayer(layer, texture.minimum, texture.maximum));
    if (this.sceneOverlayId) {
      await Forma.render.remove({ id: this.sceneOverlayId }).catch(() => undefined);
      this.sceneOverlayId = null;
    }
    if (geometry.elementPath && this.hiddenSitePath !== geometry.elementPath) {
      if (this.hiddenSitePath) await Forma.render.unhideElement({ path: this.hiddenSitePath }).catch(() => undefined);
      await Forma.render.hideElement({ path: geometry.elementPath }).catch(() => undefined);
      this.hiddenSitePath = geometry.elementPath;
    }

    // Match native Forma analyses: results remain on the terrain while buildings
    // occlude the raster and retain their normal model appearance.
  }

  private async renderClimateResponseLayer(
    Forma: Awaited<ReturnType<typeof getFormaClient>>,
    response: ClimateResponseResult,
    geometry: SiteGeometry,
  ): Promise<void> {
    await Forma.render.elementColors.clearAll();
    const texture = buildClimateResponseTexture(response);
    await Forma.terrain.groundTexture.remove({ name: GROUND_TEXTURE_NAME }).catch(() => undefined);
    await Forma.terrain.groundTexture.add({
      name: GROUND_TEXTURE_NAME,
      canvas: texture.canvas,
      position: texture.position,
      scale: texture.scale,
    });
    this.groundTextureActive = true;
    await Forma.colorbar.add(colorbarForLayer("climate-response", 0, 100));
    if (this.sceneOverlayId) {
      await Forma.render.remove({ id: this.sceneOverlayId }).catch(() => undefined);
      this.sceneOverlayId = null;
    }
    if (geometry.elementPath && this.hiddenSitePath !== geometry.elementPath) {
      if (this.hiddenSitePath) await Forma.render.unhideElement({ path: this.hiddenSitePath }).catch(() => undefined);
      await Forma.render.hideElement({ path: geometry.elementPath }).catch(() => undefined);
      this.hiddenSitePath = geometry.elementPath;
    }
  }
}

export const formaOverlayService = new FormaOverlayService();
