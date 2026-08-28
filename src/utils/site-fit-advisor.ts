import type {
  BuildingTypology,
  ClimateDNA,
  DesignBrief,
  ProgramArea,
  SiteFitAssessment,
  SiteFitOption,
  SiteGeometry,
} from "../types";
import { polygonBounds } from "./geometry-validation.ts";

const SQFT_PER_ACRE = 43_560;
const PARKING_SQFT_PER_SPACE = 325;

interface UseTemplate {
  id: string;
  typology: BuildingTypology;
  label: string;
  buildingType(siteAcres: number): string;
  minimumSiteAcres: number;
  idealSiteAcres: number;
  targetCoverage: number;
  siteReserve: number;
  operationsShare: number;
  parkingPerThousandSqFt: number;
  floorCount(siteAcres: number): number;
  grossFloorMultiplier?: number;
  floorHeightFt: number;
  heatSensitivity: number;
  bays(footprintSqFt: number): number;
  program: Array<{ name: string; ratio: number }>;
}

const templates: UseTemplate[] = [
  {
    id: "logistics",
    typology: "logistics",
    label: "Logistics / distribution",
    buildingType: () => "Climate-Controlled Logistics / Distribution Facility",
    minimumSiteAcres: 3.5,
    idealSiteAcres: 7,
    targetCoverage: 0.42,
    siteReserve: 0.12,
    operationsShare: 0.24,
    parkingPerThousandSqFt: 0.8,
    floorCount: () => 1,
    grossFloorMultiplier: 1.08,
    floorHeightFt: 40,
    heatSensitivity: 10,
    bays: (footprint) => Math.max(4, Math.min(24, Math.round(footprint / 8_000))),
    program: [
      { name: "Warehouse / Storage", ratio: 0.67 },
      { name: "Packing / Staging", ratio: 0.14 },
      { name: "Loading / Logistics", ratio: 0.11 },
      { name: "Office / Administration", ratio: 0.08 },
    ],
  },
  {
    id: "residential",
    typology: "residential",
    label: "Multifamily apartments",
    buildingType: () => "Climate-Responsive Multifamily Apartments",
    minimumSiteAcres: 1.25,
    idealSiteAcres: 3,
    targetCoverage: 0.28,
    siteReserve: 0.2,
    operationsShare: 0.08,
    parkingPerThousandSqFt: 1.35,
    floorCount: (acres) => acres >= 4 ? 5 : acres >= 2 ? 4 : 3,
    floorHeightFt: 12,
    heatSensitivity: 16,
    bays: () => 2,
    program: [
      { name: "Residential Units", ratio: 0.72 },
      { name: "Circulation / Cores", ratio: 0.14 },
      { name: "Resident Amenities", ratio: 0.08 },
      { name: "Building Services", ratio: 0.06 },
    ],
  },
  {
    id: "office",
    typology: "office",
    label: "Office / light R&D",
    buildingType: () => "Climate-Responsive Office / Light R&D Workplace",
    minimumSiteAcres: 0.75,
    idealSiteAcres: 2.5,
    targetCoverage: 0.26,
    siteReserve: 0.16,
    operationsShare: 0.06,
    parkingPerThousandSqFt: 2.8,
    floorCount: (acres) => acres >= 3 ? 4 : 3,
    floorHeightFt: 14,
    heatSensitivity: 12,
    bays: () => 2,
    program: [
      { name: "Workplace / Tenant Area", ratio: 0.58 },
      { name: "Meeting / Collaboration", ratio: 0.16 },
      { name: "Reception / Amenities", ratio: 0.14 },
      { name: "Circulation / Services", ratio: 0.12 },
    ],
  },
  {
    id: "healthcare",
    typology: "healthcare",
    label: "Healthcare",
    buildingType: (acres) => acres >= 5 ? "Hospital / Medical Campus" : "Outpatient Medical Center",
    minimumSiteAcres: 2.25,
    idealSiteAcres: 5,
    targetCoverage: 0.24,
    siteReserve: 0.18,
    operationsShare: 0.12,
    parkingPerThousandSqFt: 3.6,
    floorCount: (acres) => acres >= 5 ? 4 : 3,
    floorHeightFt: 15,
    heatSensitivity: 22,
    bays: () => 3,
    program: [
      { name: "Clinical Care", ratio: 0.4 },
      { name: "Diagnostics / Treatment", ratio: 0.24 },
      { name: "Public / Administration", ratio: 0.17 },
      { name: "Clinical Support / Services", ratio: 0.19 },
    ],
  },
  {
    id: "education",
    typology: "education",
    label: "Education / training campus",
    buildingType: () => "Climate-Responsive Education / Training Center",
    minimumSiteAcres: 3,
    idealSiteAcres: 6,
    targetCoverage: 0.22,
    siteReserve: 0.23,
    operationsShare: 0.14,
    parkingPerThousandSqFt: 1.9,
    floorCount: (acres) => acres >= 5 ? 3 : 2,
    floorHeightFt: 14,
    heatSensitivity: 19,
    bays: () => 3,
    program: [
      { name: "Classrooms / Learning", ratio: 0.45 },
      { name: "Shared Learning / Library", ratio: 0.2 },
      { name: "Assembly / Dining", ratio: 0.15 },
      { name: "Administration / Services", ratio: 0.2 },
    ],
  },
  {
    id: "hotel",
    typology: "hotel",
    label: "Hotel / extended stay",
    buildingType: () => "Climate-Responsive Hotel / Extended Stay",
    minimumSiteAcres: 1,
    idealSiteAcres: 2.5,
    targetCoverage: 0.25,
    siteReserve: 0.16,
    operationsShare: 0.08,
    parkingPerThousandSqFt: 1.45,
    floorCount: (acres) => acres >= 3 ? 6 : 5,
    floorHeightFt: 12,
    heatSensitivity: 15,
    bays: () => 3,
    program: [
      { name: "Guest Rooms / Accommodation", ratio: 0.62 },
      { name: "Lobby / Food and Beverage", ratio: 0.16 },
      { name: "Back of House", ratio: 0.12 },
      { name: "Circulation / Services", ratio: 0.1 },
    ],
  },
  {
    id: "retail",
    typology: "retail",
    label: "Neighborhood retail",
    buildingType: () => "Shaded Neighborhood Retail Center",
    minimumSiteAcres: 2,
    idealSiteAcres: 4,
    targetCoverage: 0.3,
    siteReserve: 0.14,
    operationsShare: 0.08,
    parkingPerThousandSqFt: 3.8,
    floorCount: () => 1,
    floorHeightFt: 22,
    heatSensitivity: 13,
    bays: (footprint) => Math.max(2, Math.min(8, Math.round(footprint / 15_000))),
    program: [
      { name: "Sales / Customer Area", ratio: 0.65 },
      { name: "Stock / Fulfillment", ratio: 0.16 },
      { name: "Customer Support / Circulation", ratio: 0.1 },
      { name: "Service / Utilities", ratio: 0.09 },
    ],
  },
  {
    id: "mixed-use",
    typology: "mixed-use",
    label: "Mixed-use residential / retail",
    buildingType: () => "Climate-Responsive Mixed-Use Residential / Retail",
    minimumSiteAcres: 1.5,
    idealSiteAcres: 3.5,
    targetCoverage: 0.3,
    siteReserve: 0.18,
    operationsShare: 0.08,
    parkingPerThousandSqFt: 2.15,
    floorCount: (acres) => acres >= 3 ? 5 : 4,
    floorHeightFt: 13,
    heatSensitivity: 16,
    bays: () => 3,
    program: [
      { name: "Residential Program", ratio: 0.52 },
      { name: "Ground-Floor Retail / Public Program", ratio: 0.2 },
      { name: "Shared Amenities / Circulation", ratio: 0.16 },
      { name: "Services / Cores", ratio: 0.12 },
    ],
  },
];

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));
const roundDown = (value: number, interval: number) => Math.max(interval, Math.floor(value / interval) * interval);

function allocateProgram(totalAreaSqFt: number, template: UseTemplate["program"]): ProgramArea[] {
  let allocated = 0;
  return template.map((item, index) => {
    const areaSqFt = index === template.length - 1
      ? Math.max(0, totalAreaSqFt - allocated)
      : Math.round(totalAreaSqFt * item.ratio / 100) * 100;
    allocated += areaSqFt;
    return { name: item.name, areaSqFt };
  });
}

function compactnessScore(geometry: SiteGeometry): number {
  if (!geometry.localBoundary?.length || !geometry.areaSqFt) return 70;
  const bounds = polygonBounds(geometry.localBoundary);
  const boundingAreaSqFt = Math.max(1, (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY) * 10.7639104167);
  return clamp(geometry.areaSqFt / boundingAreaSqFt * 100, 35, 100);
}

function createOption(
  template: UseTemplate,
  geometry: SiteGeometry,
  climate: ClimateDNA,
  siteAreaSqFt: number,
  siteAreaAcres: number,
  shapeScore: number,
): Omit<SiteFitOption, "rank"> {
  const floors = template.floorCount(siteAreaAcres);
  const grossMultiplier = template.grossFloorMultiplier ?? floors;
  const capacityForBuildingAndParking = siteAreaSqFt * Math.max(0.2, 1 - template.siteReserve - template.operationsShare);
  const parkingAreaPerFootprintSqFt = grossMultiplier * template.parkingPerThousandSqFt / 1_000 * PARKING_SQFT_PER_SPACE;
  const parkingLimitedFootprint = capacityForBuildingAndParking / Math.max(1, 1 + parkingAreaPerFootprintSqFt);
  const footprintSqFt = roundDown(Math.min(siteAreaSqFt * template.targetCoverage, parkingLimitedFootprint), 500);
  const totalAreaSqFt = roundDown(footprintSqFt * grossMultiplier, 500);
  const requiredParking = Math.max(1, Math.ceil(totalAreaSqFt / 1_000 * template.parkingPerThousandSqFt));
  const parkingLandPercent = requiredParking * PARKING_SQFT_PER_SPACE / siteAreaSqFt * 100;
  const siteCoveragePercent = footprintSqFt / siteAreaSqFt * 100;
  const areaFit = clamp(siteAreaAcres / template.minimumSiteAcres * 72, 20, 100);
  const idealFit = clamp(100 - Math.abs(siteAreaAcres - template.idealSiteAcres) / template.idealSiteAcres * 32, 48, 100);
  const thermalHigh = climate.profile.thermalExposure === "HIGH";
  const persistenceHigh = climate.profile.persistence === "HIGH";
  const heatPenalty = (thermalHigh ? template.heatSensitivity * 0.65 : 0) + (persistenceHigh ? template.heatSensitivity * 0.35 : 0);
  const parkingFit = clamp(100 - Math.max(0, parkingLandPercent - 32) * 2.2, 45, 100);
  const rawScore = areaFit * 0.3 + idealFit * 0.2 + parkingFit * 0.2 + shapeScore * 0.15 + (100 - heatPenalty) * 0.15;
  const score = Math.round(clamp(rawScore, 0, 100));
  const status = score >= 78 ? "strongest-fit" : score >= 62 ? "conditional" : "low-confidence";
  const heatReason = thermalHigh || persistenceHigh
    ? `${climate.profile.thermalExposure.toLowerCase()} exposure and ${climate.thermal.longestPersistenceHours} h maximum persistence require typology-specific cooling, shade and outdoor-safety measures.`
    : "Observed hot-season burden does not create an exceptional typology penalty in the current evidence window.";
  const areaReason = siteAreaAcres >= template.minimumSiteAcres
    ? `${siteAreaAcres.toFixed(2)} acres clears the advisor's ${template.minimumSiteAcres.toFixed(2)}-acre preliminary capacity threshold for this concept.`
    : `${siteAreaAcres.toFixed(2)} acres is below the advisor's ${template.minimumSiteAcres.toFixed(2)}-acre preliminary threshold; the concept is space-constrained.`;

  const brief: DesignBrief = {
    buildingType: template.buildingType(siteAreaAcres),
    totalAreaSqFt,
    program: allocateProgram(totalAreaSqFt, template.program),
    floors,
    targetFootprintSqFt: footprintSqFt,
    maximumHeightFt: Math.round(template.floorHeightFt * floors),
    requiredParking,
    loadingDocks: template.bays(footprintSqFt),
    preferredAccessRoad: "Confirm primary access edge from Forma context",
    priority: thermalHigh || persistenceHigh ? "Thermal Performance" : "Balanced",
  };

  const cautions = [
    "Zoning, permitted use, setbacks, utilities, market demand and entitlement feasibility are not connected.",
    parkingLandPercent > 32
      ? `The preliminary ${requiredParking}-space parking allowance consumes about ${parkingLandPercent.toFixed(0)}% of the parcel; structured/shared parking or lower area may be required.`
      : `The preliminary ${requiredParking}-space parking allowance still requires a civil layout and local-code verification.`,
  ];
  if (climate.designBrief.thermalZoningConfidence === "LOW") cautions.push("FortyGuard cannot reliably choose a preferred parcel sub-zone at its current resolution; use site-wide heat constraints and let Forma test placement.");
  if (template.typology === "healthcare") cautions.push("Critical-care resilience, emergency access, backup power and clinical regulations require specialist validation.");
  if (template.typology === "residential" || template.typology === "hotel") cautions.push("Unit/room count is intentionally not claimed until circulation, daylight, egress and parking geometry are resolved.");

  return {
    id: template.id,
    typology: template.typology,
    label: template.label,
    score,
    status,
    sizeSummary: `${totalAreaSqFt.toLocaleString()} ft² gross · ${footprintSqFt.toLocaleString()} ft² footprint · ${floors} ${floors === 1 ? "floor" : "floors"}`,
    estimatedSiteCoveragePercent: Number(siteCoveragePercent.toFixed(1)),
    estimatedParkingLandPercent: Number(parkingLandPercent.toFixed(1)),
    brief,
    reasons: [areaReason, heatReason, `${shapeScore.toFixed(0)}% parcel compactness supports the preliminary mass-and-circulation fit calculation.`],
    cautions,
  };
}

export function createSiteFitAssessment(geometry: SiteGeometry, climate: ClimateDNA): SiteFitAssessment {
  const siteAreaSqFt = Math.max(1, Math.round(geometry.areaSqFt ?? 0));
  const siteAreaAcres = geometry.areaAcres ?? siteAreaSqFt / SQFT_PER_ACRE;
  const shapeScore = compactnessScore(geometry);
  const options = templates
    .map((template) => createOption(template, geometry, climate, siteAreaSqFt, siteAreaAcres, shapeScore))
    .sort((first, second) => second.score - first.score || first.id.localeCompare(second.id))
    .map((option, index) => ({ ...option, rank: index + 1 }));

  return {
    schemaVersion: "sitemorph.site-fit.v1",
    source: "deterministic-constraint-engine",
    siteAreaSqFt,
    siteAreaAcres: Number(siteAreaAcres.toFixed(2)),
    evidenceSummary: [
      `${siteAreaSqFt.toLocaleString()} ft² selected Forma Site Limit`,
      `${climate.profile.thermalExposure} hot-season exposure · ${climate.thermal.longestPersistenceHours} h maximum continuous persistence`,
      `${climate.designBrief.thermalZoningConfidence} thermal-zoning confidence`,
      `${shapeScore.toFixed(0)}% parcel compactness from the selected boundary`,
    ],
    options,
    missingEvidence: ["Zoning and permitted land use", "Road/access engineering", "Utilities and servicing capacity", "Market and financial feasibility", "Local parking, fire and setback rules"],
    disclaimer: "Site Fit Advisor ranks preliminary physical and climate compatibility only. It does not determine highest-and-best use, legal feasibility, financial viability, entitlement probability or permit compliance.",
  };
}
