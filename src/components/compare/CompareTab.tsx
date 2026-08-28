import { AlertTriangle, ArrowRight, Check, CheckCircle2, LoaderCircle, RotateCw, Sparkles } from "lucide-react";
import { useSiteMorphStore } from "../../stores/useSiteMorphStore";
import type { CandidateScore } from "../../types";
import { Button, EmptyState, Score, Section, SectionHeading, SourceChip } from "../shared/ui";

const metrics: { key: keyof CandidateScore; label: string; source: "forma" | "sitemorph" }[] = [
  { key: "climateFit", label: "Climate Fit", source: "sitemorph" },
  { key: "sun", label: "Sun", source: "forma" },
  { key: "wind", label: "Wind", source: "forma" },
  { key: "microclimate", label: "Microclimate", source: "forma" },
  { key: "energy", label: "Energy", source: "forma" },
  { key: "carbon", label: "Carbon", source: "forma" },
  { key: "programFit", label: "Program Fit", source: "sitemorph" },
  { key: "siteUtilization", label: "Site Utilization", source: "sitemorph" },
];

export function CompareTab() {
  const candidates = useSiteMorphStore((state) => state.candidates);
  const improved = useSiteMorphStore((state) => state.improvedCandidate);
  const redesignStatus = useSiteMorphStore((state) => state.redesignStatus);
  const generateCandidates = useSiteMorphStore((state) => state.generateCandidates);
  const improveRecommended = useSiteMorphStore((state) => state.improveRecommended);
  const acceptImproved = useSiteMorphStore((state) => state.acceptImproved);
  const setActiveTab = useSiteMorphStore((state) => state.setActiveTab);
  if (!candidates.length) return <div className="tab-content"><EmptyState title="No candidates to compare" description="Load the three precomputed warehouse options after Climate DNA is available." action={<div className="flex gap-2"><Button onClick={() => void generateCandidates()}>Load candidates</Button><Button variant="secondary" onClick={() => setActiveTab("design")}>Open Design brief</Button></div>} /></div>;
  const recommended = candidates.find((item) => item.id === "candidate-b") ?? candidates[0];

  return (
    <div className="tab-content compare-tab">
      <Section>
        <SectionHeading eyebrow="Precomputed candidate set" title="Candidate comparison" />
        <div className="comparison-wrap"><table className="comparison-table"><thead><tr><th>Metric</th>{candidates.map((candidate) => <th key={candidate.id} className={candidate.id === recommended.id ? "recommended-col" : ""}><span>{candidate.label}</span><small>{candidate.name}</small></th>)}</tr></thead><tbody>{metrics.map((metric) => <tr key={metric.key}><td><span className={`source-square source-${metric.source}`} />{metric.label}</td>{candidates.map((candidate) => <td key={candidate.id} className={candidate.id === recommended.id ? "recommended-col" : ""}><Score value={candidate.scores[metric.key]} /></td>)}</tr>)}</tbody></table></div>
        <div className="source-legend"><SourceChip source="sitemorph">SiteMorph-derived</SourceChip><SourceChip source="forma">Forma validation</SourceChip></div>
      </Section>

      <div className="recommendation-banner"><span className="recommend-icon"><Check size={20} /></span><div><span>SiteMorph Recommendation</span><strong>Candidate B — Balanced</strong><p>Strongest balance between historical thermal suitability, Forma environmental performance, operational requirements, and site utilization.</p></div></div>

      <Section className="agent-loop">
        <SectionHeading eyebrow="Auditable agent loop" title="Improve recommended design" action={<SourceChip source="sitemorph">Structured decisions</SourceChip>} />
        {redesignStatus === "idle" && <><p className="section-intro">Evaluate one objective, modify the precomputed design through the adapter, then re-read Forma validation.</p><Button className="w-full" onClick={() => void improveRecommended()}><Sparkles size={15} />Improve Recommended Design</Button></>}
        {redesignStatus !== "idle" && <div className="agent-events">
          <div className="agent-event complete"><span><CheckCircle2 size={15} /></span><div><strong>Candidate B evaluated</strong><small>Forma validation + SiteMorph objectives</small></div></div>
          <div className="agent-event issue"><span><AlertTriangle size={15} /></span><div><strong>Issue detected</strong><small>High western afternoon exposure</small></div></div>
          <div className="agent-event action"><span><RotateCw size={15} /></span><div><strong>Action</strong><small>Rotate mass 9° northeast</small></div></div>
          <div className="agent-event action"><span><ArrowRight size={15} /></span><div><strong>Action</strong><small>Move service core toward western edge</small></div></div>
          <div className={`agent-event ${redesignStatus === "running" ? "running" : "complete"}`}><span>{redesignStatus === "running" ? <LoaderCircle className="animate-spin" size={15} /> : <CheckCircle2 size={15} />}</span><div><strong>Re-running Forma analysis</strong><small>{redesignStatus === "running" ? "Reading precomputed validation" : "Validation complete"}</small></div></div>
        </div>}

        {improved && <div className="improvement-result"><div className="improvement-head"><div><span>Candidate B2</span><strong>Balanced — Improved</strong></div><SourceChip source="forma">Validated result</SourceChip></div>{[
          ["Overall", recommended.scores.overall, improved.scores.overall], ["Microclimate", recommended.scores.microclimate, improved.scores.microclimate], ["Sun exposure", recommended.scores.sun, improved.scores.sun]
        ].map(([label,before,after]) => <div className="delta-row" key={String(label)}><span>{label}</span><b>{before}</b><ArrowRight size={14} /><strong>{after}</strong></div>)}<Button className="w-full mt-3" disabled={redesignStatus === "accepted"} onClick={() => void acceptImproved()}>{redesignStatus === "accepted" ? <><Check size={15} />Improved Design Accepted</> : "Accept Improved Design"}</Button></div>}
      </Section>
    </div>
  );
}
