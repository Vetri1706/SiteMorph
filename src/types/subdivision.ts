import type { ClimateDNA, SiteGeometry } from "./index";

export type SubdivisionPoint = [number, number];

export type SubdivisionStrategy =
  | "compact-yield"
  | "balanced-neighborhood"
  | "heat-resilient-neighborhood";

export interface SubdivisionSetbacks {
  frontFt: number;
  sideFt: number;
  rearFt: number;
  sitePerimeterFt: number;
}

/**
 * Explicit, user-visible inputs to the deterministic subdivision engine.
 * These values are planning assumptions until a verified rule source is
 * connected; the engine never treats them as zoning or building-code facts.
 */
export interface SubdivisionBrief {
  schemaVersion: "sitemorph.subdivision-brief.v1";
  id: string;
  name: string;
  dwellingType: "detached" | "duplex" | "townhouse" | "terrace";
  targetLotAreaSqFt: number;
  minimumLotWidthFt: number;
  dwellingGfaSqFt: number;
  floors: number;
  maxConnectedDwellings: number;
  roadWidthFt: number;
  pedestrianPathWidthFt: number;
  setbacks: SubdivisionSetbacks;
  openLandTargetPercent: number;
  parkingSpacesPerDwelling: number;
  treeCanopyTargetPercent: number;
}

export interface SubdivisionLot {
  id: string;
  rowId: "row-a" | "row-b";
  polygon: SubdivisionPoint[];
  areaSqFt: number;
  widthFt: number;
  depthFt: number;
  frontageRoadId: string;
  dwellingId: string;
}

export interface SubdivisionDwelling {
  id: string;
  lotId: string;
  groupId: string;
  footprint: SubdivisionPoint[];
  footprintSqFt: number;
  grossFloorAreaSqFt: number;
  floors: number;
  heightMeters: number;
}

export interface SubdivisionDwellingGroup {
  id: string;
  rowId: SubdivisionLot["rowId"];
  form: "detached" | "attached-row";
  dwellingIds: string[];
  lotIds: string[];
}

export interface SubdivisionRoad {
  id: string;
  kind: "access-road" | "pedestrian-path";
  label: string;
  polygon: SubdivisionPoint[];
  centerline: SubdivisionPoint[];
  widthMeters: number;
  shaded: boolean;
}

export interface SubdivisionTreePoint {
  id: string;
  point: SubdivisionPoint;
  canopyDiameterMeters: number;
  role: "rear-yard-shade" | "pedestrian-route-shade" | "shared-green-shade";
  provenance: "SiteMorph planning assumption";
}

export interface SubdivisionOpenSpace {
  id: string;
  kind: "shared-green" | "heat-relief-corridor";
  label: string;
  polygon: SubdivisionPoint[];
  areaSqFt: number;
}

export interface FortyGuardBurdenInput {
  id:
    | "mean-temperature"
    | "mean-persistence"
    | "maximum-continuous-persistence"
    | "mean-exceedance";
  label: string;
  value: number;
  unit: "°C" | "h";
  normalizedRisk: number;
  weightPercent: number;
  source: "FortyGuard";
}

export interface FortyGuardHistoricalBurden {
  source: "FortyGuard historical thermal evidence";
  score: number;
  scorePercent: number;
  evidenceGeneratedAt: string;
  formula: string;
  inputs: FortyGuardBurdenInput[];
  timeOfMeasureAvailable: boolean;
  peakThermalHour: string | null;
  peakThermalHourUtc: string | null;
  peakTimeEvidenceNote: string;
  thermalZoningMode: "site-wide" | "tile-informed";
  directionalClaim: string | null;
  spatialNote: string;
}

export interface SubdivisionMitigationFactor {
  id: "canopy" | "pedestrian-shade" | "open-land" | "dwelling-spacing";
  label: string;
  riskMultiplier: number;
  weightPercent: number;
  evidence: string;
}

export interface SubdivisionClimatePerformance {
  source: "FortyGuard × SiteMorph plan mitigation";
  historicalBurdenScore: number;
  mitigationMultiplier: number;
  residualHeatRiskScore: number;
  resilienceScore: number;
  formula: string;
  factors: SubdivisionMitigationFactor[];
  spatialTreatment: "site-wide" | "tile-informed";
  directionalClaim: string | null;
}

export interface SubdivisionScoreComponent {
  id: "fortyguard-climate" | "development-yield" | "lot-match" | "open-land" | "delivery-simplicity";
  label: string;
  rawScore: number;
  weightPercent: number;
  weightedScore: number;
  source: "FortyGuard × SiteMorph" | "SiteMorph derived";
  explanation: string;
}

export interface SubdivisionScoreBreakdown {
  totalScore: number;
  climateWeightPercent: 50;
  formula: string;
  components: SubdivisionScoreComponent[];
}

export interface SubdivisionMetrics {
  siteAreaSqFt: number;
  subdivisionLotAreaSqFt: number;
  roadAndPathAreaSqFt: number;
  dwellingFootprintAreaSqFt: number;
  totalDwellingGfaSqFt: number;
  averageLotAreaSqFt: number;
  averageDwellingGfaSqFt: number;
  lotCount: number;
  dwellingCount: number;
  landEfficiencyPercent: number;
  /** Explicit SubdivisionOpenSpace area divided by site area; excludes private lot yards. */
  openLandPercent: number;
  parkingProvision: number;
  treeCount: number;
  estimatedCanopyCoveragePercent: number;
}

export interface SubdivisionProvenanceEntry {
  field: string;
  source: "Forma" | "FortyGuard" | "User-confirmed input" | "SiteMorph derived";
  detail: string;
}

export interface SubdivisionVariant {
  id: string;
  strategy: SubdivisionStrategy;
  label: string;
  rank: number;
  axis: {
    origin: SubdivisionPoint;
    vector: SubdivisionPoint;
    angleDegrees: number;
    basis: "Forma Site Limit dominant axis";
  };
  lots: SubdivisionLot[];
  dwellings: SubdivisionDwelling[];
  dwellingGroups: SubdivisionDwellingGroup[];
  roads: SubdivisionRoad[];
  trees: SubdivisionTreePoint[];
  openSpaces: SubdivisionOpenSpace[];
  metrics: SubdivisionMetrics;
  climatePerformance: SubdivisionClimatePerformance;
  scoreBreakdown: SubdivisionScoreBreakdown;
  assumptions: string[];
  warnings: string[];
  provenance: SubdivisionProvenanceEntry[];
}

export interface SubdivisionPlan {
  schemaVersion: "sitemorph.subdivision-plan.v1";
  source: "SiteMorph deterministic native-Forma subdivision engine";
  briefId: string;
  siteElementPath: string;
  siteAreaSqFt: number;
  historicalBurden: FortyGuardHistoricalBurden;
  variants: SubdivisionVariant[];
  disclaimer: string;
}

export interface SubdivisionLayoutInput {
  geometry: SiteGeometry;
  climate: ClimateDNA;
  brief: SubdivisionBrief;
}
