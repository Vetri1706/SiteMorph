export type AppTab = "site" | "climate" | "design" | "compare" | "trace";
export type AsyncStatus = "idle" | "pending" | "running" | "completed" | "failed" | "skipped";
export type SourceKind = "fortyguard" | "forma" | "sitemorph";
export type RiskLevel = "LOW" | "MODERATE" | "HIGH";

export interface Coordinate {
  longitude: number;
  latitude: number;
}

export interface SiteBounds {
  north: number;
  east: number;
  south: number;
  west: number;
}

export interface GeoJsonPolygon {
  type: "Feature";
  properties: Record<string, string | number | boolean>;
  geometry: {
    type: "Polygon";
    coordinates: number[][][];
  };
}

export interface SiteProjection {
  srid: number;
  projString: string;
  refPoint: [number, number];
}

export interface SiteGeometry {
  elementPath: string;
  pointCount: number;
  triangleCount?: number;
  overlayElevation?: number;
  terrainElevationMeters?: number;
  localBoundary?: Array<[number, number]>;
  areaSqFt?: number;
  areaAcres?: number;
  centroid: Coordinate;
  bounds: SiteBounds;
  geojson: GeoJsonPolygon;
  projection?: SiteProjection;
}

export interface SiteContext {
  projectId: string;
  projectName: string;
  siteId: string;
  siteName: string;
  location: string;
  countryCode: string;
  timezone?: string;
  areaSqFt: number;
  areaAcres: number;
  selectedProposal: string;
  selectedSiteLimit: string;
  geometry?: SiteGeometry;
  creditsRemaining?: number;
  creditsUsed?: number;
  creditsTotal?: number;
  creditsPlan?: string;
  creditsResetsAt?: string;
  creditsStatus?: "loading" | "available" | "unavailable";
  creditsSource?: "live" | "saved";
  creditsSavedAt?: string;
  creditsStale?: boolean;
}

export interface FortyGuardUsage {
  creditsRemaining: number;
  creditsUsed?: number;
  creditsTotal?: number;
  plan?: string;
  resetsAt?: string;
  source?: "live" | "saved";
  savedAt?: string;
  stale?: boolean;
}

export interface DataProvenance {
  source: SourceKind;
  label: string;
  dateRange?: string;
  resolution?: string;
  confidence: string;
  derivedFrom?: string[];
}

export type ClimateLayerId =
  | "climate-response"
  | "ranked-zones"
  | "temperature"
  | "persistence"
  | "exceedance"
  | "peak-time"
  | "vegetation"
  | "impervious"
  | "street-openness"
  | "environmental";

export interface ThermalLayer {
  id: ClimateLayerId;
  name: string;
  description: string;
  available: boolean;
  unit?: string;
  overlayType: "geojson" | "glb" | "sdk" | "mock";
}

export interface ThermalMetrics {
  meanCelsius: number;
  maxCelsius: number;
  minCelsius: number;
  peakThermalHour: string;
  peakThermalHourUtc?: string;
  peakThermalTimeZone?: string;
  thresholdCelsius: number;
  hoursAboveThreshold: number;
  longestPersistenceHours: number;
  meanPersistenceHours?: number;
  hotZonePercent: number;
  coolZonePercent: number;
}

export interface EnvironmentalMetrics {
  relativeHumidityPercent?: number;
  heatIndexCelsius?: number;
  apparentTemperatureCelsius?: number;
  wetBulbCelsius?: number;
  cloudCoverPercent?: number;
  precipitationMm?: number;
  elevationMeters?: number;
  airQualityIndexUs?: number;
}

export interface SolarMetrics {
  ghiWm2?: number;
  dniWm2?: number;
  dhiWm2?: number;
}

export interface SurfaceSegmentation {
  treePercent: number;
  vegetationPercent: number;
  grassPercent: number;
  buildingPercent: number;
  roadPercent: number;
  pavementPercent: number;
  bareGroundPercent: number;
  otherPercent: number;
  canopyVegetationPercent: number;
  imperviousPercent: number;
  originalImageDataUrl?: string;
  segmentedImageDataUrl?: string;
  imageYear?: number;
}

export interface StreetSegmentation {
  treePercent: number;
  skyPercent: number;
  buildingPercent: number;
  roadPercent: number;
  sidewalkPercent: number;
  earthPercent: number;
  streetOpennessProxyPercent: number;
  available: boolean;
  status?: "available" | "unavailable" | "deferred";
  originalImageDataUrl?: string;
  segmentedImageDataUrl?: string;
  imageDate?: string;
  sampleLabel?: string;
}

export interface ClimateDesignPriority {
  label: string;
  level: "Critical" | "High" | "Moderate";
  reason: string;
}

export interface ClimateDesignBrief {
  thermalZoningConfidence: "LOW" | "MODERATE" | "HIGH";
  summary: string;
  priorities: ClimateDesignPriority[];
  siteWideConstraints: string[];
  formaActions: string[];
}

export interface SiteZone {
  id: string;
  name: string;
  direction: string;
  climateSuitability: number;
  evidence: string[];
  recommendedFor: string[];
  elementPath: string;
  sourceTileIds: string[];
}

export type ThermalZoneClass = "preferred" | "moderate" | "avoid";

export interface TileThermalSample {
  date: string;
  meanTemperatureCelsius: number;
  maxTemperatureCelsius: number;
  minTemperatureCelsius: number;
  persistenceHours: number;
  exceedanceHours: number;
  peakHourUtc: number;
}

export interface RankedThermalTile {
  id: string;
  centroid: Coordinate;
  meanTemperatureCelsius: number;
  maxTemperatureCelsius: number;
  minTemperatureCelsius: number;
  persistenceHours: number;
  maxPersistenceHours: number;
  exceedanceHours: number;
  peakHourUtc: number;
  thermalScore: number;
  classification: ThermalZoneClass;
  coolestQuintileCount: number;
  hottestQuartileCount: number;
  coolerThanSiteMeanCount: number;
  hotterThanSiteMeanCount: number;
  peakHourConsistencyPercent: number;
  sampleCount: number;
  samples: TileThermalSample[];
}

export interface DesignConstraint {
  id: string;
  category: "Placement" | "Building" | "Envelope / Landscape";
  title: string;
  value: string;
  why: string;
  evidenceIds: string[];
}

export interface ClimateDNA {
  id: string;
  generatedAt: string;
  activityId: string;
  activityIds?: {
    heat: Array<{ date: string; tcm: string; persistence: string; exceedance: string; timeOfMeasure: string }>;
    environmental?: string;
    satellite?: string;
    street?: string;
  };
  profile: {
    thermalExposure: RiskLevel;
    persistence: RiskLevel;
    vegetation?: RiskLevel;
    solarBurden?: RiskLevel;
    recommendedBuildZone?: string;
  };
  layers: ThermalLayer[];
  thermal: ThermalMetrics;
  environmental?: EnvironmentalMetrics;
  solar?: SolarMetrics;
  surface?: SurfaceSegmentation;
  street?: StreetSegmentation;
  designBrief: ClimateDesignBrief;
  zones: SiteZone[];
  constraints: DesignConstraint[];
  provenance: Partial<Record<"thermal" | "environmental" | "solar" | "surface" | "street" | "zones" | "response", DataProvenance>>;
}

export interface ClimateResponseInput {
  id: "fortyguard-history" | "forma-sun" | "forma-wind";
  label: string;
  source: SourceKind;
  configuredWeightPercent: number;
  analysisId?: string;
  resolutionMeters?: number;
  coveragePercent: number;
}

export interface ClimateResponseSummary {
  generatedAt: string;
  status: "complete" | "partial";
  label: string;
  meanRiskScore: number;
  maximumRiskScore: number;
  resolutionMeters: number;
  historicalBaselineScore: number;
  inputs: ClimateResponseInput[];
  formula: string;
  note: string;
}

export interface ClimateResponseGrid {
  grid: Float32Array;
  mask: Uint8Array;
  width: number;
  height: number;
  x0: number;
  y0: number;
  resolution: number;
}

export interface ClimateResponseResult {
  summary: ClimateResponseSummary;
  grid: ClimateResponseGrid;
}

export interface SiteAnalysisResponse {
  climateDNA: ClimateDNA;
  mapData: Partial<Record<"ranked-zones" | "temperature" | "persistence" | "exceedance" | "peak-time", GeoJSON.FeatureCollection<GeoJSON.Polygon>>>;
  rankedTiles?: RankedThermalTile[];
  cache?: {
    source: "live" | "memory" | "persistent";
    key: string;
    savedAt: string;
    persisted: boolean;
  };
}

export interface ProgramArea {
  name: string;
  areaSqFt: number;
}

export interface DesignBrief {
  buildingType: string;
  totalAreaSqFt: number;
  program: ProgramArea[];
  floors: number;
  targetFootprintSqFt: number;
  maximumHeightFt: number;
  requiredParking: number;
  loadingDocks: number;
  preferredAccessRoad: string;
  priority: "Balanced" | "Thermal Performance" | "Operational Efficiency" | "Maximum Usable Area";
}

export type SiteFitStatus = "strongest-fit" | "conditional" | "low-confidence";

export interface SiteFitOption {
  id: string;
  rank: number;
  typology: BuildingTypology;
  label: string;
  score: number;
  status: SiteFitStatus;
  sizeSummary: string;
  estimatedSiteCoveragePercent: number;
  estimatedParkingLandPercent: number;
  brief: DesignBrief;
  reasons: string[];
  cautions: string[];
}

export interface SiteFitAssessment {
  schemaVersion: "sitemorph.site-fit.v1";
  source: "deterministic-constraint-engine";
  siteAreaSqFt: number;
  siteAreaAcres: number;
  evidenceSummary: string[];
  options: SiteFitOption[];
  missingEvidence: string[];
  disclaimer: string;
}

export type ProgramPlanSide = "north" | "east" | "south" | "west";
export type BuildingTypology = "logistics" | "healthcare" | "office" | "education" | "residential" | "hotel" | "retail" | "mixed-use" | "generic";

export interface ProgramPlanZone {
  id: string;
  name: string;
  role: "primary" | "secondary" | "support" | "upper";
  level: "ground" | "mezzanine" | "upper";
  areaSqFt: number;
  widthFt: number;
  depthFt: number;
  side?: ProgramPlanSide;
  levelCount?: number;
  source: "requirement" | "generated-mass" | "sitemorph-allowance" | "typology-template" | "gross-area-remainder";
  note: string;
}

export interface ProgramPlan {
  schemaVersion: "sitemorph.program-plan.v2";
  status: "preliminary";
  units: "feet";
  typology: BuildingTypology;
  typologyLabel: string;
  programStatus: "itemized" | "typology-template";
  programSummary: string;
  buildingWidthFt: number;
  buildingDepthFt: number;
  footprintSqFt: number;
  grossFloorAreaSqFt: number;
  heightFt: number;
  aspectRatio: number;
  orientation: string;
  northEdgeUse: string;
  officeMezzanineSide: ProgramPlanSide;
  zones: ProgramPlanZone[];
  operations: {
    edgeLabel: string;
    itemCount: number;
    itemLabel: string;
    side: "north";
    approximateItemSpacingFt?: number;
    shelteredBandLabel: string;
    shelteredBandDepthFt: number;
    outdoorZoneLabel: string;
    outdoorZoneDepthFt: number;
    dimensionStatus: "concept-assumption";
  };
  parking: {
    requiredSpaces: number;
    status: "requirement" | "not-specified";
  };
  access: {
    preferredRoad: string;
    status: "requirement" | "to-be-confirmed";
  };
  climateMoves: string[];
  disclaimer: string;
}

export type SiteLayoutZoneKind = "open-space" | "parking" | "operations" | "shelter";

export interface SiteLayoutZone {
  id: string;
  kind: SiteLayoutZoneKind;
  label: string;
  polygon: Array<[number, number]>;
  note: string;
}

export interface SiteLayoutPlan {
  schemaVersion: "sitemorph.site-layout.v1";
  status: "preliminary";
  typology: BuildingTypology;
  typologyLabel: string;
  siteBoundary: Array<[number, number]>;
  buildingFootprint: Array<[number, number]>;
  zones: SiteLayoutZone[];
  accessRoute: Array<[number, number]>;
  accessLabel: string;
  parkingRequirement: number;
  parkingConceptCapacity: number;
  parkingStatus: "resolved-concept" | "space-constrained" | "not-specified";
  operationsStatus: "resolved-concept" | "space-constrained";
  assumptions: string[];
  disclaimer: string;
}

export interface RevitHandoffReadiness {
  proposalId: string;
  formaElementPath: string;
  preparedAt: string;
  transferMode: "forma-revit-addin-beta";
  placementVerified: boolean;
  instructions: string[];
}

export type MetricStatus = "pass" | "review" | "fail";

export interface FormaAnalysisMetric {
  id: string;
  label: string;
  score: number;
  status: MetricStatus;
  unit?: string;
}

export interface FormaAnalysis {
  candidateId: string;
  source: "forma";
  metrics: FormaAnalysisMetric[];
  analyzedAt: string;
  isMock: boolean;
}

export interface GeneratedBuilding {
  designLoopVersion?: "measured-v2";
  elementPath: string;
  name: string;
  footprintSqFt: number;
  heightFt: number;
  revision: number;
  sunAnalysisId?: string;
  sunStatus?: "running" | "succeeded" | "failed";
  meanSunHours?: number;
  maxSunHours?: number;
  changeSummary?: string;
  analysisMetricSource?: "ground-grid" | "native-status-only";
  analysisNote?: string;
  floors: number;
  grossFloorAreaSqFt: number;
  mezzanineAreaSqFt?: number;
  partialTopFloorAreaSqFt?: number;
  upperFloorAreaSqFt?: number;
  geometryLevelCount?: number;
  siteCoveragePercent: number;
  remainingSiteAreaSqFt: number;
  aspectRatio: number;
  orientationLabel: string;
  heightMeters: number;
  baseElevationMeters?: number;
  projectFootprint: Array<[number, number]>;
  placementSummary: string;
  programPlan?: ProgramPlan;
  siteLayout?: SiteLayoutPlan;
  siteOverlayStatus?: "rendered" | "unavailable";
  siteOverlayNote?: string;
  designImageDataUrl?: string;
  initialDesignImageDataUrl?: string;
  testedDesignImageDataUrl?: string;
  sunAnalysisIds: string[];
  climateResponse?: ClimateResponseSummary;
  intervention?: DesignIntervention;
}

export interface DesignInterventionSnapshot {
  aspectRatio: number;
  placement: string;
  loadingYardSide: string;
  officeMezzanineSide: string;
  meanSunHours?: number;
  maxSunHours?: number;
  programPlan?: ProgramPlan;
}

export interface DesignIntervention {
  issue: string;
  action: string;
  objective: string;
  outcome: "accepted" | "rejected" | "not-required";
  reason: string;
  initial: DesignInterventionSnapshot;
  tested?: DesignInterventionSnapshot;
}

export interface CandidateScore {
  climateFit: number;
  sun: number;
  wind: number;
  microclimate: number;
  energy: number;
  carbon: number;
  programFit: number;
  siteUtilization: number;
  overall: number;
}

export interface DesignCandidate {
  id: string;
  label: string;
  name: string;
  externalDesignId: string;
  orientationDegrees: number;
  orientationLabel: string;
  scores: CandidateScore;
  analysisId: string;
  selected: boolean;
  isImproved: boolean;
  parentCandidateId?: string;
}

export type AgentTraceType = "Observation" | "Decision" | "Tool Call" | "Result" | "Recommendation";

export interface AgentTraceEvent {
  id: string;
  timestamp: string;
  type: AgentTraceType;
  title: string;
  detail?: string;
  reason?: string;
  activityId?: string;
  source?: SourceKind;
}

export interface AnalysisStep {
  id: string;
  label: string;
  detail?: string;
  status: AsyncStatus;
  activityId?: string;
  optional?: boolean;
}

export interface RedesignEvent {
  id: string;
  type: "evaluation" | "issue" | "action" | "validation";
  title: string;
  detail?: string;
  status: AsyncStatus;
}

export interface ExportArtifact {
  id: string;
  label: string;
  format: "PDF" | "GEOJSON" | "CSV" | "JSON";
}
