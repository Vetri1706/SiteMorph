import type { ClimateDNA, DesignBrief, DesignInterventionSnapshot, FormaPlacementVerification, GeneratedBuilding, SiteGeometry } from "../types";
import { delay } from "../utils/config";
import { evaluateSunIntervention } from "../utils/design-intervention";
import { resolveBuildingProgram } from "../utils/design-program";
import { boundsOverlap, pointInPolygon, polygonBounds } from "../utils/geometry-validation";
import { createProgramPlan } from "../utils/program-plan";
import { detectBuildingTypology } from "../utils/program-typology";
import { decodeSunGroundGrid } from "../utils/sun-grid";
import { sampleTerrainBaseElevation } from "../utils/terrain-elevation";
import { createSiteLayoutPlan } from "../utils/site-layout";
import { resolveFormaElementFootprint } from "./forma-element-footprint.service";
import {
  isPathWithinOwnedRoot,
  listSiteMorphOwnedRootPaths,
  removeOtherSiteMorphOwnedRoots,
  rollbackSiteMorphOwnedRoot,
  SITEMORPH_ELEMENT_NAME_PREFIX,
  tagSiteMorphElementUrn,
  verifyPersistedFormaElementPlacement,
} from "./forma-element-placement.service";
import { renderSiteLayoutOverlay } from "./forma-site-layout-overlay.service";
import { getFormaClient } from "./forma.service";

const SQFT_PER_SQM = 10.7639104167;
const FEET_PER_METER = 3.280839895;

interface MassDefinition {
  floors: Array<{ polygon: Array<[number, number]>; height: number }>;
  transform: number[];
  footprintSqFt: number;
  grossFloorAreaSqFt: number;
  mainFloorCount: number;
  mezzanineAreaSqFt: number;
  partialTopFloorAreaSqFt: number;
  upperFloorAreaSqFt: number;
  heightFt: number;
  heightMeters: number;
  baseElevationMeters: number;
  terrainSampleCount: number;
  placementVerification?: FormaPlacementVerification;
  aspectRatio: number;
  projectFootprint: Array<[number, number]>;
  placementSummary: string;
  placementLabel: string;
  loadingYardSide: string;
  officeMezzanineSide: string;
}

interface MassStrategy {
  aspectRatio: number;
  placement: "balanced" | "north-west-concept";
  mezzanineSide: "north" | "east";
  loadingYardSide: "North concept edge";
}

const INITIAL_STRATEGY: MassStrategy = {
  aspectRatio: 1.6,
  placement: "balanced",
  mezzanineSide: "north",
  loadingYardSide: "North concept edge",
};

const THERMAL_REVISION_STRATEGY: MassStrategy = {
  aspectRatio: 2.2,
  placement: "north-west-concept",
  mezzanineSide: "east",
  loadingYardSide: "North concept edge",
};

interface SunResult {
  analysisId: string;
  meanHours?: number;
  maxHours?: number;
  metricSource: "ground-grid" | "native-status-only";
  note?: string;
}

function bounds(points: Array<[number, number]>): { minX: number; maxX: number; minY: number; maxY: number; centerX: number; centerY: number } {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
}

function choosePlacement(
  boundary: Array<[number, number]>,
  width: number,
  depth: number,
  margin: number,
  obstacles: Array<Array<[number, number]>>,
  strategy: MassStrategy["placement"],
): { centerX: number; centerY: number; summary: string } {
  const site = bounds(boundary);
  const xStart = site.minX + margin + width / 2;
  const xEnd = site.maxX - margin - width / 2;
  const yStart = site.minY + margin + depth / 2;
  const yEnd = site.maxY - margin - depth / 2;
  const obstacleBounds = obstacles.filter((item) => item.length >= 3).map(bounds);
  const candidates: Array<{ centerX: number; centerY: number; score: number }> = [];
  const steps = 10;
  for (let row = 0; row <= steps; row += 1) {
    for (let column = 0; column <= steps; column += 1) {
      const centerX = xStart + (xEnd - xStart) * (column / steps);
      const centerY = yStart + (yEnd - yStart) * (row / steps);
      const corners: Array<[number, number]> = [[centerX - width / 2, centerY - depth / 2], [centerX + width / 2, centerY - depth / 2], [centerX + width / 2, centerY + depth / 2], [centerX - width / 2, centerY + depth / 2]];
      if (!corners.every((corner) => pointInPolygon(corner, boundary))) continue;
      const clearance = 5;
      const collides = obstacleBounds.some((obstacle) => centerX + width / 2 + clearance > obstacle.minX && centerX - width / 2 - clearance < obstacle.maxX && centerY + depth / 2 + clearance > obstacle.minY && centerY - depth / 2 - clearance < obstacle.maxY);
      if (collides) continue;
      const distanceFromCenter = Math.hypot(centerX - site.centerX, centerY - site.centerY);
      const obstacleDistance = obstacleBounds.length ? Math.min(...obstacleBounds.map((obstacle) => Math.hypot(centerX - obstacle.centerX, centerY - obstacle.centerY))) : 0;
      const accessDistance = site.maxY - (centerY + depth / 2);
      const westEdgeDistance = centerX - width / 2 - site.minX;
      const score = strategy === "north-west-concept"
        ? obstacleDistance - accessDistance * 1.1 - westEdgeDistance * 0.25
        : obstacleDistance - distanceFromCenter * 0.2;
      candidates.push({ centerX, centerY, score });
    }
  }
  const selected = candidates.sort((a, b) => b.score - a.score)[0];
  if (!selected) throw new Error("No collision-free placement fits inside the Site Limit with the requested footprint and working clearances.");
  return {
    centerX: selected.centerX,
    centerY: selected.centerY,
    summary: `${strategy === "north-west-concept" ? "North-west concept placement (access engineering unconfirmed)" : "Balanced placement"} selected after testing ${candidates.length} viable positions${obstacleBounds.length ? ` against ${obstacleBounds.length} existing building footprint${obstacleBounds.length === 1 ? "" : "s"}` : "; no readable existing-building footprints were returned"}.`,
  };
}

function makeMass(brief: DesignBrief, geometry: SiteGeometry, strategy: MassStrategy, obstacles: Array<Array<[number, number]>>): MassDefinition {
  const boundary = geometry.localBoundary;
  if (!boundary?.length) throw new Error("The selected Forma Site Limit has no local boundary for building placement.");
  const xs = boundary.map(([x]) => x);
  const ys = boundary.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const margin = 10;
  const availableWidth = Math.max(0, maxX - minX - margin * 2);
  const availableDepth = Math.max(0, maxY - minY - margin * 2);
  const requestedSqFt = brief.targetFootprintSqFt || brief.totalAreaSqFt / Math.max(1, brief.floors);
  const requestedSqM = requestedSqFt / SQFT_PER_SQM;
  let width = Math.sqrt(requestedSqM * strategy.aspectRatio);
  let depth = requestedSqM / width;
  const fitScale = Math.min(1, availableWidth / width, availableDepth / depth);
  if (!Number.isFinite(fitScale) || fitScale < 0.9) {
    throw new Error("The requested footprint does not fit inside the selected Site Limit with a 10 m working setback.");
  }
  width *= fitScale;
  depth *= fitScale;
  const polygon: Array<[number, number]> = [
    [-width / 2, -depth / 2],
    [width / 2, -depth / 2],
    [width / 2, depth / 2],
    [-width / 2, depth / 2],
    [-width / 2, -depth / 2],
  ];
  const totalHeightFt = brief.maximumHeightFt > 0 ? brief.maximumHeightFt : 40;
  const totalHeightM = totalHeightFt / FEET_PER_METER;
  const fullFloorAreaSqFt = Math.round(width * depth * SQFT_PER_SQM);
  const program = resolveBuildingProgram(brief, fullFloorAreaSqFt);
  const { mainFloorCount: floors, mezzanineAreaSqFt, fullFloorCount, partialTopFloorAreaSqFt, geometryLevelCount } = program;
  const geometryFloors: MassDefinition["floors"] = [];
  const levelHeightM = totalHeightM / geometryLevelCount;
  geometryFloors.push(...Array.from({ length: fullFloorCount }, () => ({ polygon, height: levelHeightM })));
  if (partialTopFloorAreaSqFt > 0) {
    const partialAreaSqM = partialTopFloorAreaSqFt / SQFT_PER_SQM;
    const partialPolygon: Array<[number, number]> = strategy.mezzanineSide === "east"
      ? (() => {
        const partialWidth = Math.min(width, partialAreaSqM / depth);
        return [[width / 2 - partialWidth, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [width / 2 - partialWidth, depth / 2], [width / 2 - partialWidth, -depth / 2]];
      })()
      : (() => {
        const partialDepth = Math.min(depth, partialAreaSqM / width);
        return [[-width / 2, depth / 2 - partialDepth], [width / 2, depth / 2 - partialDepth], [width / 2, depth / 2], [-width / 2, depth / 2], [-width / 2, depth / 2 - partialDepth]];
      })();
    geometryFloors.push({ polygon: partialPolygon, height: levelHeightM });
  }
  const placement = choosePlacement(boundary, width, depth, margin, obstacles, strategy.placement);
  const { centerX, centerY } = placement;
  const projectFootprint = polygon.map(([x, y]) => [x + centerX, y + centerY] as [number, number]);
  return {
    floors: geometryFloors,
    transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, centerX, centerY, 0, 1],
    footprintSqFt: fullFloorAreaSqFt,
    grossFloorAreaSqFt: program.grossFloorAreaSqFt,
    mainFloorCount: floors,
    mezzanineAreaSqFt,
    partialTopFloorAreaSqFt,
    upperFloorAreaSqFt: Math.max(0, program.grossFloorAreaSqFt - fullFloorAreaSqFt),
    heightFt: totalHeightFt,
    heightMeters: totalHeightFt / FEET_PER_METER,
    baseElevationMeters: 0,
    terrainSampleCount: 0,
    aspectRatio: strategy.aspectRatio,
    projectFootprint,
    placementSummary: placement.summary,
    placementLabel: strategy.placement === "north-west-concept" ? "North-west concept placement · access unconfirmed" : "Balanced within Site Limit",
    loadingYardSide: strategy.loadingYardSide,
    officeMezzanineSide: strategy.mezzanineSide === "east" ? "East side" : "North strip",
  };
}

async function placeMassOnTerrain(
  Forma: Awaited<ReturnType<typeof getFormaClient>>,
  mass: MassDefinition,
): Promise<void> {
  const terrain = await sampleTerrainBaseElevation(
    mass.projectFootprint,
    ([x, y]) => Forma.terrain.getElevationAt({ x, y }),
  );
  mass.baseElevationMeters = terrain.elevationMeters;
  mass.terrainSampleCount = terrain.successfulSampleCount;
  mass.transform[14] = terrain.elevationMeters;
}

function programPlanForMass(brief: DesignBrief, mass: MassDefinition) {
  const profile = detectBuildingTypology(brief.buildingType);
  const itemDescription = mass.loadingYardSide.toLowerCase();
  const interventionProgramLabel = mass.upperFloorAreaSqFt > 0 ? profile.upperLevelLabel : profile.occupiedProgramLabel;
  return createProgramPlan(brief, {
    footprintSqFt: mass.footprintSqFt,
    grossFloorAreaSqFt: mass.grossFloorAreaSqFt,
    mezzanineAreaSqFt: mass.mezzanineAreaSqFt,
    heightFt: mass.heightFt,
    aspectRatio: mass.aspectRatio,
    orientationLabel: "East–west long axis",
  }, {
    officeMezzanineSide: mass.officeMezzanineSide,
    climateMoves: [
      `Keep ${brief.loadingDocks > 0 ? `${brief.loadingDocks} ${profile.operations.itemLabel.toLowerCase()}${brief.loadingDocks === 1 ? "" : "s"}` : profile.operations.edgeLabel.toLowerCase()} and sheltered outdoor operations on the ${itemDescription}.`,
      `Place the most heat-sensitive ${interventionProgramLabel.toLowerCase()} on the ${mass.officeMezzanineSide.toLowerCase()}.`,
      "Use the west edge as a heat-buffer and envelope-performance priority.",
    ],
  });
}

async function attachSiteLayout(
  Forma: Awaited<ReturnType<typeof getFormaClient>>,
  brief: DesignBrief,
  geometry: SiteGeometry,
  mass: MassDefinition,
  building: GeneratedBuilding,
): Promise<GeneratedBuilding> {
  const programPlan = building.programPlan ?? programPlanForMass(brief, mass);
  const siteLayout = createSiteLayoutPlan({
    siteBoundary: geometry.localBoundary ?? [],
    buildingFootprint: mass.projectFootprint,
    programPlan,
  });
  try {
    await renderSiteLayoutOverlay(Forma, geometry, siteLayout);
    return {
      ...building,
      programPlan,
      siteLayout,
      siteOverlayStatus: "rendered",
      siteOverlayNote: "Typology-aware parking, access and operations zones are visible as a preliminary terrain overlay. The Forma floor stack remains the native analysis and Revit-transfer element.",
    };
  } catch (error) {
    return {
      ...building,
      programPlan,
      siteLayout,
      siteOverlayStatus: "unavailable",
      siteOverlayNote: error instanceof Error ? error.message : "The site layout overlay could not be rendered in this Forma session.",
    };
  }
}

function interventionSnapshot(brief: DesignBrief, mass: MassDefinition, sun: SunResult): DesignInterventionSnapshot {
  return {
    aspectRatio: mass.aspectRatio,
    placement: mass.placementLabel,
    loadingYardSide: mass.loadingYardSide,
    officeMezzanineSide: mass.officeMezzanineSide,
    meanSunHours: sun.meanHours,
    maxSunHours: sun.maxHours,
    programPlan: programPlanForMass(brief, mass),
  };
}

async function waitForSunAnalysis(
  Forma: Awaited<ReturnType<typeof getFormaClient>>,
  analysisId: string,
): Promise<SunResult> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (attempt > 0) await delay(2_000);
    const analysis = await Forma.analysis.getSunAnalysis({ analysisId });
    if (analysis.status === "FAILED" || analysis.status === "STOPPED") throw new Error(`Forma sun analysis ${analysis.status.toLowerCase()}.`);
    if (analysis.status !== "SUCCEEDED") continue;
    try {
      const grid = await Forma.analysis.getGroundGrid({ analysis });
      const decoded = grid ? decodeSunGroundGrid(grid.grid, grid.mask, analysis.parameters.sunPositionsPerHour) : undefined;
      const values = decoded?.hours ?? [];
      if (values.length) {
        const maximum = values.reduce((current, value) => Math.max(current, value), Number.NEGATIVE_INFINITY);
        return {
          analysisId,
          meanHours: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)),
          maxHours: Number(maximum.toFixed(1)),
          metricSource: "ground-grid",
          note: decoded?.note,
        };
      }
    } catch (error) {
      return {
        analysisId,
        metricSource: "native-status-only",
        note: error instanceof Error
          ? `Forma completed the Sun job, but SiteMorph rejected its ground-grid metrics: ${error.message}`
          : "Forma completed the Sun job, but SiteMorph could not validate its ground-grid metrics.",
      };
    }
    return {
      analysisId,
      metricSource: "native-status-only",
      note: "Forma completed the Sun job, but this result did not expose a readable ground grid through the embedded SDK.",
    };
  }
  throw new Error("Forma sun analysis did not finish within two minutes.");
}

async function addValidatedMass(
  Forma: Awaited<ReturnType<typeof getFormaClient>>,
  urn: string,
  mass: MassDefinition,
  name: string,
  boundary: Array<[number, number]>,
): Promise<{ path: string; footprint: Array<[number, number]> }> {
  const ownedUrn = await tagSiteMorphElementUrn(Forma, urn);
  const added = await Forma.proposal.addElement({ urn: ownedUrn, transform: mass.transform, name });
  try {
    await Forma.proposal.awaitProposalPersisted();
    mass.placementVerification = await verifyPersistedFormaElementPlacement(Forma, added.path, {
      terrainBaseElevationMeters: mass.baseElevationMeters,
      terrainSampleCount: mass.terrainSampleCount,
      expectedCenterXMeters: mass.transform[12],
      expectedCenterYMeters: mass.transform[13],
    });
    const resolved = await resolveFormaElementFootprint(Forma, added.path, mass.projectFootprint, boundary);
    await removeOtherSiteMorphOwnedRoots(Forma, added.path);
    return { path: added.path, footprint: resolved.coordinates };
  } catch (error) {
    try {
      await rollbackSiteMorphOwnedRoot(Forma, added.path);
    } catch (rollbackError) {
      const generationDetail = error instanceof Error ? error.message : "unknown generation error";
      const rollbackDetail = rollbackError instanceof Error ? rollbackError.message : "unknown rollback error";
      throw new Error(`SiteMorph generation failed (${generationDetail}) and proposal cleanup also failed (${rollbackDetail})`);
    }
    throw error;
  }
}

async function captureDesignImage(
  Forma: Awaited<ReturnType<typeof getFormaClient>>,
  mass: MassDefinition,
): Promise<string | undefined> {
  const previous = await Forma.camera.getCurrent();
  const outline = bounds(mass.projectFootprint);
  const span = Math.max(outline.maxX - outline.minX, outline.maxY - outline.minY, mass.heightMeters * 2, 40);
  let perspectiveChanged = false;
  try {
    if (previous.type !== "perspective") {
      await Forma.camera.switchPerspective();
      perspectiveChanged = true;
    }
    await Forma.camera.move({
      position: { x: outline.centerX - span, y: outline.centerY - span, z: mass.baseElevationMeters + mass.heightMeters + span * 0.8 },
      target: { x: outline.centerX, y: outline.centerY, z: mass.baseElevationMeters + mass.heightMeters * 0.3 },
      transitionTimeMs: 0,
    });
    const canvas = await Forma.camera.capture({ width: 1200, height: 720 });
    return canvas.toDataURL("image/png");
  } catch {
    return undefined;
  } finally {
    await Forma.camera.move({ position: previous.position, target: previous.target, transitionTimeMs: 0 }).catch(() => undefined);
    if (perspectiveChanged) await Forma.camera.switchPerspective().catch(() => undefined);
  }
}

class FormaDesignService {
  async generateAndImprove(
    brief: DesignBrief,
    geometry: SiteGeometry,
    climate: ClimateDNA,
    _existingPath?: string,
  ): Promise<GeneratedBuilding> {
    if (!brief.buildingType.trim()) throw new Error("Enter a building type before generation.");
    if (brief.totalAreaSqFt <= 0 && brief.targetFootprintSqFt <= 0) throw new Error("Enter a positive building area before generation.");
    if (brief.totalAreaSqFt > 0 && brief.targetFootprintSqFt > brief.totalAreaSqFt) {
      throw new Error("Target footprint cannot exceed total gross area. Correct the project requirements before generation.");
    }
    const Forma = await getFormaClient();
    if (!(await Forma.getCanEdit())) throw new Error("This Forma project is read-only. Edit access is required to generate a building.");
    const siteBoundary = geometry.localBoundary;
    if (!siteBoundary?.length) throw new Error("The selected Forma Site Limit has no local boundary for building placement.");

    const ownedRootPaths = await listSiteMorphOwnedRootPaths(Forma);
    const categoryPaths = await Promise.all([
      Forma.geometry.getPathsByCategory({ category: "building" }).catch(() => []),
      Forma.geometry.getPathsByCategory({ category: "buildings" }).catch(() => []),
    ]);
    const existingBuildingPaths = [...new Set(categoryPaths.flat())]
      .filter((path) => !isPathWithinOwnedRoot(path, ownedRootPaths));
    const obstacleFootprints = (await Promise.all(existingBuildingPaths.map((path) => Forma.geometry.getFootprint({ path }).catch(() => undefined))))
      .filter((footprint): footprint is NonNullable<typeof footprint> => Boolean(footprint?.coordinates?.length))
      .map((footprint) => footprint.coordinates.map(([x, y]) => [x, y] as [number, number]))
      .filter((footprint) => boundsOverlap(polygonBounds(footprint), polygonBounds(siteBoundary), 20));

    const initial = makeMass(brief, geometry, INITIAL_STRATEGY, obstacleFootprints);
    await placeMassOnTerrain(Forma, initial);
    const initialElement = await Forma.elements.floorStack.createFromFloors({ floors: initial.floors });
    const addedInitial = await addValidatedMass(Forma, initialElement.urn, initial, `${SITEMORPH_ELEMENT_NAME_PREFIX} ${brief.buildingType}`, siteBoundary);
    initial.projectFootprint = addedInitial.footprint;
    let elementPath = addedInitial.path;

    // The Site Limit must be the analysis area. Selecting only the generated
    // building creates a geometry result with no ground-grid texture to read.
    const firstAnalysis = await Forma.analysis.triggerSun({ selectedElementPaths: [geometry.elementPath], month: 6, date: 21 });
    const firstSun = await waitForSunAnalysis(Forma, firstAnalysis.analysisId);
    const initialDesignImageDataUrl = await captureDesignImage(Forma, initial);
    const thermalInterventionRequired = climate.profile.thermalExposure === "HIGH" || climate.profile.persistence === "HIGH";
    if (!thermalInterventionRequired && firstSun.meanHours !== undefined && firstSun.meanHours <= 6) {
      return attachSiteLayout(Forma, brief, geometry, initial, {
        designLoopVersion: "measured-v2",
        elementPath,
        name: brief.buildingType,
        footprintSqFt: initial.footprintSqFt,
        heightFt: initial.heightFt,
        revision: 1,
        sunAnalysisId: firstSun.analysisId,
        sunStatus: "succeeded",
        meanSunHours: firstSun.meanHours,
        maxSunHours: firstSun.maxHours,
        changeSummary: "The initial mass kept mean ground sun at or below the six-hour guardrail and the Climate Design Brief did not require a thermal intervention, so no unsupported geometry change was made.",
        analysisMetricSource: firstSun.metricSource,
        analysisNote: firstSun.note,
        floors: initial.mainFloorCount,
        grossFloorAreaSqFt: initial.grossFloorAreaSqFt,
        mezzanineAreaSqFt: initial.mezzanineAreaSqFt || undefined,
        partialTopFloorAreaSqFt: initial.partialTopFloorAreaSqFt || undefined,
        upperFloorAreaSqFt: initial.upperFloorAreaSqFt || undefined,
        geometryLevelCount: initial.floors.length,
        siteCoveragePercent: Number(((initial.footprintSqFt / Math.max(1, geometry.areaSqFt ?? initial.footprintSqFt)) * 100).toFixed(1)),
        remainingSiteAreaSqFt: Math.max(0, Math.round((geometry.areaSqFt ?? initial.footprintSqFt) - initial.footprintSqFt)),
        aspectRatio: initial.aspectRatio,
        orientationLabel: "East–west long axis",
        heightMeters: initial.heightMeters,
        baseElevationMeters: initial.baseElevationMeters,
        placementVerification: initial.placementVerification,
        projectFootprint: initial.projectFootprint,
        placementSummary: initial.placementSummary,
        programPlan: programPlanForMass(brief, initial),
        designImageDataUrl: initialDesignImageDataUrl,
        initialDesignImageDataUrl,
        sunAnalysisIds: [firstSun.analysisId],
        intervention: {
          issue: "No measured design-performance issue required a geometry change.",
          action: "Retain the requirements-driven initial mass.",
          objective: "Avoid unsupported redesign.",
          outcome: "not-required",
          reason: "Forma mean ground sun was at or below the six-hour guardrail.",
          initial: interventionSnapshot(brief, initial, firstSun),
        },
      });
    }

    // Test a visible, evidence-driven intervention while preserving gross area,
    // footprint, north access and existing-building clearances.
    const revised = makeMass(brief, geometry, THERMAL_REVISION_STRATEGY, obstacleFootprints);
    await placeMassOnTerrain(Forma, revised);
    const revisedElement = await Forma.elements.floorStack.createFromFloors({ floors: revised.floors });
    const addedRevised = await addValidatedMass(Forma, revisedElement.urn, revised, `${SITEMORPH_ELEMENT_NAME_PREFIX} ${brief.buildingType} · revised`, siteBoundary);
    revised.projectFootprint = addedRevised.footprint;
    elementPath = addedRevised.path;
    const revisedAnalysis = await Forma.analysis.triggerSun({ selectedElementPaths: [geometry.elementPath], month: 6, date: 21 });
    const revisedSun = await waitForSunAnalysis(Forma, revisedAnalysis.analysisId);
    const testedDesignImageDataUrl = await captureDesignImage(Forma, revised);
    const decision = evaluateSunIntervention(firstSun, revisedSun);
    const revisedProgramPlan = programPlanForMass(brief, revised);
    const interventionProgramLabel = revisedProgramPlan.interventionProgramLabel.toLowerCase();
    const testedMassDescription = "2.2:1 north-west concept mass (access engineering unconfirmed)";
    let finalMass = revised;
    let finalSun = revisedSun;
    let changeSummary: string;
    if (!decision.accepted) {
      const restored = await addValidatedMass(Forma, initialElement.urn, initial, `${SITEMORPH_ELEMENT_NAME_PREFIX} ${brief.buildingType} · retained initial`, siteBoundary);
      initial.projectFootprint = restored.footprint;
      elementPath = restored.path;
      finalMass = initial;
      finalSun = firstSun;
      changeSummary = decision.reason === "metrics-unavailable"
        ? `SiteMorph tested a ${testedMassDescription} with the ${interventionProgramLabel} shown east, but the embedded Forma result exposed no validated ground metrics. The agent rejected the unverified intervention and restored the initial design.`
        : `SiteMorph tested a ${testedMassDescription} with the ${interventionProgramLabel} shown east. Forma measured ${revisedSun.meanHours} h mean ground sun versus ${firstSun.meanHours} h initially (${decision.meanDeltaHours ?? 0} h reduction), below the required 0.1 h improvement, so the agent rejected the intervention and restored the initial design.`;
    } else {
      const improvedMetric = decision.reason === "peak-improved" ? "maximum ground sun" : "mean ground sun";
      changeSummary = `SiteMorph tested a ${testedMassDescription} with the ${interventionProgramLabel} shown east. Forma improved ${improvedMetric}; mean ground sun changed from ${firstSun.meanHours} h to ${revisedSun.meanHours} h. The agent accepted the measured intervention.`;
    }
    const designImageDataUrl = decision.accepted ? testedDesignImageDataUrl : initialDesignImageDataUrl;
    return attachSiteLayout(Forma, brief, geometry, finalMass, {
      designLoopVersion: "measured-v2",
      elementPath,
      name: brief.buildingType,
      footprintSqFt: finalMass.footprintSqFt,
      heightFt: finalMass.heightFt,
      revision: 2,
      sunAnalysisId: finalSun.analysisId,
      sunStatus: "succeeded",
      meanSunHours: finalSun.meanHours,
      maxSunHours: finalSun.maxHours,
      changeSummary,
      analysisMetricSource: finalSun.metricSource,
      analysisNote: finalSun.note,
      floors: finalMass.mainFloorCount,
      grossFloorAreaSqFt: finalMass.grossFloorAreaSqFt,
      mezzanineAreaSqFt: finalMass.mezzanineAreaSqFt || undefined,
      partialTopFloorAreaSqFt: finalMass.partialTopFloorAreaSqFt || undefined,
      upperFloorAreaSqFt: finalMass.upperFloorAreaSqFt || undefined,
      geometryLevelCount: finalMass.floors.length,
      siteCoveragePercent: Number(((finalMass.footprintSqFt / Math.max(1, geometry.areaSqFt ?? finalMass.footprintSqFt)) * 100).toFixed(1)),
      remainingSiteAreaSqFt: Math.max(0, Math.round((geometry.areaSqFt ?? finalMass.footprintSqFt) - finalMass.footprintSqFt)),
      aspectRatio: finalMass.aspectRatio,
      orientationLabel: "East–west long axis",
      heightMeters: finalMass.heightMeters,
      baseElevationMeters: finalMass.baseElevationMeters,
      placementVerification: finalMass.placementVerification,
      projectFootprint: finalMass.projectFootprint,
      placementSummary: finalMass.placementSummary,
      programPlan: programPlanForMass(brief, finalMass),
      designImageDataUrl,
      initialDesignImageDataUrl,
      testedDesignImageDataUrl,
      sunAnalysisIds: [firstSun.analysisId, revisedSun.analysisId],
      intervention: {
        issue: `Persistent hot-season thermal load (${climate.thermal.longestPersistenceHours} h maximum continuous persistence) makes exposed operational areas and west-facing program a design risk.`,
        action: `Test a longer east–west mass at a north-west concept position, show the ${revisedProgramPlan.interventionProgramLabel.toLowerCase()} on the east side, and preserve the north concept operations edge. Access engineering remains unconfirmed.`,
        objective: "Reduce Forma mean ground sun by at least 0.1 h, or reduce peak ground sun by at least 0.2 h without increasing the mean.",
        outcome: decision.accepted ? "accepted" : "rejected",
        reason: changeSummary,
        initial: interventionSnapshot(brief, initial, firstSun),
        tested: interventionSnapshot(brief, revised, revisedSun),
      },
    });
  }
}

export const formaDesignService = new FormaDesignService();
