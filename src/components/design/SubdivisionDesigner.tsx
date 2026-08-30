import {
  AlertTriangle,
  Building2,
  Check,
  CircleDot,
  Flame,
  Gauge,
  Layers3,
  LoaderCircle,
  MapPinned,
  ParkingCircle,
  Route,
  ShieldAlert,
  Sparkles,
  Trees,
} from "lucide-react";
import type { ClimateDNA } from "../../types";
import type { SubdivisionBrief, SubdivisionPlan, SubdivisionVariant } from "../../types/subdivision";
import { appConfig } from "../../utils/config";
import { deriveFortyGuardHistoricalBurden } from "../../utils/subdivision-layout";
import { Button, SourceChip, StatusPill } from "../shared/ui";
import { SubdivisionPlanDiagram } from "./SubdivisionPlanDiagram";

export type SubdivisionDesignerStatus =
  | "idle"
  | "generating-options"
  | "options-ready"
  | "building-selected"
  | "completed"
  | "failed";

export interface SubdivisionBuildSummary {
  variantId: string;
  createdDwellingCount: number;
  nativeElementCount?: number;
  persistentContext?: {
    treeCount: number;
    roadFeatureCount: number;
    pedestrianPathFeatureCount: number;
    openSpaceFeatureCount: number;
    lotOutlineFeatureCount: number;
  };
  nativeAnalysisStatus?: "pending" | "running" | "completed" | "native-result-only" | "failed";
  message?: string;
}

export interface SubdivisionDesignerProps {
  brief: SubdivisionBrief;
  climate: ClimateDNA;
  plan: SubdivisionPlan | null;
  selectedVariantId: string | null;
  status: SubdivisionDesignerStatus;
  generatedResult?: SubdivisionBuildSummary | null;
  onBriefUpdate(patch: Partial<SubdivisionBrief>): void;
  onGenerateOptions(): void;
  onSelectVariant(variantId: string): void;
  onBuildSelected(): void;
}

const missingEvidence = [
  "Zoning and permitted density",
  "Verified access and road dedication",
  "Fire-apparatus access",
  "Utilities and drainage capacity",
  "Binding parking requirements",
];

function numericValue(value: string, minimum = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, parsed) : minimum;
}

function formatNumber(value: number, digits = 0) {
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function strategyLabel(variant: SubdivisionVariant) {
  if (variant.strategy === "compact-yield") return "Yield-led";
  if (variant.strategy === "heat-resilient-neighborhood") return "Heat-resilient";
  return "Balanced";
}

function BriefInputs({ brief, onUpdate }: { brief: SubdivisionBrief; onUpdate(patch: Partial<SubdivisionBrief>): void }) {
  return <div className="subdivision-inputs">
    <label className="subdivision-field subdivision-field-wide"><span>Dwelling form <small>User-confirmed input</small></span><select value={brief.dwellingType} onChange={(event) => onUpdate({ dwellingType: event.target.value as SubdivisionBrief["dwellingType"] })}><option value="detached">Detached houses</option><option value="duplex">Duplex</option><option value="townhouse">Townhouses</option><option value="terrace">Terrace housing</option></select></label>
    <label className="subdivision-field"><span>Target lot <small>ft²</small></span><input type="number" min="600" step="50" value={brief.targetLotAreaSqFt} onChange={(event) => onUpdate({ targetLotAreaSqFt: numericValue(event.target.value, 600) })} /></label>
    <label className="subdivision-field"><span>Minimum width <small>ft</small></span><input type="number" min="12" step="1" value={brief.minimumLotWidthFt} onChange={(event) => onUpdate({ minimumLotWidthFt: numericValue(event.target.value, 12) })} /></label>
    <label className="subdivision-field"><span>Dwelling GFA <small>ft²</small></span><input type="number" min="300" step="50" value={brief.dwellingGfaSqFt} onChange={(event) => onUpdate({ dwellingGfaSqFt: numericValue(event.target.value, 300) })} /></label>
    <label className="subdivision-field"><span>Floors</span><input type="number" min="1" max="8" step="1" value={brief.floors} onChange={(event) => onUpdate({ floors: Math.round(numericValue(event.target.value, 1)) })} /></label>
    <label className="subdivision-field"><span>Road width <small>ft</small></span><input type="number" min="10" step="0.5" value={brief.roadWidthFt} onChange={(event) => onUpdate({ roadWidthFt: numericValue(event.target.value, 10) })} /></label>
    <label className="subdivision-field"><span>Path width <small>ft</small></span><input type="number" min="3" step="0.5" value={brief.pedestrianPathWidthFt} onChange={(event) => onUpdate({ pedestrianPathWidthFt: numericValue(event.target.value, 3) })} /></label>
    <label className="subdivision-field"><span>Site edge buffer <small>ft</small></span><input type="number" min="0" step="0.5" value={brief.setbacks.sitePerimeterFt} onChange={(event) => onUpdate({ setbacks: { ...brief.setbacks, sitePerimeterFt: numericValue(event.target.value) } })} /></label>
    <label className="subdivision-field"><span>Lot front setback <small>ft</small></span><input type="number" min="0" step="0.5" value={brief.setbacks.frontFt} onChange={(event) => onUpdate({ setbacks: { ...brief.setbacks, frontFt: numericValue(event.target.value) } })} /></label>
    <label className="subdivision-field"><span>Lot side setback <small>ft</small></span><input type="number" min="0" step="0.25" value={brief.setbacks.sideFt} onChange={(event) => onUpdate({ setbacks: { ...brief.setbacks, sideFt: numericValue(event.target.value) } })} /></label>
    <label className="subdivision-field"><span>Lot rear setback <small>ft</small></span><input type="number" min="0" step="0.5" value={brief.setbacks.rearFt} onChange={(event) => onUpdate({ setbacks: { ...brief.setbacks, rearFt: numericValue(event.target.value) } })} /></label>
    <label className="subdivision-field"><span>Open land <small>%</small></span><input type="number" min="0" max="80" step="1" value={brief.openLandTargetPercent} onChange={(event) => onUpdate({ openLandTargetPercent: Math.min(80, numericValue(event.target.value)) })} /></label>
    <label className="subdivision-field"><span>Parking <small>spaces / dwelling</small></span><input type="number" min="0" max="6" step="0.25" value={brief.parkingSpacesPerDwelling} onChange={(event) => onUpdate({ parkingSpacesPerDwelling: Math.min(6, numericValue(event.target.value)) })} /></label>
    <label className="subdivision-field"><span>Max connected <small>dwellings</small></span><input type="number" min="1" max="20" step="1" value={brief.maxConnectedDwellings} onChange={(event) => onUpdate({ maxConnectedDwellings: Math.min(20, Math.round(numericValue(event.target.value, 1))) })} /></label>
    <label className="subdivision-field subdivision-field-wide"><span>Canopy target <small>preliminary %</small></span><div className="subdivision-range"><input type="range" min="0" max="50" step="1" value={brief.treeCanopyTargetPercent} onChange={(event) => onUpdate({ treeCanopyTargetPercent: numericValue(event.target.value) })} /><b>{brief.treeCanopyTargetPercent}%</b></div></label>
  </div>;
}

function FortyGuardEvidence({ climate, plan }: { climate: ClimateDNA; plan: SubdivisionPlan | null }) {
  const evidence = plan?.historicalBurden ?? deriveFortyGuardHistoricalBurden(climate);
  const input = (id: string) => evidence?.inputs.find((item) => item.id === id);
  const metrics = [
    { id: "mean-temperature", title: "Temperature", icon: <Flame size={14} /> },
    { id: "mean-persistence", title: "Mean persistence", icon: <Gauge size={14} /> },
    { id: "maximum-continuous-persistence", title: "Max persistence", icon: <Layers3 size={14} /> },
    { id: "mean-exceedance", title: "Mean exceedance", icon: <ShieldAlert size={14} /> },
  ];

  return <section className="subdivision-fortyguard">
    <header><div className="subdivision-fg-mark">FG</div><div><span>FortyGuard × SiteMorph</span><h3>Historical heat evidence drives half the decision</h3><p>{appConfig.mockMode ? "This demo preview applies the same saved hot-season evidence to every option before plan mitigation." : "Every option is ranked against the same saved hot-season burden before plan mitigation is applied."}</p></div><SourceChip source="fortyguard">{appConfig.mockMode ? "Demo Climate DNA · 50%" : "50% climate weight"}</SourceChip></header>
    <div className="subdivision-fg-metrics">{metrics.map((metric) => {
      const item = input(metric.id);
      return <div key={metric.id}>{metric.icon}<span>{metric.title}</span><strong>{item ? `${formatNumber(item.value, 1)} ${item.unit}` : "Awaiting Climate DNA"}</strong>{item && <small>{item.weightPercent}% of historical burden</small>}</div>;
    })}<div><CircleDot size={14} /><span>Peak thermal hour</span><strong>{evidence?.peakThermalHour ?? "Unavailable"}</strong><small>{evidence?.peakThermalHourUtc ? `${evidence.peakThermalHourUtc} · ` : ""}supporting evidence · excluded from burden</small></div></div>
    <div className="subdivision-fg-formula"><div><span>Exposed multiplicative method</span><strong>{evidence?.formula ?? "Weighted geometric mean of temperature 35% × mean persistence 25% × maximum persistence 20% × exceedance 20%; peak thermal hour is supporting evidence only"}</strong></div>{evidence && <b>{formatNumber(evidence.scorePercent, 0)}<small>/100<br />burden</small></b>}</div>
    <div className={`subdivision-zoning-confidence ${evidence?.thermalZoningMode === "tile-informed" ? "subdivision-zoning-tile" : ""}`}><MapPinned size={15} /><div><strong>{evidence?.thermalZoningMode === "tile-informed" ? "Tile-informed thermal zoning" : "LOW thermal-zoning confidence · site-wide response"}</strong><span>{evidence?.spatialNote ?? "No directional claim is made until real FortyGuard cells show meaningful parcel separation."}</span></div></div>
  </section>;
}

function VariantCard({ variant, selected, onSelect }: { variant: SubdivisionVariant; selected: boolean; onSelect(): void }) {
  const metrics = variant.metrics;
  const climateComponent = variant.scoreBreakdown.components.find((component) => component.id === "fortyguard-climate");
  return <article className={`subdivision-variant ${selected ? "subdivision-variant-selected" : ""}`}>
    <header><div><span>#{variant.rank} · {strategyLabel(variant)}</span><h4>{variant.label}</h4></div><div className="subdivision-score"><strong>{Math.round(variant.scoreBreakdown.totalScore)}</strong><small>/100</small></div></header>
    <div className="subdivision-variant-metrics"><span><b>{metrics.lotCount}</b>lots</span><span><b>{formatNumber(metrics.landEfficiencyPercent, 0)}%</b>efficiency</span><span><b>{formatNumber(metrics.averageLotAreaSqFt)}</b>avg lot ft²</span><span><b>{formatNumber(metrics.averageDwellingGfaSqFt)}</b>avg GFA ft²</span><span><b>{formatNumber(metrics.totalDwellingGfaSqFt)}</b>total GFA ft²</span><span><b>{strategyLabel(variant)}</b>strategy</span></div>
    <div className="subdivision-variant-climate"><Flame size={14} /><span><b>FortyGuard climate contribution:</b> {climateComponent ? `${formatNumber(climateComponent.rawScore, 0)}/100` : "included"} · residual heat risk {formatNumber(variant.climatePerformance.residualHeatRiskScore, 0)}/100</span></div>
    <details><summary>Audit ranking and mitigation</summary><div className="subdivision-audit">{variant.scoreBreakdown.components.map((component) => <div key={component.id}><span>{component.label}<small>{component.source}</small></span><b>{formatNumber(component.rawScore, 0)} × {component.weightPercent}%</b></div>)}</div><p>{variant.climatePerformance.formula}</p></details>
    <Button variant={selected ? "secondary" : variant.rank === 1 ? "primary" : "ghost"} className="w-full" onClick={onSelect}>{selected ? <><Check size={14} />Option selected</> : "Select this option"}</Button>
  </article>;
}

function GeneratedResult({ result }: { result: SubdivisionBuildSummary }) {
  const analysisTone = result.nativeAnalysisStatus === "completed" ? "success" : result.nativeAnalysisStatus === "failed" ? "danger" : "info";
  const context = result.persistentContext;
  return <section className="subdivision-generated-result"><div className="subdivision-generated-icon"><Building2 size={20} /></div><div><span>Persistent Forma proposal</span><h3>{result.createdDwellingCount} separate dwellings created</h3><p>{result.message ?? "Only the selected option was written. Native dwellings and preliminary planning context are tracked separately."}</p><div><StatusPill tone="success" label={`${result.nativeElementCount ?? result.createdDwellingCount} native dwellings`} />{context && <StatusPill tone="success" label={`${context.treeCount} low-poly trees · context persisted`} />}{result.nativeAnalysisStatus && <StatusPill tone={analysisTone} label={`Forma analysis · ${result.nativeAnalysisStatus.replaceAll("-", " ")}`} />}</div>{context && <small className="subdivision-context-boundary">Roads, paths, green areas and trees survive refresh as virtual SiteMorph concept elements; they are not surveyed civil, planting or Revit BIM objects.</small>}</div></section>;
}

export function SubdivisionDesigner({ brief, climate, plan, selectedVariantId, status, generatedResult, onBriefUpdate, onGenerateOptions, onSelectVariant, onBuildSelected }: SubdivisionDesignerProps) {
  const selectedVariant = plan?.variants.find((variant) => variant.id === selectedVariantId) ?? null;
  const isGenerating = status === "generating-options";
  const isBuilding = status === "building-selected";
  const hasOptions = Boolean(plan?.variants.length);

  return <div className="subdivision-designer">
    <div className="subdivision-hero"><div className="subdivision-hero-icon"><Sparkles size={20} /></div><div><p className="eyebrow">Residential subdivision mode</p><h2>Heat-resilient neighborhood generator</h2><p>SiteMorph converts explicit assumptions into auditable local options, then writes the selected dwellings and persistent planning context into Forma.</p></div><SourceChip source="sitemorph">Deterministic</SourceChip></div>

    <section className="subdivision-panel subdivision-brief-panel"><div className="subdivision-panel-heading"><div><span>01 · User-confirmed assumptions</span><h3>Development brief</h3></div><StatusPill tone="warning" label="Rules unverified" /></div><BriefInputs brief={brief} onUpdate={onBriefUpdate} /><div className="subdivision-input-provenance"><AlertTriangle size={14} /><span>These are scenario inputs—not inferred zoning, subdivision approval, fire access or parking-code requirements.</span></div><Button className="w-full" onClick={onGenerateOptions} disabled={isGenerating || isBuilding}>{isGenerating ? <><LoaderCircle className="animate-spin" size={15} />Generating three local options…</> : <><Sparkles size={15} />Generate auditable options</>}</Button></section>

    <FortyGuardEvidence climate={climate} plan={plan} />

    {hasOptions && <section className="subdivision-options"><div className="subdivision-panel-heading"><div><span>02 · Local option set</span><h3>Compare three transparent strategies</h3></div><span className="subdivision-options-count">{plan!.variants.length} options</span></div><p className="subdivision-section-copy">No paid design AI and no third-party geometry generator. Each score exposes its FortyGuard contribution and SiteMorph-derived assumptions.</p><div className="subdivision-variant-list">{plan!.variants.slice(0, 3).map((variant) => <VariantCard key={variant.id} variant={variant} selected={variant.id === selectedVariantId} onSelect={() => onSelectVariant(variant.id)} />)}</div></section>}

    {selectedVariant && <section className="subdivision-selected-plan"><div className="subdivision-panel-heading"><div><span>03 · Selected concept preview</span><h3>{selectedVariant.label}</h3></div><StatusPill tone="info" label="Pre-build preview" /></div><SubdivisionPlanDiagram variant={selectedVariant} /><div className="subdivision-mitigation"><div><Trees size={16} /><span><b>{selectedVariant.metrics.treeCount} assumed trees</b><small>{formatNumber(selectedVariant.metrics.estimatedCanopyCoveragePercent, 0)}% estimated canopy target · recognizable low-poly models after build</small></span></div><div><Route size={16} /><span><b>{formatNumber(selectedVariant.metrics.openLandPercent, 0)}% open land</b><small>Persistent road, path and heat-relief terrain shapes after build</small></span></div><div><ParkingCircle size={16} /><span><b>{selectedVariant.metrics.parkingProvision} preliminary spaces</b><small>Binding parking ratio remains unconfirmed</small></span></div></div><div className="subdivision-build-action"><Button className="w-full" onClick={onBuildSelected} disabled={isBuilding || status === "completed"}>{isBuilding ? <><LoaderCircle className="animate-spin" size={15} />Creating dwellings and persistent context…</> : <><Building2 size={15} />Build selected option in Forma</>}</Button><p>Creates {selectedVariant.metrics.dwellingCount} separate terrain-elevated floor stacks plus refresh-safe conceptual roads, paths, green areas and 3D trees, then validates the dwelling proposal once with native Forma analysis.</p></div></section>}

    {generatedResult && <GeneratedResult result={generatedResult} />}

    <section className="subdivision-evidence-warning"><header><AlertTriangle size={16} /><div><span>Decision boundary</span><h3>Evidence required before design use</h3></div></header><ul>{missingEvidence.map((item) => <li key={item}>{item}</li>)}</ul><p>Preliminary SiteMorph constraint layout only. Verify setbacks, zoning, entitlement, emergency access, grading, drainage, utilities, structures and civil geometry before design or construction use.</p></section>
  </div>;
}
