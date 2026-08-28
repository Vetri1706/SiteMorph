import type { SiteGeometry, SiteLayoutPlan, SiteLayoutZone } from "../types";
import { polygonBounds } from "../utils/geometry-validation";
import { getFormaClient } from "./forma.service";

const DESIGN_TEXTURE_NAME = "sitemorph-site-layout-v1";

interface CanvasMapper {
  x(value: number): number;
  y(value: number): number;
  metersPerPixel: number;
}

const zoneStyle: Record<SiteLayoutZone["kind"], { fill: string; stroke: string }> = {
  "open-space": { fill: "rgba(38, 166, 134, 0.12)", stroke: "rgba(38, 166, 134, 0.7)" },
  parking: { fill: "rgba(42, 139, 214, 0.58)", stroke: "rgba(15, 69, 112, 0.95)" },
  operations: { fill: "rgba(242, 167, 43, 0.58)", stroke: "rgba(150, 83, 5, 0.95)" },
  shelter: { fill: "rgba(44, 203, 183, 0.75)", stroke: "rgba(7, 91, 84, 0.98)" },
};

function pathPolygon(context: CanvasRenderingContext2D, points: Array<[number, number]>, mapper: CanvasMapper): void {
  context.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) context.moveTo(mapper.x(x), mapper.y(y));
    else context.lineTo(mapper.x(x), mapper.y(y));
  });
  context.closePath();
}

function polygonCenter(points: Array<[number, number]>): [number, number] {
  const bounds = polygonBounds(points);
  return [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];
}

function drawLabel(context: CanvasRenderingContext2D, label: string, point: [number, number], mapper: CanvasMapper): void {
  const x = mapper.x(point[0]);
  const y = mapper.y(point[1]);
  const size = Math.max(11, Math.min(18, 4 / mapper.metersPerPixel));
  context.save();
  context.font = `600 ${size}px Arial, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  const width = context.measureText(label).width + 12;
  context.fillStyle = "rgba(10, 31, 48, 0.82)";
  context.fillRect(x - width / 2, y - size, width, size * 2);
  context.fillStyle = "#ffffff";
  context.fillText(label, x, y);
  context.restore();
}

function drawParkingStripes(context: CanvasRenderingContext2D, zone: SiteLayoutZone, mapper: CanvasMapper, spaces: number): void {
  const bounds = polygonBounds(zone.polygon);
  const horizontal = bounds.maxX - bounds.minX >= bounds.maxY - bounds.minY;
  const stripes = Math.max(2, Math.min(30, spaces));
  context.save();
  pathPolygon(context, zone.polygon, mapper);
  context.clip();
  context.strokeStyle = "rgba(255,255,255,0.82)";
  context.lineWidth = 1;
  for (let index = 1; index < stripes; index += 1) {
    const ratio = index / stripes;
    context.beginPath();
    if (horizontal) {
      const x = bounds.minX + (bounds.maxX - bounds.minX) * ratio;
      context.moveTo(mapper.x(x), mapper.y(bounds.minY));
      context.lineTo(mapper.x(x), mapper.y(bounds.maxY));
    } else {
      const y = bounds.minY + (bounds.maxY - bounds.minY) * ratio;
      context.moveTo(mapper.x(bounds.minX), mapper.y(y));
      context.lineTo(mapper.x(bounds.maxX), mapper.y(y));
    }
    context.stroke();
  }
  context.restore();
}

function buildCanvas(plan: SiteLayoutPlan): { canvas: HTMLCanvasElement; position: { x: number; y: number; z: number }; scale: { x: number; y: number } } {
  const bounds = polygonBounds(plan.siteBoundary);
  const metersPerPixel = Math.max(0.2, Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 1024);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / metersPerPixel));
  canvas.height = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) / metersPerPixel));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas rendering is unavailable for the SiteMorph site layout overlay.");
  const mapper: CanvasMapper = {
    x: (value) => (value - bounds.minX) / metersPerPixel,
    y: (value) => (bounds.maxY - value) / metersPerPixel,
    metersPerPixel,
  };
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  pathPolygon(context, plan.siteBoundary, mapper);
  context.clip();

  for (const zone of plan.zones) {
    const style = zoneStyle[zone.kind];
    pathPolygon(context, zone.polygon, mapper);
    context.fillStyle = style.fill;
    context.fill();
    context.lineWidth = zone.kind === "open-space" ? 2 : 3;
    context.strokeStyle = style.stroke;
    context.stroke();
    if (zone.kind === "parking") drawParkingStripes(context, zone, mapper, plan.parkingRequirement);
  }

  if (plan.accessRoute.length >= 2) {
    context.beginPath();
    plan.accessRoute.forEach(([x, y], index) => {
      if (index === 0) context.moveTo(mapper.x(x), mapper.y(y));
      else context.lineTo(mapper.x(x), mapper.y(y));
    });
    context.strokeStyle = "rgba(8, 207, 226, 0.9)";
    context.lineWidth = Math.max(5, 7 / metersPerPixel);
    context.setLineDash([14, 8]);
    context.stroke();
    context.setLineDash([]);
  }

  pathPolygon(context, plan.buildingFootprint, mapper);
  context.fillStyle = "rgba(8, 29, 46, 0.22)";
  context.fill();
  context.strokeStyle = "rgba(8, 29, 46, 0.98)";
  context.lineWidth = 4;
  context.stroke();
  context.restore();

  for (const zone of plan.zones.filter((item) => item.kind !== "open-space")) {
    drawLabel(context, zone.label, polygonCenter(zone.polygon), mapper);
  }
  drawLabel(context, `${plan.typologyLabel} mass`, polygonCenter(plan.buildingFootprint), mapper);

  return {
    canvas,
    position: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2, z: 220 },
    scale: { x: metersPerPixel, y: metersPerPixel },
  };
}

export async function renderSiteLayoutOverlay(
  Forma: Awaited<ReturnType<typeof getFormaClient>>,
  geometry: SiteGeometry,
  plan: SiteLayoutPlan,
): Promise<void> {
  if (!geometry.localBoundary?.length) throw new Error("The Forma Site Limit boundary is unavailable for site-overlay placement.");
  const texture = buildCanvas(plan);
  await Forma.terrain.groundTexture.remove({ name: DESIGN_TEXTURE_NAME }).catch(() => undefined);
  await Forma.terrain.groundTexture.add({
    name: DESIGN_TEXTURE_NAME,
    canvas: texture.canvas,
    position: texture.position,
    scale: texture.scale,
  });
}

export async function clearSiteLayoutOverlay(): Promise<void> {
  const Forma = await getFormaClient();
  await Forma.terrain.groundTexture.remove({ name: DESIGN_TEXTURE_NAME }).catch(() => undefined);
}
