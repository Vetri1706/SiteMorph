import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ClimateDNA, DesignBrief, SiteContext } from "../src/types/index.ts";
import { buildSiteIntelligenceReport } from "../src/utils/site-report.ts";

const root = resolve(import.meta.dirname, "..");
const readJson = async <T>(path: string): Promise<T> => JSON.parse(await readFile(resolve(root, path), "utf8")) as T;
const dataUrl = async (path: string, mimeType: string): Promise<string> => `data:${mimeType};base64,${(await readFile(resolve(root, path))).toString("base64")}`;

const site = await readJson<SiteContext>("src/mocks/site.json");
const climate = await readJson<ClimateDNA>("src/mocks/climate-dna.json");
delete climate.surface;
climate.street = { treePercent: 0, skyPercent: 0, buildingPercent: 0, roadPercent: 0, sidewalkPercent: 0, earthPercent: 0, streetOpennessProxyPercent: 0, available: false, status: "deferred" };

const requirements: DesignBrief = {
  buildingType: "Climate-controlled self-storage",
  totalAreaSqFt: 85000,
  program: [{ name: "Storage", areaSqFt: 78000 }, { name: "Office / mezzanine", areaSqFt: 7000 }],
  floors: 1,
  targetFootprintSqFt: 78000,
  maximumHeightFt: 36,
  requiredParking: 60,
  loadingDocks: 12,
  preferredAccessRoad: "E Broadway Rd",
  priority: "Balanced",
};

const html = buildSiteIntelligenceReport({
  climate,
  site,
  requirements,
  building: null,
  trace: [],
  assets: {
    mastheadDataUrl: await dataUrl("public/sitemorph-report-masthead.jpg", "image/jpeg"),
    logoDataUrl: await dataUrl("public/sitemorph-logo-256.png", "image/png"),
    archivedSatelliteDataUrl: await dataUrl("public/evidence/south-phoenix-satellite-source.png", "image/png"),
    archivedSurfaceSegmentationDataUrl: await dataUrl("public/evidence/south-phoenix-surface-segmentation.png", "image/png"),
    archivedStreetDataUrl: await dataUrl("public/evidence/south-phoenix-street-source.jpg", "image/jpeg"),
    archivedStreetSegmentationDataUrl: await dataUrl("public/evidence/south-phoenix-street-segmentation.png", "image/png"),
  },
});

const outputDirectory = resolve(root, "artifacts");
await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(resolve(outputDirectory, "sitemorph-report-preview.html"), html),
  writeFile(resolve(outputDirectory, "SiteMorph-report-preview.doc"), html),
]);
