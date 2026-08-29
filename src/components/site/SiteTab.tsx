import { BoxSelect, ChevronDown, Crosshair, Database, MapPin, Play, ScanLine, ShieldCheck, Unplug } from "lucide-react";
import { useSiteMorphStore } from "../../stores/useSiteMorphStore";
import { AnalysisTimeline } from "./AnalysisTimeline";
import { Button, EmptyState, Section, SectionHeading, StatusPill } from "../shared/ui";
import { appConfig } from "../../utils/config";

export function SiteTab() {
  const site = useSiteMorphStore((state) => state.site);
  const geometry = useSiteMorphStore((state) => state.siteGeometry);
  const selectionStatus = useSiteMorphStore((state) => state.siteSelectionStatus);
  const connection = useSiteMorphStore((state) => state.connection);
  const analysisStatus = useSiteMorphStore((state) => state.analysisStatus);
  const analysisCacheStatus = useSiteMorphStore((state) => state.analysisCacheStatus);
  const selectSiteLimit = useSiteMorphStore((state) => state.selectSiteLimit);
  const analyzeSite = useSiteMorphStore((state) => state.analyzeSite);
  const setActiveTab = useSiteMorphStore((state) => state.setActiveTab);

  const savedCreditLabel = site?.creditsSavedAt
    ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(site.creditsSavedAt))
    : undefined;
  const creditUsageLabel = site?.creditsUsed !== undefined && site.creditsTotal !== undefined
    ? `${site.creditsUsed.toLocaleString()} of ${site.creditsTotal.toLocaleString()} used`
    : undefined;
  const creditStatus = site?.creditsStatus ?? (site?.creditsRemaining === undefined ? "loading" : "available");
  const creditDetail = creditStatus === "loading"
    ? "Loading the dated saved balance"
    : creditStatus === "unavailable"
      ? "Safe mode did not contact the usage API and no saved snapshot was available"
    : [
        site?.creditsStale ? `Last saved${savedCreditLabel ? ` · ${savedCreditLabel}` : ""}` : "Live balance",
        site?.creditsPlan,
        creditUsageLabel,
      ].filter(Boolean).join(" · ");
  const initialAnalysisEnabled = appConfig.paidFortyGuardAnalysis;
  const firstRunReady = analysisCacheStatus === "missing" && initialAnalysisEnabled;
  const actionLabel = analysisStatus === "running"
    ? analysisCacheStatus === "checking" ? "Checking Saved Climate DNA" : "Running Initial Climate Analysis"
    : analysisStatus === "waiting"
      ? "Check Processing Status"
    : analysisStatus === "completed"
      ? "Open Climate DNA"
      : firstRunReady
        ? "Run First Thermal Analysis · max 12"
        : initialAnalysisEnabled
          ? "Check Saved Climate DNA"
          : "Load Saved Climate DNA";
  const actionDetail = analysisStatus === "waiting"
    ? "Auto-checking saved activity IDs · short requests only · no new submissions"
    : firstRunReady
    ? "Explicit approval required · core thermal only · saved for automatic no-credit reuse"
    : initialAnalysisEnabled
      ? "Saved AOI is checked first · no new FortyGuard activity starts during this check"
      : analysisStatus === "completed"
        ? "Restored automatically · zero new FortyGuard submissions"
        : "Safe mode · checks the saved AOI result only";

  if (!site) return <EmptyState icon={<Unplug size={20} />} title="Forma project unavailable" description="Open SiteMorph from a Forma project with a valid proposal, then reconnect." />;

  return (
    <div className="tab-content">
      <div className="intro-row">
        <div><p className="eyebrow">Current Forma context</p><h2>{site.projectName}</h2><p><MapPin size={14} />{site.location}</p></div>
        <StatusPill label={connection.mode === "mock" ? "Mock mode" : "Live"} tone={connection.mode === "mock" ? "neutral" : "success"} />
      </div>

      <Section>
        <div className="site-stats">
          <div><span>Site area</span><strong>{geometry ? `${site.areaSqFt.toLocaleString()} ft²` : "Not selected"}</strong><small>{geometry ? `${site.areaAcres} acres` : "Choose an area in Forma"}</small></div>
          <div><span>Proposal</span><strong>{site.selectedProposal}</strong><small>{site.selectedSiteLimit}</small></div>
        </div>
      </Section>

      <Section>
        <SectionHeading eyebrow="Preflight" title="Integration status" />
        <div className="status-list">
          <div><span><ShieldCheck size={16} />Forma Connection</span><StatusPill label={connection.connected ? "Connected" : "Connecting"} tone={connection.connected ? "success" : "neutral"} /></div>
          <div><span><ScanLine size={16} />Site Geometry</span><StatusPill label={geometry ? "Ready" : "Missing"} tone={geometry ? "success" : "warning"} /></div>
          <div><span><Database size={16} />FortyGuard</span><StatusPill label={appConfig.hostedSite ? "Hosted · capped" : "Ready"} tone="success" /></div>
        </div>
        <div className={`boundary-callout ${selectionStatus === "waiting" || selectionStatus === "resolving" ? "boundary-waiting" : ""}`}>
          <span className="boundary-icon"><BoxSelect size={19} /></span>
          {selectionStatus === "waiting" ? <div><strong>Waiting for selection...</strong><span>Click a Site Limit in Forma</span></div> : selectionStatus === "resolving" ? <div><strong>Reading selected area...</strong><span>Validating the real Forma element and geometry</span></div> : geometry ? <div><strong>Site boundary detected</strong><span>{geometry.pointCount} geometry points</span><small>Ready for climate analysis</small></div> : <div><strong>No Site Limit Selected</strong><span>Select or create a Site Limit in Forma before analysis.</span></div>}
        </div>
        <Button variant="secondary" className="w-full" disabled={selectionStatus === "resolving"} onClick={() => void selectSiteLimit()}><Crosshair size={15} />{selectionStatus === "waiting" ? "Waiting for selection..." : selectionStatus === "resolving" ? "Reading selection..." : "Select Site Limit"}</Button>
      </Section>

      <AnalysisTimeline />

      <div className="sticky-action">
        <Button className="w-full" disabled={!geometry || analysisStatus === "running"} onClick={() => {
          if (analysisStatus === "completed") {
            setActiveTab("climate");
            return;
          }
          if (firstRunReady) {
            const approved = window.confirm("Run the first hosted thermal analysis for this Site Limit? This may create up to 12 FortyGuard activities. Optional imagery remains deferred, and the completed result will be reused without new activities.");
            if (approved) void analyzeSite(false);
            return;
          }
          void analyzeSite(true);
        }}>
          <Play size={15} fill="currentColor" />{actionLabel}
        </Button>
        <span>{actionDetail}</span>
      </div>

      <details className="developer-details">
        <summary><ChevronDown size={15} />Developer details</summary>
        {geometry && <div className="debug-grid">
          <span>Element path</span><code>{geometry.elementPath}</code>
          <span>Triangle mesh</span><code>{geometry.triangleCount ?? 0} triangles read</code>
          <span>Centroid</span><code>{geometry.centroid.latitude}, {geometry.centroid.longitude}</code>
          <span>Bounds</span><code>{JSON.stringify(geometry.bounds)}</code>
          <span>GeoJSON preview</span><pre>{JSON.stringify(geometry.geojson, null, 2)}</pre>
        </div>}
      </details>

      <div className={`credits ${site.creditsStale ? "credits-saved" : ""}`}>
        <Database size={16} />
        <div><span>FortyGuard Credits</span><small>{creditDetail}</small></div>
        <strong>{creditStatus === "loading" ? "Checking…" : site.creditsRemaining === undefined ? "Not checked" : `${site.creditsRemaining.toLocaleString()} remaining`}</strong>
      </div>
    </div>
  );
}
