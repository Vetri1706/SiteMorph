import { create } from "zustand";
import traceMock from "../mocks/agent-trace.json";
import { analysisService } from "../services/analysis.service";
import { climateService } from "../services/climate.service";
import { designService } from "../services/design.service";
import { formaService, type FormaConnectionState } from "../services/forma.service";
import { fortyGuardService, FortyGuardServiceError } from "../services/fortyguard.service";
import { formaOverlayService } from "../services/overlay.service";
import { formaDesignService } from "../services/forma-design.service";
import { formaClimateResponseService } from "../services/forma-climate-response.service";
import { revitHandoffService } from "../services/revit-handoff.service";
import { formaSubdivisionService, type GeneratedSubdivisionResult } from "../services/forma-subdivision.service";
import { formaSubdivisionOverlayService } from "../services/forma-subdivision-overlay.service";
import { generateSubdivisionLayouts } from "../utils/subdivision-layout";
import type { SubdivisionBrief, SubdivisionPlan } from "../types/subdivision";
import type {
  AgentTraceEvent,
  AnalysisStep,
  AppTab,
  ClimateDNA,
  ClimateLayerId,
  DesignBrief,
  DesignCandidate,
  FormaAnalysis,
  FortyGuardUsage,
  GeneratedBuilding,
  RevitHandoffReadiness,
  RankedThermalTile,
  SiteFitOption,
  SiteContext,
  SiteGeometry,
} from "../types";
import { appConfig, delay } from "../utils/config";
import { markNoThermalCoverageSteps, settleRunningAnalysisSteps } from "../utils/analysis-state";
import { mockSiteContext } from "../utils/mock-site";

const warehouseDemoBrief: DesignBrief = {
  buildingType: "Warehouse / Distribution Facility",
  totalAreaSqFt: 85000,
  program: [
    { name: "Cold Storage", areaSqFt: 20000 },
    { name: "Dry Storage", areaSqFt: 32000 },
    { name: "Packing", areaSqFt: 10000 },
    { name: "Offices", areaSqFt: 7000 },
    { name: "Loading / Logistics", areaSqFt: 16000 },
  ],
  floors: 1,
  targetFootprintSqFt: 85000,
  maximumHeightFt: 42,
  requiredParking: 86,
  loadingDocks: 18,
  preferredAccessRoad: "West Broadway Road",
  priority: "Balanced",
};

const liveBrief: DesignBrief = {
  buildingType: "",
  totalAreaSqFt: 0,
  program: [],
  floors: 1,
  targetFootprintSqFt: 0,
  maximumHeightFt: 0,
  requiredParking: 0,
  loadingDocks: 0,
  preferredAccessRoad: "",
  priority: "Balanced",
};

const defaultSubdivisionBrief: SubdivisionBrief = {
  schemaVersion: "sitemorph.subdivision-brief.v1",
  id: "climate-responsive-townhouse-neighborhood",
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

const createAnalysisSteps = (pointCount?: number): AnalysisStep[] => [
  { id: "geometry", label: "Site geometry extracted", detail: pointCount ? `${pointCount} Forma geometry points` : "Forma Site Limit", status: "pending" },
  { id: "heatmap", label: appConfig.paidFortyGuardAnalysis ? "Climate evidence" : "Saved heat activities", detail: appConfig.mockMode ? "60 m resolution" : appConfig.paidFortyGuardAnalysis ? appConfig.optionalFortyGuardEvidence ? `Saved AOI first · full first run: ${appConfig.firstRunActivityLimit} activities maximum` : "Saved AOI first · new Site Limit: 12 core thermal activities maximum" : "Safe mode · resume saved activity IDs · zero new submissions", status: "pending" },
  { id: "persistence", label: "Persistent heat analysis", status: "pending" },
  { id: "exceedance", label: "Threshold exceedance analysis", detail: "35 °C threshold", status: "pending" },
  ...(!appConfig.mockMode ? [
    { id: "peak-time", label: "Peak thermal hour analysis", detail: "time_of_measure · UTC", status: "pending" },
    { id: "ranking", label: "Hot-season relative tile ranking", detail: "40% temperature · 35% mean persistence · 25% mean exceedance", status: "pending" },
    { id: "environment", label: "Environmental parameters", detail: appConfig.optionalFortyGuardEvidence ? "Humidity · wet bulb · apparent temperature · solar" : "Deferred by Credit Saver mode", status: appConfig.optionalFortyGuardEvidence ? "pending" : "skipped", optional: true },
    { id: "satellite", label: "Satellite surface segmentation", detail: appConfig.optionalFortyGuardEvidence ? "Vegetation · pavement · roads · buildings" : "Deferred by Credit Saver mode", status: appConfig.optionalFortyGuardEvidence ? "pending" : "skipped", optional: true },
    { id: "street", label: "Street-edge context", detail: appConfig.optionalFortyGuardEvidence ? "North access edge · graceful fallback" : "Deferred by Credit Saver mode", status: appConfig.optionalFortyGuardEvidence ? "pending" : "skipped", optional: true },
  ] satisfies AnalysisStep[] : []),
  ...(appConfig.mockMode ? [
  { id: "environment", label: "Environmental context", status: "pending" },
  { id: "satellite", label: "Satellite segmentation", status: "pending" },
  { id: "street", label: "Street-level context", detail: "Optional endpoint", status: "pending", optional: true },
  ] satisfies AnalysisStep[] : []),
];

function applyCreditUsage(usage: FortyGuardUsage) {
  return (state: SiteMorphState): Partial<SiteMorphState> => ({
    site: state.site ? {
      ...state.site,
      creditsRemaining: usage.creditsRemaining,
      creditsUsed: usage.creditsUsed,
      creditsTotal: usage.creditsTotal,
      creditsPlan: usage.plan,
      creditsResetsAt: usage.resetsAt,
      creditsStatus: "available",
      creditsSource: usage.source ?? "live",
      creditsSavedAt: usage.savedAt,
      creditsStale: usage.stale ?? usage.source === "saved",
    } : null,
  });
}

type SiteSelectionStatus = "idle" | "waiting" | "resolving" | "ready" | "error";
type AnalysisCacheStatus = "unknown" | "checking" | "missing" | "pending" | "available" | "unavailable";
type DesignMode = "single-building" | "subdivision";
type SubdivisionStatus = "idle" | "generating-options" | "options-ready" | "building-selected" | "completed" | "failed";
let selectionRequestId = 0;
let selectionCandidateRequestId = 0;
let analysisRequestId = 0;
let initializationStarted = false;
let savedAnalysisPollTimer: number | undefined;
let savedAnalysisPollingStartedAt: number | undefined;
const SAVED_ANALYSIS_POLL_INTERVAL_MS = 15_000;
const SAVED_ANALYSIS_POLL_WINDOW_MS = 15 * 60_000;

function cancelSavedAnalysisPolling(resetWindow = false): void {
  if (savedAnalysisPollTimer !== undefined && typeof window !== "undefined") {
    window.clearTimeout(savedAnalysisPollTimer);
  }
  savedAnalysisPollTimer = undefined;
  if (resetWindow) savedAnalysisPollingStartedAt = undefined;
}

interface SiteMorphState {
  activeTab: AppTab;
  connection: FormaConnectionState;
  site: SiteContext | null;
  selectedSitePath: string | null;
  siteSelectionStatus: SiteSelectionStatus;
  siteGeometry: SiteGeometry | null;
  climateDNA: ClimateDNA | null;
  rankedTiles: RankedThermalTile[];
  activeLayer: ClimateLayerId | null;
  overlayVisible: boolean;
  analysisStatus: "idle" | "running" | "waiting" | "completed" | "failed";
  analysisCacheStatus: AnalysisCacheStatus;
  analysisSteps: AnalysisStep[];
  analysisError: string | null;
  designMode: DesignMode;
  designBrief: DesignBrief;
  candidates: DesignCandidate[];
  candidateStatus: "idle" | "generating" | "completed" | "failed";
  generatedBuilding: GeneratedBuilding | null;
  buildingStatus: "idle" | "generating" | "analyzing" | "completed" | "failed";
  subdivisionBrief: SubdivisionBrief;
  subdivisionPlan: SubdivisionPlan | null;
  selectedSubdivisionVariantId: string | null;
  generatedSubdivision: GeneratedSubdivisionResult | null;
  subdivisionStatus: SubdivisionStatus;
  revitHandoffStatus: "idle" | "preparing" | "ready" | "failed";
  revitHandoff: RevitHandoffReadiness | null;
  selectedCandidateId: string | null;
  improvedCandidate: DesignCandidate | null;
  redesignStatus: "idle" | "running" | "completed" | "accepted" | "failed";
  formaAnalyses: FormaAnalysis[];
  recommendation: string | null;
  selectedSiteFitOptionId: string | null;
  agentTrace: AgentTraceEvent[];
  toast: string | null;
  setActiveTab(tab: AppTab): void;
  initialize(): Promise<void>;
  selectSiteLimit(): Promise<void>;
  analyzeSite(cacheOnly?: boolean): Promise<void>;
  retryAnalysis(): Promise<void>;
  setThreshold(value: number): void;
  toggleLayer(layer: ClimateLayerId): Promise<void>;
  focusZone(zoneId: string): Promise<void>;
  setDesignMode(mode: DesignMode): void;
  updateBrief(patch: Partial<DesignBrief>): void;
  updateProgram(index: number, areaSqFt: number): void;
  applySiteFitOption(option: SiteFitOption): void;
  generateCandidates(): Promise<void>;
  generateBuilding(): Promise<void>;
  updateSubdivisionBrief(patch: Partial<SubdivisionBrief>): void;
  generateSubdivisionOptions(): Promise<void>;
  selectSubdivisionVariant(variantId: string): void;
  generateSubdivision(): Promise<void>;
  prepareRevitHandoff(): Promise<void>;
  viewCandidate(candidateId: string): Promise<void>;
  selectCandidate(candidateId: string): Promise<void>;
  improveRecommended(): Promise<void>;
  acceptImproved(): Promise<void>;
  setToast(message: string | null): void;
}

export const useSiteMorphStore = create<SiteMorphState>((set, get) => ({
  activeTab: "site",
  connection: { connected: false, mode: appConfig.mockMode ? "mock" : "embedded", message: "Connecting…" },
  site: appConfig.mockMode ? mockSiteContext : null,
  selectedSitePath: appConfig.mockMode ? mockSiteContext.geometry!.elementPath : null,
  siteSelectionStatus: appConfig.mockMode ? "ready" : "idle",
  siteGeometry: appConfig.mockMode ? mockSiteContext.geometry! : null,
  climateDNA: null,
  rankedTiles: [],
  activeLayer: null,
  overlayVisible: false,
  analysisStatus: "idle",
  analysisCacheStatus: "unknown",
  analysisSteps: createAnalysisSteps(appConfig.mockMode ? mockSiteContext.geometry!.pointCount : undefined),
  analysisError: null,
  designMode: "single-building",
  designBrief: appConfig.mockMode ? warehouseDemoBrief : liveBrief,
  candidates: [],
  candidateStatus: "idle",
  generatedBuilding: null,
  buildingStatus: "idle",
  subdivisionBrief: defaultSubdivisionBrief,
  subdivisionPlan: null,
  selectedSubdivisionVariantId: null,
  generatedSubdivision: null,
  subdivisionStatus: "idle",
  revitHandoffStatus: "idle",
  revitHandoff: null,
  selectedCandidateId: null,
  improvedCandidate: null,
  redesignStatus: "idle",
  formaAnalyses: [],
  recommendation: null,
  selectedSiteFitOptionId: null,
  agentTrace: [],
  toast: null,

  setActiveTab: (activeTab) => set({ activeTab }),

  setDesignMode: (designMode) => set({ designMode, toast: designMode === "subdivision" ? "Residential subdivision mode · saved FortyGuard Climate DNA will be reused" : "Single-building design mode" }),

  initialize: async () => {
    if (initializationStarted) return;
    initializationStarted = true;
    if (!appConfig.mockMode) {
      cancelSavedAnalysisPolling(true);
      set({
        selectedSitePath: null,
        siteGeometry: null,
        climateDNA: null,
        rankedTiles: [],
        siteSelectionStatus: "idle",
        activeLayer: null,
        overlayVisible: false,
        analysisStatus: "idle",
        analysisCacheStatus: "unknown",
        analysisError: null,
        analysisSteps: createAnalysisSteps(),
        generatedBuilding: null,
        buildingStatus: "idle",
        subdivisionPlan: null,
        selectedSubdivisionVariantId: null,
        generatedSubdivision: null,
        subdivisionStatus: "idle",
        revitHandoffStatus: "idle",
        revitHandoff: null,
      });
    }
    try {
      const connection = await formaService.connect();
      const site = await formaService.getCurrentProject();
      set({ connection, site, siteGeometry: appConfig.mockMode ? site.geometry ?? null : null });
      if (!appConfig.mockMode) {
        void fortyGuardService.getUsage().then((usage) => {
          set(applyCreditUsage(usage));
        }).catch(() => {
          set((state) => ({ site: state.site ? { ...state.site, creditsStatus: "unavailable" } : null }));
        });
      }
      const resolveSelectedSiteLimit = async (
        selectedSitePath: string,
        options?: { autoRestore?: boolean; silentInvalid?: boolean; preloadedGeometry?: SiteGeometry },
      ) => {
        const requestId = ++selectionRequestId;
        analysisRequestId += 1;
        cancelSavedAnalysisPolling(true);
        set({
          selectedSitePath,
          siteSelectionStatus: "resolving",
          siteGeometry: null,
          climateDNA: null,
          rankedTiles: [],
          activeLayer: null,
          overlayVisible: false,
          analysisStatus: "idle",
          analysisCacheStatus: "unknown",
          analysisError: null,
          generatedBuilding: null,
          buildingStatus: "idle",
          subdivisionPlan: null,
          selectedSubdivisionVariantId: null,
          generatedSubdivision: null,
          subdivisionStatus: "idle",
          revitHandoffStatus: "idle",
          revitHandoff: null,
        });
        try {
          const [siteGeometry, currentProject] = await Promise.all([
            options?.preloadedGeometry
              ? Promise.resolve(options.preloadedGeometry)
              : formaService.readSiteLimit(selectedSitePath),
            formaService.getCurrentProject().catch(() => null),
          ]);
          if (requestId !== selectionRequestId || get().selectedSitePath !== selectedSitePath) return;
          await formaService.highlightElement(selectedSitePath);
          set((state) => {
            const mergedSite = currentProject
              ? { ...(state.site ?? {}), ...currentProject }
              : state.site;
            return {
              siteGeometry,
              siteSelectionStatus: "ready",
              analysisSteps: createAnalysisSteps(siteGeometry.pointCount),
              site: mergedSite ? {
                ...mergedSite,
                siteId: selectedSitePath,
                siteName: "Selected Forma Site Limit",
                selectedSiteLimit: selectedSitePath.split("/").at(-1) ?? "Site Limit",
                geometry: siteGeometry,
                areaSqFt: siteGeometry.areaSqFt ?? 0,
                areaAcres: siteGeometry.areaAcres ?? 0,
              } : null,
              toast: options?.autoRestore
                ? "Site boundary restored · checking the saved Climate DNA"
                : `Site boundary detected · ${siteGeometry.pointCount} geometry points`,
            };
          });
          if (options?.autoRestore) await get().analyzeSite(true);
        } catch (error) {
          if (requestId !== selectionRequestId) return;
          set({
            selectedSitePath: options?.silentInvalid ? null : selectedSitePath,
            siteGeometry: null,
            climateDNA: null,
            siteSelectionStatus: options?.silentInvalid ? "idle" : "waiting",
            toast: options?.silentInvalid ? null : error instanceof Error ? error.message : "Site selection failed",
          });
        }
      };

      await formaService.subscribeToSelection((paths) => {
        const selectedSitePath = paths[0];
        const selectionStatus = get().siteSelectionStatus;
        if (!selectedSitePath) return;
        if (selectionStatus === "waiting" || selectionStatus === "resolving") {
          void resolveSelectedSiteLimit(selectedSitePath, { autoRestore: true });
          return;
        }
        if (selectionStatus !== "ready" || get().siteGeometry?.elementPath === selectedSitePath) return;
        const candidateRequestId = ++selectionCandidateRequestId;
        void formaService.readSiteLimit(selectedSitePath).then((siteGeometry) => {
          if (candidateRequestId !== selectionCandidateRequestId) return;
          void resolveSelectedSiteLimit(selectedSitePath, { autoRestore: true, preloadedGeometry: siteGeometry });
        }).catch(() => {
          // Selecting a building, tree, or concept overlay must not replace the
          // active Site Limit or pair its path with stale AOI geometry.
        });
      });

      if (!appConfig.mockMode) {
        const currentSelection = await formaService.getSelectedPaths();
        const currentPath = currentSelection[0];
        if (currentPath) await resolveSelectedSiteLimit(currentPath, { autoRestore: true, silentInvalid: true });
      }
    } catch (error) {
      initializationStarted = false;
      set({
        connection: { connected: false, mode: appConfig.mockMode ? "mock" : "embedded", message: error instanceof Error ? error.message : "Forma connection failed" },
      });
    }
  },

  selectSiteLimit: async () => {
    if (appConfig.mockMode) {
      const siteGeometry = await formaService.readSiteLimit(mockSiteContext.geometry!.elementPath);
      set({ selectedSitePath: siteGeometry.elementPath, siteGeometry, siteSelectionStatus: "ready", toast: `Site boundary detected · ${siteGeometry.pointCount} geometry points` });
      return;
    }

    selectionRequestId += 1;
    selectionCandidateRequestId += 1;
    analysisRequestId += 1;
    cancelSavedAnalysisPolling(true);
    set({
      selectedSitePath: null,
      siteGeometry: null,
      climateDNA: null,
      rankedTiles: [],
      siteSelectionStatus: "waiting",
      activeLayer: null,
      overlayVisible: false,
      analysisStatus: "idle",
      analysisCacheStatus: "unknown",
      analysisError: null,
      analysisSteps: createAnalysisSteps(),
      generatedBuilding: null,
      buildingStatus: "idle",
      subdivisionPlan: null,
      selectedSubdivisionVariantId: null,
      generatedSubdivision: null,
      subdivisionStatus: "idle",
      revitHandoffStatus: "idle",
      revitHandoff: null,
      toast: "Waiting for selection · Click a Site Limit in Forma",
    });
    await Promise.all([formaOverlayService.clearLayers(), formaSubdivisionOverlayService.clear(), formaService.clearHighlight()]);
  },

  analyzeSite: async (cacheOnly = false) => {
    const geometry = get().siteGeometry;
    if (!geometry) {
      set({ analysisError: "No Site Limit Selected", analysisStatus: "failed" });
      return;
    }
    const requestId = ++analysisRequestId;
    const isCurrentRequest = () => requestId === analysisRequestId
      && get().siteGeometry?.elementPath === geometry.elementPath
      && get().selectedSitePath === geometry.elementPath;
    cancelSavedAnalysisPolling(!cacheOnly);
    set({
      analysisStatus: "running",
      analysisCacheStatus: cacheOnly ? "checking" : get().analysisCacheStatus,
      analysisError: null,
      analysisSteps: createAnalysisSteps(geometry.pointCount),
    });
    const advance = async (id: string, status: AnalysisStep["status"], activityId?: string) => {
      if (!isCurrentRequest()) return;
      set((state) => ({ analysisSteps: state.analysisSteps.map((step) => step.id === id ? { ...step, status, activityId } : step) }));
      await delay(status === "running" ? 320 : 100);
    };

    try {
      await advance("geometry", "running");
      await advance("geometry", "completed");
      await advance("heatmap", "running");
      const result = await climateService.analyze(geometry, 35, get().site?.timezone, cacheOnly);
      if (!isCurrentRequest()) return;
      await advance("heatmap", "completed", result.climateDNA.activityId);
      for (const id of ["persistence", "exceedance", "peak-time", "ranking"] as const) {
        if (appConfig.mockMode && (id === "peak-time" || id === "ranking")) continue;
        await advance(id, "running");
        await advance(id, "completed");
      }
      if (!appConfig.mockMode) {
        await advance("environment", result.climateDNA.environmental ? "completed" : "skipped");
        await advance("satellite", result.climateDNA.surface ? "completed" : "skipped");
        await advance("street", result.climateDNA.street?.available ? "completed" : "skipped");
      }
      if (appConfig.mockMode) {
        for (const id of ["environment", "satellite"] as const) {
          await advance(id, "running");
          await advance(id, "completed");
        }
        await advance("street", "running");
        await advance("street", "skipped");
      }
      formaOverlayService.setAnalysisResult(result, geometry);
      const initialLayer: ClimateLayerId = appConfig.mockMode ? "persistence" : result.climateDNA.designBrief.thermalZoningConfidence === "LOW" ? "temperature" : "ranked-zones";
      await formaOverlayService.addHeatLayer(initialLayer);
      cancelSavedAnalysisPolling(true);
      set({
        climateDNA: result.climateDNA,
        rankedTiles: result.rankedTiles ?? [],
        analysisStatus: "completed",
        analysisCacheStatus: "available",
        activeTab: "climate",
        activeLayer: initialLayer,
        overlayVisible: true,
        agentTrace: appConfig.mockMode ? traceMock as AgentTraceEvent[] : [
          { id: "live-geometry", timestamp: new Date().toLocaleTimeString(), type: "Observation", title: "Forma Site Limit geometry read", detail: `${geometry.pointCount} selected coordinates converted to WGS84 GeoJSON`, source: "forma" },
          { id: "live-analysis", timestamp: new Date().toLocaleTimeString(), type: "Tool Call", title: result.cache?.source === "live" ? "FortyGuard analysis completed and saved" : "Saved AOI analysis loaded", detail: `${result.cache?.source === "live" ? "Live" : "No-credit cache"} · TCM + persistence + exceedance + time_of_measure across ${result.rankedTiles?.[0]?.sampleCount ?? 0} hot-season dates`, activityId: result.climateDNA.activityId, source: "fortyguard" },
          { id: "live-context", timestamp: new Date().toLocaleTimeString(), type: "Tool Call", title: "Non-heat site evidence requested", detail: `Environmental ${result.climateDNA.environmental ? "complete" : "skipped"} · Satellite ${result.climateDNA.surface ? "complete" : "skipped"} · Street View ${result.climateDNA.street?.available ? "complete" : "unavailable"}`, source: "fortyguard" },
          { id: "live-ranking", timestamp: new Date().toLocaleTimeString(), type: "Decision", title: result.climateDNA.designBrief.thermalZoningConfidence === "LOW" ? "Site-wide Climate Design Brief created" : "Relative tile suitability computed", detail: result.climateDNA.designBrief.summary, reason: "Only make spatial claims supported by the sampled AOI tiles", source: "sitemorph" },
          { id: "live-overlay", timestamp: new Date().toLocaleTimeString(), type: "Result", title: "FortyGuard evidence rendered in Forma", detail: result.climateDNA.designBrief.thermalZoningConfidence === "LOW" ? "Site-wide thermal coverage · no invented preferred corner" : "Green preferred · amber moderate · red avoid", source: "forma" },
        ],
        toast: appConfig.mockMode
          ? "Climate DNA ready · Persistent Heat overlay simulated"
          : result.cache?.source !== "live"
            ? "Saved Climate DNA loaded · no FortyGuard credits used"
            : result.cache?.persisted
              ? "Climate DNA ready · analysis saved for no-credit reuse"
              : "Climate DNA ready · disk cache unavailable, session cache only",
      });
      if (!appConfig.mockMode) {
        void fortyGuardService.getUsage().then((usage) => {
          set(applyCreditUsage(usage));
        }).catch(() => {
          // Keep the completed analysis visible if usage reporting is temporarily unavailable.
        });
      }
    } catch (error) {
      if (!isCurrentRequest()) return;
      const message = error instanceof Error ? error.message : "Analysis failed";
      const errorCode = error instanceof FortyGuardServiceError ? error.code : "";
      const noThermalCoverage = errorCode === "NO_THERMAL_COVERAGE";
      const savedResultMissing = cacheOnly && (errorCode === "SAVED_ANALYSIS_MISSING" || message.includes("No complete saved analysis exists yet"));
      const normalizedMessage = message.toLowerCase();
      const savedActivitiesPending = [
        "JOB_PENDING",
        "CACHE_CHECK_TIMEOUT",
        "ANALYSIS_REQUEST_TIMEOUT",
        "ANALYSIS_ALREADY_RUNNING",
      ].includes(errorCode)
        || normalizedMessage.includes("still running")
        || normalizedMessage.includes("still processing")
        || normalizedMessage.includes("request has stopped");
      set((state) => {
        if (noThermalCoverage) {
          cancelSavedAnalysisPolling(true);
          return {
            analysisStatus: "failed",
            analysisCacheStatus: "unavailable",
            analysisSteps: markNoThermalCoverageSteps(state.analysisSteps),
            analysisError: message,
            toast: "No FortyGuard thermal coverage for this Site Limit · saved activities will not be resubmitted",
          };
        }
        if (savedResultMissing) {
          cancelSavedAnalysisPolling(true);
          return {
            analysisStatus: "idle",
            analysisCacheStatus: "missing",
            analysisSteps: settleRunningAnalysisSteps(state.analysisSteps, "pending"),
            analysisError: null,
            toast: appConfig.paidFortyGuardAnalysis
              ? "No saved Climate DNA found · first thermal run requires explicit approval"
              : "No saved Climate DNA matches this Site Limit · initial analysis is disabled",
          };
        }
        if (savedActivitiesPending) {
          const now = Date.now();
          savedAnalysisPollingStartedAt ??= now;
          const pollingContinues = now - savedAnalysisPollingStartedAt < SAVED_ANALYSIS_POLL_WINDOW_MS;
          if (pollingContinues && typeof window !== "undefined") {
            savedAnalysisPollTimer = window.setTimeout(() => {
              savedAnalysisPollTimer = undefined;
              const current = get();
              if (current.analysisStatus === "waiting" && current.siteGeometry?.elementPath === geometry.elementPath) {
                void current.analyzeSite(true);
              }
            }, SAVED_ANALYSIS_POLL_INTERVAL_MS);
          }
          return {
            analysisStatus: "waiting",
            analysisCacheStatus: "pending",
            analysisSteps: settleRunningAnalysisSteps(state.analysisSteps, "pending"),
            analysisError: message,
            toast: pollingContinues
              ? "FortyGuard is processing · saved activities will be checked automatically"
              : "Automatic checks paused after 15 minutes · use Check Processing Status to resume",
          };
        }
        cancelSavedAnalysisPolling(true);
        return {
          analysisStatus: "failed",
          analysisSteps: settleRunningAnalysisSteps(state.analysisSteps, "failed"),
          analysisError: message,
          toast: null,
        };
      });
    }
  },

  retryAnalysis: async () => get().analyzeSite(true),

  setThreshold: (value) => {
    const climateDNA = get().climateDNA;
    if (!climateDNA) return;
    set({ climateDNA: climateService.recalculateThreshold(climateDNA, value), toast: `Threshold updated to ${value} °C` });
  },

  toggleLayer: async (layer) => {
    const climateDNA = get().climateDNA;
    const layerDefinition = climateDNA?.layers.find((item) => item.id === layer);
    if (!layerDefinition?.available) {
      set({ toast: "Street imagery unavailable. Analysis continues without street-level context." });
      return;
    }
    const overlay = await formaOverlayService.toggleLayer(layer);
    set({ activeLayer: overlay.activeLayer, overlayVisible: overlay.visible, toast: overlay.visible ? `${layerDefinition.name} overlay ${appConfig.mockMode ? "simulated" : "active in Forma"}` : "Forma overlay cleared" });
  },

  focusZone: async (zoneId) => {
    const zone = get().climateDNA?.zones.find((item) => item.id === zoneId);
    if (!zone) return;
    const selectedSitePath = get().siteGeometry?.elementPath ?? get().selectedSitePath;
    if (!selectedSitePath) {
      set({ toast: "Select a real Forma Site Limit before highlighting it." });
      return;
    }
    await Promise.all([formaOverlayService.focusZone(zone), formaService.highlightElement(selectedSitePath)]);
    set({ activeLayer: "ranked-zones", overlayVisible: true, toast: `${zone.name} — ${zone.direction} ${appConfig.mockMode ? "highlight simulated" : "highlighted in Forma"}` });
  },

  updateBrief: (patch) => set((state) => ({ designBrief: { ...state.designBrief, ...patch }, selectedSiteFitOptionId: null, revitHandoffStatus: "idle", revitHandoff: null })),

  updateProgram: (index, areaSqFt) => set((state) => ({
    designBrief: { ...state.designBrief, program: state.designBrief.program.map((item, itemIndex) => itemIndex === index ? { ...item, areaSqFt } : item) },
    selectedSiteFitOptionId: null,
    revitHandoffStatus: "idle",
    revitHandoff: null,
  })),

  applySiteFitOption: (option) => set((state) => ({
    designBrief: option.brief,
    selectedSiteFitOptionId: option.id,
    revitHandoffStatus: "idle",
    revitHandoff: null,
    agentTrace: [
      ...state.agentTrace,
      {
        id: `site-fit-${option.id}-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString(),
        type: "Recommendation",
        title: `${option.label} brief selected`,
        detail: `${option.score}/100 preliminary physical-climate fit · ${option.sizeSummary}`,
        reason: option.reasons.join(" "),
        source: "sitemorph",
      },
    ],
    toast: `${option.label} loaded into Project requirements · review or edit any field`,
  })),

  generateCandidates: async () => {
    const climateDNA = get().climateDNA;
    if (!climateDNA) {
      set({ toast: "Analyze the site before generating design options." });
      return;
    }
    set({ candidateStatus: "generating" });
    try {
      const candidates = await designService.generateCandidates(get().designBrief, climateDNA);
      const formaAnalyses = await analysisService.readAnalyses();
      set({ candidates, formaAnalyses, candidateStatus: "completed", recommendation: "candidate-b", toast: "3 precomputed design candidates loaded" });
    } catch (error) {
      set({ candidateStatus: "failed", toast: error instanceof Error ? error.message : "Candidate generation failed" });
    }
  },

  generateBuilding: async () => {
    const climateDNA = get().climateDNA;
    const geometry = get().siteGeometry;
    if (!climateDNA || !geometry) {
      set({ toast: "Analyze a real Forma Site Limit before generating a building." });
      return;
    }
    set({ buildingStatus: "generating", revitHandoffStatus: "idle", revitHandoff: null, toast: "Creating one real building mass in Forma…" });
    try {
      await formaSubdivisionOverlayService.clear().catch(() => undefined);
      set({ buildingStatus: "analyzing" });
      const generatedBuilding = await formaDesignService.generateAndImprove(get().designBrief, geometry, climateDNA, get().generatedBuilding?.elementPath);
      let resolvedBuilding = generatedBuilding;
      let climateResponseError: string | undefined;
      try {
        const climateResponse = await formaClimateResponseService.create(generatedBuilding, geometry, climateDNA);
        formaOverlayService.setClimateResponse(climateResponse, geometry);
        await formaOverlayService.addHeatLayer("climate-response");
        resolvedBuilding = { ...generatedBuilding, climateResponse: climateResponse.summary };
      } catch (error) {
        climateResponseError = error instanceof Error ? error.message : "Hybrid Climate Response could not be resolved";
        formaOverlayService.clearClimateResponse();
        if (get().activeLayer === "climate-response") await formaOverlayService.clearLayers().catch(() => undefined);
      }
      const sunDetail = resolvedBuilding.maxSunHours === undefined
        ? "Native Sun job completed · ground-grid metrics unavailable through the embedded SDK"
        : `Mean ${resolvedBuilding.meanSunHours ?? 0} h · maximum ${resolvedBuilding.maxSunHours} h`;
      set((state) => ({
        generatedBuilding: resolvedBuilding,
        buildingStatus: "completed",
        generatedSubdivision: null,
        subdivisionStatus: state.subdivisionPlan ? "options-ready" : "idle",
        climateDNA: !state.climateDNA ? state.climateDNA : resolvedBuilding.climateResponse ? {
          ...state.climateDNA,
          layers: [
            {
              id: "climate-response" as const,
              name: "Forma-resolved Climate Response",
              description: `${resolvedBuilding.climateResponse.status === "complete" ? "FortyGuard + Forma Sun + Rapid Wind" : "Partial hybrid response"} · ${resolvedBuilding.climateResponse.resolutionMeters} m grid`,
              available: true,
              unit: "index",
              overlayType: "sdk" as const,
            },
            ...state.climateDNA.layers.filter((layer) => layer.id !== "climate-response"),
          ],
          provenance: {
            ...state.climateDNA.provenance,
            response: {
              source: "sitemorph",
              label: resolvedBuilding.climateResponse.label,
              resolution: `${resolvedBuilding.climateResponse.resolutionMeters} m`,
              confidence: resolvedBuilding.climateResponse.status === "complete" ? "Hybrid result from all configured inputs" : "Partial hybrid result; unavailable native inputs omitted",
              derivedFrom: resolvedBuilding.climateResponse.inputs.map((input) => input.label),
            },
          },
        } : {
          ...state.climateDNA,
          layers: state.climateDNA.layers.filter((layer) => layer.id !== "climate-response"),
          provenance: { ...state.climateDNA.provenance, response: undefined },
        },
        activeLayer: resolvedBuilding.climateResponse ? "climate-response" : state.activeLayer === "climate-response" ? null : state.activeLayer,
        overlayVisible: resolvedBuilding.climateResponse ? true : state.activeLayer === "climate-response" ? false : state.overlayVisible,
        agentTrace: [
          ...state.agentTrace,
          { id: `design-create-${Date.now()}`, timestamp: new Date().toLocaleTimeString(), type: "Tool Call", title: "Actual Forma floor-stack created", detail: `${resolvedBuilding.footprintSqFt.toLocaleString()} ft² footprint · ${resolvedBuilding.heightFt} ft height`, source: "forma" },
          { id: `design-overlay-${Date.now()}`, timestamp: new Date().toLocaleTimeString(), type: "Result", title: resolvedBuilding.siteOverlayStatus === "rendered" ? "Typology-aware site overlay rendered" : "Site overlay unavailable", detail: resolvedBuilding.siteOverlayStatus === "rendered" ? `${resolvedBuilding.siteLayout?.typologyLabel ?? "Building"} concept · ${resolvedBuilding.siteLayout?.parkingRequirement ?? 0} parking · access and ${resolvedBuilding.programPlan?.operations.outdoorZoneLabel.toLowerCase() ?? "operations"}` : resolvedBuilding.siteOverlayNote, reason: "Requirements are translated into a preliminary terrain diagram while the native Forma mass remains authoritative geometry", source: "sitemorph" },
          { id: `design-sun-${Date.now()}`, timestamp: new Date().toLocaleTimeString(), type: "Result", title: "Native Forma sun analysis completed", detail: sunDetail, activityId: resolvedBuilding.sunAnalysisId, source: "forma" },
          { id: `design-revise-${Date.now()}`, timestamp: new Date().toLocaleTimeString(), type: "Decision", title: resolvedBuilding.intervention?.outcome === "accepted" ? "Measured intervention accepted" : resolvedBuilding.intervention?.outcome === "rejected" ? "Unproven intervention rejected" : "Initial geometry retained", detail: resolvedBuilding.changeSummary, reason: resolvedBuilding.intervention?.objective ?? "Use measured Forma performance to change geometry without inventing an A/B/C workflow", source: "sitemorph" },
          resolvedBuilding.climateResponse
            ? { id: `hybrid-response-${Date.now()}`, timestamp: new Date().toLocaleTimeString(), type: "Result", title: "Forma-resolved Climate Response rendered", detail: `${resolvedBuilding.climateResponse.meanRiskScore} mean · ${resolvedBuilding.climateResponse.maximumRiskScore} maximum · ${resolvedBuilding.climateResponse.resolutionMeters} m grid`, reason: resolvedBuilding.climateResponse.formula, source: "sitemorph" }
            : { id: `hybrid-response-${Date.now()}`, timestamp: new Date().toLocaleTimeString(), type: "Result", title: "Hybrid Climate Response unavailable", detail: climateResponseError, reason: "No synthetic spatial detail was generated when native grids could not be resolved", source: "sitemorph" },
        ],
        toast: resolvedBuilding.climateResponse
          ? `${resolvedBuilding.climateResponse.status === "complete" ? "FortyGuard + Forma Climate Response active" : "Partial Climate Response active"} · no new FortyGuard credits used`
          : `Building validated · ${climateResponseError ?? "hybrid response unavailable"}`,
      }));
    } catch (error) {
      set({ buildingStatus: "failed", toast: error instanceof Error ? error.message : "Forma building generation failed" });
    }
  },

  updateSubdivisionBrief: (patch) => set((state) => ({
    subdivisionBrief: {
      ...state.subdivisionBrief,
      ...patch,
      setbacks: patch.setbacks ? { ...state.subdivisionBrief.setbacks, ...patch.setbacks } : state.subdivisionBrief.setbacks,
    },
    subdivisionPlan: null,
    selectedSubdivisionVariantId: null,
    generatedSubdivision: null,
    subdivisionStatus: "idle",
    revitHandoffStatus: "idle",
    revitHandoff: null,
  })),

  generateSubdivisionOptions: async () => {
    const climateDNA = get().climateDNA;
    const geometry = get().siteGeometry;
    if (!climateDNA || !geometry) {
      set({ subdivisionStatus: "failed", toast: "Analyze a real Forma Site Limit before generating subdivision options." });
      return;
    }
    set({ subdivisionStatus: "generating-options", generatedSubdivision: null, revitHandoffStatus: "idle", revitHandoff: null, toast: "Combining saved FortyGuard evidence with deterministic subdivision constraints…" });
    await Promise.resolve();
    try {
      const subdivisionPlan = generateSubdivisionLayouts(geometry, climateDNA, get().subdivisionBrief);
      const recommended = subdivisionPlan.variants.find((variant) => variant.rank === 1) ?? subdivisionPlan.variants[0];
      set((state) => ({
        subdivisionPlan,
        selectedSubdivisionVariantId: recommended.id,
        subdivisionStatus: "options-ready",
        agentTrace: [
          ...state.agentTrace,
          {
            id: `subdivision-fortyguard-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString(),
            type: "Decision",
            title: "FortyGuard-weighted subdivision options generated",
            detail: `${subdivisionPlan.variants.length} deterministic plans · ${subdivisionPlan.historicalBurden.scorePercent}% historical heat burden · climate carries 50% of ranking`,
            reason: `${subdivisionPlan.historicalBurden.formula} ${recommended.scoreBreakdown.formula}`,
            source: "fortyguard",
          },
          {
            id: `subdivision-plan-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString(),
            type: "Recommendation",
            title: `${recommended.label} ranked first`,
            detail: `${recommended.metrics.dwellingCount} dwellings · ${recommended.metrics.landEfficiencyPercent}% land efficiency · ${recommended.metrics.treeCount} concept trees · ${recommended.climatePerformance.residualHeatRiskScore}/100 residual heat risk`,
            reason: recommended.climatePerformance.formula,
            source: "sitemorph",
          },
        ],
        toast: `${subdivisionPlan.variants.length} auditable options ready · saved FortyGuard Climate DNA reused · zero new activities`,
      }));
    } catch (error) {
      set({ subdivisionStatus: "failed", toast: error instanceof Error ? error.message : "Subdivision option generation failed" });
    }
  },

  selectSubdivisionVariant: (variantId) => set((state) => {
    const variant = state.subdivisionPlan?.variants.find((item) => item.id === variantId);
    if (!variant) return { toast: "That subdivision option is no longer available." };
    return {
      selectedSubdivisionVariantId: variantId,
      generatedSubdivision: state.generatedSubdivision?.variantId === variantId ? state.generatedSubdivision : null,
      subdivisionStatus: state.generatedSubdivision?.variantId === variantId ? "completed" : "options-ready",
      revitHandoffStatus: "idle",
      revitHandoff: null,
      toast: `${variant.label} selected · ${variant.metrics.dwellingCount} native dwellings will be created only when you confirm the build`,
    };
  }),

  generateSubdivision: async () => {
    const { climateDNA, siteGeometry, subdivisionPlan, selectedSubdivisionVariantId } = get();
    const variant = subdivisionPlan?.variants.find((item) => item.id === selectedSubdivisionVariantId);
    if (!climateDNA || !siteGeometry || !subdivisionPlan || !variant) {
      set({ subdivisionStatus: "failed", toast: "Generate and select a FortyGuard-weighted subdivision option first." });
      return;
    }
    set({ subdivisionStatus: "building-selected", generatedSubdivision: null, revitHandoffStatus: "idle", revitHandoff: null, toast: `Creating ${variant.metrics.dwellingCount} terrain-placed dwellings plus persistent roads and trees…` });
    try {
      const generatedSubdivision = await formaSubdivisionService.materialize(variant, siteGeometry);
      let overlayRendered = true;
      let overlayNote = "Transient labels rendered above persistent Forma roads, paths, green areas, lot outlines and low-poly tree models.";
      try {
        await formaOverlayService.clearLayers();
        formaOverlayService.clearClimateResponse();
        await formaSubdivisionOverlayService.render(siteGeometry, variant, "annotations-only");
      } catch (error) {
        overlayRendered = false;
        overlayNote = error instanceof Error ? error.message : "The transient subdivision labels could not be rendered; persistent context remains in Forma.";
      }
      set((state) => ({
        generatedSubdivision,
        generatedBuilding: null,
        buildingStatus: "idle",
        subdivisionStatus: "completed",
        activeLayer: null,
        overlayVisible: false,
        agentTrace: [
          ...state.agentTrace,
          {
            id: `subdivision-native-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString(),
            type: "Tool Call",
            title: "Selected subdivision persisted as native dwellings plus concept context",
            detail: `${generatedSubdivision.elements.length} verified floor stacks · ${generatedSubdivision.persistentContext.roadFeatureCount} road · ${generatedSubdivision.persistentContext.pedestrianPathFeatureCount} path · ${generatedSubdivision.persistentContext.treeCount} low-poly trees · ${generatedSubdivision.totalGrossFloorAreaSqFt.toLocaleString()} ft² dwelling GFA`,
            reason: "Every dwelling and assumed tree is terrain-sampled and verified. The road/green plan is a refresh-safe virtual Forma context root; only dwelling floor stacks are the native Revit source.",
            source: "forma",
          },
          {
            id: `subdivision-overlay-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString(),
            type: "Result",
            title: overlayRendered ? "Persistent subdivision context labelled" : "Persistent subdivision retained; transient labels unavailable",
            detail: overlayNote,
            reason: "Roads, lots, open space and recognizable tree models persist as virtual SiteMorph concept elements; transient raster work is limited to labels and does not define the design.",
            source: "sitemorph",
          },
          {
            id: `subdivision-analysis-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString(),
            type: "Result",
            title: generatedSubdivision.nativeAnalysis.status === "succeeded" ? "Native Forma subdivision Sun analysis completed" : "Native Forma subdivision analysis recorded",
            detail: generatedSubdivision.nativeAnalysis.note,
            activityId: generatedSubdivision.nativeAnalysis.analysisId,
            source: "forma",
          },
        ],
        toast: `${generatedSubdivision.elements.length} native dwellings + ${generatedSubdivision.persistentContext.treeCount} persistent 3D trees verified · ${generatedSubdivision.nativeAnalysis.status === "succeeded" ? "Forma Sun measured" : "native analysis status recorded"} · zero new FortyGuard activities`,
      }));
    } catch (error) {
      set({ subdivisionStatus: "failed", toast: error instanceof Error ? error.message : "Native Forma subdivision generation failed" });
    }
  },

  prepareRevitHandoff: async () => {
    const building = get().generatedBuilding;
    const geometry = get().siteGeometry;
    if (!building || !geometry) {
      set({ revitHandoffStatus: "failed", toast: "Generate and validate a Forma building before preparing Revit transfer." });
      return;
    }
    set({ revitHandoffStatus: "preparing", revitHandoff: null, toast: "Persisting and verifying the Forma proposal…" });
    try {
      const revitHandoff = await revitHandoffService.prepare(building, geometry);
      set({ revitHandoff, revitHandoffStatus: "ready", toast: "Proposal verified · use Forma’s Revit menu to send it" });
    } catch (error) {
      set({ revitHandoffStatus: "failed", revitHandoff: null, toast: error instanceof Error ? error.message : "Revit transfer preflight failed" });
    }
  },

  viewCandidate: async (candidateId) => {
    const candidate = get().candidates.find((item) => item.id === candidateId);
    if (!candidate) return;
    await designService.activateCandidate(candidate);
    set({ toast: `${candidate.label} — ${candidate.name} ${appConfig.mockMode ? "preview simulated" : "active in Forma"}` });
  },

  selectCandidate: async (candidateId) => {
    const candidate = get().candidates.find((item) => item.id === candidateId);
    if (!candidate) return;
    await designService.activateCandidate(candidate);
    set((state) => ({ selectedCandidateId: candidateId, candidates: state.candidates.map((item) => ({ ...item, selected: item.id === candidateId })), toast: `Candidate ${candidate.label} selected as final proposal` }));
  },

  improveRecommended: async () => {
    const candidate = get().candidates.find((item) => item.id === "candidate-b");
    if (!candidate) {
      set({ toast: "Load the precomputed candidates first." });
      return;
    }
    set({ redesignStatus: "running", activeTab: "compare" });
    try {
      const improvedCandidate = await designService.modifyCandidate(candidate);
      set({ improvedCandidate, redesignStatus: "completed", toast: "Candidate B2 validated with improved mock scores" });
    } catch (error) {
      set({ redesignStatus: "failed", toast: error instanceof Error ? error.message : "Redesign failed" });
    }
  },

  acceptImproved: async () => {
    const improved = get().improvedCandidate;
    if (!improved) return;
    await designService.activateCandidate(improved);
    set({ selectedCandidateId: improved.id, redesignStatus: "accepted", toast: "Candidate B2 accepted as the final proposal" });
  },

  setToast: (toast) => set({ toast }),
}));
