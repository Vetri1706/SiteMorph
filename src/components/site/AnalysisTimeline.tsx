import { AlertTriangle, CheckCircle2, ChevronRight, Clock3, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useSiteMorphStore } from "../../stores/useSiteMorphStore";
import { Button, StatusGlyph } from "../shared/ui";

export function AnalysisTimeline() {
  const status = useSiteMorphStore((state) => state.analysisStatus);
  const steps = useSiteMorphStore((state) => state.analysisSteps);
  const error = useSiteMorphStore((state) => state.analysisError);
  const mode = useSiteMorphStore((state) => state.connection.mode);
  const retry = useSiteMorphStore((state) => state.retryAnalysis);
  const setToast = useSiteMorphStore((state) => state.setToast);
  const [advanced, setAdvanced] = useState(false);
  if (status === "idle") return null;

  return (
    <div className={`analysis-timeline timeline-${status}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {status === "failed" ? <AlertTriangle size={17} /> : status === "completed" ? <CheckCircle2 size={17} /> : <Clock3 size={17} />}
          <strong>{status === "completed" ? mode === "mock" ? "Demo analysis loaded" : "Site analysis complete" : status === "failed" ? "Analysis needs attention" : "Analyzing site"}</strong>
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
        <div className="error-block">
          <strong>{error}</strong>
          <p>{error.includes("still running") ? "The paid activity IDs were saved. Check again to resume polling without submitting new activities." : "Check the saved result without starting another FortyGuard analysis."}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void retry()}><RotateCcw size={14} />Check saved result</Button>
            <Button variant="ghost" onClick={() => setToast("Unavailable layer skipped")}>Skip layer<ChevronRight size={14} /></Button>
          </div>
        </div>
      )}
    </div>
  );
}
