import { ArrowDownToLine, BrainCircuit, CheckCircle2, Clock3, Database, FileJson, FileText, LayoutGrid, Send, Wrench } from "lucide-react";
import { useSiteMorphStore } from "../../stores/useSiteMorphStore";
import type { AgentTraceType } from "../../types";
import { downloadBlob, downloadCsv, downloadJson } from "../../utils/config";
import { exportDesignEvidence, exportGenericObj } from "../../utils/revit-handoff";
import { createSiteFitAssessment } from "../../utils/site-fit-advisor";
import { buildSiteIntelligenceReport } from "../../utils/site-report";
import { loadSiteReportAssets } from "../../utils/report-assets";
import { Button, EmptyState, Section, SectionHeading, SourceChip } from "../shared/ui";

const typeIcon: Record<AgentTraceType, typeof Clock3> = { Observation: Clock3, Decision: BrainCircuit, "Tool Call": Wrench, Result: Database, Recommendation: CheckCircle2 };

export function TraceTab() {
  const trace = useSiteMorphStore((state) => state.agentTrace);
  const climate = useSiteMorphStore((state) => state.climateDNA);
  const site = useSiteMorphStore((state) => state.site);
  const requirements = useSiteMorphStore((state) => state.designBrief);
  const generatedBuilding = useSiteMorphStore((state) => state.generatedBuilding);
  const subdivisionBrief = useSiteMorphStore((state) => state.subdivisionBrief);
  const subdivisionPlan = useSiteMorphStore((state) => state.subdivisionPlan);
  const selectedSubdivisionVariantId = useSiteMorphStore((state) => state.selectedSubdivisionVariantId);
  const generatedSubdivision = useSiteMorphStore((state) => state.generatedSubdivision);
  const siteGeometry = useSiteMorphStore((state) => state.siteGeometry);
  const setActiveTab = useSiteMorphStore((state) => state.setActiveTab);
  const setToast = useSiteMorphStore((state) => state.setToast);
  const prepareRevitHandoff = useSiteMorphStore((state) => state.prepareRevitHandoff);
  const revitHandoffStatus = useSiteMorphStore((state) => state.revitHandoffStatus);
  const revitHandoff = useSiteMorphStore((state) => state.revitHandoff);
  const selectedSiteFitOptionId = useSiteMorphStore((state) => state.selectedSiteFitOptionId);
  if (!trace.length) return <div className="tab-content"><EmptyState icon={<BrainCircuit size={20} />} title="No analysis trace yet" description="The public audit trail begins when SiteMorph reads a Forma site boundary and chooses its first climate tool." action={<Button onClick={() => setActiveTab("site")}>Analyze Site</Button>} /></div>;

  const exportClimate = () => {
    if (!climate) return;
    downloadJson("sitemorph-climate-evidence.json", climate);
    const rows = [["Metric","Value","Source"],["Mean temperature",String(climate.thermal.meanCelsius),"FortyGuard"],["Maximum temperature",String(climate.thermal.maxCelsius),"FortyGuard"],["Peak thermal hour",climate.thermal.peakThermalHour,"FortyGuard"]];
    if (climate.surface) rows.push(["Impervious",String(climate.surface.imperviousPercent),"SiteMorph derived"]);
    if (climate.profile.recommendedBuildZone) rows.push(["Recommended zone",climate.profile.recommendedBuildZone,"SiteMorph derived"]);
    downloadCsv("sitemorph-metrics.csv", rows);
    setToast("Climate evidence JSON and metrics CSV exported");
  };

  const exportReport = async () => {
    if (!climate || !site) return;
    setToast("Building the formatted Word report…");
    try {
      const assets = await loadSiteReportAssets(site, siteGeometry);
      const siteFitAssessment = siteGeometry ? createSiteFitAssessment(siteGeometry, climate) : undefined;
      const report = await buildSiteIntelligenceReport({ climate, site, requirements, building: generatedBuilding, trace, assets, siteFitAssessment, selectedSiteFitOptionId, subdivisionPlan, selectedSubdivisionVariantId, generatedSubdivision });
      downloadBlob("SiteMorph-Site-Intelligence-Climate-Design-Report.docx", report);
      setToast(generatedBuilding || generatedSubdivision ? "Formatted design-complete DOCX exported" : subdivisionPlan ? "Formatted DOCX exported · selected subdivision option included" : "Formatted DOCX exported · generate a design to complete the design sections");
    } catch (error) {
      setToast(`Report export failed · ${error instanceof Error ? error.message : "Word package could not be created"}`);
    }
  };

  const exportEvidence = () => {
    if (!generatedBuilding || !siteGeometry || !climate) return;
    exportDesignEvidence(generatedBuilding, siteGeometry, climate, requirements, site);
    setToast("SiteMorph design evidence JSON exported");
  };

  const exportSubdivisionEvidence = () => {
    if (!subdivisionPlan || !climate || !siteGeometry) return;
    const selectedVariant = subdivisionPlan.variants.find((variant) => variant.id === selectedSubdivisionVariantId) ?? null;
    downloadJson("sitemorph-subdivision-evidence.json", {
      schemaVersion: "sitemorph.subdivision-evidence.v1",
      exportedAt: new Date().toISOString(),
      source: "SiteMorph deterministic native-Forma subdivision workflow",
      brief: subdivisionBrief,
      plan: subdivisionPlan,
      selectedVariant,
      nativeFormaResult: generatedSubdivision,
      formaSiteLimit: siteGeometry.elementPath,
      fortyGuardEvidence: {
        activityId: climate.activityId,
        activityIds: climate.activityIds,
        generatedAt: climate.generatedAt,
        historicalBurden: subdivisionPlan.historicalBurden,
      },
      boundaries: [
        generatedSubdivision
          ? "Roads, paths, open spaces, lot outlines and low-poly trees are persistent virtual SiteMorph-authored Forma concept elements; they are not surveyed, code-verified civil or planting objects."
          : "Lots, roads, paths, open spaces and trees are preliminary SiteMorph preview evidence until the selected option is built.",
        "Only generated dwelling floor stacks are the native Forma-to-Revit design source; concept context transfer is not claimed.",
        "This JSON is an audit sidecar and is not a native Revit import.",
      ],
    });
    setToast("Subdivision plan, FortyGuard formula and native Forma references exported");
  };

  return (
    <div className="tab-content trace-tab">
      <Section>
        <SectionHeading eyebrow="Public audit events — not private chain-of-thought" title="Site analysis trace" action={<SourceChip source="sitemorph">Auditable</SourceChip>} />
        <div className="trace-list">{trace.map((event) => { const Icon = typeIcon[event.type]; return <article className={`trace-event trace-${event.type.toLowerCase().replace(" ", "-")}`} key={event.id}><time>{event.timestamp}</time><span className="trace-icon"><Icon size={14} /></span><div><label>{event.type}</label><strong>{event.title}</strong>{event.detail && <p>{event.detail}</p>}{event.reason && <div className="trace-reason"><span>Reason</span>{event.reason}</div>}{event.activityId && <code>activity_id: {event.activityId}</code>}</div></article>; })}</div>
      </Section>

      <Section>
        <SectionHeading eyebrow="Project handoff" title="Export outputs" />
        <div className="export-list">
          <div><FileText size={16} /><span><strong>Site Intelligence & Climate Design Report</strong><small>True Word document with fixed pagination, proposal imagery, validation and evidence IDs</small></span><b>DOCX</b></div>
          <div><FileJson size={16} /><span><strong>Climate evidence + metrics</strong><small>Source-labeled JSON and CSV</small></span><b>JSON / CSV</b></div>
          <div><Send size={16} /><span><strong>Native Forma proposal → Revit</strong><small>SiteMorph verifies the proposal; you complete Revit → Send to Revit add-in (Beta) in Forma</small></span><b>FORMA</b></div>
          <div><FileJson size={16} /><span><strong>SiteMorph design evidence</strong><small>Program zones, climate decisions and Forma analysis references; optional audit sidecar, not a Revit import</small></span><b>JSON</b></div>
          <div><LayoutGrid size={16} /><span><strong>Subdivision evidence</strong><small>Explicit inputs, three strategies, four-signal FortyGuard risk math, peak-time context and native dwelling references</small></span><b>JSON</b></div>
          <div><FileText size={16} /><span><strong>Generic concept mass</strong><small>Optional OBJ reference only; not native BIM walls, floors, rooms or openings</small></span><b>OBJ</b></div>
        </div>
        <div className="export-actions"><Button onClick={() => void exportReport()}><ArrowDownToLine size={15} />Export Report</Button><Button variant="secondary" onClick={exportClimate}><ArrowDownToLine size={15} />Export Climate Data</Button></div>
        {generatedSubdivision ? <div className="revit-handoff-guide"><strong><CheckCircle2 size={15} />Persistent subdivision is in the Forma proposal</strong><p>{generatedSubdivision.elements.length} separate terrain-verified dwelling floor stacks can follow Forma’s proposal-to-Revit workflow. The same proposal also contains one virtual SiteMorph context root with {generatedSubdivision.persistentContext.treeCount} low-poly trees and persistent road/green terrain shapes. Those concept elements are refresh-safe in Forma but are not claimed as Revit Roads, Toposolids, Planting families, Rooms or parameters.</p><ol><li>Open a new blank Revit file.</li><li>In Forma, use Proposals → Revit → Send to Revit add-in (Beta).</li><li>Run Load From Forma once and verify every dwelling elevation before using the model.</li></ol></div> : <>
          <Button className="w-full" disabled={!generatedBuilding || !siteGeometry || revitHandoffStatus === "preparing"} onClick={() => void prepareRevitHandoff()}><Send size={15} />{revitHandoffStatus === "preparing" ? "Verifying Forma Proposal…" : revitHandoffStatus === "ready" ? "Forma Proposal Ready for Revit" : "Prepare Forma Proposal for Revit"}</Button>
          {revitHandoff && <div className="revit-handoff-guide"><strong><CheckCircle2 size={15} />Continue manually in Autodesk Forma</strong><p>SiteMorph cannot invoke Forma’s host Revit menu from the embedded extension.</p><ol>{revitHandoff.instructions.map((instruction) => <li key={instruction}>{instruction}</li>)}</ol></div>}
        </>}
        <Button variant="secondary" className="w-full" disabled={!generatedBuilding || !siteGeometry || !climate} onClick={exportEvidence}><ArrowDownToLine size={15} />Download Design Evidence JSON</Button>
        <Button variant="secondary" className="w-full" disabled={!subdivisionPlan || !siteGeometry || !climate} onClick={exportSubdivisionEvidence}><ArrowDownToLine size={15} />Download Subdivision Evidence JSON</Button>
        <Button variant="ghost" className="w-full" disabled={!generatedBuilding} onClick={() => { if (!generatedBuilding) return; exportGenericObj(generatedBuilding); setToast("Optional generic OBJ reference exported"); }}><ArrowDownToLine size={14} />Optional generic OBJ</Button>
        <p className="button-note">Start with a new blank Revit file and run Load From Forma once; repeated loads into the same file are unsupported. Use a blank wrapper plus Link Revit / Bind Link for an existing model. JSON remains an audit sidecar; OBJ is generic concept geometry only.</p>
      </Section>
    </div>
  );
}
