import type { SiteGeometry } from "../types";
import type {
  SubdivisionOpenSpace,
  SubdivisionPoint,
  SubdivisionRoad,
  SubdivisionVariant,
} from "../types/subdivision";
import { pointInPolygon, polygonBounds } from "../utils/geometry-validation.ts";

export const SUBDIVISION_TEXTURE_NAME = "sitemorph-subdivision-concept-v1";

const TARGET_MAX_PIXELS = 1280;
const MIN_METERS_PER_PIXEL = 0.12;

const COLORS = {
  access: "#2E9EFF",
  boundary: "#2E9EFF",
  dwellingFill: "rgba(255, 255, 255, 0.88)",
  dwellingStroke: "rgba(10, 31, 48, 0.92)",
  heatReliefFill: "rgba(83, 194, 116, 0.55)",
  heatReliefStroke: "rgba(19, 112, 78, 0.96)",
  labelFill: "rgba(10, 31, 48, 0.90)",
  lotFillA: "rgba(181, 222, 171, 0.34)",
  lotFillB: "rgba(218, 239, 203, 0.34)",
  lotStroke: "rgba(37, 107, 80, 0.72)",
  navy: "#0A1F30",
  openSpaceFill: "rgba(118, 186, 90, 0.43)",
  openSpaceStroke: "rgba(54, 126, 64, 0.94)",
  parking: "#68C4FF",
  pathFill: "rgba(46, 158, 255, 0.38)",
  pathStroke: "rgba(12, 121, 216, 0.96)",
  roadFill: "rgba(10, 31, 48, 0.72)",
  roadStroke: "rgba(255, 255, 255, 0.74)",
  siteFill: "rgba(232, 244, 239, 0.24)",
  teal: "#22B8AE",
  treeFill: "rgba(89, 166, 67, 0.55)",
  treeStroke: "rgba(31, 98, 52, 0.98)",
  white: "#FFFFFF",
} as const;

interface CanvasMapper {
  x(value: number): number;
  y(value: number): number;
  length(value: number): number;
  metersPerPixel: number;
}

export interface SubdivisionOverlayTexture {
  canvas: HTMLCanvasElement;
  position: { x: number; y: number; z: number };
  scale: { x: number; y: number };
}

export interface SubdivisionOverlaySpec {
  width: number;
  height: number;
  metersPerPixel: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  accessPoint: SubdivisionPoint | null;
  northAnchor: SubdivisionPoint;
  parkingProvision: number;
}

export type SubdivisionOverlayMode = "full-preview" | "annotations-only";

function validPoints(points: SubdivisionPoint[] | undefined): SubdivisionPoint[] {
  return (points ?? []).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
}

function polygonCenter(points: SubdivisionPoint[]): SubdivisionPoint {
  const open = points.length > 1
    && points[0][0] === points.at(-1)![0]
    && points[0][1] === points.at(-1)![1]
    ? points.slice(0, -1)
    : points;
  if (!open.length) return [0, 0];
  let twiceArea = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (let index = 0; index < open.length; index += 1) {
    const [x0, y0] = open[index];
    const [x1, y1] = open[(index + 1) % open.length];
    const cross = x0 * y1 - x1 * y0;
    twiceArea += cross;
    weightedX += (x0 + x1) * cross;
    weightedY += (y0 + y1) * cross;
  }
  if (Math.abs(twiceArea) < 1e-8) {
    return [
      open.reduce((sum, [x]) => sum + x, 0) / open.length,
      open.reduce((sum, [, y]) => sum + y, 0) / open.length,
    ];
  }
  return [weightedX / (3 * twiceArea), weightedY / (3 * twiceArea)];
}

function nearestBoundaryDistance(point: SubdivisionPoint, boundary: SubdivisionPoint[]): number {
  let closest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < boundary.length; index += 1) {
    const start = boundary[index];
    const end = boundary[(index + 1) % boundary.length];
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const lengthSquared = dx * dx + dy * dy;
    const ratio = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
    const projected: SubdivisionPoint = [start[0] + dx * ratio, start[1] + dy * ratio];
    closest = Math.min(closest, Math.hypot(point[0] - projected[0], point[1] - projected[1]));
  }
  return closest;
}

function accessPointFor(variant: SubdivisionVariant, boundary: SubdivisionPoint[]): SubdivisionPoint | null {
  const accessRoads = variant.roads.filter((road) => road.kind === "access-road");
  const endpoints = accessRoads.flatMap((road) => {
    const line = validPoints(road.centerline);
    return line.length ? [line[0], line.at(-1)!] : [];
  });
  if (!endpoints.length) return null;
  return [...endpoints].sort((first, second) => nearestBoundaryDistance(first, boundary) - nearestBoundaryDistance(second, boundary))[0];
}

function insetAnchor(boundary: SubdivisionPoint[], target: SubdivisionPoint): SubdivisionPoint {
  const center = polygonCenter(boundary);
  if (!pointInPolygon(center, boundary, 0.01)) {
    const bounds = polygonBounds(boundary);
    center[0] = (bounds.minX + bounds.maxX) / 2;
    center[1] = (bounds.minY + bounds.maxY) / 2;
  }
  for (let ratio = 0.7; ratio >= 0; ratio -= 0.1) {
    const candidate: SubdivisionPoint = [
      center[0] + (target[0] - center[0]) * ratio,
      center[1] + (target[1] - center[1]) * ratio,
    ];
    if (pointInPolygon(candidate, boundary, 0.1)) return candidate;
  }
  return center;
}

/** Pure geometry/canvas specification used by the renderer and focused tests. */
export function createSubdivisionOverlaySpec(
  geometry: SiteGeometry,
  variant: SubdivisionVariant,
): SubdivisionOverlaySpec {
  const boundary = validPoints(geometry.localBoundary);
  if (boundary.length < 3) throw new Error("The Forma Site Limit boundary is unavailable for the subdivision overlay.");
  const bounds = polygonBounds(boundary);
  const extentX = bounds.maxX - bounds.minX;
  const extentY = bounds.maxY - bounds.minY;
  if (!(extentX > 0) || !(extentY > 0)) throw new Error("The selected Forma Site Limit has no renderable area.");
  const metersPerPixel = Math.max(MIN_METERS_PER_PIXEL, Math.max(extentX, extentY) / TARGET_MAX_PIXELS);
  return {
    ...bounds,
    width: Math.max(1, Math.ceil(extentX / metersPerPixel)),
    height: Math.max(1, Math.ceil(extentY / metersPerPixel)),
    metersPerPixel,
    accessPoint: accessPointFor(variant, boundary),
    northAnchor: insetAnchor(boundary, [bounds.maxX, bounds.maxY]),
    parkingProvision: Math.max(0, Math.round(variant.metrics.parkingProvision)),
  };
}

function pathPolygon(context: CanvasRenderingContext2D, points: SubdivisionPoint[], mapper: CanvasMapper): boolean {
  const polygon = validPoints(points);
  if (polygon.length < 3) return false;
  context.beginPath();
  polygon.forEach(([x, y], index) => {
    if (index === 0) context.moveTo(mapper.x(x), mapper.y(y));
    else context.lineTo(mapper.x(x), mapper.y(y));
  });
  context.closePath();
  return true;
}

function strokePolygon(
  context: CanvasRenderingContext2D,
  points: SubdivisionPoint[],
  mapper: CanvasMapper,
  fill: string,
  stroke: string,
  lineWidth: number,
): void {
  if (!pathPolygon(context, points, mapper)) return;
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = stroke;
  context.lineWidth = lineWidth;
  context.stroke();
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const resolved = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + resolved, y);
  context.lineTo(x + width - resolved, y);
  context.quadraticCurveTo(x + width, y, x + width, y + resolved);
  context.lineTo(x + width, y + height - resolved);
  context.quadraticCurveTo(x + width, y + height, x + width - resolved, y + height);
  context.lineTo(x + resolved, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - resolved);
  context.lineTo(x, y + resolved);
  context.quadraticCurveTo(x, y, x + resolved, y);
  context.closePath();
}

function drawBadge(
  context: CanvasRenderingContext2D,
  label: string,
  point: SubdivisionPoint,
  mapper: CanvasMapper,
  options: { fill?: string; text?: string; size?: number; align?: CanvasTextAlign } = {},
): void {
  const size = options.size ?? Math.max(10, Math.min(15, mapper.length(2.2)));
  const x = mapper.x(point[0]);
  const y = mapper.y(point[1]);
  context.save();
  context.font = `700 ${size}px Arial, sans-serif`;
  context.textAlign = options.align ?? "center";
  context.textBaseline = "middle";
  const padding = 6;
  const width = context.measureText(label).width + padding * 2;
  const left = context.textAlign === "left" ? x : context.textAlign === "right" ? x - width : x - width / 2;
  roundedRect(context, left, y - size, width, size * 2, 4);
  context.fillStyle = options.fill ?? COLORS.labelFill;
  context.fill();
  context.fillStyle = options.text ?? COLORS.white;
  context.fillText(label, x, y);
  context.restore();
}

function drawRoad(context: CanvasRenderingContext2D, road: SubdivisionRoad, mapper: CanvasMapper): void {
  const pedestrian = road.kind === "pedestrian-path";
  strokePolygon(
    context,
    road.polygon,
    mapper,
    pedestrian ? COLORS.pathFill : COLORS.roadFill,
    pedestrian ? COLORS.pathStroke : COLORS.roadStroke,
    pedestrian ? 1.5 : 2.5,
  );
  const centerline = validPoints(road.centerline);
  if (centerline.length < 2) return;
  context.beginPath();
  centerline.forEach(([x, y], index) => {
    if (index === 0) context.moveTo(mapper.x(x), mapper.y(y));
    else context.lineTo(mapper.x(x), mapper.y(y));
  });
  context.strokeStyle = pedestrian ? COLORS.white : "rgba(255, 255, 255, 0.84)";
  context.lineWidth = pedestrian ? 1.3 : 1.5;
  context.setLineDash(pedestrian ? [5, 4] : [12, 8]);
  context.stroke();
  context.setLineDash([]);
}

function drawOpenSpace(context: CanvasRenderingContext2D, space: SubdivisionOpenSpace, mapper: CanvasMapper): void {
  const heatRelief = space.kind === "heat-relief-corridor";
  strokePolygon(
    context,
    space.polygon,
    mapper,
    heatRelief ? COLORS.heatReliefFill : COLORS.openSpaceFill,
    heatRelief ? COLORS.heatReliefStroke : COLORS.openSpaceStroke,
    heatRelief ? 3 : 2,
  );
  const center = polygonCenter(space.polygon);
  drawBadge(context, heatRelief ? "SHADED HEAT-RELIEF" : "SHARED GREEN", center, mapper, {
    fill: heatRelief ? "rgba(19, 112, 78, 0.92)" : "rgba(54, 126, 64, 0.90)",
    size: Math.max(9, Math.min(13, mapper.length(1.8))),
  });
}

function drawTrees(context: CanvasRenderingContext2D, variant: SubdivisionVariant, mapper: CanvasMapper): void {
  for (const tree of variant.trees) {
    if (!Number.isFinite(tree.point[0]) || !Number.isFinite(tree.point[1])) continue;
    const radius = Math.max(3, mapper.length(Math.max(1, tree.canopyDiameterMeters / 2)));
    context.beginPath();
    context.arc(mapper.x(tree.point[0]), mapper.y(tree.point[1]), radius, 0, Math.PI * 2);
    context.fillStyle = COLORS.treeFill;
    context.fill();
    context.strokeStyle = COLORS.treeStroke;
    context.lineWidth = 1.5;
    context.stroke();
    context.beginPath();
    context.arc(mapper.x(tree.point[0]), mapper.y(tree.point[1]), Math.max(1.3, radius * 0.16), 0, Math.PI * 2);
    context.fillStyle = COLORS.treeStroke;
    context.fill();
  }
}

function drawNorthMarker(context: CanvasRenderingContext2D, anchor: SubdivisionPoint, mapper: CanvasMapper): void {
  const x = mapper.x(anchor[0]);
  const y = mapper.y(anchor[1]);
  const length = Math.max(25, Math.min(48, mapper.length(8)));
  context.save();
  context.strokeStyle = COLORS.navy;
  context.fillStyle = COLORS.navy;
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(x, y + length * 0.45);
  context.lineTo(x, y - length * 0.45);
  context.stroke();
  context.beginPath();
  context.moveTo(x, y - length * 0.62);
  context.lineTo(x - length * 0.16, y - length * 0.32);
  context.lineTo(x + length * 0.16, y - length * 0.32);
  context.closePath();
  context.fill();
  context.font = `800 ${Math.max(12, length * 0.32)}px Arial, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "bottom";
  context.fillText("N", x, y - length * 0.65);
  context.restore();
}

function drawAccessMarker(context: CanvasRenderingContext2D, point: SubdivisionPoint, mapper: CanvasMapper): void {
  const x = mapper.x(point[0]);
  const y = mapper.y(point[1]);
  const radius = Math.max(7, Math.min(11, mapper.length(1.8)));
  context.save();
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = COLORS.access;
  context.fill();
  context.strokeStyle = COLORS.white;
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = COLORS.white;
  context.font = `800 ${Math.max(10, radius)}px Arial, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("A", x, y);
  context.restore();
  const labelPoint: SubdivisionPoint = [point[0] + Math.max(2.5, mapper.metersPerPixel * 18), point[1]];
  drawBadge(context, "CONCEPT ACCESS", labelPoint, mapper, { fill: "rgba(12, 121, 216, 0.92)", align: "left", size: 10 });
}

function buildCanvas(
  geometry: SiteGeometry,
  variant: SubdivisionVariant,
  mode: SubdivisionOverlayMode = "full-preview",
): SubdivisionOverlayTexture {
  const boundary = validPoints(geometry.localBoundary);
  const spec = createSubdivisionOverlaySpec(geometry, variant);
  const canvas = document.createElement("canvas");
  canvas.width = spec.width;
  canvas.height = spec.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas rendering is unavailable for the SiteMorph subdivision overlay.");
  const mapper: CanvasMapper = {
    x: (value) => (value - spec.minX) / spec.metersPerPixel,
    y: (value) => (spec.maxY - value) / spec.metersPerPixel,
    length: (value) => value / spec.metersPerPixel,
    metersPerPixel: spec.metersPerPixel,
  };
  context.clearRect(0, 0, canvas.width, canvas.height);

  // Everything is clipped to the real Forma Site Limit. The full raster is a
  // pre-build preview; once proposal-backed context exists, only transient
  // labels are rendered here so refresh-safe roads and trees remain authoritative.
  context.save();
  if (!pathPolygon(context, boundary, mapper)) throw new Error("The Forma Site Limit boundary cannot be rendered.");
  context.clip();
  if (mode === "full-preview") {
    context.fillStyle = COLORS.siteFill;
    context.fillRect(0, 0, canvas.width, canvas.height);

    variant.openSpaces.forEach((space) => drawOpenSpace(context, space, mapper));
    variant.lots.forEach((lot, index) => {
      strokePolygon(context, lot.polygon, mapper, index % 2 === 0 ? COLORS.lotFillA : COLORS.lotFillB, COLORS.lotStroke, 1.25);
    });
    variant.roads.forEach((road) => drawRoad(context, road, mapper));
    variant.dwellings.forEach((dwelling) => {
      strokePolygon(context, dwelling.footprint, mapper, COLORS.dwellingFill, COLORS.dwellingStroke, 1.8);
    });
    drawTrees(context, variant, mapper);
  }

  const lotLabelStep = Math.max(1, Math.ceil(variant.lots.length / 24));
  variant.lots.forEach((lot, index) => {
    if (index % lotLabelStep !== 0) return;
    const compactId = lot.id.replace(/^lot-/, "").toUpperCase();
    drawBadge(context, compactId, polygonCenter(lot.polygon), mapper, {
      fill: "rgba(10, 31, 48, 0.72)",
      size: Math.max(8, Math.min(10, mapper.length(1.4))),
    });
  });

  const accessRoad = variant.roads.find((road) => road.kind === "access-road");
  if (accessRoad?.centerline.length) {
    drawBadge(context, "PRELIMINARY INTERNAL ROAD", polygonCenter(accessRoad.centerline), mapper, { size: 10 });
  }
  if (spec.parkingProvision > 0) {
    const parkingAnchor = accessRoad?.centerline.length
      ? polygonCenter(accessRoad.centerline)
      : polygonCenter(boundary);
    const shifted: SubdivisionPoint = [parkingAnchor[0], parkingAnchor[1] - Math.max(2, 16 * spec.metersPerPixel)];
    drawBadge(context, `P ${spec.parkingProvision} CONCEPT SPACES`, shifted, mapper, {
      fill: "rgba(12, 121, 216, 0.90)",
      text: COLORS.white,
      size: 10,
    });
  }
  if (spec.accessPoint) drawAccessMarker(context, spec.accessPoint, mapper);
  drawNorthMarker(context, spec.northAnchor, mapper);
  if (Number.isFinite(variant.climatePerformance.residualHeatRiskScore)) {
    const climateAnchor = insetAnchor(boundary, [spec.minX, spec.maxY]);
    drawBadge(
      context,
      `FORTYGUARD × PLAN · RESIDUAL HEAT RISK ${variant.climatePerformance.residualHeatRiskScore.toFixed(1)}`,
      climateAnchor,
      mapper,
      { fill: "rgba(19, 112, 78, 0.94)", size: Math.max(9, Math.min(12, mapper.length(1.7))) },
    );
  }
  const disclaimerAnchor = insetAnchor(boundary, [spec.minX, spec.minY]);
  drawBadge(context, "PRELIMINARY LOTS / ROADS / TREES · NOT SURVEYED OR CODE-VERIFIED", disclaimerAnchor, mapper, {
    fill: COLORS.labelFill,
    size: Math.max(9, Math.min(12, mapper.length(1.7))),
  });
  context.restore();

  // Re-emphasize the exact selected boundary after drawing, without expanding
  // content beyond it. The complete selected Site Limit is the texture mask.
  context.save();
  if (pathPolygon(context, boundary, mapper)) {
    context.clip();
    context.strokeStyle = COLORS.boundary;
    context.lineWidth = 3;
    context.stroke();
  }
  context.restore();

  return {
    canvas,
    position: {
      x: (spec.minX + spec.maxX) / 2,
      y: (spec.minY + spec.maxY) / 2,
      z: geometry.overlayElevation ?? 100,
    },
    scale: { x: spec.metersPerPixel, y: spec.metersPerPixel },
  };
}

export class FormaSubdivisionOverlayService {
  async render(
    geometry: SiteGeometry,
    selectedVariant: SubdivisionVariant,
    mode: SubdivisionOverlayMode = "full-preview",
  ): Promise<void> {
    const { getFormaClient } = await import("./forma.service.ts");
    const Forma = await getFormaClient();
    const texture = buildCanvas(geometry, selectedVariant, mode);
    await Forma.terrain.groundTexture.remove({ name: SUBDIVISION_TEXTURE_NAME }).catch(() => undefined);
    await Forma.terrain.groundTexture.add({
      name: SUBDIVISION_TEXTURE_NAME,
      canvas: texture.canvas,
      position: texture.position,
      scale: texture.scale,
    });
  }

  async clear(): Promise<void> {
    const { getFormaClient } = await import("./forma.service.ts");
    const Forma = await getFormaClient();
    await Forma.terrain.groundTexture.remove({ name: SUBDIVISION_TEXTURE_NAME }).catch(() => undefined);
  }
}

export const formaSubdivisionOverlayService = new FormaSubdivisionOverlayService();

export async function renderSubdivisionOverlay(geometry: SiteGeometry, selectedVariant: SubdivisionVariant): Promise<void> {
  await formaSubdivisionOverlayService.render(geometry, selectedVariant);
}

export async function clearSubdivisionOverlay(): Promise<void> {
  await formaSubdivisionOverlayService.clear();
}
