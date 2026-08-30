import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  ImageRun,
  LevelFormat,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import type { ITableBordersOptions } from "docx";

import type { AgentTraceEvent, ClimateDNA, DesignBrief, GeneratedBuilding, ProgramPlan, SiteContext, SiteFitAssessment } from "../types";
import type { SubdivisionPlan, SubdivisionVariant } from "../types/subdivision";
import type { GeneratedSubdivisionResult } from "../services/forma-subdivision.service";
import type { SiteReportAssets } from "./report-assets";
import { createProgramPlan, formatInterventionPlacement, groundZonesInSpatialOrder, presentDesignNarrative } from "./program-plan.ts";

interface ReportInput {
  climate: ClimateDNA;
  site: SiteContext;
  requirements: DesignBrief;
  building: GeneratedBuilding | null;
  trace: AgentTraceEvent[];
  assets?: SiteReportAssets;
  siteFitAssessment?: SiteFitAssessment;
  selectedSiteFitOptionId?: string | null;
  subdivisionPlan?: SubdivisionPlan | null;
  selectedSubdivisionVariantId?: string | null;
  generatedSubdivision?: GeneratedSubdivisionResult | null;
}

const PAGE_WIDTH_DXA = 9360;
const NAVY = "0D1A29";
const INK = "17212B";
const BLUE = "2E74B5";
const DARK_BLUE = "17374B";
const TEAL = "30C5B2";
const MUTED = "5F6B76";
const BORDER = "CCD4DB";
const PALE_BLUE = "EDF5F7";
const PALE_TEAL = "EAF7F5";
const PALE_AMBER = "FFF7E8";
const PALE_ARCHIVE = "EEF5FA";
const WHITE = "FFFFFF";

const tableBorders = {
  top: { style: BorderStyle.SINGLE, color: BORDER, size: 4 },
  bottom: { style: BorderStyle.SINGLE, color: BORDER, size: 4 },
  left: { style: BorderStyle.SINGLE, color: BORDER, size: 4 },
  right: { style: BorderStyle.SINGLE, color: BORDER, size: 4 },
  insideHorizontal: { style: BorderStyle.SINGLE, color: BORDER, size: 4 },
  insideVertical: { style: BorderStyle.SINGLE, color: BORDER, size: 4 },
};

const noBorders = {
  top: { style: BorderStyle.NONE, color: WHITE, size: 0 },
  bottom: { style: BorderStyle.NONE, color: WHITE, size: 0 },
  left: { style: BorderStyle.NONE, color: WHITE, size: 0 },
  right: { style: BorderStyle.NONE, color: WHITE, size: 0 },
  insideHorizontal: { style: BorderStyle.NONE, color: WHITE, size: 0 },
  insideVertical: { style: BorderStyle.NONE, color: WHITE, size: 0 },
};

const formatNumber = (value: number) => value.toLocaleString("en-US");
const clean = (value: unknown) => String(value ?? "").replaceAll("→", "to");

function run(text: unknown, options: { bold?: boolean; color?: string; size?: number; italic?: boolean; font?: string } = {}): TextRun {
  return new TextRun({
    text: clean(text),
    bold: options.bold,
    italics: options.italic,
    color: options.color ?? INK,
    size: options.size ?? 22,
    font: options.font ?? "Calibri",
  });
}

function bodyParagraph(text: unknown, options: { bold?: boolean; color?: string; italic?: boolean; after?: number; keepNext?: boolean; alignment?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}): Paragraph {
  return new Paragraph({
    style: "ReportBody",
    alignment: options.alignment,
    keepNext: options.keepNext,
    spacing: { after: options.after ?? 120, line: 264, lineRule: "auto" },
    children: [run(text, options)],
  });
}

function richParagraph(children: TextRun[], options: { after?: number; keepNext?: boolean; alignment?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}): Paragraph {
  return new Paragraph({
    style: "ReportBody",
    alignment: options.alignment,
    keepNext: options.keepNext,
    spacing: { after: options.after ?? 120, line: 264, lineRule: "auto" },
    children,
  });
}

function sectionHeading(number: number, title: string, pageBreakBefore = false): Paragraph {
  return new Paragraph({
    style: "Heading1",
    pageBreakBefore,
    keepNext: true,
    children: [run(`${number}. ${title}`, { bold: true, color: BLUE, size: 32 })],
  });
}

function subheading(title: string): Paragraph {
  return new Paragraph({
    style: "Heading2",
    keepNext: true,
    children: [run(title, { bold: true, color: DARK_BLUE, size: 26 })],
  });
}

function bullet(text: unknown): Paragraph {
  return new Paragraph({
    style: "ReportBody",
    numbering: { reference: "report-bullets", level: 0 },
    spacing: { after: 80, line: 280, lineRule: "auto" },
    children: [run(text)],
  });
}

function tableCell(
  children: Paragraph[],
  width: number,
  options: { fill?: string; accentLeft?: string; borders?: ITableBordersOptions; verticalAlign?: "top" | "center" | "bottom" } = {},
): TableCell {
  const borders = options.borders ?? tableBorders;
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    margins: { top: 100, bottom: 100, left: 140, right: 140 },
    verticalAlign: options.verticalAlign ?? VerticalAlign.CENTER,
    shading: options.fill ? { fill: options.fill, type: ShadingType.CLEAR, color: "auto" } : undefined,
    borders: options.accentLeft ? { ...borders, left: { style: BorderStyle.SINGLE, color: options.accentLeft, size: 20 } } : borders,
    children,
  });
}

function dataCell(text: unknown, width: number, options: { bold?: boolean; fill?: string; color?: string; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; code?: boolean } = {}): TableCell {
  return tableCell([
    richParagraph([
      run(text, { bold: options.bold, color: options.color, size: options.code ? 17 : 20, font: options.code ? "Consolas" : "Calibri" }),
    ], { after: 0, alignment: options.align }),
  ], width, { fill: options.fill });
}

function fixedTable(rows: TableRow[], columnWidths: number[], options: { borders?: ITableBordersOptions; indent?: number } = {}): Table {
  return new Table({
    rows,
    width: { size: PAGE_WIDTH_DXA, type: WidthType.DXA },
    columnWidths,
    indent: { size: options.indent ?? 120, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    borders: options.borders ?? tableBorders,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
  });
}

function labelValueTable(rows: Array<[string, unknown]>): Table {
  const visibleRows = rows.filter(([, value]) => value !== undefined && value !== null && value !== "");
  return fixedTable(visibleRows.map(([label, value]) => new TableRow({
    cantSplit: true,
    children: [
      dataCell(label, 2700, { bold: true, fill: PALE_BLUE, color: DARK_BLUE }),
      dataCell(value, 6660),
    ],
  })), [2700, 6660]);
}

function matrixTable(headers: string[], rows: unknown[][], widths: number[]): Table {
  const header = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: headers.map((item, index) => dataCell(item, widths[index], { bold: true, fill: PALE_BLUE, color: DARK_BLUE })),
  });
  return fixedTable([header, ...rows.map((items) => new TableRow({
    cantSplit: true,
    children: items.map((item, index) => dataCell(item, widths[index])),
  }))], widths);
}

function programPlanCell(title: string, lines: string[], width: number, fill: string, options: { color?: string; columnSpan?: number } = {}): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    columnSpan: options.columnSpan,
    margins: { top: 120, bottom: 120, left: 150, right: 150 },
    verticalAlign: VerticalAlign.CENTER,
    shading: { fill, type: ShadingType.CLEAR, color: "auto" },
    borders: tableBorders,
    children: [
      richParagraph([run(title, { bold: true, color: options.color ?? DARK_BLUE, size: 21 })], { after: 45, alignment: AlignmentType.CENTER }),
      ...lines.map((line) => richParagraph([run(line, { color: options.color ?? MUTED, size: 17 })], { after: 20, alignment: AlignmentType.CENTER })),
    ],
  });
}

function programPlanTable(plan: ProgramPlan): Table {
  const areaAndSize = (areaSqFt: number, widthFt: number, depthFt: number) => `${formatNumber(areaSqFt)} ft2  |  ${widthFt} ft x ${depthFt} ft`;
  const groundZones = groundZonesInSpatialOrder(plan);
  const upperZones = plan.zones.filter((zone) => zone.level !== "ground");
  const groundTotal = groundZones.reduce((sum, zone) => sum + zone.areaSqFt, 0);
  let allocatedWidth = 0;
  const columnWidths = groundZones.length ? groundZones.map((zone, index) => {
    const width = index === groundZones.length - 1
      ? PAGE_WIDTH_DXA - allocatedWidth
      : Math.max(1, Math.round(PAGE_WIDTH_DXA * zone.areaSqFt / Math.max(1, groundTotal)));
    allocatedWidth += width;
    return width;
  }) : [PAGE_WIDTH_DXA];
  const columnCount = columnWidths.length;
  const rows: TableRow[] = [
    new TableRow({ cantSplit: true, children: [programPlanCell(plan.operations.edgeLabel.toUpperCase(), [plan.operations.itemCount ? `${plan.operations.itemCount} ${plan.operations.itemLabel}${plan.operations.itemCount === 1 ? "" : "s"}  |  approx. ${plan.operations.approximateItemSpacingFt} ft spacing` : "Arrival, access and servicing to be resolved"], PAGE_WIDTH_DXA, NAVY, { color: WHITE, columnSpan: columnCount })] }),
    new TableRow({ cantSplit: true, children: [programPlanCell(plan.operations.shelteredBandLabel.toUpperCase(), [`${plan.operations.shelteredBandDepthFt} ft concept depth`], PAGE_WIDTH_DXA, "DDF5F1", { color: "16695F", columnSpan: columnCount })] }),
  ];
  if (groundZones.length) {
    rows.push(new TableRow({
      cantSplit: true,
      height: { value: 1000, rule: "atLeast" },
      children: groundZones.map((zone, index) => programPlanCell(
        zone.name.toUpperCase(),
        [areaAndSize(zone.areaSqFt, zone.widthFt, zone.depthFt), `${zone.side ? `${zone.side} side · ` : ""}${zone.source.replaceAll("-", " ")}`],
        columnWidths[index],
        zone.role === "primary" ? "E7F1F5" : zone.role === "support" ? "EDF0F2" : "EEF7F7",
      )),
    }));
  }
  for (const zone of upperZones) rows.push(new TableRow({
    cantSplit: true,
    children: [programPlanCell(
      `${zone.name.toUpperCase()} — ${zone.level.toUpperCase()}`,
      [areaAndSize(zone.areaSqFt, zone.widthFt, zone.depthFt), `${zone.side ? `${zone.side} side · ` : ""}${zone.source.replaceAll("-", " ")}`],
      PAGE_WIDTH_DXA,
      PALE_TEAL,
      { columnSpan: columnCount },
    )],
  }));
  rows.push(new TableRow({ cantSplit: true, children: [programPlanCell(plan.operations.outdoorZoneLabel.toUpperCase(), [`${plan.operations.outdoorZoneDepthFt} ft concept depth · access and fire verification required`], PAGE_WIDTH_DXA, "F7ECD6", { color: "755622", columnSpan: columnCount })] }));
  rows.push(new TableRow({ cantSplit: true, children: [programPlanCell("PREFERRED ACCESS", [plan.access.status === "requirement" ? plan.access.preferredRoad : "Access engineering unconfirmed"], PAGE_WIDTH_DXA, "F5F7F8", { columnSpan: columnCount })] }));
  rows.push(new TableRow({ cantSplit: true, children: [programPlanCell("PARKING", [plan.parking.requiredSpaces ? `${plan.parking.requiredSpaces}-space preliminary allowance` : "Not specified"], PAGE_WIDTH_DXA, "F5F7F8", { columnSpan: columnCount })] }));
  return fixedTable(rows, columnWidths);
}

function callout(children: Paragraph[], fill: string, accent: string): Table {
  return fixedTable([new TableRow({
    cantSplit: true,
    children: [tableCell(children, PAGE_WIDTH_DXA, { fill, accentLeft: accent })],
  })], [PAGE_WIDTH_DXA]);
}

function dataUrlBytes(dataUrl: string): { data: Uint8Array; type: "jpg" | "png" | "gif" | "bmp" } | null {
  const match = /^data:image\/(png|jpe?g|gif|bmp);base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  try {
    const binary = globalThis.atob(match[2]);
    const data = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const type = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase() as "jpg" | "png" | "gif" | "bmp";
    return { data, type };
  } catch {
    return null;
  }
}

function imageDimensions(data: Uint8Array, type: "jpg" | "png" | "gif" | "bmp"): { width: number; height: number } | null {
  if (type === "png" && data.length >= 24 && data[0] === 0x89 && data[1] === 0x50) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (type === "jpg" && data.length > 10 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    while (offset + 8 < data.length) {
      if (data[offset] !== 0xff) { offset += 1; continue; }
      const marker = data[offset + 1];
      const length = (data[offset + 2] << 8) + data[offset + 3];
      if (startOfFrame.has(marker)) {
        return { height: (data[offset + 5] << 8) + data[offset + 6], width: (data[offset + 7] << 8) + data[offset + 8] };
      }
      if (!Number.isFinite(length) || length < 2) break;
      offset += 2 + length;
    }
  }
  return null;
}

function imageRun(dataUrl: string | undefined, maxWidth: number, maxHeight: number, description: string): ImageRun | null {
  if (!dataUrl) return null;
  const decoded = dataUrlBytes(dataUrl);
  if (!decoded) return null;
  const dimensions = imageDimensions(decoded.data, decoded.type) ?? { width: 1200, height: 675 };
  const scale = Math.min(maxWidth / dimensions.width, maxHeight / dimensions.height, 1);
  return new ImageRun({
    type: decoded.type,
    data: decoded.data,
    transformation: { width: Math.max(1, Math.round(dimensions.width * scale)), height: Math.max(1, Math.round(dimensions.height * scale)) },
    altText: { title: description, description, name: description },
  });
}

function fullWidthFigure(source: string | undefined, caption: string, maxHeight = 360): Array<Paragraph | Table> {
  const image = imageRun(source, 620, maxHeight, caption);
  if (!image) return [];
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 100, after: 60 }, children: [image] }),
    new Paragraph({ style: "Caption", alignment: AlignmentType.CENTER, keepNext: false, children: [run(caption, { color: MUTED, size: 17 })] }),
  ];
}

function evidencePair(items: Array<{ source?: string; caption: string }>): Table | null {
  const visible = items.filter((item) => Boolean(item.source)).slice(0, 2);
  if (!visible.length) return null;
  const widths = visible.length === 1 ? [PAGE_WIDTH_DXA] : [4680, 4680];
  const cells = visible.map((item, index) => {
    const image = imageRun(item.source, visible.length === 1 ? 600 : 285, 190, item.caption);
    return tableCell([
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 70 }, children: image ? [image] : [] }),
      new Paragraph({ style: "Caption", alignment: AlignmentType.CENTER, children: [run(item.caption, { color: MUTED, size: 17 })] }),
    ], widths[index], { borders: noBorders, verticalAlign: VerticalAlign.TOP });
  });
  return fixedTable([new TableRow({ cantSplit: true, children: cells })], widths, { borders: noBorders, indent: 0 });
}

function brandBar(assets?: SiteReportAssets): Table {
  const logo = imageRun(assets?.logoDataUrl, 30, 30, "SiteMorph logo");
  const left = new Paragraph({
    spacing: { after: 0 },
    children: [...(logo ? [logo, run("  ", { color: WHITE })] : []), run("SiteMorph", { bold: true, color: WHITE, size: 26 })],
  });
  const right = new Paragraph({
    alignment: AlignmentType.RIGHT,
    spacing: { after: 0 },
    children: [run("SITE INTELLIGENCE & CLIMATE DESIGN", { bold: true, color: "BFEEE7", size: 16 })],
  });
  return fixedTable([new TableRow({ cantSplit: true, children: [
      tableCell([left], 4680, { fill: NAVY, borders: noBorders }),
      tableCell([right], 4680, { fill: NAVY, borders: noBorders }),
    ] })], [4680, 4680], { borders: noBorders, indent: 0 });
}

function reportHeader(): Header {
  return new Header({
    children: [new Paragraph({
      spacing: { after: 60 },
      border: { bottom: { style: BorderStyle.SINGLE, color: TEAL, size: 8 } },
      children: [run("SiteMorph  |  Site Intelligence & Climate Design", { bold: true, color: NAVY, size: 18 })],
    })],
  });
}

function reportFooter(): Footer {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { before: 80, after: 0 },
      border: { top: { style: BorderStyle.SINGLE, color: TEAL, size: 8 } },
      children: [run("SiteMorph  |  Evidence-to-design report  |  Page ", { color: MUTED, size: 17 }), new TextRun({ children: [PageNumber.CURRENT], color: MUTED, size: 17, font: "Calibri" })],
    })],
  });
}

function dateLabel(site: SiteContext): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: site.timezone ?? "UTC",
    }).format(new Date());
  } catch {
    return new Date().toLocaleString("en-US");
  }
}

function createDocument({
  climate,
  site,
  requirements,
  building,
  trace,
  assets,
  siteFitAssessment,
  selectedSiteFitOptionId,
  subdivisionPlan,
  selectedSubdivisionVariantId,
  generatedSubdivision,
}: ReportInput): Document {
  const children: Array<Paragraph | Table> = [];
  const constraints = climate.designBrief.siteWideConstraints;
  const concept = requirements.buildingType || "Not chosen";
  const confidence = building ? (building.analysisMetricSource === "ground-grid" ? "Moderate" : "Low-Moderate") : "Preliminary";
  const programPlan = building ? building.programPlan ?? createProgramPlan(requirements, {
    footprintSqFt: building.footprintSqFt,
    grossFloorAreaSqFt: building.grossFloorAreaSqFt,
    mezzanineAreaSqFt: building.mezzanineAreaSqFt,
    heightFt: building.heightFt,
    aspectRatio: building.aspectRatio,
    orientationLabel: building.orientationLabel,
  }, { officeMezzanineSide: building.intervention?.outcome === "accepted" ? building.intervention.tested?.officeMezzanineSide : building.intervention?.initial.officeMezzanineSide }) : undefined;
  const displayedChangeSummary = building && programPlan ? presentDesignNarrative(building.changeSummary, programPlan) : undefined;
  const responseContainsSun = building?.climateResponse?.inputs.some((input) => input.id === "forma-sun" && input.source === "forma") ?? false;
  const readableClimateResponse = building?.climateResponse && !(responseContainsSun && building.analysisMetricSource !== "ground-grid")
    ? building.climateResponse
    : undefined;
  const selectedSiteFitOption = siteFitAssessment?.options.find((option) => option.id === selectedSiteFitOptionId)
    ?? siteFitAssessment?.options.find((option) => option.brief.buildingType === requirements.buildingType);
  const selectedSubdivisionVariant: SubdivisionVariant | undefined = subdivisionPlan?.variants.find((variant) => variant.id === generatedSubdivision?.variantId)
    ?? subdivisionPlan?.variants.find((variant) => variant.id === selectedSubdivisionVariantId)
    ?? (subdivisionPlan && selectedSubdivisionVariantId == null ? subdivisionPlan.variants.find((variant) => variant.rank === 1) : undefined);
  const subdivisionMode = Boolean(selectedSubdivisionVariant || generatedSubdivision);
  const subdivisionBuilt = Boolean(generatedSubdivision);
  const subdivisionStatus = subdivisionBuilt
    ? `Persistent Forma subdivision - ${formatNumber(generatedSubdivision!.elements.length)} dwelling floor stacks + planning context`
    : selectedSubdivisionVariant
      ? `Subdivision option selected - ${formatNumber(selectedSubdivisionVariant.metrics.dwellingCount)} dwellings - not written to Forma`
      : "Subdivision generation result present";

  children.push(brandBar(assets));
  children.push(...fullWidthFigure(assets?.mastheadDataUrl, "SiteMorph geospatial intelligence", 150));
  children.push(new Paragraph({ style: "Kicker", children: [run("SITE INTELLIGENCE REPORT", { bold: true, color: TEAL, size: 18 })] }));
  children.push(new Paragraph({ style: "ReportTitle", children: [run("SiteMorph — Site Intelligence & Climate Design Report", { bold: true, color: NAVY, size: 44 })] }));
  children.push(bodyParagraph("FortyGuard historical evidence + Autodesk Forma design-performance analysis", { color: MUTED, italic: true, after: 220 }));
  children.push(callout([
    richParagraph([run(site.projectName, { bold: true, size: 28, color: NAVY })], { after: 70 }),
    richParagraph([run(`${site.location}  |  ${formatNumber(site.areaSqFt)} ft2  |  ${site.areaAcres} acres`, { color: DARK_BLUE })], { after: 70 }),
    richParagraph([run("Requested concept: ", { bold: true }), run(subdivisionMode && selectedSubdivisionVariant
      ? `${selectedSubdivisionVariant.label}  |  ${formatNumber(selectedSubdivisionVariant.metrics.dwellingCount)} dwellings`
      : `${concept}  |  ${formatNumber(requirements.totalAreaSqFt || requirements.targetFootprintSqFt)} ft2`)], { after: 0 }),
  ], PALE_TEAL, TEAL));
  children.push(bodyParagraph(`Generated ${dateLabel(site)}  |  Concept-stage evidence-to-design workflow`, { color: MUTED, after: 180 }));

  children.push(matrixTable(["Key signal", "Current finding"], [
    ["Hot-season exposure", climate.profile.thermalExposure],
    ["Summer persistence", climate.profile.persistence],
    ["Thermal zoning confidence", climate.designBrief.thermalZoningConfidence],
    ["Design status", subdivisionMode ? subdivisionStatus : building ? `Forma Design R${building.revision}` : "Building not generated"],
  ], [3600, 5760]));
  children.push(callout([
    richParagraph([run(subdivisionMode ? (subdivisionBuilt ? "Native subdivision proposal created" : "Subdivision option selected") : building ? `Recommendation confidence: ${confidence}` : "Next required action", { bold: true, color: NAVY, size: 24 })], { after: 70 }),
    bodyParagraph(subdivisionMode
      ? subdivisionBuilt
        ? `${generatedSubdivision!.elements.length} separate native Forma dwelling floor stacks and one refresh-safe virtual planning context root were terrain-placed and verified. One native Sun analysis was requested for the Site Limit; conceptual roads and trees were excluded from physical analysis.`
        : "This deterministic option is documented below, but it has not been written to the Forma proposal and has no native design-analysis result."
      : building ? displayedChangeSummary : "Generate one building in Forma, run native Sun and Rapid Wind, and export again to complete the spatial design evidence.", { after: 0 }),
  ], subdivisionMode ? (subdivisionBuilt ? PALE_TEAL : PALE_AMBER) : building ? PALE_TEAL : PALE_AMBER, subdivisionMode ? (subdivisionBuilt ? TEAL : "D9951E") : building ? TEAL : "D9951E"));
  children.push(sectionHeading(1, "Site overview", true));
  children.push(labelValueTable([
    ["Project", site.projectName],
    ["Location", site.location],
    ["Proposal", site.selectedProposal],
    ["Selected Site Limit", site.selectedSiteLimit],
    ["Site area", `${formatNumber(site.areaSqFt)} ft2 / ${site.areaAcres} acres`],
    ["Analysis basis", "Real Forma Site Limit + FortyGuard historical/site evidence"],
    ["Planning status", "Zoning, entitlement, utilities, access engineering and market feasibility are not connected"],
  ]));

  children.push(sectionHeading(2, "Climate history"));
  children.push(matrixTable(["Metric", "Observed value", "Meaning"], [
    ["Hot-season mean", `${climate.thermal.meanCelsius} C`, "Historical thermal burden"],
    ["Hot-season maximum", `${climate.thermal.maxCelsius} C`, "Peak sampled condition"],
    [`Mean exceedance above ${climate.thermal.thresholdCelsius} C`, `${climate.thermal.hoursAboveThreshold} h`, "Mean exceedance duration"],
    ["Maximum continuous persistence", `${climate.thermal.longestPersistenceHours} h`, "Longest continuous episode"],
    ["Peak thermal hour", climate.thermal.peakThermalHour, climate.thermal.peakThermalHourUtc ?? "UTC retained in evidence trail"],
  ], [2700, 2100, 4560]));
  children.push(bodyParagraph(climate.provenance.thermal?.label ?? "FortyGuard historical thermal evidence", { color: MUTED, italic: true }));

  children.push(sectionHeading(3, "Climate Design Brief", true));
  children.push(callout([
    richParagraph([run(`Thermal zoning confidence: ${climate.designBrief.thermalZoningConfidence}`, { bold: true, color: NAVY, size: 24 })], { after: 70 }),
    bodyParagraph(climate.designBrief.summary, { after: 0 }),
  ], PALE_TEAL, TEAL));
  children.push(matrixTable(["Priority", "Level", "Evidence-based reason"], climate.designBrief.priorities.map((item) => [item.label, item.level, item.reason]), [2450, 1500, 5410]));
  children.push(subheading("Site-wide constraints"));
  children.push(...constraints.map(bullet));

  children.push(sectionHeading(4, "Environmental and site intelligence"));
  children.push(subheading("Environmental parameters"));
  const environmentalRows: Array<[string, unknown]> = climate.environmental ? [
    ["Relative humidity", climate.environmental.relativeHumidityPercent === undefined ? undefined : `${climate.environmental.relativeHumidityPercent}%`],
    ["Wet-bulb temperature", climate.environmental.wetBulbCelsius === undefined ? undefined : `${climate.environmental.wetBulbCelsius} C`],
    ["Apparent temperature", climate.environmental.apparentTemperatureCelsius === undefined ? undefined : `${climate.environmental.apparentTemperatureCelsius} C`],
    ["Heat index", climate.environmental.heatIndexCelsius === undefined ? undefined : `${climate.environmental.heatIndexCelsius} C`],
    ["US AQI", climate.environmental.airQualityIndexUs],
    ["Cloud cover", climate.environmental.cloudCoverPercent === undefined ? undefined : `${climate.environmental.cloudCoverPercent}%`],
    ["Precipitation", climate.environmental.precipitationMm === undefined ? undefined : `${climate.environmental.precipitationMm} mm`],
  ] : [];
  if (environmentalRows.some(([, value]) => value !== undefined && value !== null && value !== "")) children.push(labelValueTable(environmentalRows));
  else children.push(callout([bodyParagraph("Environmental parameters were unavailable for this analysis window. No placeholder values were used.", { after: 0 })], PALE_AMBER, "D9951E"));

  const archivedSurface = !climate.surface && Boolean(assets?.archivedSatelliteDataUrl || assets?.archivedSurfaceSegmentationDataUrl);
  children.push(subheading("Satellite - What is around the site?"));
  const surfacePair = evidencePair([
    { source: climate.surface?.originalImageDataUrl ?? assets?.archivedSatelliteDataUrl, caption: climate.surface ? `Satellite context${climate.surface.imageYear ? ` - ${climate.surface.imageYear}` : ""}` : "Archived satellite context - South Phoenix - captured 23 Aug 2026" },
    { source: climate.surface?.segmentedImageDataUrl ?? assets?.archivedSurfaceSegmentationDataUrl, caption: climate.surface ? "FortyGuard surface segmentation" : "Archived FortyGuard surface segmentation - supporting context" },
  ]);
  if (surfacePair) children.push(surfacePair);
  if (climate.surface) children.push(bodyParagraph(`Finding: ${climate.surface.imperviousPercent}% impervious surface and ${climate.surface.canopyVegetationPercent}% canopy/vegetation in the sampled context. These values drive paving reduction and shade priorities.`));
  else if (archivedSurface) children.push(callout([bodyParagraph("Archived evidence: recovered from the earlier South Phoenix analysis as visual context only. Credit Saver did not request or charge for it again; earlier percentages are not carried into the current thermal result.", { after: 0 })], PALE_ARCHIVE, BLUE));
  else children.push(bodyParagraph("Satellite surface segmentation was unavailable."));

  const archivedStreet = !climate.street?.available && Boolean(assets?.archivedStreetDataUrl || assets?.archivedStreetSegmentationDataUrl);
  children.push(subheading("Street view - What does the access edge look like?"));
  const streetPair = evidencePair([
    { source: climate.street?.available ? climate.street.originalImageDataUrl : assets?.archivedStreetDataUrl, caption: climate.street?.available ? `Street view - ${climate.street.sampleLabel ?? "sampled access edge"}` : "Archived street view - North access edge - captured 23 Aug 2026" },
    { source: climate.street?.available ? climate.street.segmentedImageDataUrl : assets?.archivedStreetSegmentationDataUrl, caption: climate.street?.available ? "FortyGuard street segmentation" : "Archived FortyGuard street segmentation - supporting context" },
  ]);
  if (streetPair) children.push(streetPair);
  if (climate.street?.available) children.push(bodyParagraph(`Finding: the sampled edge contains ${climate.street.roadPercent}% road, ${climate.street.treePercent}% tree and ${climate.street.skyPercent}% sky. Sky percentage is an openness proxy, not a true Sky View Factor.`));
  else if (archivedStreet) children.push(callout([bodyParagraph("Archived evidence: earlier north access-edge source and segmentation imagery are supporting context. No new Street View activity was submitted.", { after: 0 })], PALE_ARCHIVE, BLUE));
  else children.push(bodyParagraph("Street imagery was unavailable at the sampled access edge; SiteMorph continued without it."));

  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(sectionHeading(5, "What could fit here?"));
  children.push(bodyParagraph("Site Fit Advisor is a deterministic, no-paid-AI-API ranking of preliminary physical and climate compatibility. It is not a land-use approval or highest-and-best-use study.", { color: MUTED, italic: true }));
  if (siteFitAssessment) {
    children.push(matrixTable(
      ["Rank", "Typology", "Score", "Status", "Input-specific sizing"],
      siteFitAssessment.options.map((option) => [
        option.rank,
        `${option.label}${option.id === selectedSiteFitOption?.id ? " (selected)" : ""}`,
        `${option.score} / 100`,
        option.status.replaceAll("-", " "),
        option.sizeSummary,
      ]),
      [700, 2050, 1150, 1760, 3700],
    ));
    if (selectedSiteFitOption) children.push(callout([
      richParagraph([run("Selected Site Fit Advisor option: ", { bold: true }), run(`${selectedSiteFitOption.label} — score ${selectedSiteFitOption.score} / 100`, { bold: true, color: NAVY })], { after: 70 }),
      bodyParagraph(`Preliminary parking allowance: ${selectedSiteFitOption.brief.requiredParking} spaces. This is a site-fit planning input, not a code-derived parking requirement.`, { after: 0 }),
    ], PALE_TEAL, TEAL));
    children.push(subheading("Missing feasibility evidence"));
    children.push(...siteFitAssessment.missingEvidence.map(bullet));
    children.push(bodyParagraph(siteFitAssessment.disclaimer, { color: MUTED, italic: true }));
  } else {
    children.push(callout([bodyParagraph("A Site Fit Advisor assessment was not included in this export. Reopen the selected Forma Site Limit and export again to include the input-specific ranked options.", { after: 0 })], PALE_AMBER, "D9951E"));
  }

  children.push(sectionHeading(6, "Generated Forma proposal"));
  if (subdivisionMode) {
    children.push(subheading(subdivisionBuilt ? "Selected native Forma subdivision" : "Selected subdivision option - preview only"));
    if (generatedSubdivision) children.push(...fullWidthFigure(generatedSubdivision.designImageDataUrl, "Selected subdivision captured from the live Forma proposal", 300));
    if (selectedSubdivisionVariant) {
      const metrics = selectedSubdivisionVariant.metrics;
      children.push(labelValueTable([
        ["Selected strategy", `${selectedSubdivisionVariant.label} - rank ${selectedSubdivisionVariant.rank}`],
        ["Deterministic option score", `${selectedSubdivisionVariant.scoreBreakdown.totalScore} / 100`],
        ["Lots / dwellings", `${formatNumber(metrics.lotCount)} / ${formatNumber(metrics.dwellingCount)}`],
        ["Land efficiency", `${metrics.landEfficiencyPercent}%`],
        ["Average lot area", `${formatNumber(metrics.averageLotAreaSqFt)} ft2`],
        ["Average dwelling GFA", `${formatNumber(metrics.averageDwellingGfaSqFt)} ft2`],
        ["Total dwelling GFA", `${formatNumber(metrics.totalDwellingGfaSqFt)} ft2`],
        ["Dwelling footprint area", `${formatNumber(metrics.dwellingFootprintAreaSqFt)} ft2`],
        ["Road and path area", `${formatNumber(metrics.roadAndPathAreaSqFt)} ft2`],
        ["Open land", `${metrics.openLandPercent}%`],
        ["Preliminary parking provision", `${formatNumber(metrics.parkingProvision)} spaces`],
        ["Preliminary tree assumptions", `${formatNumber(metrics.treeCount)} points; ${metrics.estimatedCanopyCoveragePercent}% conceptual canopy`],
        ["Dominant-axis basis", `${selectedSubdivisionVariant.axis.angleDegrees.toFixed(1)} degrees from the Forma Site Limit dominant axis`],
      ]));
      children.push(callout([
        bodyParagraph(subdivisionBuilt
          ? `${generatedSubdivision!.elements.length} separate dwelling floor stacks were persisted as native Forma geometry. Roads, paths, lot/open-space terrain shapes and ${generatedSubdivision!.persistentContext.treeCount} recognizable low-poly trees were persisted separately as one virtual SiteMorph-authored concept root that survives refresh.`
          : "Option-only state: no subdivision dwelling geometry has been written to Forma, no terrain placement has been verified and no native Forma design analysis has been run for this option.", { after: 0 }),
      ], subdivisionBuilt ? PALE_TEAL : PALE_AMBER, subdivisionBuilt ? TEAL : "D9951E"));
    } else if (generatedSubdivision) {
      children.push(labelValueTable([
        ["Persisted variant", generatedSubdivision.variantLabel],
        ["Native floor stacks", generatedSubdivision.elements.length],
        ["Total dwelling GFA", `${formatNumber(generatedSubdivision.totalGrossFloorAreaSqFt)} ft2`],
      ]));
      children.push(callout([bodyParagraph("The selected deterministic option was unavailable in this export, so its lots, roads, plan metrics and FortyGuard ranking cannot be reconstructed from the generated geometry alone.", { after: 0 })], PALE_AMBER, "D9951E"));
    }
    if (generatedSubdivision) children.push(labelValueTable([
      ["Run ID", generatedSubdivision.runId],
      ["Native Forma floor stacks", generatedSubdivision.elements.length],
      ["Persistent planning-context root", generatedSubdivision.persistentContext.elementPath],
      ["Context model", generatedSubdivision.persistentContext.modelVersion],
      ["Persistent road / path features", `${generatedSubdivision.persistentContext.roadFeatureCount} / ${generatedSubdivision.persistentContext.pedestrianPathFeatureCount}`],
      ["Persistent open-space / lot features", `${generatedSubdivision.persistentContext.openSpaceFeatureCount} / ${generatedSubdivision.persistentContext.lotOutlineFeatureCount}`],
      ["Persistent low-poly trees", `${generatedSubdivision.persistentContext.treeCount}; ${generatedSubdivision.persistentContext.treeTerrainVerificationCount} terrain placements verified`],
      ["Total persisted GFA", `${formatNumber(generatedSubdivision.totalGrossFloorAreaSqFt)} ft2`],
      ["Dwelling terrain samples", generatedSubdivision.terrainSampleCount],
      ["Dwelling terrain placement verifications", `${generatedSubdivision.terrainVerificationCount} of ${generatedSubdivision.elements.length}`],
      ["Replaced prior SiteMorph roots", generatedSubdivision.removedPreviousPaths.length],
    ]));
  } else if (building) {
    if (programPlan) {
      children.push(subheading("Dimensioned 2D program/site plan"));
      children.push(programPlanTable(programPlan));
      children.push(bodyParagraph("Ground-program cell widths are proportional to the stated ground areas; printed width × depth dimensions remain the governing concept measurements.", { color: MUTED, italic: true }));
      children.push(labelValueTable([
        ["Building envelope", `${programPlan.buildingWidthFt} ft x ${programPlan.buildingDepthFt} ft`],
        ["Footprint / gross area", `${formatNumber(programPlan.footprintSqFt)} ft2 / ${formatNumber(programPlan.grossFloorAreaSqFt)} ft2`],
        ["Program basis", programPlan.programSummary],
        [programPlan.operations.edgeLabel, programPlan.operations.itemCount ? `${programPlan.operations.itemCount} ${programPlan.operations.itemLabel}${programPlan.operations.itemCount === 1 ? "" : "s"}` : "Access and servicing to be resolved"],
        [`${programPlan.interventionProgramLabel} side`, programPlan.officeMezzanineSide],
      ]));
      children.push(callout([bodyParagraph(programPlan.disclaimer, { color: MUTED, italic: true, after: 0 })], PALE_AMBER, "D9951E"));
    }
    children.push(subheading("Native Forma analysis mass"));
    children.push(...fullWidthFigure(building.designImageDataUrl, "Generated proposal captured from the live Forma scene for native analysis", 300));
    children.push(labelValueTable([
      ["Proposal", `SiteMorph Design R${building.revision}`],
      ["Building type", building.name],
      ["Total / gross area", `${formatNumber(building.grossFloorAreaSqFt)} ft2`],
      ["Footprint", `${formatNumber(building.footprintSqFt)} ft2`],
      ["Main floors", building.floors],
      ["Upper-floor gross area", building.upperFloorAreaSqFt ? `${formatNumber(building.upperFloorAreaSqFt)} ft2` : undefined],
      ["Partial top level", building.partialTopFloorAreaSqFt ? `${formatNumber(building.partialTopFloorAreaSqFt)} ft2` : undefined],
      ["Maximum height", `${building.heightFt} ft`],
      ["Orientation", building.orientationLabel],
      ["Aspect ratio", `${building.aspectRatio.toFixed(1)}:1`],
      ["Site coverage", `${building.siteCoveragePercent}%`],
      ["Parcel outside mass", `${formatNumber(building.remainingSiteAreaSqFt)} ft2 gross, before parking, setbacks, access, fire/civil and landscape reservations`],
      ["Terrain placement", building.placementVerification ? `${building.placementVerification.terrainBaseElevationMeters.toFixed(3)} m base from ${building.placementVerification.terrainSampleCount} real terrain samples` : undefined],
      ["Persisted XY / Z", building.placementVerification ? `${building.placementVerification.worldTransformXMeters.toFixed(3)}, ${building.placementVerification.worldTransformYMeters.toFixed(3)} / ${building.placementVerification.worldTransformElevationMeters.toFixed(3)} m` : undefined],
      ["Generated mesh base", building.placementVerification ? `${building.placementVerification.meshBaseElevationMeters.toFixed(3)} m; verified within ${building.placementVerification.toleranceMeters.toFixed(2)} m` : undefined],
    ]));
    children.push(subheading("Program allocation"));
    if (requirements.program.length) children.push(matrixTable(["Program", "Area"], requirements.program.map((item) => [item.name, `${formatNumber(item.areaSqFt)} ft2`]), [6500, 2860]));
    else children.push(bodyParagraph(programPlan?.programSummary ?? "No internal program allocation was supplied for this concept."));
    children.push(subheading("Why this massing was selected"));
    children.push(bodyParagraph(formatInterventionPlacement(building.placementSummary, programPlan!)));
    children.push(subheading("Key climate constraints used"));
    children.push(...constraints.map(bullet));
  } else children.push(callout([bodyParagraph("No generated Forma building was present when this report was exported. Generate and evaluate a building, then export the report again.", { after: 0 })], PALE_AMBER, "D9951E"));

  children.push(sectionHeading(7, "Native Forma analysis"));
  if (subdivisionMode) {
    if (subdivisionPlan) {
      children.push(subheading("FortyGuard four-signal historical burden"));
      children.push(labelValueTable([
        ["Historical burden", `${subdivisionPlan.historicalBurden.scorePercent} / 100`],
        ["Evidence timestamp", subdivisionPlan.historicalBurden.evidenceGeneratedAt],
        ["Peak thermal hour - site local", subdivisionPlan.historicalBurden.peakThermalHour ?? "Unavailable"],
        ["Peak thermal hour - UTC", subdivisionPlan.historicalBurden.peakThermalHourUtc ?? "Unavailable"],
        ["Peak-time role", "Supporting evidence only - excluded from numerical burden"],
        ["Thermal zoning mode", subdivisionPlan.historicalBurden.thermalZoningMode],
        ["Directional claim", subdivisionPlan.historicalBurden.directionalClaim ?? "None - site-wide treatment"],
      ]));
      children.push(matrixTable(
        ["Real FortyGuard signal", "Observed value", "Normalized risk", "Weight"],
        subdivisionPlan.historicalBurden.inputs.map((input) => [
          input.label,
          `${input.value} ${input.unit}`,
          input.normalizedRisk.toFixed(3),
          `${input.weightPercent}%`,
        ]),
        [3900, 1900, 1800, 1760],
      ));
      children.push(callout([
        bodyParagraph(subdivisionPlan.historicalBurden.formula, { bold: true, after: 70 }),
        bodyParagraph(subdivisionPlan.historicalBurden.peakTimeEvidenceNote, { color: MUTED, after: 70 }),
        bodyParagraph(subdivisionPlan.historicalBurden.spatialNote, { color: MUTED, italic: true, after: 0 }),
      ], PALE_TEAL, TEAL));
    }
    if (selectedSubdivisionVariant) {
      children.push(subheading("Multiplicative plan mitigation"));
      children.push(labelValueTable([
        ["Historical burden", `${selectedSubdivisionVariant.climatePerformance.historicalBurdenScore} / 100`],
        ["Plan mitigation multiplier", selectedSubdivisionVariant.climatePerformance.mitigationMultiplier.toFixed(3)],
        ["Residual heat risk", `${selectedSubdivisionVariant.climatePerformance.residualHeatRiskScore} / 100`],
        ["Climate resilience", `${selectedSubdivisionVariant.climatePerformance.resilienceScore} / 100`],
        ["Spatial treatment", selectedSubdivisionVariant.climatePerformance.spatialTreatment],
      ]));
      children.push(matrixTable(
        ["Mitigation factor", "Risk multiplier", "Weight", "Evidence"],
        selectedSubdivisionVariant.climatePerformance.factors.map((factor) => [factor.label, factor.riskMultiplier.toFixed(3), `${factor.weightPercent}%`, factor.evidence]),
        [2400, 1650, 1300, 4010],
      ));
      children.push(callout([bodyParagraph(selectedSubdivisionVariant.climatePerformance.formula, { bold: true, after: 0 })], PALE_TEAL, TEAL));
    }
    children.push(subheading("Complete-proposal native Sun analysis"));
    if (generatedSubdivision) {
      const native = generatedSubdivision.nativeAnalysis;
      children.push(labelValueTable([
        ["Status", native.status],
        ["Analysis ID", native.analysisId],
        ["Analysis area", native.selectedElementPath],
        ["Metric source", native.metricSource],
        ["Mean ground sun", native.metricSource === "ground-grid" && native.meanSunHours !== undefined ? `${native.meanSunHours} h` : undefined],
        ["Maximum ground sun", native.metricSource === "ground-grid" && native.maxSunHours !== undefined ? `${native.maxSunHours} h` : undefined],
        ["Native floor stacks validated", `${generatedSubdivision.terrainVerificationCount} of ${generatedSubdivision.elements.length}`],
        ["Global terrain samples", generatedSubdivision.terrainSampleCount],
      ]));
      children.push(callout([bodyParagraph(native.note, { after: 0 })], native.status === "succeeded" ? PALE_TEAL : PALE_AMBER, native.status === "succeeded" ? TEAL : "D9951E"));
      children.push(bodyParagraph("Analysis scope: native dwelling floor stacks only. The persistent road, green, lot and tree context is marked virtual, so it remains visible and refresh-safe without being treated as measured physical obstruction or vegetation performance.", { color: MUTED, italic: true }));
    } else children.push(callout([bodyParagraph("No native analysis exists for this option. The plan remains a deterministic local preview until the user writes the selected option to Forma.", { after: 0 })], PALE_AMBER, "D9951E"));
    children.push(bodyParagraph("Forma remains responsible for native Sun, Rapid Wind, microclimate, energy, daylight, noise and carbon validation. SiteMorph does not infer native results from FortyGuard history or from plan geometry."));
  } else if (building) {
    const hasGroundGridMetrics = building.analysisMetricSource === "ground-grid";
    children.push(labelValueTable([
      ["Native Forma Sun status", building.sunStatus === "succeeded" ? (hasGroundGridMetrics ? "Completed with readable ground grid" : "Native job completed; embedded ground grid unavailable") : building.sunStatus],
      ["Mean ground sun", hasGroundGridMetrics && building.meanSunHours !== undefined ? `${building.meanSunHours} h` : undefined],
      ["Maximum ground sun", hasGroundGridMetrics && building.maxSunHours !== undefined ? `${building.maxSunHours} h` : undefined],
      ["Metric source", hasGroundGridMetrics ? "Forma ground-grid output" : "Native completion status only; not treated as measured validation"],
    ]));
    if (building.analysisNote) children.push(callout([bodyParagraph(building.analysisNote, { after: 0 })], PALE_AMBER, "D9951E"));
    if (readableClimateResponse) {
      children.push(subheading(readableClimateResponse.label));
      children.push(labelValueTable([
        ["Status", readableClimateResponse.status],
        ["Mean response index", `${readableClimateResponse.meanRiskScore} / 100`],
        ["Maximum response index", `${readableClimateResponse.maximumRiskScore} / 100`],
        ["Spatial resolution", `${readableClimateResponse.resolutionMeters} m`],
        ["FortyGuard historical baseline", `${readableClimateResponse.historicalBaselineScore} / 100`],
      ]));
      children.push(matrixTable(["Input", "Source", "Weight", "Coverage"], readableClimateResponse.inputs.map((input) => [input.label, input.source, `${input.configuredWeightPercent}%`, `${input.coveragePercent}%`]), [3850, 1800, 1650, 2060]));
      children.push(callout([bodyParagraph(readableClimateResponse.formula, { bold: true, after: 70 }), bodyParagraph(readableClimateResponse.note, { color: MUTED, italic: true, after: 0 })], PALE_TEAL, TEAL));
    } else if (building.climateResponse) {
      children.push(callout([bodyParagraph("The combined response index was omitted. The embedded Sun ground grid was rejected or unreadable, so no stale or unsupported Sun-derived response was used.", { after: 0 })], PALE_AMBER, "D9951E"));
    }
    children.push(bodyParagraph("Microclimate, energy, daylight, noise and carbon remain recommended native Forma validations. SiteMorph does not claim results that were not run or readable."));
  } else children.push(bodyParagraph("Forma validation will appear after a building is generated."));

  children.push(sectionHeading(8, subdivisionMode ? "SiteMorph subdivision ranking" : "SiteMorph revision", Boolean(building || generatedSubdivision)));
  if (subdivisionMode) {
    if (selectedSubdivisionVariant) {
      children.push(callout([
        richParagraph([run(`Selected option: ${selectedSubdivisionVariant.label} - ${selectedSubdivisionVariant.scoreBreakdown.totalScore} / 100`, { bold: true, color: NAVY, size: 24 })], { after: 70 }),
        bodyParagraph(selectedSubdivisionVariant.scoreBreakdown.formula, { bold: true, after: 0 }),
      ], PALE_TEAL, TEAL));
      children.push(matrixTable(
        ["Ranking component", "Source", "Raw score", "Weight", "Contribution"],
        selectedSubdivisionVariant.scoreBreakdown.components.map((component) => [
          component.label,
          component.source,
          component.rawScore,
          `${component.weightPercent}%`,
          component.weightedScore,
        ]),
        [2850, 2200, 1400, 1300, 1610],
      ));
      children.push(bodyParagraph("Exactly 50% of the option score is the FortyGuard × SiteMorph climate-resilience component. Development yield, lot match, open land and delivery simplicity share the remaining 50%; the report does not convert this ranking into a zoning or market recommendation.", { color: MUTED, italic: true }));
      children.push(subheading("Explicit planning assumptions"));
      children.push(...selectedSubdivisionVariant.assumptions.map(bullet));
      children.push(subheading("Warnings and unverified rules"));
      if (selectedSubdivisionVariant.warnings.length) children.push(...selectedSubdivisionVariant.warnings.map(bullet));
      else children.push(bullet("No engine warnings were recorded; zoning, access, fire, civil, utility and entitlement verification are still outside this analysis."));
      children.push(subheading("Input provenance"));
      children.push(matrixTable(
        ["Field", "Source", "Detail"],
        selectedSubdivisionVariant.provenance.map((entry) => [entry.field, entry.source, entry.detail]),
        [2450, 2250, 4660],
      ));
    } else children.push(callout([bodyParagraph("The persisted subdivision result could not be linked to its deterministic option, so SiteMorph does not recreate or imply its ranking formula, assumptions or provenance.", { after: 0 })], PALE_AMBER, "D9951E"));
    children.push(bodyParagraph(generatedSubdivision
      ? "SiteMorph previewed alternatives locally, persisted only the selected option and validated the complete proposal once. No post-analysis geometry revision was made in this subdivision run."
      : "This report records an option-only selection. Persisting the selected option and running native Forma analysis remain outstanding."));
  } else if (building) {
    const initialDecisionPlan = building.intervention?.initial.programPlan ?? programPlan!;
    const testedDecisionPlan = building.intervention?.tested?.programPlan ?? programPlan!;
    const interventionPair = evidencePair([
      { source: building.initialDesignImageDataUrl, caption: building.intervention ? `Initial mass - ${building.intervention.initial.aspectRatio}:1 - ${formatInterventionPlacement(building.intervention.initial.placement, initialDecisionPlan)}` : "Initial mass" },
      { source: building.testedDesignImageDataUrl, caption: building.intervention?.tested ? `Tested intervention - ${building.intervention.tested.aspectRatio}:1 - ${formatInterventionPlacement(building.intervention.tested.placement, testedDecisionPlan)}` : "Tested intervention" },
    ]);
    if (interventionPair) children.push(interventionPair);
    if (building.intervention) children.push(labelValueTable([
      ["Detected issue", building.intervention.issue],
      ["Action tested", presentDesignNarrative(building.intervention.action, testedDecisionPlan)],
      ["Acceptance rule", building.intervention.objective],
      ["Decision", building.intervention.outcome.toUpperCase()],
      ["Aspect ratio", building.intervention.tested ? `${building.intervention.initial.aspectRatio}:1 to ${building.intervention.tested.aspectRatio}:1` : `${building.intervention.initial.aspectRatio}:1`],
      ["Placement", building.intervention.tested ? `${formatInterventionPlacement(building.intervention.initial.placement, initialDecisionPlan)} to ${formatInterventionPlacement(building.intervention.tested.placement, testedDecisionPlan)}` : formatInterventionPlacement(building.intervention.initial.placement, initialDecisionPlan)],
      [`${testedDecisionPlan.interventionProgramLabel} side`, building.intervention.tested ? `${building.intervention.initial.officeMezzanineSide} to ${building.intervention.tested.officeMezzanineSide}` : building.intervention.initial.officeMezzanineSide],
      ["Mean ground sun", building.intervention.tested && building.intervention.initial.meanSunHours !== undefined && building.intervention.tested.meanSunHours !== undefined ? `${building.intervention.initial.meanSunHours} h to ${building.intervention.tested.meanSunHours} h` : undefined],
      ["Maximum ground sun", building.intervention.tested && building.intervention.initial.maxSunHours !== undefined && building.intervention.tested.maxSunHours !== undefined ? `${building.intervention.initial.maxSunHours} h to ${building.intervention.tested.maxSunHours} h` : undefined],
    ]));
    if (building.intervention?.initial.programPlan && building.intervention.tested?.programPlan) children.push(matrixTable(
      ["2D plan decision", "Initial", "Tested"],
      [
        ["Building envelope", `${building.intervention.initial.programPlan.buildingWidthFt} ft x ${building.intervention.initial.programPlan.buildingDepthFt} ft`, `${building.intervention.tested.programPlan.buildingWidthFt} ft x ${building.intervention.tested.programPlan.buildingDepthFt} ft`],
        [testedDecisionPlan.interventionProgramLabel, building.intervention.initial.programPlan.officeMezzanineSide, building.intervention.tested.programPlan.officeMezzanineSide],
        ["Operations edge", building.intervention.initial.programPlan.operations.edgeLabel, building.intervention.tested.programPlan.operations.edgeLabel],
        ["Visible climate response", `North-side ${initialDecisionPlan.interventionProgramLabel.toLowerCase()}`, `${testedDecisionPlan.interventionProgramLabel} shown east; west heat buffer retained`],
      ],
      [3000, 3180, 3180],
    ));
    const outcome = building.intervention?.outcome === "accepted" ? "Accepted measured change" : building.intervention?.outcome === "rejected" ? "Rejected; initial design restored" : "Initial design retained";
    children.push(callout([richParagraph([run(`Initial design -> Forma Sun -> tested intervention -> ${outcome}`, { bold: true, color: NAVY, size: 24 })], { after: 70 }), bodyParagraph(displayedChangeSummary, { after: 0 })], building.intervention?.outcome === "rejected" ? PALE_AMBER : PALE_TEAL, building.intervention?.outcome === "rejected" ? "D9951E" : TEAL));
  } else children.push(bodyParagraph("No autonomous geometry revision has been completed."));

  children.push(sectionHeading(9, "SiteMorph Recommendation"));
  const designResponse = climate.designBrief.priorities.slice(0, 4).map((item) => item.label.toLowerCase()).join(", ");
  children.push(callout(subdivisionMode && selectedSubdivisionVariant ? [
    richParagraph([run(subdivisionBuilt ? `Proceed to concept validation for ${selectedSubdivisionVariant.label}` : `Selected preview: ${selectedSubdivisionVariant.label}`, { bold: true, color: NAVY, size: 26 })], { after: 100 }),
    richParagraph([run("Evidence status: ", { bold: true }), run(subdivisionBuilt ? "Native dwelling geometry verified; complete-proposal Sun status recorded" : "Option-only; no native dwelling geometry or design analysis yet")], { after: 60 }),
    richParagraph([run("FortyGuard role: ", { bold: true }), run(`four-signal historical burden ${subdivisionPlan?.historicalBurden.scorePercent ?? selectedSubdivisionVariant.climatePerformance.historicalBurdenScore} / 100, weighted at ${selectedSubdivisionVariant.scoreBreakdown.climateWeightPercent}% of option ranking; peak thermal hour is retained separately as supporting evidence`)], { after: 60 }),
    richParagraph([run("Plan response: ", { bold: true }), run(`multiplicative mitigation ${selectedSubdivisionVariant.climatePerformance.mitigationMultiplier.toFixed(3)}; residual heat risk ${selectedSubdivisionVariant.climatePerformance.residualHeatRiskScore} / 100`)], { after: 60 }),
    richParagraph([run("Spatial restraint: ", { bold: true }), run(selectedSubdivisionVariant.climatePerformance.directionalClaim ?? "No directional build-zone claim; heat measures apply site-wide at FortyGuard resolution")], { after: 60 }),
    richParagraph([run("Decision boundary: ", { bold: true }), run("Treat the option as preliminary until zoning, access, fire, civil, utilities, entitlement, parking and market evidence are confirmed.")], { after: 0 }),
  ] : building ? [
    richParagraph([run(`Proceed to concept validation for ${concept}`, { bold: true, color: NAVY, size: 26 })], { after: 100 }),
    richParagraph([run("Confidence: ", { bold: true }), run(confidence)], { after: 60 }),
    richParagraph([run("Primary constraint: ", { bold: true }), run("Persistent hot-season thermal load")], { after: 60 }),
    richParagraph([run("Design response: ", { bold: true }), run(designResponse)], { after: 60 }),
    richParagraph([run(building.analysisMetricSource === "ground-grid" ? "Forma ground-grid measured proposal: " : "Forma proposal analysis status: ", { bold: true }), run(building.analysisMetricSource === "ground-grid" ? `SiteMorph Design R${building.revision}` : `SiteMorph Design R${building.revision}; native Sun job completed, readable ground-grid metrics unavailable`)], { after: 60 }),
    richParagraph([run("Reason selected: ", { bold: true }), run(displayedChangeSummary)], { after: 0 }),
  ] : [
    richParagraph([run("Complete the generated Forma proposal before a design recommendation", { bold: true, color: NAVY, size: 26 })], { after: 100 }),
    richParagraph([run("Confidence: ", { bold: true }), run(confidence)], { after: 60 }),
    richParagraph([run("Primary constraint: ", { bold: true }), run("Persistent hot-season thermal load")], { after: 60 }),
    richParagraph([run("Next decision: ", { bold: true }), run("Generate, analyze and revise one requirements-driven building.")], { after: 0 }),
  ], subdivisionMode && !subdivisionBuilt ? PALE_AMBER : PALE_TEAL, subdivisionMode && !subdivisionBuilt ? "D9951E" : TEAL));

  children.push(sectionHeading(10, "Revit handoff"));
  if (subdivisionMode) {
    if (generatedSubdivision) {
      children.push(labelValueTable([
        ["Native transfer source", `${generatedSubdivision.elements.length} persisted Autodesk Forma dwelling floor stacks`],
        ["Persistent Forma context", `${generatedSubdivision.persistentContext.elementPath} - virtual SiteMorph concept element`],
        ["Verified terrain placements", `${generatedSubdivision.terrainVerificationCount} of ${generatedSubdivision.elements.length}`],
        ["Total native dwelling GFA", `${formatNumber(generatedSubdivision.totalGrossFloorAreaSqFt)} ft2`],
        ["Start in Revit", "Open a new blank Revit file for this proposal transfer"],
        ["Transfer command", "Forma Proposals menu -> Revit -> Send to Revit add-in (Beta)"],
        ["Revit receive step", "Run Load From Forma once in the Autodesk Revit add-in"],
        ["Repeated loads", "Use a fresh blank Revit file for another load"],
        ["Round-trip verification", "Not performed by SiteMorph for this subdivision run"],
        ["Embedded-extension limit", "SiteMorph cannot invoke the Forma host transfer menu"],
      ]));
      children.push(callout([
        bodyParagraph("The separate dwelling floor stacks are the native Forma geometry prepared for the Revit transfer workflow. The proposal also contains persistent SiteMorph-authored terrain shapes and low-poly tree instances, but those remain virtual concept context - not surveyed alignments, graded roads, Toposolids, Planting families or validated native BIM.", { after: 70 }),
        bodyParagraph("SiteMorph does not claim that the context root, subdivision lot IDs, dwelling names, rooms, walls, roofs, openings, landscape objects or program labels will arrive in Revit. A clean Forma-to-Revit round trip has not been verified for this complete multi-building result.", { color: MUTED, italic: true, after: 0 }),
      ], PALE_AMBER, "D9951E"));
    } else children.push(callout([
      bodyParagraph("This is an option-only subdivision report. No native floor stacks exist in the Forma proposal, so there is nothing to transfer to Revit yet.", { after: 70 }),
      bodyParagraph("Select Build in Forma, verify the complete proposal and its terrain placement, then use Forma's native Revit add-in workflow from a blank Revit file.", { color: MUTED, italic: true, after: 0 }),
    ], PALE_AMBER, "D9951E"));
  } else if (building) {
    children.push(labelValueTable([
      ["Native transfer source", "Persisted Autodesk Forma proposal floor stack"],
      ["SiteMorph element", building.elementPath],
      ["Placement preflight", building.placementVerification ? `Verified X, Y, terrain Z and generated mesh Z within ${building.placementVerification.toleranceMeters.toFixed(2)} m` : "Run Prepare Forma Proposal for Revit before transfer"],
      ["Start in Revit", "Open a new blank Revit file for this proposal transfer"],
      ["Transfer command", "Forma Proposals menu -> Revit -> Send to Revit add-in (Beta)"],
      ["Revit receive step", "Run Load From Forma once in the Autodesk Revit add-in"],
      ["Repeated loads", "Repeated Load From Forma into the same Revit file is unsupported; use a fresh blank file for another load"],
      ["Existing Revit model", "Load the Forma proposal into a blank wrapper file, then Link Revit into the existing model and Bind Link only when appropriate"],
      ["Embedded-extension limit", "SiteMorph can prepare, verify and highlight the proposal but cannot invoke the Forma host menu"],
    ]));
    children.push(callout([
      bodyParagraph("SiteMorph design-evidence JSON is an optional audit sidecar; Revit does not natively import it. The optional OBJ is generic concept geometry only and is not native BIM walls, floors, rooms, roofs or openings.", { after: 70 }),
      bodyParagraph("The dimensioned 2D program plan and terrain concept overlay communicate intent. The persisted Forma floor stack is the actual native transfer geometry.", { color: MUTED, italic: true, after: 0 }),
    ], PALE_AMBER, "D9951E"));
  } else children.push(bodyParagraph("Generate a Forma proposal before starting the native Revit add-in handoff."));

  children.push(sectionHeading(11, "Evidence trail", Boolean(building || generatedSubdivision)));
  children.push(subheading("FortyGuard heat activities"));
  const heatRows = climate.activityIds?.heat.length ? climate.activityIds.heat.map((sample) => [sample.date, sample.tcm, sample.persistence, sample.exceedance, sample.timeOfMeasure]) : [["Primary", climate.activityId, "", "", ""]];
  children.push(matrixTable(["Date", "TCM", "Persistence", "Exceedance", "Peak time"], heatRows, [1200, 2040, 2040, 2040, 2040]));

  const optionalActivities = [["Environmental parameters", climate.activityIds?.environmental], ["Satellite segmentation", climate.activityIds?.satellite], ["Street segmentation", climate.activityIds?.street]].filter((item): item is [string, string] => Boolean(item[1]));
  const formaInputs = generatedSubdivision?.nativeAnalysis.analysisId
    ? [["Subdivision Site Limit Sun", generatedSubdivision.nativeAnalysis.analysisId] as const]
    : building ? [...building.sunAnalysisIds.map((id, index) => [`Forma Sun ${index + 1}`, id] as const), ...(readableClimateResponse?.inputs.filter((input) => input.analysisId && !building.sunAnalysisIds.includes(input.analysisId)).map((input) => [input.label, input.analysisId!] as const) ?? [])] : [];
  const decisions = trace.filter((event) => event.type === "Decision" || event.type === "Recommendation");
  if (subdivisionMode) {
    children.push(subheading("FortyGuard site-context activities"));
    if (optionalActivities.length) children.push(...optionalActivities.map(([label, id]) => richParagraph([run(`${label}: `, { bold: true }), run(id, { font: "Consolas", size: 17 })])));
    else children.push(bullet(archivedSurface || archivedStreet ? "Archived South Phoenix satellite, surface and street imagery included as supporting context - captured 23 Aug 2026 - no new FortyGuard activity" : "No optional activity IDs recorded for this export."));
    children.push(subheading("FortyGuard-derived subdivision evidence"));
    if (subdivisionPlan) {
      children.push(richParagraph([run("Burden formula: ", { bold: true }), run(subdivisionPlan.historicalBurden.formula)]));
      children.push(richParagraph([run("Four numerical risk signals: ", { bold: true }), run(subdivisionPlan.historicalBurden.inputs.map((input) => `${input.label} ${input.value} ${input.unit} @ ${input.weightPercent}%`).join("; "))]));
      children.push(richParagraph([run("Peak-time supporting evidence: ", { bold: true }), run(`${subdivisionPlan.historicalBurden.peakThermalHour ?? "Unavailable"}${subdivisionPlan.historicalBurden.peakThermalHourUtc ? ` (${subdivisionPlan.historicalBurden.peakThermalHourUtc})` : ""}. Excluded from the numerical burden; retained for evidence completeness and design interpretation.`)]));
      if (selectedSubdivisionVariant) {
        children.push(richParagraph([run("Ranking formula: ", { bold: true }), run(selectedSubdivisionVariant.scoreBreakdown.formula)]));
        children.push(richParagraph([run("Mitigation formula: ", { bold: true }), run(selectedSubdivisionVariant.climatePerformance.formula)]));
      }
    } else children.push(bullet("The deterministic SubdivisionPlan was not included; no historical-burden or option-ranking formula is inferred."));
    children.push(subheading("Forma geometry and analysis evidence"));
    if (generatedSubdivision) {
      children.push(labelValueTable([
        ["Subdivision run", generatedSubdivision.runId],
        ["Generated at", generatedSubdivision.generatedAt],
        ["Persisted proposal roots", generatedSubdivision.proposalElementPaths.length],
        ["Native dwelling roots", generatedSubdivision.elementPaths.length],
        ["Persistent context path", generatedSubdivision.persistentContext.elementPath],
        ["Dwelling terrain placement verified", `${generatedSubdivision.terrainVerificationCount} of ${generatedSubdivision.elements.length}`],
        ["Tree terrain placement verified", `${generatedSubdivision.persistentContext.treeTerrainVerificationCount} of ${generatedSubdivision.persistentContext.treeCount}`],
        ["Native Sun analysis", generatedSubdivision.nativeAnalysis.analysisId ?? `${generatedSubdivision.nativeAnalysis.status}; no analysis ID returned`],
        ["Metric source", generatedSubdivision.nativeAnalysis.metricSource],
      ]));
    } else children.push(bullet("No Forma geometry or analysis evidence exists for the selected option."));
    children.push(subheading("SiteMorph-derived decisions"));
    if (decisions.length) children.push(...decisions.map((event) => richParagraph([run(`${event.title}: `, { bold: true }), run(event.detail ?? event.reason ?? "Recorded in the SiteMorph trace")])));
    else children.push(bullet("See the selected option, exposed ranking formula and recommendation above."));
  } else if (building) {
    children.push(subheading("FortyGuard site-context activities"));
    if (optionalActivities.length) children.push(...optionalActivities.map(([label, id]) => richParagraph([run(`${label}: `, { bold: true }), run(id, { font: "Consolas", size: 17 })])));
    else children.push(bullet(archivedSurface || archivedStreet ? "Archived South Phoenix satellite, surface and street imagery included as supporting context - captured 23 Aug 2026 - no new FortyGuard activity" : "No optional activity IDs recorded for this export."));
    children.push(subheading("Forma analyses used"));
    if (formaInputs.length) children.push(...formaInputs.map(([label, id]) => richParagraph([run(`${label}: `, { bold: true }), run(id, { font: "Consolas", size: 17 })])));
    else children.push(bullet("No Forma analysis IDs recorded."));
    children.push(subheading("SiteMorph-derived decisions"));
    if (decisions.length) children.push(...decisions.map((event) => richParagraph([run(`${event.title}: `, { bold: true }), run(programPlan ? presentDesignNarrative(event.detail ?? event.reason ?? "Recorded in the SiteMorph trace", programPlan) : event.detail ?? event.reason ?? "Recorded in the SiteMorph trace")])));
    else children.push(bullet("See the Climate Design Brief and revision decision above."));
  } else {
    const siteContext = optionalActivities.length
      ? optionalActivities.map(([label, id]) => `${label}: ${id}`).join("; ")
      : archivedSurface || archivedStreet
        ? "Archived South Phoenix satellite, surface and street imagery - captured 23 Aug 2026 - no new FortyGuard activity"
        : "No optional activity IDs recorded";
    const decisionSummary = decisions.length
      ? decisions.map((event) => `${event.title}: ${event.detail ?? event.reason ?? "Recorded in trace"}`).join("; ")
      : "See the Climate Design Brief above";
    children.push(labelValueTable([
      ["Site context", siteContext],
      ["Forma analyses", "None recorded - building not generated"],
      ["SiteMorph decision", decisionSummary],
    ]));
  }
  children.push(subheading("Limitations"));
  children.push(bodyParagraph(`${subdivisionMode ? generatedSubdivision ? "Subdivision roads, paths, open spaces, lot outlines and trees are persistent virtual SiteMorph-authored Forma concept elements; the separate dwelling floor stacks remain the native Forma-to-Revit source. The context is not surveyed civil geometry, verified grading, code-compliant access, species selection, planting design or validated BIM. " : "Subdivision lots, roads, paths, open spaces, parking and trees are deterministic preview graphics until the selected option is built; no native geometry is implied. " : ""}FortyGuard supplies historical thermal and site context. Forma remains responsible for native sun, wind, daylight, microclimate, energy, noise, solar and carbon validation. Archived imagery is labeled separately and is not presented as part of the current thermal run. This document is a concept-stage intelligence and design report, not a zoning determination, engineering certification, environmental-impact statement, financial feasibility study or permit document.`));

  return new Document({
    creator: "SiteMorph",
    title: "SiteMorph — Site Intelligence & Climate Design Report",
    description: "Evidence-to-design report combining FortyGuard historical context with Autodesk Forma analysis.",
    styles: {
      default: { document: { run: { font: "Calibri", size: 22, color: INK }, paragraph: { spacing: { after: 120, line: 264, lineRule: "auto" } } } },
      paragraphStyles: [
        { id: "ReportTitle", name: "Report Title", basedOn: "Normal", next: "ReportBody", quickFormat: true, run: { font: "Calibri", size: 44, bold: true, color: NAVY }, paragraph: { spacing: { before: 80, after: 120 }, keepNext: true } },
        { id: "Kicker", name: "Kicker", basedOn: "Normal", next: "ReportTitle", quickFormat: true, run: { font: "Calibri", size: 18, bold: true, color: TEAL }, paragraph: { spacing: { before: 100, after: 40 }, keepNext: true } },
        { id: "ReportBody", name: "Report Body", basedOn: "Normal", next: "ReportBody", quickFormat: true, run: { font: "Calibri", size: 22, color: INK }, paragraph: { spacing: { before: 0, after: 120, line: 264, lineRule: "auto" } } },
        { id: "Heading1", name: "Heading 1", basedOn: "ReportBody", next: "ReportBody", quickFormat: true, run: { font: "Calibri", size: 32, bold: true, color: BLUE }, paragraph: { spacing: { before: 320, after: 160 }, keepNext: true, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "ReportBody", next: "ReportBody", quickFormat: true, run: { font: "Calibri", size: 26, bold: true, color: BLUE }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true, outlineLevel: 1 } },
        { id: "Heading3", name: "Heading 3", basedOn: "ReportBody", next: "ReportBody", quickFormat: true, run: { font: "Calibri", size: 24, bold: true, color: DARK_BLUE }, paragraph: { spacing: { before: 160, after: 80 }, keepNext: true, outlineLevel: 2 } },
        { id: "Caption", name: "Caption", basedOn: "ReportBody", next: "ReportBody", quickFormat: true, run: { font: "Calibri", size: 17, color: MUTED, italics: true }, paragraph: { spacing: { before: 0, after: 140, line: 220, lineRule: "auto" } } },
      ],
    },
    numbering: { config: [{ reference: "report-bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 }, spacing: { after: 80, line: 280, lineRule: "auto" } }, run: { font: "Calibri", size: 22, color: INK } } }] }] },
    sections: [{
      properties: { titlePage: true, page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 708, gutter: 0 } } },
      headers: { first: new Header({ children: [new Paragraph({ children: [] })] }), default: reportHeader() },
      footers: { default: reportFooter() },
      children,
    }],
  });
}

export async function buildSiteIntelligenceReport(input: ReportInput): Promise<Blob> {
  return Packer.toBlob(createDocument(input));
}
