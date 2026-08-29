import { AlertTriangle, Check, MapPinned, SlidersHorizontal, Sparkles } from "lucide-react";
import type { SiteFitAssessment, SiteFitOption } from "../../types";
import { Button, SourceChip } from "../shared/ui";

interface SiteFitAdvisorProps {
  assessment: SiteFitAssessment;
  selectedOptionId: string | null;
  onSelect(option: SiteFitOption): void;
  onManual(): void;
}

function FitOptionCard({ option, selected, onSelect }: { option: SiteFitOption; selected: boolean; onSelect(): void }) {
  return <article className={`site-fit-card site-fit-${option.status} ${selected ? "site-fit-selected" : ""}`}>
    <div className="site-fit-card-head">
      <div><span>#{option.rank} · {option.status === "strongest-fit" ? "Best-supported concept" : option.status === "conditional" ? "Conditional fit" : "Low-confidence fit"}</span><strong>{option.label}</strong></div>
      <b>{option.score}<small>/100</small></b>
    </div>
    <p>{option.sizeSummary}</p>
    <div className="site-fit-metrics"><span><b>{option.estimatedSiteCoveragePercent}%</b> coverage</span><span><b>{option.brief.requiredParking}</b> preliminary parking allowance</span><span><b>{option.brief.maximumHeightFt} ft</b> height</span></div>
    <div className="site-fit-reason"><MapPinned size={14} /><span>{option.reasons[0]}</span></div>
    <details><summary>Why this result</summary><ul>{option.reasons.slice(1).map((reason) => <li key={reason}>{reason}</li>)}</ul><div className="site-fit-caution"><AlertTriangle size={13} /><span>{option.cautions[0]}</span></div></details>
    <Button variant={selected ? "secondary" : option.rank === 1 ? "primary" : "ghost"} className="w-full" onClick={onSelect}>{selected ? <><Check size={14} />Brief selected</> : "Use this brief"}</Button>
  </article>;
}

export function SiteFitAdvisor({ assessment, selectedOptionId, onSelect, onManual }: SiteFitAdvisorProps) {
  const primary = assessment.options.slice(0, 3);
  const alternatives = assessment.options.slice(3);
  return <section className="site-fit-advisor">
    <div className="site-fit-title"><div className="site-fit-icon"><Sparkles size={17} /></div><div><span>SiteMorph decision engine</span><h3>Site Fit Advisor</h3><p>Use the measured parcel and Climate DNA to suggest appropriately sized development concepts—without a paid AI API.</p></div><SourceChip source="sitemorph">Auditable</SourceChip></div>
    <div className="site-fit-evidence">{assessment.evidenceSummary.map((item) => <span key={item}>{item}</span>)}</div>
    <div className="site-fit-list">{primary.map((option) => <FitOptionCard key={option.id} option={option} selected={selectedOptionId === option.id} onSelect={() => onSelect(option)} />)}</div>
    <details className="site-fit-alternatives"><summary>Review {alternatives.length} other evaluated uses</summary><div>{alternatives.map((option) => <button type="button" key={option.id} onClick={() => onSelect(option)}><span>#{option.rank} · {option.label}</span><b>{option.score}/100</b><small>{option.sizeSummary}</small></button>)}</div></details>
    <div className="site-fit-footer"><div><AlertTriangle size={14} /><span><b>Evidence still required:</b> {assessment.missingEvidence.join(" · ")}</span></div><p>{assessment.disclaimer}</p><Button variant="ghost" className="w-full" onClick={onManual}><SlidersHorizontal size={14} />Enter a manual brief instead</Button></div>
  </section>;
}
