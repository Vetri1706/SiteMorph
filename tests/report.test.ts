import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";

import type { ClimateDNA, DesignBrief, GeneratedBuilding, SiteContext, SiteGeometry } from "../src/types/index.ts";
import type { GeneratedSubdivisionResult } from "../src/services/forma-subdivision.service.ts";
import { SUBDIVISION_CONTEXT_DISCLAIMER, SUBDIVISION_CONTEXT_MODEL_VERSION } from "../src/services/forma-subdivision-context.service.ts";
import type { SubdivisionBrief } from "../src/types/subdivision.ts";
import { createSiteFitAssessment } from "../src/utils/site-fit-advisor.ts";
import { buildSiteIntelligenceReport } from "../src/utils/site-report.ts";
import { generateSubdivisionLayouts } from "../src/utils/subdivision-layout.ts";

const site: SiteContext = {
  projectId: "south-phoenix",
  projectName: "South Phoenix, AZ",
  siteId: "site-limit-988",
  siteName: "Site limit 988",
  location: "South Phoenix, AZ",
  countryCode: "US",
  timezone: "America/Phoenix",
  areaSqFt: 359376,
  areaAcres: 8.25,
  selectedProposal: "Proposal 1",
  selectedSiteLimit: "Site limit 988",
};

const climate: ClimateDNA = {
  id: "climate-1",
  generatedAt: "2026-08-23T00:00:00Z",
  activityId: "fg-primary",
  activityIds: {
    heat: [{ date: "2024-07-15", tcm: "fg-tcm", persistence: "fg-persistence", exceedance: "fg-exceedance", timeOfMeasure: "fg-peak" }],
  },
  profile: { thermalExposure: "HIGH", persistence: "HIGH" },
  layers: [],
  thermal: {
    meanCelsius: 35.6,
    maxCelsius: 42.5,
    minCelsius: 22.3,
    peakThermalHour: "9:00 PM MST",
    peakThermalHourUtc: "04:00 UTC",
    peakThermalTimeZone: "America/Phoenix",
    thresholdCelsius: 35,
    hoursAboveThreshold: 15,
    longestPersistenceHours: 16,
    hotZonePercent: 100,
    coolZonePercent: 0,
  },
  designBrief: {
    thermalZoningConfidence: "LOW",
    summary: "The parcel is thermally uniform at FortyGuard resolution.",
    priorities: [{ label: "Cooling resilience", level: "Critical", reason: "Persistent hot-season load" }],
    siteWideConstraints: ["Use a high-performance envelope"],
    formaActions: ["Run native Sun analysis"],
  },
  zones: [],
  constraints: [],
  provenance: { thermal: { source: "fortyguard", label: "FortyGuard hot-season evidence", confidence: "Direct model output" } },
};

const requirements: DesignBrief = {
  buildingType: "Neighborhood retail / supermarket",
  totalAreaSqFt: 78000,
  program: [],
  floors: 1,
  targetFootprintSqFt: 78000,
  maximumHeightFt: 36,
  requiredParking: 180,
  loadingDocks: 12,
  preferredAccessRoad: "",
  priority: "Balanced",
};

const siteGeometry: SiteGeometry = {
  elementPath: "proposal/site-limit-988",
  pointCount: 5,
  localBoundary: [[0, 0], [220, 0], [220, 151.8], [0, 151.8], [0, 0]],
  areaSqFt: 359376,
  areaAcres: 8.25,
  centroid: { longitude: -112.0722, latitude: 33.4062 },
  bounds: { north: 33.41, east: -112.06, south: 33.39, west: -112.08 },
  geojson: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[-112.08, 33.39], [-112.06, 33.39], [-112.06, 33.41], [-112.08, 33.41], [-112.08, 33.39]]] } },
};

const siteFitAssessment = createSiteFitAssessment(siteGeometry, climate);
const selectedRetailOption = siteFitAssessment.options.find((option) => option.id === "retail")!;

const building: GeneratedBuilding = {
  elementPath: "proposal/building-1",
  name: "Neighborhood retail / supermarket",
  footprintSqFt: 78000,
  heightFt: 36,
  revision: 2,
  sunStatus: "succeeded",
  meanSunHours: 8.1,
  maxSunHours: 10,
  changeSummary: "SiteMorph tested a 2.2:1 access-aligned mass with the sensitive upper program moved east, then retained the initial mass.",
  analysisMetricSource: "ground-grid",
  floors: 1,
  grossFloorAreaSqFt: 78000,
  geometryLevelCount: 1,
  siteCoveragePercent: 21.7,
  remainingSiteAreaSqFt: 281376,
  aspectRatio: 2.2,
  orientationLabel: "East-west long axis",
  heightMeters: 10.97,
  baseElevationMeters: 326.75,
  placementVerification: {
    terrainBaseElevationMeters: 326.75,
    terrainSampleCount: 18,
    expectedCenterXMeters: 50,
    expectedCenterYMeters: 25,
    worldTransformXMeters: 50,
    worldTransformYMeters: 25,
    worldTransformElevationMeters: 326.75,
    meshBaseElevationMeters: 326.75,
    toleranceMeters: 0.25,
    verifiedAt: "2026-08-23T00:00:00Z",
  },
  projectFootprint: [[0, 0], [100, 0], [100, 50], [0, 50]],
  placementSummary: "Placed clear of existing readable building footprints.",
  designImageDataUrl: "data:image/png;base64,ZmFrZQ==",
  initialDesignImageDataUrl: "data:image/png;base64,aW5pdGlhbA==",
  testedDesignImageDataUrl: "data:image/png;base64,dGVzdGVk",
  sunAnalysisIds: ["forma-sun-initial", "forma-sun-revision"],
  climateResponse: {
    generatedAt: "2026-08-23T00:00:00Z",
    status: "complete",
    label: "Forma-resolved Climate Response",
    meanRiskScore: 67.4,
    maximumRiskScore: 82.1,
    resolutionMeters: 1,
    historicalBaselineScore: 70.5,
    inputs: [
      { id: "fortyguard-history", label: "FortyGuard hot-season historical burden", source: "fortyguard", configuredWeightPercent: 45, resolutionMeters: 60, coveragePercent: 100 },
      { id: "forma-sun", label: "Forma native ground Sun exposure", source: "forma", configuredWeightPercent: 35, analysisId: "forma-sun-revision", resolutionMeters: 1, coveragePercent: 100 },
      { id: "forma-wind", label: "Forma Rapid Wind comfort", source: "forma", configuredWeightPercent: 20, resolutionMeters: 1.5, coveragePercent: 100 },
    ],
    formula: "45% FortyGuard historical burden + 35% Forma ground Sun + 20% Forma Rapid Wind comfort.",
    note: "Spatial variation comes from native Forma grids.",
  },
  intervention: {
    issue: "Persistent heat makes exposed operations a design risk.",
    action: "Test an access-aligned mass and move the sensitive upper program east.",
    objective: "Require a measured Forma improvement.",
    outcome: "rejected",
    reason: "The tested design did not improve the native result.",
    initial: { aspectRatio: 1.6, placement: "Balanced", loadingYardSide: "North", officeMezzanineSide: "North", meanSunHours: 8.1, maxSunHours: 10 },
    tested: { aspectRatio: 2.2, placement: "North-west, access aligned", loadingYardSide: "North", officeMezzanineSide: "East", meanSunHours: 8.1, maxSunHours: 10 },
  },
};

test("the report is a real DOCX that tells the completed evidence-to-design story", async () => {
  const report = await buildSiteIntelligenceReport({
    climate,
    site,
    requirements,
    building,
    trace: [{ id: "decision-1", timestamp: "2026-08-23T00:00:00Z", type: "Decision", title: "Retained initial mass", detail: building.changeSummary }],
    siteFitAssessment,
    selectedSiteFitOptionId: selectedRetailOption.id,
    assets: {
      mastheadDataUrl: "data:image/jpeg;base64,bWFzdGhlYWQ=",
      logoDataUrl: "data:image/png;base64,bG9nbw==",
      archivedSatelliteDataUrl: "data:image/png;base64,c2F0ZWxsaXRl",
      archivedSurfaceSegmentationDataUrl: "data:image/png;base64,c3VyZmFjZQ==",
      archivedStreetDataUrl: "data:image/jpeg;base64,c3RyZWV0",
      archivedStreetSegmentationDataUrl: "data:image/png;base64,c2VnbWVudGVk",
    },
  });

  assert.equal(report.type, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  const bytes = new Uint8Array(await report.arrayBuffer());
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), "PK");
  assert.ok(bytes.length > 10_000);

  const archive = await JSZip.loadAsync(bytes);
  const documentXml = await archive.file("word/document.xml")!.async("string");
  const stylesXml = await archive.file("word/styles.xml")!.async("string");
  const headerFiles = Object.keys(archive.files).filter((path) => /^word\/header\d+\.xml$/.test(path));
  const headerXml = (await Promise.all(headerFiles.map((path) => archive.file(path)!.async("string")))).join("\n");
  assert.match(documentXml, /SiteMorph — Site Intelligence &amp; Climate Design Report/);
  assert.match(documentXml, /9:00 PM MST/);
  assert.match(documentXml, /04:00 UTC/);
  assert.match(documentXml, /Generated proposal captured from the live Forma scene/);
  assert.match(documentXml, /Dimensioned 2D program\/site plan/);
  assert.match(documentXml, /NORTH CUSTOMER AND SERVICE EDGE/);
  assert.match(documentXml, /12 service bays/);
  assert.match(documentXml, /Preliminary retail program diagram, not a permit floor plan/);
  assert.match(documentXml, /Initial mass - 1.6:1 - Balanced/);
  assert.match(documentXml, /Tested intervention - 2.2:1 - North-west/);
  assert.match(documentXml, /REJECTED/);
  assert.match(documentXml, /Rejected; initial design restored/);
  assert.match(documentXml, /Selected Site Fit Advisor option:/);
  assert.match(documentXml, /retail — score/i);
  assert.match(documentXml, new RegExp(`${selectedRetailOption.score} \/ 100`));
  assert.match(documentXml, /Preliminary parking allowance/);
  assert.match(documentXml, /Zoning and permitted land use/);
  assert.match(documentXml, /SiteMorph Recommendation/);
  assert.match(documentXml, /Evidence trail/);
  assert.match(documentXml, /forma-sun-initial/);
  assert.match(documentXml, /Forma-resolved Climate Response/);
  assert.match(documentXml, /67.4 \/ 100/);
  assert.match(documentXml, /Forma Rapid Wind comfort/);
  assert.match(documentXml, /Revit handoff/);
  assert.match(documentXml, /18 real terrain samples/);
  assert.match(documentXml, /Verified X, Y, terrain Z and generated mesh Z within 0.25 m/);
  assert.match(documentXml, /Open a new blank Revit file/);
  assert.match(documentXml, /Repeated Load From Forma into the same Revit file is unsupported/);
  assert.match(documentXml, /Link Revit into the existing model and Bind Link/);
  assert.match(documentXml, /Revit does not natively import it/);
  assert.match(documentXml, /not native BIM walls, floors, rooms, roofs or openings/);
  assert.match(documentXml, /Environmental parameters were unavailable for this analysis window/);
  assert.match(documentXml, /Archived satellite context - South Phoenix/);
  assert.match(documentXml, /Archived street view - North access edge/);
  assert.match(documentXml, /no new FortyGuard activity/);
  assert.match(stylesXml, /w:styleId="ReportTitle"/);
  assert.match(headerXml, /SiteMorph/);
  assert.doesNotMatch(documentXml, /Satellite surface segmentation was unavailable/);
  assert.doesNotMatch(documentXml, /Street imagery was unavailable/);
  assert.doesNotMatch(documentXml, /No building has been generated yet/);
  assert.doesNotMatch(documentXml, /PROGRAM TO BE CONFIRMED/);
  assert.doesNotMatch(documentXml, /Forma-validated proposal/);
  assert.doesNotMatch(documentXml, /sensitive upper program|access-aligned/i);
});

test("omits a stale Forma response when the Sun ground grid was rejected", async () => {
  const nativeStatusOnlyBuilding: GeneratedBuilding = {
    ...building,
    analysisMetricSource: "native-status-only",
    meanSunHours: undefined,
    maxSunHours: undefined,
    analysisNote: "Forma completed the Sun job, but the embedded ground grid was unreadable.",
    climateResponse: building.climateResponse,
  };
  const report = await buildSiteIntelligenceReport({
    climate,
    site,
    requirements,
    building: nativeStatusOnlyBuilding,
    trace: [],
    siteFitAssessment,
    selectedSiteFitOptionId: selectedRetailOption.id,
  });
  const archive = await JSZip.loadAsync(new Uint8Array(await report.arrayBuffer()));
  const documentXml = await archive.file("word/document.xml")!.async("string");

  assert.match(documentXml, /Native job completed; embedded ground grid unavailable/);
  assert.match(documentXml, /combined response index was omitted/i);
  assert.match(documentXml, /no stale or unsupported Sun-derived response was used/i);
  assert.doesNotMatch(documentXml, /Forma-resolved Climate Response/);
  assert.doesNotMatch(documentXml, /67.4 \/ 100/);
  assert.doesNotMatch(documentXml, /Forma-validated proposal/);
  assert.doesNotMatch(documentXml, /Forma ground-grid measured proposal/);
});

test("retains a valid Wind-only response when Sun metrics are unavailable", async () => {
  const windOnlyBuilding: GeneratedBuilding = {
    ...building,
    analysisMetricSource: "native-status-only",
    meanSunHours: undefined,
    maxSunHours: undefined,
    climateResponse: {
      ...building.climateResponse!,
      status: "partial",
      inputs: building.climateResponse!.inputs.filter((input) => input.id !== "forma-sun"),
      formula: "FortyGuard historical burden + Forma Rapid Wind comfort; available inputs renormalized.",
      note: "Sun was unavailable; this partial response uses the readable Wind grid only.",
    },
  };
  const report = await buildSiteIntelligenceReport({ climate, site, requirements, building: windOnlyBuilding, trace: [] });
  const archive = await JSZip.loadAsync(new Uint8Array(await report.arrayBuffer()));
  const documentXml = await archive.file("word/document.xml")!.async("string");

  assert.match(documentXml, /Forma-resolved Climate Response/);
  assert.match(documentXml, /Forma Rapid Wind comfort/);
  assert.match(documentXml, /readable Wind grid only/);
  assert.doesNotMatch(documentXml, /combined response index was omitted/i);
});

test("documents a built subdivision with exposed FortyGuard multiplication and honest Forma/Revit boundaries", async () => {
  const subdivisionBrief: SubdivisionBrief = {
    schemaVersion: "sitemorph.subdivision-brief.v1",
    id: "report-townhouses",
    name: "Climate-responsive townhouse neighborhood",
    dwellingType: "townhouse",
    targetLotAreaSqFt: 3229.17,
    minimumLotWidthFt: 32.81,
    dwellingGfaSqFt: 1899,
    floors: 2,
    maxConnectedDwellings: 4,
    roadWidthFt: 19.69,
    pedestrianPathWidthFt: 4.92,
    setbacks: { frontFt: 6.56, sideFt: 3.28, rearFt: 13.12, sitePerimeterFt: 4.92 },
    openLandTargetPercent: 10,
    parkingSpacesPerDwelling: 2,
    treeCanopyTargetPercent: 18,
  };
  const subdivisionPlan = generateSubdivisionLayouts(siteGeometry, climate, subdivisionBrief);
  const selectedVariant = subdivisionPlan.variants.find((variant) => variant.rank === 1)!;
  const generatedSubdivision: GeneratedSubdivisionResult = {
    schemaVersion: 3,
    runId: "subdivision-report-run",
    variantId: selectedVariant.id,
    variantLabel: selectedVariant.label,
    generatedAt: "2026-08-23T00:00:00Z",
    elementPaths: selectedVariant.dwellings.map((dwelling) => `root/${dwelling.id}`),
    proposalElementPaths: [
      ...selectedVariant.dwellings.map((dwelling) => `root/${dwelling.id}`),
      "root/subdivision-context",
    ],
    elements: selectedVariant.dwellings.map((dwelling, index) => ({
      itemId: dwelling.id,
      lotId: dwelling.lotId,
      groupId: dwelling.groupId,
      elementPath: `root/${dwelling.id}`,
      name: `SiteMorph — ${selectedVariant.label} · Dwelling ${index + 1}`,
      footprintSqFt: dwelling.footprintSqFt,
      grossFloorAreaSqFt: dwelling.grossFloorAreaSqFt,
      floors: dwelling.floors,
      heightMeters: dwelling.heightMeters,
      projectFootprint: dwelling.footprint,
      footprintSource: "direct-footprint",
      placement: {
        terrainBaseElevationMeters: 326.75,
        terrainSampleCount: 5,
        expectedCenterXMeters: 50,
        expectedCenterYMeters: 25,
        worldTransformXMeters: 50,
        worldTransformYMeters: 25,
        worldTransformElevationMeters: 326.75,
        meshBaseElevationMeters: 326.75,
        toleranceMeters: 0.25,
        verifiedAt: "2026-08-23T00:00:00Z",
      },
    })),
    totalGrossFloorAreaSqFt: selectedVariant.metrics.totalDwellingGfaSqFt,
    terrainSampleCount: selectedVariant.dwellings.length * 5,
    terrainVerificationCount: selectedVariant.dwellings.length,
    persistentContext: {
      elementPath: "root/subdivision-context",
      name: "SiteMorph — Heat-resilient neighborhood · Persistent planning context",
      status: "persisted-concept-context",
      modelVersion: SUBDIVISION_CONTEXT_MODEL_VERSION,
      persistedAt: "2026-08-23T00:00:00Z",
      roadFeatureCount: selectedVariant.roads.filter((road) => road.kind === "access-road").length,
      pedestrianPathFeatureCount: selectedVariant.roads.filter((road) => road.kind === "pedestrian-path").length,
      openSpaceFeatureCount: selectedVariant.openSpaces.length,
      lotOutlineFeatureCount: selectedVariant.lots.length,
      treeCount: selectedVariant.trees.length,
      treeTerrainSampleCount: selectedVariant.trees.length,
      treeTerrainVerificationCount: selectedVariant.trees.length,
      treeTriangleCount: selectedVariant.trees.length * 96,
      treeModelUrn: "urn:adsk-forma-elements:integrate:test:tree:1",
      disclaimer: SUBDIVISION_CONTEXT_DISCLAIMER,
    },
    removedPreviousPaths: [],
    nativeAnalysis: {
      type: "sun",
      selectedElementPath: siteGeometry.elementPath,
      status: "succeeded",
      analysisId: "forma-subdivision-sun-1",
      metricSource: "ground-grid",
      meanSunHours: 8.4,
      maxSunHours: 10.8,
      note: "Readable native Site-Limit Sun grid.",
    },
  };

  const report = await buildSiteIntelligenceReport({
    climate,
    site,
    requirements,
    building: null,
    trace: [],
    subdivisionPlan,
    selectedSubdivisionVariantId: selectedVariant.id,
    generatedSubdivision,
  });
  const archive = await JSZip.loadAsync(new Uint8Array(await report.arrayBuffer()));
  const documentXml = await archive.file("word/document.xml")!.async("string");

  assert.match(documentXml, /FortyGuard four-signal historical burden/);
  assert.match(documentXml, /Hot-season mean temperature/);
  assert.match(documentXml, /Mean continuous persistence/);
  assert.match(documentXml, /Maximum continuous persistence/);
  assert.match(documentXml, /Mean exceedance above/);
  assert.match(documentXml, /Peak thermal hour - site local/);
  assert.match(documentXml, /Supporting evidence only - excluded from numerical burden/);
  assert.match(documentXml, /Weighted geometric mean/);
  assert.match(documentXml, /Exactly 50% of the option score/);
  assert.match(documentXml, /Residual heat risk = FortyGuard historical burden/);
  assert.match(documentXml, /forma-subdivision-sun-1/);
  assert.match(documentXml, /separate dwelling floor stacks/);
  assert.match(documentXml, /persistent virtual SiteMorph-authored Forma concept elements/i);
  assert.match(documentXml, /Persistent planning-context root/);
  assert.match(documentXml, /low-poly trees/i);
  assert.match(documentXml, /does not claim that the context root, subdivision lot IDs, dwelling names, rooms, walls, roofs, openings/);
});
