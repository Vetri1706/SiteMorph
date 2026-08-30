import proj4 from "proj4";
import type { Footprint } from "forma-embedded-view-sdk/geometry";
import type { Project } from "forma-embedded-view-sdk/project";
import type { GeoJsonPolygon, SiteContext, SiteGeometry } from "../types";
import { appConfig, delay } from "../utils/config";
import { mockSiteContext } from "../utils/mock-site";

type FormaClient = typeof import("forma-embedded-view-sdk/auto")["Forma"];
let formaClientPromise: Promise<FormaClient> | null = null;

export function getFormaClient(): Promise<FormaClient> {
  formaClientPromise ??= import("./forma-client").then((module) => module.Forma);
  return formaClientPromise;
}

export interface FormaConnectionState {
  connected: boolean;
  mode: "embedded" | "mock";
  message: string;
}

export interface FormaServiceContract {
  connect(): Promise<FormaConnectionState>;
  getCurrentProject(): Promise<SiteContext>;
  readSiteLimit(elementPath: string): Promise<SiteGeometry>;
  getSelectedPaths(): Promise<string[]>;
  subscribeToSelection(callback: (paths: string[]) => void): Promise<void>;
  highlightElement(elementPath: string): Promise<void>;
  clearHighlight(): Promise<void>;
}

const WGS84 = "EPSG:4326";

function closeRing(points: number[][]): number[][] {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return points;
  return first[0] === last[0] && first[1] === last[1] ? points : [...points, [...first]];
}

function polygonArea(points: [number, number][]): number {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    twiceArea += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(twiceArea) / 2;
}

function areaToSquareFeet(area: number, projString: string): number {
  if (/\+units=(?:ft|us-ft)\b/.test(projString)) return area;
  return area * 10.7639104167;
}

function footprintToGeometry(elementPath: string, footprint: Footprint, project: Project, triangles?: Float32Array): SiteGeometry {
  if (footprint.type !== "Polygon" || footprint.coordinates.length < 3) {
    throw new Error("Selected Site Limit has no readable polygon geometry.");
  }

  const wgs84Points = footprint.coordinates.map(([x, y]) =>
    proj4(project.projString, WGS84, [project.refPoint[0] + x, project.refPoint[1] + y]),
  );
  const ring = closeRing(wgs84Points);
  const longitudes = ring.map(([longitude]) => longitude);
  const latitudes = ring.map(([, latitude]) => latitude);
  const centroid = {
    longitude: longitudes.reduce((sum, value) => sum + value, 0) / longitudes.length,
    latitude: latitudes.reduce((sum, value) => sum + value, 0) / latitudes.length,
  };
  const geojson: GeoJsonPolygon = {
    type: "Feature",
    properties: { source: "Forma", elementPath },
    geometry: { type: "Polygon", coordinates: [ring] },
  };
  const areaSqFt = Math.round(areaToSquareFeet(polygonArea(footprint.coordinates), project.projString));
  const elevations = triangles
    ? Array.from({ length: Math.floor(triangles.length / 3) }, (_, index) => triangles[index * 3 + 2]).filter(Number.isFinite)
    : [];
  const terrainElevationMeters = elevations.length ? Math.max(...elevations) : undefined;
  const overlayElevation = terrainElevationMeters !== undefined ? terrainElevationMeters + 0.75 : 1.5;

  return {
    elementPath,
    pointCount: footprint.coordinates.length,
    triangleCount: triangles ? Math.floor(triangles.length / 9) : undefined,
    overlayElevation,
    terrainElevationMeters,
    localBoundary: footprint.coordinates.map(([x, y]) => [x, y]),
    areaSqFt,
    areaAcres: Number((areaSqFt / 43560).toFixed(2)),
    centroid,
    bounds: {
      north: Math.max(...latitudes),
      east: Math.max(...longitudes),
      south: Math.min(...latitudes),
      west: Math.min(...longitudes),
    },
    geojson,
    projection: { srid: project.srid, projString: project.projString, refPoint: project.refPoint },
  };
}

class FormaService implements FormaServiceContract {
  private selectionCallback: ((paths: string[]) => void) | null = null;
  private selectionSubscriptionPromise: Promise<void> | null = null;

  async connect(): Promise<FormaConnectionState> {
    if (appConfig.mockMode) {
      await delay(220);
      return { connected: true, mode: "mock", message: "Forma SDK ready · mock project context" };
    }

    const Forma = await getFormaClient();
    const response = await Forma.ping();
    return { connected: response.length > 0, mode: "embedded", message: "Connected to Autodesk Forma" };
  }

  async getCurrentProject(): Promise<SiteContext> {
    if (appConfig.mockMode) return mockSiteContext;

    const Forma = await getFormaClient();
    const [project, geoLocation, proposalId] = await Promise.all([
      Forma.project.get(),
      Forma.project.getGeoLocation(),
      Forma.proposal.getId(),
    ]);
    const proposal = await Forma.proposal.get({ proposalId });

    return {
      projectId: project.hubId,
      projectName: project.name,
      siteId: "",
      siteName: "Awaiting Forma Site Limit",
      location: geoLocation ? `${geoLocation[0].toFixed(4)}, ${geoLocation[1].toFixed(4)}` : project.timezone,
      countryCode: project.countryCode.toUpperCase(),
      timezone: project.timezone,
      areaSqFt: 0,
      areaAcres: 0,
      selectedProposal: proposal.properties?.name ?? proposalId,
      selectedSiteLimit: "Not selected",
    };
  }

  async readSiteLimit(elementPath: string): Promise<SiteGeometry> {
    if (appConfig.mockMode) {
      await delay(520);
      return mockSiteContext.geometry!;
    }

    const Forma = await getFormaClient();
    const [{ element }, siteLimitPaths, project, footprint, triangles] = await Promise.all([
      Forma.elements.getByPath({ path: elementPath }),
      Forma.geometry.getPathsByCategory({ category: "site_limit" }),
      Forma.project.get(),
      Forma.geometry.getFootprint({ path: elementPath }),
      Forma.geometry.getTriangles({ path: elementPath }).catch(() => new Float32Array()),
    ]);
    const isSiteLimit = siteLimitPaths.includes(elementPath) || element.properties?.category === "site_limit";
    if (!isSiteLimit) throw new Error("That selection is not a Forma Site Limit. Click a Site Limit in the canvas.");
    if (!footprint) throw new Error("Selected Site Limit has no readable polygon geometry.");
    return footprintToGeometry(elementPath, footprint, project, triangles);
  }

  async subscribeToSelection(callback: (paths: string[]) => void): Promise<void> {
    if (appConfig.mockMode) return;
    this.selectionCallback = callback;
    this.selectionSubscriptionPromise ??= getFormaClient()
      .then((Forma) => Forma.selection.subscribe(({ paths }) => this.selectionCallback?.(paths)))
      .then(() => undefined);
    await this.selectionSubscriptionPromise;
  }

  async getSelectedPaths(): Promise<string[]> {
    if (appConfig.mockMode) return [mockSiteContext.geometry!.elementPath];
    const Forma = await getFormaClient();
    return Forma.selection.getSelection();
  }

  async highlightElement(elementPath: string): Promise<void> {
    if (appConfig.mockMode) {
      await delay(260);
      return;
    }
    const Forma = await getFormaClient();
    await Forma.render.elementColors.clearAll();
    const pathsToColor = new Map<string, string>();
    pathsToColor.set(elementPath, "#2F80ED");
    await Forma.render.elementColors.set({ pathsToColor });
  }

  async clearHighlight(): Promise<void> {
    if (appConfig.mockMode) return;
    const Forma = await getFormaClient();
    await Forma.render.elementColors.clearAll();
  }
}

export const formaService = new FormaService();
