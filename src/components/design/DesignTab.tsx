import { useMemo } from "react";
import { ArrowRight, BarChart3, Building2, Check, CheckCircle2, Download, Eye, LayoutGrid, LoaderCircle, Send, Sparkles } from "lucide-react";
import { useSiteMorphStore } from "../../stores/useSiteMorphStore";
import type { DesignBrief, DesignCandidate, FormaAnalysisMetric, GeneratedBuilding } from "../../types";
import { appConfig } from "../../utils/config";
import { createProgramPlan, formatInterventionPlacement, isConfirmedAccessRoad, presentDesignNarrative } from "../../utils/program-plan";
import { detectBuildingTypology } from "../../utils/program-typology";
import { createSiteFitAssessment } from "../../utils/site-fit-advisor";
import { exportDesignEvidence, exportGenericObj } from "../../utils/revit-handoff";
import { Button, EmptyState, Score, Section, SectionHeading, SourceChip } from "../shared/ui";
import { ProgramPlanDiagram } from "./ProgramPlanDiagram";
import { SiteFitAdvisor } from "./SiteFitAdvisor";
import { SubdivisionDesigner } from "./SubdivisionDesigner";

function NumberField({ label, value, onChange, suffix }: { label: string; value: number; onChange(value: number): void; suffix?: string }) {
  return <label className="field"><span>{label}</span><div className="field-input"><input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} />{suffix && <b>{suffix}</b>}</div></label>;
}

function CandidateCard({ candidate }: { candidate: DesignCandidate }) {
  const analyses = useSiteMorphStore((state) => state.formaAnalyses);
  const selectedCandidateId = useSiteMorphStore((state) => state.selectedCandidateId);
  const viewCandidate = useSiteMorphStore((state) => state.viewCandidate);
  const selectCandidate = useSiteMorphStore((state) => state.selectCandidate);
  const setActiveTab = useSiteMorphStore((state) => state.setActiveTab);
  const setToast = useSiteMorphStore((state) => state.setToast);
  const analysis = analyses.find((item) => item.candidateId === candidate.id);
  return (
    <article className={`candidate-card ${candidate.id === "candidate-b" ? "recommended" : ""} ${selectedCandidateId === candidate.id ? "selected" : ""}`}>
      <div className="candidate-head"><div className="candidate-letter">{candidate.label}</div><div><span>Candidate {candidate.label}</span><h3>{candidate.name}</h3></div>{candidate.id === "candidate-b" && <span className="recommend-badge">Recommended</span>}</div>
      <div className="candidate-orientation"><Building2 size={15} /><span>Orientation</span><strong>{candidate.orientationLabel}</strong></div>
      <div className="candidate-scores"><div><span>Thermal suitability</span><Score value={candidate.scores.climateFit} /></div><div><span>Program fit</span><Score value={candidate.scores.programFit} /></div><div><span>Site utilization</span><Score value={candidate.scores.siteUtilization} /></div></div>
      {analysis && <details className="forma-validation"><summary><span><BarChart3 size={14} />Forma validation</span><span>{analysis.metrics.filter((metric) => metric.status === "pass").length}/{analysis.metrics.length} pass</span></summary><div className="validation-grid">{analysis.metrics.slice(0,6).map((metric) => <ValidationMetric key={metric.id} metric={metric} />)}</div><SourceChip source="forma">{analysis.isMock ? "Precomputed Forma values" : "Forma native analysis"}</SourceChip></details>}
      <div className="candidate-actions"><Button variant="ghost" onClick={() => void viewCandidate(candidate.id)}><Eye size={14} />View</Button><Button variant="ghost" onClick={() => setToast(`Forma validation loaded for Candidate ${candidate.label}`)}><BarChart3 size={14} />Analyze</Button><Button variant="ghost" onClick={() => setActiveTab("compare")}>Compare</Button><Button variant={selectedCandidateId === candidate.id ? "secondary" : "primary"} onClick={() => void selectCandidate(candidate.id)}>{selectedCandidateId === candidate.id ? <><Check size={14} />Selected</> : "Select"}</Button></div>
    </article>
  );
}

function ValidationMetric({ metric }: { metric: FormaAnalysisMetric }) {
  return <div className={`validation-metric metric-${metric.status}`}><span>{metric.label}</span><strong>{metric.score}</strong><small>{metric.status === "pass" ? "Pass" : metric.status === "review" ? "Review" : "Fails objective"}</small></div>;
}

function LiveBuildingResult({ building }: { building: GeneratedBuilding }) {
  const geometry = useSiteMorphStore((state) => state.siteGeometry);
  const climate = useSiteMorphStore((state) => state.climateDNA);
  const requirements = useSiteMorphStore((state) => state.designBrief);
  const site = useSiteMorphStore((state) => state.site);
  const setToast = useSiteMorphStore((state) => state.setToast);
  const prepareRevitHandoff = useSiteMorphStore((state) => state.prepareRevitHandoff);
  const revitHandoffStatus = useSiteMorphStore((state) => state.revitHandoffStatus);
  const revitHandoff = useSiteMorphStore((state) => state.revitHandoff);
  const hasGridMetrics = building.analysisMetricSource === "ground-grid" && building.maxSunHours !== undefined;
  const intervention = building.intervention;
  const planMass = (aspectRatio: number) => ({
    footprintSqFt: building.footprintSqFt,
    grossFloorAreaSqFt: building.grossFloorAreaSqFt,
    mezzanineAreaSqFt: building.mezzanineAreaSqFt,
    heightFt: building.heightFt,
    aspectRatio,
    orientationLabel: building.orientationLabel,
  });
  const finalOfficeSide = intervention?.outcome === "accepted"
    ? intervention.tested?.officeMezzanineSide
    : intervention?.initial.officeMezzanineSide;
  const finalPlan = building.programPlan ?? createProgramPlan(requirements, planMass(building.aspectRatio), { officeMezzanineSide: finalOfficeSide });
  const initialPlan = intervention?.initial.programPlan ?? (intervention ? createProgramPlan(requirements, planMass(intervention.initial.aspectRatio), { officeMezzanineSide: intervention.initial.officeMezzanineSide }) : undefined);
  const testedPlan = intervention?.tested?.programPlan ?? (intervention?.tested ? createProgramPlan(requirements, planMass(intervention.tested.aspectRatio), { officeMezzanineSide: intervention.tested.officeMezzanineSide }) : undefined);
  const displayedChangeSummary = presentDesignNarrative(building.changeSummary, finalPlan);
  const responseContainsSun = building.climateResponse?.inputs.some((input) => input.id === "forma-sun" && input.source === "forma") ?? false;
  const resolvedClimateResponse = building.climateResponse && !(responseContainsSun && building.analysisMetricSource !== "ground-grid")
    ? building.climateResponse
    : undefined;
  return <Section className="candidate-section">
    <SectionHeading eyebrow="Live Forma element" title={building.name} action={<SourceChip source="forma">Native geometry</SourceChip>} />
    <ProgramPlanDiagram plan={finalPlan} title="Approved program/site plan" />
    {building.siteLayout && <details className="forma-validation" open>
      <summary><span><Eye size={14} />Forma terrain concept overlay</span><span>{building.siteOverlayStatus === "rendered" ? "Visible" : "Unavailable"}</span></summary>
      <div className="validation-grid">
        <div className={`validation-metric ${building.siteLayout.parkingStatus === "resolved-concept" ? "metric-pass" : "metric-review"}`}><span>Parking</span><strong>{building.siteLayout.parkingRequirement || "Not set"}</strong><small>{building.siteLayout.parkingRequirement ? `concept capacity ${building.siteLayout.parkingConceptCapacity}` : "requirement not specified"}</small></div>
        <div className={`validation-metric ${building.siteLayout.operationsStatus === "resolved-concept" ? "metric-pass" : "metric-review"}`}><span>Operations / arrival</span><strong>{building.siteLayout.operationsStatus === "resolved-concept" ? "Shown" : "Constrained"}</strong><small>{finalPlan.operations.outdoorZoneLabel}</small></div>
        <div className={`validation-metric ${finalPlan.access.status === "requirement" ? "metric-pass" : "metric-review"}`}><span>Preferred access</span><strong>{finalPlan.access.status === "requirement" ? "Brief access stated" : "Concept edge only"}</strong><small>{finalPlan.access.status === "requirement" ? finalPlan.access.preferredRoad : "Access engineering unconfirmed"}</small></div>
      </div>
      <p className="section-intro">{building.siteOverlayNote}</p>
      <p className="button-note">{building.siteLayout.disclaimer}</p>
    </details>}
    {building.designImageDataUrl && <details className="forma-mass-evidence"><summary>Forma analysis mass</summary><figure className="design-capture"><img src={building.designImageDataUrl} alt="Generated building captured from the Forma canvas" /><figcaption>Native Forma mass retained for Sun, Wind and microclimate analysis</figcaption></figure></details>}
    <div className="candidate-orientation"><Building2 size={15} /><span>Element path</span><strong>{building.elementPath.split("/").at(-1)}</strong></div>
    <div className="candidate-scores">
      <div><span>Footprint</span><strong>{building.footprintSqFt.toLocaleString()} ft²</strong></div>
      <div><span>Gross floor area</span><strong>{building.grossFloorAreaSqFt.toLocaleString()} ft²</strong></div>
      <div><span>Height / floors</span><strong>{building.heightFt} ft · {building.floors}</strong></div>
      {building.upperFloorAreaSqFt && <div><span>Upper-floor gross area</span><strong>{building.upperFloorAreaSqFt.toLocaleString()} ft²</strong></div>}
      {building.partialTopFloorAreaSqFt && <div><span>Partial top level</span><strong>{building.partialTopFloorAreaSqFt.toLocaleString()} ft²</strong></div>}
      <div><span>Site coverage</span><strong>{building.siteCoveragePercent}%</strong></div>
      <div><span>Parcel outside mass <small>before site reservations</small></span><strong>{building.remainingSiteAreaSqFt.toLocaleString()} ft²</strong></div>
      <div><span>Final mass</span><strong>{building.aspectRatio.toFixed(1)}:1 · {building.orientationLabel}</strong></div>
    </div>
    <p className="section-intro"><strong>Placement:</strong> {formatInterventionPlacement(building.placementSummary, finalPlan)}</p>
    {intervention && intervention.outcome !== "not-required" && <div className={`intervention-result intervention-${intervention.outcome}`}>
      <div className="intervention-head"><div><span>SiteMorph measured redesign</span><strong>{intervention.outcome === "accepted" ? "Intervention accepted" : "Intervention rejected · initial restored"}</strong></div><SourceChip source="sitemorph">{intervention.outcome}</SourceChip></div>
      {(building.initialDesignImageDataUrl || building.testedDesignImageDataUrl) && <div className="intervention-images">
        {building.initialDesignImageDataUrl && <figure><img src={building.initialDesignImageDataUrl} alt="Initial Forma building mass" /><figcaption>Initial · {intervention.initial.aspectRatio}:1 · {formatInterventionPlacement(intervention.initial.placement, initialPlan ?? finalPlan)}</figcaption></figure>}
        {building.testedDesignImageDataUrl && <figure><img src={building.testedDesignImageDataUrl} alt="Tested SiteMorph building intervention" /><figcaption>Tested · {intervention.tested?.aspectRatio}:1 · {formatInterventionPlacement(intervention.tested?.placement ?? "Test placement", testedPlan ?? finalPlan)}</figcaption></figure>}
      </div>}
      {initialPlan && testedPlan && <div className="intervention-plan-compare"><ProgramPlanDiagram plan={initialPlan} title="Initial program plan" compact /><ProgramPlanDiagram plan={testedPlan} title="Tested program plan" compact /></div>}
      <div className="intervention-story"><p><b>Detected issue</b>{intervention.issue}</p><p><b>Action tested</b>{presentDesignNarrative(intervention.action, testedPlan ?? finalPlan)}</p><p><b>Acceptance rule</b>{intervention.objective}</p></div>
      {intervention.tested && <div className="intervention-deltas">
        <div><span>Aspect ratio</span><b>{intervention.initial.aspectRatio}:1</b><ArrowRight size={13} /><strong>{intervention.tested.aspectRatio}:1</strong></div>
        <div><span>Placement</span><b>{formatInterventionPlacement(intervention.initial.placement, initialPlan ?? finalPlan)}</b><ArrowRight size={13} /><strong>{formatInterventionPlacement(intervention.tested.placement, testedPlan ?? finalPlan)}</strong></div>
        <div><span>{(testedPlan ?? finalPlan).interventionProgramLabel}</span><b>{intervention.initial.officeMezzanineSide}</b><ArrowRight size={13} /><strong>{intervention.tested.officeMezzanineSide}</strong></div>
        <div><span>Mean ground sun</span><b>{intervention.initial.meanSunHours ?? "Unavailable"}</b><ArrowRight size={13} /><strong>{intervention.tested.meanSunHours ?? "Unavailable"}</strong></div>
      </div>}
    </div>}
    <details className="forma-validation" open>
      <summary><span><BarChart3 size={14} />{hasGridMetrics ? "Forma Sun ground-grid validation" : "Forma Sun job status"}</span><span>{hasGridMetrics ? "Measured" : "Native job completed"}</span></summary>
      {hasGridMetrics ? <div className="validation-grid"><div className="validation-metric metric-pass"><span>Mean ground sun</span><strong>{building.meanSunHours}</strong><small>hours</small></div><div className="validation-metric metric-review"><span>Maximum ground sun</span><strong>{building.maxSunHours}</strong><small>hours</small></div></div> : <div className="inline-warning"><BarChart3 size={16} /><div><strong>Native result completed</strong><span>Open Forma’s analysis result to inspect the surface colors; the embedded SDK returned no readable ground grid.</span></div></div>}
      <p className="section-intro">{displayedChangeSummary}</p>
      {building.analysisNote && <p className="helper-copy">{building.analysisNote}</p>}
      <SourceChip source="forma">Analysis {building.sunAnalysisId}</SourceChip>
    </details>
    {resolvedClimateResponse && <div className="climate-response-result">
      <div className="intervention-head"><div><span>FortyGuard + Forma</span><strong>{resolvedClimateResponse.label}</strong></div><SourceChip source="sitemorph">{resolvedClimateResponse.status}</SourceChip></div>
      <div className="validation-grid">
        <div className="validation-metric metric-review"><span>Mean response</span><strong>{resolvedClimateResponse.meanRiskScore}</strong><small>0–100 index</small></div>
        <div className="validation-metric metric-review"><span>Maximum response</span><strong>{resolvedClimateResponse.maximumRiskScore}</strong><small>0–100 index</small></div>
        <div className="validation-metric metric-pass"><span>Historical baseline</span><strong>{resolvedClimateResponse.historicalBaselineScore}</strong><small>FortyGuard</small></div>
        <div className="validation-metric metric-pass"><span>Spatial grid</span><strong>{resolvedClimateResponse.resolutionMeters}</strong><small>meters</small></div>
      </div>
      <div className="response-inputs">{resolvedClimateResponse.inputs.map((input) => <div key={input.id}><SourceChip source={input.source}>{input.source === "fortyguard" ? "Historical" : "Native Forma"}</SourceChip><span>{input.label}</span><b>{input.configuredWeightPercent}% · {input.coveragePercent}% coverage</b></div>)}</div>
      <p className="section-intro">{resolvedClimateResponse.formula}</p>
      <p className="helper-copy">{resolvedClimateResponse.note}</p>
    </div>}
    <div className="revit-handoff-block">
      <Button className="w-full" disabled={!geometry || revitHandoffStatus === "preparing"} onClick={() => void prepareRevitHandoff()}><Send size={15} />{revitHandoffStatus === "preparing" ? "Verifying Forma Proposal…" : revitHandoffStatus === "ready" ? "Forma Proposal Ready for Revit" : "Prepare Forma Proposal for Revit"}</Button>
      {revitHandoff && <div className="revit-handoff-guide"><strong><CheckCircle2 size={15} />Forma proposal verified for Revit handoff</strong><p>SiteMorph verified and highlighted element <code>{revitHandoff.formaElementPath.split("/").at(-1)}</code>. Persisted XY, terrain Z and generated mesh Z agree within {revitHandoff.placement.toleranceMeters.toFixed(2)} m across {revitHandoff.placement.terrainSampleCount} terrain samples. The extension cannot invoke Forma’s host Revit menu; complete the send in Forma.</p><ol>{revitHandoff.instructions.map((instruction) => <li key={instruction}>{instruction}</li>)}</ol></div>}
    </div>
    <Button variant="secondary" className="w-full" disabled={!geometry || !climate} onClick={() => {
      if (!geometry || !climate) return;
      exportDesignEvidence(building, geometry, climate, requirements, site);
      setToast("SiteMorph design evidence JSON exported");
    }}><Download size={15} />Download Design Evidence JSON</Button>
    <Button variant="ghost" className="w-full" onClick={() => { exportGenericObj(building); setToast("Optional generic OBJ reference exported"); }}><Download size={14} />Optional generic OBJ</Button>
    <p className="button-note">Start from a new blank Revit file and run Load From Forma once; repeated loads into the same file are unsupported. For an existing model, use a blank wrapper, then Link Revit / Bind Link as appropriate. JSON is an audit sidecar, and OBJ is generic concept geometry—not native BIM.</p>
  </Section>;
}

export function DesignTab() {
  const climate = useSiteMorphStore((state) => state.climateDNA);
  const geometry = useSiteMorphStore((state) => state.siteGeometry);
  const brief = useSiteMorphStore((state) => state.designBrief);
  const candidates = useSiteMorphStore((state) => state.candidates);
  const candidateStatus = useSiteMorphStore((state) => state.candidateStatus);
  const generatedBuilding = useSiteMorphStore((state) => state.generatedBuilding);
  const buildingStatus = useSiteMorphStore((state) => state.buildingStatus);
  const designMode = useSiteMorphStore((state) => state.designMode);
  const subdivisionBrief = useSiteMorphStore((state) => state.subdivisionBrief);
  const subdivisionPlan = useSiteMorphStore((state) => state.subdivisionPlan);
  const selectedSubdivisionVariantId = useSiteMorphStore((state) => state.selectedSubdivisionVariantId);
  const subdivisionStatus = useSiteMorphStore((state) => state.subdivisionStatus);
  const generatedSubdivision = useSiteMorphStore((state) => state.generatedSubdivision);
  const setDesignMode = useSiteMorphStore((state) => state.setDesignMode);
  const updateBrief = useSiteMorphStore((state) => state.updateBrief);
  const updateProgram = useSiteMorphStore((state) => state.updateProgram);
  const generateCandidates = useSiteMorphStore((state) => state.generateCandidates);
  const generateBuilding = useSiteMorphStore((state) => state.generateBuilding);
  const updateSubdivisionBrief = useSiteMorphStore((state) => state.updateSubdivisionBrief);
  const generateSubdivisionOptions = useSiteMorphStore((state) => state.generateSubdivisionOptions);
  const selectSubdivisionVariant = useSiteMorphStore((state) => state.selectSubdivisionVariant);
  const generateSubdivision = useSiteMorphStore((state) => state.generateSubdivision);
  const applySiteFitOption = useSiteMorphStore((state) => state.applySiteFitOption);
  const selectedSiteFitOptionId = useSiteMorphStore((state) => state.selectedSiteFitOptionId);
  const setActiveTab = useSiteMorphStore((state) => state.setActiveTab);
  const setToast = useSiteMorphStore((state) => state.setToast);
  const siteFitAssessment = useMemo(() => geometry && climate ? createSiteFitAssessment(geometry, climate) : null, [geometry, climate]);
  if (!climate) return <div className="tab-content"><EmptyState icon={<Sparkles size={20} />} title="Climate constraints required" description="Generate Climate DNA before preparing a design brief." action={<Button onClick={() => setActiveTab("site")}>Analyze Site</Button>} /></div>;
  const requirementsError = brief.totalAreaSqFt > 0 && brief.targetFootprintSqFt > brief.totalAreaSqFt
    ? `Target footprint (${brief.targetFootprintSqFt.toLocaleString()} ft²) cannot exceed total gross area (${brief.totalAreaSqFt.toLocaleString()} ft²).`
    : null;
  const hasLegacyBuildingResult = Boolean(generatedBuilding && generatedBuilding.designLoopVersion !== "measured-v2");
  const typology = detectBuildingTypology(brief.buildingType);
  const programTotal = brief.program.reduce((total, item) => total + item.areaSqFt, 0);
  const currentBuildingMatchesBrief = generatedBuilding?.name === brief.buildingType;
  const plannedFootprintSqFt = brief.targetFootprintSqFt || brief.totalAreaSqFt / Math.max(1, brief.floors);
  const hasPlannedUpperArea = brief.totalAreaSqFt > plannedFootprintSqFt;
  const loopProgramLabel = hasPlannedUpperArea ? typology.upperLevelLabel : typology.occupiedProgramLabel;
  const testPlacementLabel = isConfirmedAccessRoad(brief.preferredAccessRoad)
    ? "north-west placement · stated access considered"
    : "north-west concept placement · access unconfirmed";
  const modeSwitch = <div className="design-mode-switch" role="tablist" aria-label="Design workflow">
    <button role="tab" aria-selected={designMode === "single-building"} className={designMode === "single-building" ? "active" : ""} onClick={() => setDesignMode("single-building")}><Building2 size={16} /><span><b>Single building</b><small>Measured Forma loop</small></span></button>
    <button role="tab" aria-selected={designMode === "subdivision"} className={designMode === "subdivision" ? "active" : ""} onClick={() => setDesignMode("subdivision")}><LayoutGrid size={16} /><span><b>Subdivision</b><small>FortyGuard-weighted options</small></span></button>
  </div>;

  if (designMode === "subdivision") {
    const nativeAnalysisStatus = generatedSubdivision?.nativeAnalysis.status === "succeeded"
      ? "completed"
      : generatedSubdivision?.nativeAnalysis.status;
    return <div className="tab-content">
      {modeSwitch}
      <SubdivisionDesigner
        brief={subdivisionBrief}
        climate={climate}
        plan={subdivisionPlan}
        selectedVariantId={selectedSubdivisionVariantId}
        status={subdivisionStatus}
        generatedResult={generatedSubdivision ? {
          variantId: generatedSubdivision.variantId,
          createdDwellingCount: generatedSubdivision.elements.length,
          nativeElementCount: generatedSubdivision.elementPaths.length,
          persistentContext: {
            treeCount: generatedSubdivision.persistentContext.treeCount,
            roadFeatureCount: generatedSubdivision.persistentContext.roadFeatureCount,
            pedestrianPathFeatureCount: generatedSubdivision.persistentContext.pedestrianPathFeatureCount,
            openSpaceFeatureCount: generatedSubdivision.persistentContext.openSpaceFeatureCount,
            lotOutlineFeatureCount: generatedSubdivision.persistentContext.lotOutlineFeatureCount,
          },
          nativeAnalysisStatus,
          message: `${generatedSubdivision.terrainVerificationCount} dwelling and ${generatedSubdivision.persistentContext.treeTerrainVerificationCount} tree terrain placements verified. Refresh-safe road, path, green and lot context persisted. ${generatedSubdivision.nativeAnalysis.note}`,
        } : null}
        onBriefUpdate={updateSubdivisionBrief}
        onGenerateOptions={() => void generateSubdivisionOptions()}
        onSelectVariant={selectSubdivisionVariant}
        onBuildSelected={() => void generateSubdivision()}
      />
    </div>;
  }

  return (
    <div className="tab-content">
      {modeSwitch}
      <div className="intro-row"><div><p className="eyebrow">Climate-to-design agent</p><h2>Generate one building</h2><p>{appConfig.mockMode ? "Demo requirements and precomputed options." : "Turn the Climate Design Brief into actual Forma geometry, validate it with native sun analysis, and revise it once."}</p></div></div>
      <div className="brief-confidence"><span>Thermal zoning confidence</span><strong className={climate.designBrief.thermalZoningConfidence === "LOW" ? "risk-high" : "risk-low"}>{climate.designBrief.thermalZoningConfidence}</strong></div>
      {siteFitAssessment && <SiteFitAdvisor assessment={siteFitAssessment} selectedOptionId={selectedSiteFitOptionId} onSelect={applySiteFitOption} onManual={() => {
        updateBrief({});
        setToast("Manual Project requirements enabled · enter any building type and values");
        window.setTimeout(() => document.getElementById("building-type-input")?.focus(), 0);
      }} />}
      <Section>
        <SectionHeading title="Project requirements" action={<SourceChip source="sitemorph">Climate Design Brief</SourceChip>} />
        <label className="field"><span>Building Type</span><input id="building-type-input" value={brief.buildingType} onChange={(event) => updateBrief({ buildingType: event.target.value })} /></label>
        <div className="form-grid"><NumberField label="Total Area" value={brief.totalAreaSqFt} suffix="ft²" onChange={(totalAreaSqFt) => updateBrief({ totalAreaSqFt })} /><NumberField label="Floors" value={brief.floors} onChange={(floors) => updateBrief({ floors })} /><NumberField label="Target footprint" value={brief.targetFootprintSqFt} suffix="ft²" onChange={(targetFootprintSqFt) => updateBrief({ targetFootprintSqFt })} /><NumberField label="Maximum height" value={brief.maximumHeightFt} suffix="ft" onChange={(maximumHeightFt) => updateBrief({ maximumHeightFt })} /><NumberField label={selectedSiteFitOptionId ? "Preliminary parking allowance" : "Required parking"} value={brief.requiredParking} onChange={(requiredParking) => updateBrief({ requiredParking })} /><NumberField label={typology.key === "logistics" ? "Loading docks" : "Service / arrival bays"} value={brief.loadingDocks} onChange={(loadingDocks) => updateBrief({ loadingDocks })} /></div>
        <label className="field"><span>Preferred access road</span><input value={brief.preferredAccessRoad} onChange={(event) => updateBrief({ preferredAccessRoad: event.target.value })} /></label>
        <label className="field"><span>Priority</span><select value={brief.priority} onChange={(event) => updateBrief({ priority: event.target.value as DesignBrief["priority"] })}><option>Balanced</option><option>Thermal Performance</option><option>Operational Efficiency</option><option>Maximum Usable Area</option></select></label>
      </Section>
      <Section>
        <SectionHeading title="Program" />
        <div className="program-list">{brief.program.map((item, index) => <label key={item.name}><span>{item.name}</span><div className="field-input"><input type="number" value={item.areaSqFt} onChange={(event) => updateProgram(index, Number(event.target.value))} /><b>ft²</b></div></label>)}</div>
        {!brief.program.length && <div className="program-empty"><strong>{typology.label} template</strong><span>No detailed program was entered. SiteMorph will create a clearly labeled preliminary typology plan from the gross-area target; it will not substitute a warehouse.</span></div>}
        <div className="program-total"><span>Program basis</span><strong>{programTotal > 0 ? `${programTotal.toLocaleString()} ft² itemized` : `${brief.totalAreaSqFt.toLocaleString()} ft² gross target · not itemized`}</strong></div>
      </Section>

      {!appConfig.mockMode && <>
        <div className="measured-loop-contract">
          <div><SourceChip source="sitemorph">Measured loop v2</SourceChip><strong>One intervention. Two native Forma analyses. One evidence-based decision.</strong></div>
          <ol><li><span>Initial</span>1.6:1 · balanced placement · north {loopProgramLabel.toLowerCase()}</li><li><span>Test</span>2.2:1 · {testPlacementLabel} · east {loopProgramLabel.toLowerCase()}</li><li><span>Decide</span>Accept measured improvement or restore initial</li></ol>
        </div>
        {hasLegacyBuildingResult && <div className="inline-warning"><BarChart3 size={16} /><div><strong>This proposal predates the measured redesign loop.</strong><span>Its existing Forma analysis remains valid, but it has no initial/tested captures or v2 acceptance decision. Run the measured redesign once to create that evidence.</span></div></div>}
        {requirementsError && <div className="inline-warning"><Building2 size={16} /><div><strong>Requirements conflict</strong><span>{requirementsError}</span></div></div>}
        {buildingStatus === "generating" || buildingStatus === "analyzing" ? <div className="generation-state"><div className="flex items-center gap-2"><LoaderCircle className="animate-spin" size={17} /><strong>Forma design loop running</strong></div>{["Creating the brief-driven initial mass","Running native June 21 Sun analysis",`Testing aspect ratio, placement and ${loopProgramLabel.toLowerCase()} side`,"Running Forma Rapid Wind and resolving the hybrid grid","Accepting only a measured improvement"].map((step) => <div key={step}><CheckCircle2 size={14} />{step}</div>)}<p>Native Forma jobs and the geometry-aware Wind prediction can take several minutes. No new FortyGuard request is made.</p></div> : null}
        <Button className="w-full" disabled={buildingStatus === "generating" || buildingStatus === "analyzing" || !brief.buildingType.trim() || Boolean(requirementsError) || (brief.totalAreaSqFt <= 0 && brief.targetFootprintSqFt <= 0)} onClick={() => void generateBuilding()}><Sparkles size={15} />{hasLegacyBuildingResult && currentBuildingMatchesBrief ? "Run Measured Redesign" : generatedBuilding && currentBuildingMatchesBrief ? "Run Redesign Again" : "Generate + Test Building"}<ArrowRight size={15} /></Button>
        <p className="button-note">Creates an actual Forma floor stack plus a typology-aware terrain concept overlay for parking, access and site operations. No A/B/C candidates and no mocked validation.</p>
        {generatedBuilding && currentBuildingMatchesBrief && <LiveBuildingResult building={generatedBuilding} />}
      </>}

      {appConfig.mockMode && candidateStatus === "generating" && <div className="generation-state"><div className="flex items-center gap-2"><LoaderCircle className="animate-spin" size={17} /><strong>Generating design brief</strong></div>{["Sensitive zones identified","Service buffer calculated","Orientation constraints prepared","Access requirements preserved"].map((step) => <div key={step}><CheckCircle2 size={14} />{step}</div>)}<p>Sending design constraints to the candidate adapter…</p></div>}

      {appConfig.mockMode && <><Button className="w-full" disabled={candidateStatus === "generating"} onClick={() => void generateCandidates()}><Sparkles size={15} />{candidates.length ? "Reload Precomputed Options" : "Generate Design Options"}<ArrowRight size={15} /></Button><p className="button-note">Mock mode loads validated design IDs; no complex geometry is fabricated in the browser.</p></>}

      {appConfig.mockMode && candidates.length > 0 && <Section className="candidate-section"><SectionHeading eyebrow="Precomputed for demo stability" title="3 design candidates generated" action={<SourceChip source="forma">Autodesk-ready IDs</SourceChip>} /><div className="candidate-list">{candidates.map((candidate) => <CandidateCard key={candidate.id} candidate={candidate} />)}</div></Section>}
    </div>
  );
}
