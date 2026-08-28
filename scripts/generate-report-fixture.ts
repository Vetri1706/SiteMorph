import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

import type { ClimateDNA, DesignBrief, SiteContext } from "../src/types/index.ts";
import { buildSiteIntelligenceReport } from "../src/utils/site-report.ts";

const root = resolve(import.meta.dirname, "..");

async function json<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(resolve(root, path), "utf8")) as T;
}

async function dataUrl(path: string): Promise<string> {
  const absolute = resolve(root, path);
  const extension = extname(absolute).toLowerCase();
  const mime = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${(await readFile(absolute)).toString("base64")}`;
}

const site = await json<SiteContext>("src/mocks/site.json");
const climate = await json<ClimateDNA>("src/mocks/climate-dna.json");
const requirements: DesignBrief = {
  buildingType: "Climate-controlled logistics / storage",
  totalAreaSqFt: 85_000,
  program: [{ name: "Storage and operations", areaSqFt: 78_000 }, { name: "Office / mezzanine", areaSqFt: 7_000 }],
  floors: 1,
  targetFootprintSqFt: 78_000,
  maximumHeightFt: 36,
  requiredParking: 60,
  loadingDocks: 12,
  preferredAccessRoad: "E Broadway Rd",
  priority: "Balanced",
};

const report = await buildSiteIntelligenceReport({
  climate,
  site,
  requirements,
  building: null,
  trace: [{ id: "fixture-recommendation", timestamp: new Date().toISOString(), type: "Recommendation", title: "Generate and validate one Forma building", detail: "Historical evidence is ready; native spatial validation is the next step." }],
  assets: {
    mastheadDataUrl: await dataUrl("public/sitemorph-report-masthead.jpg"),
    logoDataUrl: await dataUrl("public/sitemorph-logo-256.png"),
    archivedSatelliteDataUrl: await dataUrl("public/evidence/south-phoenix-satellite-source.png"),
    archivedSurfaceSegmentationDataUrl: await dataUrl("public/evidence/south-phoenix-surface-segmentation.png"),
    archivedStreetDataUrl: await dataUrl("public/evidence/south-phoenix-street-source.jpg"),
    archivedStreetSegmentationDataUrl: await dataUrl("public/evidence/south-phoenix-street-segmentation.png"),
  },
});

const outputDirectory = resolve(root, "artifacts");
const outputPath = resolve(outputDirectory, "SiteMorph-Site-Intelligence-Climate-Design-Report.docx");
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, new Uint8Array(await report.arrayBuffer()));
console.log(outputPath);
