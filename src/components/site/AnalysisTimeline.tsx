import { AlertTriangle, CheckCircle2, Clock3, Crosshair, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useSiteMorphStore } from "../../stores/useSiteMorphStore";
import { Button, StatusGlyph } from "../shared/ui";

export function AnalysisTimeline() {
  const status = useSiteMorphStore((state) => state.analysisStatus);
  const steps = useSiteMorphStore((state) => state.analysisSteps);
  const error = useSiteMorphStore((state) => state.analysisError);
  const cacheStatus = useSiteMorphStore((state) => state.analysisCacheStatus);
  const mode = useSiteMorphStore((state) => state.connection.mode);
  const retry = useSiteMorphStore((state) => state.retryAnalysis);
  const selectSiteLimit = useSiteMorphStore((state) => state.selectSiteLimit);
  const [advanced, setAdvanced] = useState(false);
  const noThermalCoverage = cacheStatus === "unavailable";
  if (status === "idle") return null;

  return (
    <div className={`analysis-timeline timeline-${status}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {status === "failed" ? <AlertTriangle size={17} /> : status === "completed" ? <CheckCircle2 size={17} /> : <Clock3 size={17} />}
          <strong>{status === "completed" ? mode === "mock" ? "Demo analysis loaded" : "Site analysis complete" : noThermalCoverage ? "Climate coverage unavailable" : status === "failed" ? "Analysis needs attention" : status === "waiting" ? "FortyGuard is processing" : "Analyzing site"}</strong>
        </div>
        <label className="advanced-toggle"><input type="checkbox" checked={advanced} onChange={(event) => setAdvanced(event.target.checked)} />Advanced</label>
      </div>
      <div className="timeline-list">
        {steps.map((step) => (
          <div key={step.id} className={`timeline-step step-${step.status}`}>
            <span className="step-glyph"><StatusGlyph status={step.status} /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2"><span>{step.label}</span><span className="step-state">{step.status}</span></div>
              {step.detail && <small>{step.detail}</small>}
              {advanced && step.activityId && <code>activity_id: {step.activityId}</code>}
            </div>
          </div>
        ))}
      </div>
      {error && (
        <div className={`error-block ${status === "waiting" ? "pending-block" : ""}`}>
          <strong>{error}</strong>
          <p>{noThermalCoverage
            ? "The saved activities completed with zero polygon tiles. SiteMorph stopped the workflow instead of fabricating Climate DNA; checking this AOI again will not submit another activity."
            : status === "waiting"
            ? "No SiteMorph request is being held open. SiteMorph will automatically check every saved activity again; Check now is also safe and never submits new activities."
            : error.includes("backend is not connected")
              ? "Use the local Forma extension until its private hosted analysis route is deployed."
              : "Check the saved result without starting another FortyGuard analysis."}</p>
          <div className="flex flex-wrap gap-2">
            {noThermalCoverage
              ? <Button variant="secondary" onClick={() => void selectSiteLimit()}><Crosshair size={14} />Select another Site Limit</Button>
              : <Button variant="secondary" onClick={() => void retry()}><RotateCcw size={14} />{error.includes("backend is not connected") ? "Retry connection" : status === "waiting" ? "Check now" : "Check saved result"}</Button>}
          </div>
        </div>
      )}
    </div>
  );
}
