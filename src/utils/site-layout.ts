import type { ProgramPlan, SiteLayoutPlan, SiteLayoutZone } from "../types";
import { pointInPolygon, polygonBounds, type Point2D, type PolygonBounds } from "./geometry-validation.ts";

const FEET_PER_METER = 3.280839895;
const PARKING_AREA_SQM_PER_SPACE = 30;

interface LayoutInput {
  siteBoundary: Point2D[];
  buildingFootprint: Point2D[];
  programPlan: ProgramPlan;
}

interface RectCandidate {
  side: "south" | "east" | "west";
  bounds: PolygonBounds;
  area: number;
}

const rectPolygon = ({ minX, maxX, minY, maxY }: PolygonBounds): Point2D[] => [
  [minX, minY],
  [maxX, minY],
  [maxX, maxY],
  [minX, maxY],
  [minX, minY],
];

const rectArea = (value: PolygonBounds) => Math.max(0, value.maxX - value.minX) * Math.max(0, value.maxY - value.minY);

function rectangleInside(bounds: PolygonBounds, boundary: Point2D[]): boolean {
  if (rectArea(bounds) <= 1) return false;
  const corners = rectPolygon(bounds).slice(0, -1);
  const center: Point2D = [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];
  return [...corners, center].every((point) => pointInPolygon(point, boundary, 0.35));
}

function shrinkToSite(candidate: PolygonBounds, boundary: Point2D[]): PolygonBounds | undefined {
  let current = { ...candidate };
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (rectangleInside(current, boundary)) return current;
    const centerX = (current.minX + current.maxX) / 2;
    const centerY = (current.minY + current.maxY) / 2;
    const halfWidth = (current.maxX - current.minX) * 0.44;
    const halfHeight = (current.maxY - current.minY) * 0.44;
    current = { minX: centerX - halfWidth, maxX: centerX + halfWidth, minY: centerY - halfHeight, maxY: centerY + halfHeight };
  }
  return undefined;
}

function makeNorthBand(
  site: PolygonBounds,
  building: PolygonBounds,
  boundary: Point2D[],
  requestedDepthMeters: number,
  gapMeters: number,
): { bounds?: PolygonBounds; constrained: boolean } {
  const availableDepth = Math.max(0, site.maxY - 2 - (building.maxY + gapMeters));
  const depth = Math.min(requestedDepthMeters, availableDepth);
  const candidate: PolygonBounds = {
    minX: Math.max(site.minX + 2, building.minX),
    maxX: Math.min(site.maxX - 2, building.maxX),
    minY: building.maxY + gapMeters,
    maxY: building.maxY + gapMeters + depth,
  };
  const fitted = shrinkToSite(candidate, boundary);
  return { bounds: fitted, constrained: !fitted || depth + 0.5 < requestedDepthMeters };
}

function parkingCandidates(site: PolygonBounds, building: PolygonBounds, desiredArea: number): RectCandidate[] {
  const margin = 3;
  const gap = 4;
  const results: RectCandidate[] = [];

  const southWidth = Math.max(0, site.maxX - site.minX - margin * 2);
  const southAvailableDepth = Math.max(0, building.minY - gap - (site.minY + margin));
  if (southWidth > 0 && southAvailableDepth > 0) {
    const depth = Math.min(southAvailableDepth, desiredArea / southWidth);
    const bounds = { minX: site.minX + margin, maxX: site.maxX - margin, minY: building.minY - gap - depth, maxY: building.minY - gap };
    results.push({ side: "south", bounds, area: rectArea(bounds) });
  }

  const sideHeight = Math.max(0, building.maxY - building.minY);
  const eastAvailableWidth = Math.max(0, site.maxX - margin - (building.maxX + gap));
  if (sideHeight > 0 && eastAvailableWidth > 0) {
    const width = Math.min(eastAvailableWidth, desiredArea / sideHeight);
    const bounds = { minX: building.maxX + gap, maxX: building.maxX + gap + width, minY: building.minY, maxY: building.maxY };
    results.push({ side: "east", bounds, area: rectArea(bounds) });
  }

  const westAvailableWidth = Math.max(0, building.minX - gap - (site.minX + margin));
  if (sideHeight > 0 && westAvailableWidth > 0) {
    const width = Math.min(westAvailableWidth, desiredArea / sideHeight);
    const bounds = { minX: building.minX - gap - width, maxX: building.minX - gap, minY: building.minY, maxY: building.maxY };
    results.push({ side: "west", bounds, area: rectArea(bounds) });
  }
  return results;
}

function centerOf(bounds: PolygonBounds): Point2D {
  return [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];
}

export function createSiteLayoutPlan({ siteBoundary, buildingFootprint, programPlan }: LayoutInput): SiteLayoutPlan {
  if (siteBoundary.length < 3) throw new Error("A Forma Site Limit boundary is required for the site layout overlay.");
  if (buildingFootprint.length < 3) throw new Error("A readable generated-building footprint is required for the site layout overlay.");

  const site = polygonBounds(siteBoundary);
  const building = polygonBounds(buildingFootprint);
  const zones: SiteLayoutZone[] = [{
    id: "open-site",
    kind: "open-space",
    label: "Unallocated landscape / future site area",
    polygon: siteBoundary,
    note: "The remaining parcel is intentionally uncommitted until civil, landscape, fire-access and utility requirements are connected.",
  }];

  const operationsDepth = programPlan.operations.outdoorZoneDepthFt / FEET_PER_METER;
  const operationsBand = makeNorthBand(site, building, siteBoundary, operationsDepth, 1.5);
  if (operationsBand.bounds) {
    zones.push({
      id: "operations-zone",
      kind: "operations",
      label: programPlan.operations.outdoorZoneLabel,
      polygon: rectPolygon(operationsBand.bounds),
      note: operationsBand.constrained
        ? `${programPlan.operations.outdoorZoneDepthFt} ft was requested as a concept assumption; the visible band is compressed by the current Site Limit and building placement.`
        : `${programPlan.operations.outdoorZoneDepthFt} ft concept depth shown along the north operations edge.`,
    });
  }

  const shelterDepth = programPlan.operations.shelteredBandDepthFt / FEET_PER_METER;
  const shelterBand = makeNorthBand(site, building, siteBoundary, shelterDepth, 0.35);
  if (shelterBand.bounds) {
    zones.push({
      id: "sheltered-edge",
      kind: "shelter",
      label: programPlan.operations.shelteredBandLabel,
      polygon: rectPolygon(shelterBand.bounds),
      note: `${programPlan.operations.shelteredBandDepthFt} ft preliminary sheltered-edge assumption.`,
    });
  }

  const parkingRequirement = programPlan.parking.requiredSpaces;
  const desiredParkingArea = Math.max(PARKING_AREA_SQM_PER_SPACE, parkingRequirement * PARKING_AREA_SQM_PER_SPACE);
  const parkingOptions = parkingCandidates(site, building, desiredParkingArea)
    .map((candidate) => {
      const fitted = shrinkToSite(candidate.bounds, siteBoundary);
      return fitted ? { ...candidate, bounds: fitted, area: rectArea(fitted) } : undefined;
    })
    .filter((candidate): candidate is RectCandidate => Boolean(candidate))
    .sort((first, second) => Math.abs(desiredParkingArea - first.area) - Math.abs(desiredParkingArea - second.area));
  const parking = parkingRequirement > 0 ? parkingOptions[0] : undefined;
  const parkingConceptCapacity = parking ? Math.max(0, Math.floor(parking.area / PARKING_AREA_SQM_PER_SPACE)) : 0;
  if (parking) {
    zones.push({
      id: "parking-zone",
      kind: "parking",
      label: `${parkingRequirement}-space parking requirement`,
      polygon: rectPolygon(parking.bounds),
      note: `${parking.side} concept zone; approximately ${parkingConceptCapacity} spaces at a planning allowance of ${PARKING_AREA_SQM_PER_SPACE} m² per space including circulation.`,
    });
  }

  const northMost = siteBoundary.reduce((selected, point) => point[1] > selected[1] ? point : selected, siteBoundary[0]);
  const destination = operationsBand.bounds
    ? centerOf(operationsBand.bounds)
    : [(building.minX + building.maxX) / 2, building.maxY] as Point2D;
  const parkingStatus = parkingRequirement <= 0
    ? "not-specified"
    : parkingConceptCapacity >= parkingRequirement
      ? "resolved-concept"
      : "space-constrained";

  return {
    schemaVersion: "sitemorph.site-layout.v1",
    status: "preliminary",
    typology: programPlan.typology,
    typologyLabel: programPlan.typologyLabel,
    siteBoundary,
    buildingFootprint,
    zones,
    accessRoute: [northMost, [northMost[0], destination[1]], destination],
    accessLabel: programPlan.access.preferredRoad,
    parkingRequirement,
    parkingConceptCapacity,
    parkingStatus,
    operationsStatus: operationsBand.constrained ? "space-constrained" : "resolved-concept",
    assumptions: [
      "North is the current SiteMorph concept access edge; confirm it against the selected road and survey.",
      "Parking uses a 30 m²/space planning allowance including circulation, not a code-compliant stall layout.",
      "The native Forma floor stack remains the analysis and Revit-transfer geometry; colored site zones are an explanatory terrain overlay.",
    ],
    disclaimer: "Preliminary AI-assisted constraint layout only. Verify setbacks, zoning, emergency access, parking code, grading, drainage, utilities, structure and civil geometry before design use.",
  };
}
