import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";

import type { ClimateDNA, DesignBrief, GeneratedBuilding, SiteContext } from "../src/types/index.ts";
import { buildSiteIntelligenceReport } from "../src/utils/site-report.ts";

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
  buildingType: "Climate-controlled self-storage",
  totalAreaSqFt: 85000,
  program: [{ name: "Storage", areaSqFt: 85000 }],
  floors: 1,
  targetFootprintSqFt: 78000,
  maximumHeightFt: 36,
  requiredParking: 60,
  loadingDocks: 12,
  preferredAccessRoad: "E Broadway Rd",
  priority: "Balanced",
};

const building: GeneratedBuilding = {
  elementPath: "proposal/building-1",
  name: "Climate-controlled self-storage",
  footprintSqFt: 78000,
  heightFt: 36,
  revision: 2,
  sunStatus: "succeeded",
  meanSunHours: 8.1,
  maxSunHours: 10,
  changeSummary: "The tested revision performed worse, so SiteMorph retained the initial mass.",
  analysisMetricSource: "ground-grid",
  floors: 1,
  grossFloorAreaSqFt: 85000,
  mezzanineAreaSqFt: 7000,
  geometryLevelCount: 2,
  siteCoveragePercent: 21.7,
  remainingSiteAreaSqFt: 281376,
  aspectRatio: 2.2,
  orientationLabel: "East-west long axis",
  heightMeters: 10.97,
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
    action: "Test aspect ratio, placement and program-side changes.",
    objective: "Require a measured Forma improvement.",
    outcome: "rejected",
    reason: "The tested design did not improve the native result.",
    initial: { aspectRatio: 1.6, placement: "Balanced", loadingYardSide: "North", officeMezzanineSide: "North", meanSunHours: 8.1, maxSunHours: 10 },
    tested: { aspectRatio: 2.2, placement: "North-west", loadingYardSide: "North", officeMezzanineSide: "East", meanSunHours: 8.1, maxSunHours: 10 },
  },
};

test("the report is a real DOCX that tells the completed evidence-to-design story", async () => {
  const report = await buildSiteIntelligenceReport({
    climate,
    site,
    requirements,
    building,
    trace: [{ id: "decision-1", timestamp: "2026-08-23T00:00:00Z", type: "Decision", title: "Retained initial mass", detail: building.changeSummary }],
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
  assert.match(documentXml, /NORTH LOADING EDGE/);
  assert.match(documentXml, /12 loading docks/);
  assert.match(documentXml, /Preliminary logistics \/ industrial program diagram, not a permit floor plan/);
  assert.match(documentXml, /Initial mass - 1.6:1 - Balanced/);
  assert.match(documentXml, /Tested intervention - 2.2:1 - North-west/);
  assert.match(documentXml, /REJECTED/);
  assert.match(documentXml, /Rejected; initial design restored/);
  assert.match(documentXml, /7,000 ft2/);
  assert.match(documentXml, /SiteMorph Recommendation/);
  assert.match(documentXml, /Evidence trail/);
  assert.match(documentXml, /forma-sun-initial/);
  assert.match(documentXml, /Forma-resolved Climate Response/);
  assert.match(documentXml, /67.4 \/ 100/);
  assert.match(documentXml, /Forma Rapid Wind comfort/);
  assert.match(documentXml, /Environmental parameters were unavailable for this analysis window/);
  assert.match(documentXml, /Archived satellite context - South Phoenix/);
  assert.match(documentXml, /Archived street view - North access edge/);
  assert.match(documentXml, /no new FortyGuard activity/);
  assert.match(stylesXml, /w:styleId="ReportTitle"/);
  assert.match(headerXml, /SiteMorph/);
  assert.doesNotMatch(documentXml, /Satellite surface segmentation was unavailable/);
  assert.doesNotMatch(documentXml, /Street imagery was unavailable/);
  assert.doesNotMatch(documentXml, /No building has been generated yet/);
});
