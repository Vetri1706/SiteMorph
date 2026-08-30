import {
  AlertTriangle, Blocks, Building2, ChevronDown, Clock3, CloudSun, ExternalLink, Eye, EyeOff,
  Gauge, Info, Layers3, Leaf, MapPinned, Satellite, SunMedium, Thermometer, Trees, ClipboardList, ArrowRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useSiteMorphStore } from "../../stores/useSiteMorphStore";
import type { ClimateLayerId, DesignConstraint, SiteZone } from "../../types";
import { appConfig } from "../../utils/config";
import { Button, EmptyState, MetricRow, Score, Section, SectionHeading, SourceChip, StatusPill } from "../shared/ui";

const layerIcons: Record<ClimateLayerId, LucideIcon> = {
  "climate-response": Layers3,
  "ranked-zones": MapPinned,
  temperature: Thermometer,
  persistence: Clock3,
  exceedance: AlertTriangle,
  "peak-time": SunMedium,
  vegetation: Leaf,
  impervious: Blocks,
  "street-openness": Building2,
  environmental: CloudSun,
};

const riskTone = (value: string) => value === "HIGH" ? "risk-high" : value === "MODERATE" ? "risk-moderate" : "risk-low";

function LayerControls() {
  const climate = useSiteMorphStore((state) => state.climateDNA);
  const generatedBuilding = useSiteMorphStore((state) => state.generatedBuilding);
  const rankedTiles = useSiteMorphStore((state) => state.rankedTiles);
  const activeLayer = useSiteMorphStore((state) => state.activeLayer);
  const overlayVisible = useSiteMorphStore((state) => state.overlayVisible);
  const toggleLayer = useSiteMorphStore((state) => state.toggleLayer);
  if (!climate) return null;
  const hasClimateResponse = climate.layers.some((layer) => layer.id === "climate-response");
  return (
    <Section className="layers-section">
      <SectionHeading eyebrow="Historical + Forma-resolved evidence" title="Climate layers" action={activeLayer && overlayVisible ? <StatusPill label={appConfig.mockMode ? "Mock overlay active" : "Overlay active"} tone="success" /> : undefined} />
      <div className={`layer-scope-note ${hasClimateResponse ? "resolved" : "historical"}`}>
        <Layers3 size={17} />
        <div>
          <strong>{hasClimateResponse ? "Forma-resolved spatial response is ready." : "These are coarse historical baselines—not Forma simulation maps."}</strong>
          <span>{hasClimateResponse
            ? "Climate Response uses native Forma Sun and Rapid Wind grids; its visible variation comes from the generated geometry."
            : `Temperature, persistence, exceedance and peak time reuse the same ${rankedTiles.length || 2} real 60 m FortyGuard cells. The footprint therefore stays the same; only the measured variable and legend change.`}</span>
        </div>
      </div>
      <div className="layer-grid">
        {!hasClimateResponse && <div className="layer-button unavailable response-placeholder" aria-label="Forma-resolved Climate Response unavailable">
          <span className="layer-icon"><Layers3 size={16} /></span>
          <span><strong>Forma-resolved Climate Response</strong><small>{generatedBuilding ? "Native Sun/Wind grid was not readable—rerun Generate + Test" : "Waiting for Design → Generate + Test Building"}</small></span>
          <EyeOff size={16} />
        </div>}
        {climate.layers.map((layer) => {
          const Icon = layerIcons[layer.id];
          const active = overlayVisible && activeLayer === layer.id;
          const layerValues = rankedTiles.map((tile) => layer.id === "temperature"
            ? tile.meanTemperatureCelsius
            : layer.id === "persistence"
              ? tile.persistenceHours
              : layer.id === "exceedance"
                ? tile.exceedanceHours
                : layer.id === "peak-time"
                  ? tile.peakHourUtc
                  : layer.id === "ranked-zones"
                    ? tile.thermalScore
                    : Number.NaN).filter(Number.isFinite);
          const isUniform = layerValues.length > 1 && Math.max(...layerValues) === Math.min(...layerValues);
          const unit = layer.unit ? ` ${layer.unit}` : "";
          const description = isUniform
            ? `Uniform: ${layerValues[0]}${unit} across ${layerValues.length} FG cells`
            : layer.description;
          return (
            <button key={layer.id} className={`layer-button ${active ? "active" : ""} ${!layer.available ? "unavailable" : ""}`} onClick={() => void toggleLayer(layer.id)}>
              <span className="layer-icon"><Icon size={16} /></span>
              <span><strong>{layer.name}</strong><small>{description}</small></span>
              {active ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
          );
        })}
      </div>
      <p className="helper-copy"><Info size={13} />Historical layers preserve FortyGuard's native resolution. SiteMorph never fabricates extra variation to imitate Forma.</p>
    </Section>
  );
}

function Provenance({ title, source }: { title: string; source: { label: string; dateRange?: string; resolution?: string; confidence: string; source: "fortyguard" | "forma" | "sitemorph"; derivedFrom?: string[] } }) {
  return (
    <div className="provenance">
      <SourceChip source={source.source}>{source.source === "fortyguard" ? "FortyGuard source" : source.source === "forma" ? "Forma analysis" : "SiteMorph derived"}</SourceChip>
      <div><strong>{title}</strong><span>{source.label}</span></div>
      <dl>
        {source.dateRange && <><dt>Date range</dt><dd>{source.dateRange}</dd></>}
        {source.resolution && <><dt>Resolution</dt><dd>{source.resolution}</dd></>}
        <dt>Confidence</dt><dd>{source.confidence}</dd>
        {source.derivedFrom && <><dt>Derived from</dt><dd>{source.derivedFrom.join(" + ")}</dd></>}
      </dl>
    </div>
  );
}

function DataCards() {
  const climate = useSiteMorphStore((state) => state.climateDNA);
  const siteGeometry = useSiteMorphStore((state) => state.siteGeometry);
  const setThreshold = useSiteMorphStore((state) => state.setThreshold);
  if (!climate) return null;
  const { thermal, environmental, solar, surface, street } = climate;
  const streetDeferred = street?.status === "deferred" || climate.provenance.street?.label.toLowerCase().includes("deferred");
  const hasSouthPhoenixArchive = Boolean(siteGeometry
    && Math.abs(siteGeometry.centroid.latitude - 33.4062) < 0.01
    && Math.abs(siteGeometry.centroid.longitude + 112.0722) < 0.01);
  const showArchivedEvidence = hasSouthPhoenixArchive && (!surface || !street?.available);
  return (
    <Section className="data-section">
      <SectionHeading eyebrow="Observed and derived evidence" title="Climate data" />
      <details className="data-disclosure" open>
        <summary><span><Thermometer size={16} />Thermal</span><ChevronDown size={15} /></summary>
        <div className="thermal-hero-grid">
          <div><span>Hot-season mean</span><strong>{thermal.meanCelsius} °C</strong></div><div><span>Hot-season max</span><strong className="text-hot">{thermal.maxCelsius} °C</strong></div><div><span>Hot-season min</span><strong className="text-cool">{thermal.minCelsius} °C</strong></div>
        </div>
        <div className="metric-list">
          <MetricRow label="Peak thermal hour" value={thermal.peakThermalHour} />
          <MetricRow label={`Mean exceedance above ${thermal.thresholdCelsius} °C`} value={`${thermal.hoursAboveThreshold} h`} accent="hot" />
          {thermal.meanPersistenceHours !== undefined && <MetricRow label="Mean continuous persistence" value={`${thermal.meanPersistenceHours} h`} />}
          <MetricRow label="Maximum continuous persistence" value={`${thermal.longestPersistenceHours} h`} />
          <MetricRow label="Hot-zone percentage" value={`${thermal.hotZonePercent}%`} accent="hot" />
          <MetricRow label="Cool-zone percentage" value={`${thermal.coolZonePercent}%`} accent="cool" />
        </div>
        {appConfig.mockMode && <label className="threshold-control"><span><strong>Heat threshold</strong><small>Recalculates exceedance and persistence</small></span><span className="number-input"><input type="number" min="30" max="45" value={thermal.thresholdCelsius} onChange={(event) => setThreshold(Number(event.target.value))} /><b>°C</b></span></label>}
        {climate.provenance.thermal && <Provenance title="Thermal evidence" source={climate.provenance.thermal} />}
      </details>

      {showArchivedEvidence && <details className="data-disclosure" open>
        <summary><span><Satellite size={16} />Archived visual evidence</span><ChevronDown size={15} /></summary>
        <div className="inline-warning"><Info size={16} /><div><strong>Recovered from the earlier South Phoenix analysis.</strong><span>Captured in the SiteMorph report on 23 Aug 2026. Shown as supporting context; Credit Saver did not request it again.</span></div></div>
        {!surface && <><h3>Satellite and surface context</h3><div className="evidence-images">
          <figure><img src="/evidence/south-phoenix-satellite-source.png" alt="Archived South Phoenix satellite source" /><figcaption>Satellite source · 2026 archive</figcaption></figure>
          <figure><img src="/evidence/south-phoenix-surface-segmentation.png" alt="Archived FortyGuard surface segmentation" /><figcaption>FortyGuard surface segmentation · archived</figcaption></figure>
        </div></>}
        {!street?.available && <><h3>North access-edge context</h3><div className="evidence-images">
          <figure><img src="/evidence/south-phoenix-street-source.jpg" alt="Archived South Phoenix north access Street View" /><figcaption>Street source · North access edge · archived</figcaption></figure>
          <figure><img src="/evidence/south-phoenix-street-segmentation.png" alt="Archived FortyGuard street segmentation" /><figcaption>FortyGuard street segmentation · archived</figcaption></figure>
        </div></>}
        <div className="provenance"><SourceChip source="fortyguard">Archived source</SourceChip><div><strong>Earlier visual context</strong><span>Recovered from the generated SiteMorph report</span></div><dl><dt>Captured</dt><dd>23 Aug 2026</dd><dt>Confidence</dt><dd>Prior direct model output · not part of the current thermal run</dd></dl></div>
      </details>}

      {environmental && climate.provenance.environmental && <details className="data-disclosure">
        <summary><span><CloudSun size={16} />Environmental</span><ChevronDown size={15} /></summary>
        <div className="metric-list two-column">
          {environmental.relativeHumidityPercent !== undefined && <MetricRow label="Relative humidity" value={`${environmental.relativeHumidityPercent}%`} />}{environmental.heatIndexCelsius !== undefined && <MetricRow label="Heat index" value={`${environmental.heatIndexCelsius} °C`} />}
          {environmental.apparentTemperatureCelsius !== undefined && <MetricRow label="Apparent temperature" value={`${environmental.apparentTemperatureCelsius} °C`} />}{environmental.wetBulbCelsius !== undefined && <MetricRow label="Wet-bulb temperature" value={`${environmental.wetBulbCelsius} °C`} />}
          {environmental.cloudCoverPercent !== undefined && <MetricRow label="Cloud cover" value={`${environmental.cloudCoverPercent}%`} />}{environmental.precipitationMm !== undefined && <MetricRow label="Precipitation" value={`${environmental.precipitationMm} mm`} />}
          {environmental.airQualityIndexUs !== undefined && <MetricRow label="US AQI" value={`${environmental.airQualityIndexUs}`} />}{environmental.elevationMeters !== undefined && <MetricRow label="Elevation" value={`${environmental.elevationMeters} m`} />}
        </div>
        <Provenance title="Environmental context" source={climate.provenance.environmental} />
      </details>}

      {solar && climate.provenance.solar && <details className="data-disclosure">
        <summary><span><SunMedium size={16} />Solar</span><ChevronDown size={15} /></summary>
        <div className="thermal-hero-grid">{solar.ghiWm2 !== undefined && <div><span>GHI</span><strong>{solar.ghiWm2}</strong><small>W/m²</small></div>}{solar.dniWm2 !== undefined && <div><span>DNI</span><strong>{solar.dniWm2}</strong><small>W/m²</small></div>}{solar.dhiWm2 !== undefined && <div><span>DHI</span><strong>{solar.dhiWm2}</strong><small>W/m²</small></div>}</div>
        <Provenance title="Solar burden" source={climate.provenance.solar} />
      </details>}

      {surface && climate.provenance.surface && <details className="data-disclosure" open>
        <summary><span><Satellite size={16} />Satellite context and surface segmentation</span><ChevronDown size={15} /></summary>
        <p className="helper-copy">Captured by FortyGuard for the first analysis and restored from the same saved evidence on later visits.</p>
        <div className="segmentation-grid">
          {[ ["Tree",surface.treePercent],["Vegetation",surface.vegetationPercent],["Grass",surface.grassPercent],["Building",surface.buildingPercent],["Road",surface.roadPercent],["Pavement",surface.pavementPercent],["Bare ground",surface.bareGroundPercent],["Other",surface.otherPercent] ].map(([label,value]) => <div key={label}><span>{label}</span><strong>{value}%</strong><i style={{ width: `${value}%` }} /></div>)}
        </div>
        <div className="derived-strip"><div><Trees size={15} /><span>Canopy / vegetation</span><strong>{surface.canopyVegetationPercent}%</strong></div><div><Blocks size={15} /><span>Impervious</span><strong>{surface.imperviousPercent}%</strong></div><SourceChip source="sitemorph">Derived</SourceChip></div>
        {(surface.originalImageDataUrl || surface.segmentedImageDataUrl) && <div className="evidence-images">{surface.originalImageDataUrl && <figure><img src={surface.originalImageDataUrl} alt="FortyGuard satellite source for the selected Site Limit" /><figcaption>FortyGuard satellite source · first-run site context{surface.imageYear ? ` · ${surface.imageYear}` : ""}</figcaption></figure>}{surface.segmentedImageDataUrl && <figure><img src={surface.segmentedImageDataUrl} alt="FortyGuard satellite surface segmentation for the selected Site Limit" /><figcaption>FortyGuard surface segmentation · saved with the same first run</figcaption></figure>}</div>}
        <Provenance title="Surface coverage" source={climate.provenance.surface} />
      </details>}

      {street && climate.provenance.street && <details className="data-disclosure" open>
        <summary><span><Building2 size={16} />Street context</span><ChevronDown size={15} /></summary>
        {!street.available ? <div className="inline-warning"><AlertTriangle size={16} /><div><strong>{streetDeferred ? "Street View deferred to protect credits." : "Street imagery unavailable at this location."}</strong><span>{streetDeferred ? "Credit Saver made no Street View request. The thermal analysis remains valid." : "Analysis continues without street-level context."}</span></div></div> : <><div className="metric-list two-column">
          <MetricRow label="Tree" value={`${street.treePercent}%`} /><MetricRow label="Sky" value={`${street.skyPercent}%`} /><MetricRow label="Building" value={`${street.buildingPercent}%`} /><MetricRow label="Road" value={`${street.roadPercent}%`} /><MetricRow label="Sidewalk" value={`${street.sidewalkPercent}%`} /><MetricRow label="Earth" value={`${street.earthPercent}%`} /><MetricRow label="Street openness proxy" value={`${street.streetOpennessProxyPercent}%`} />
        </div>{(street.originalImageDataUrl || street.segmentedImageDataUrl) && <div className="evidence-images">{street.originalImageDataUrl && <figure><img src={street.originalImageDataUrl} alt="FortyGuard street view" /><figcaption>{street.sampleLabel ?? "Street source"}{street.imageDate ? ` · ${street.imageDate}` : ""}</figcaption></figure>}{street.segmentedImageDataUrl && <figure><img src={street.segmentedImageDataUrl} alt="FortyGuard street segmentation" /><figcaption>Street segmentation</figcaption></figure>}</div>}</>}
        <p className="helper-copy">Sky percentage is segmentation output and is not presented as true Sky View Factor.</p>
        <Provenance title="Street-level context" source={climate.provenance.street} />
      </details>}
    </Section>
  );
}

function ZoneCard({ zone, rank }: { zone: SiteZone; rank: number }) {
  const focusZone = useSiteMorphStore((state) => state.focusZone);
  const zoneTone = zone.id === "zone-avoid" ? "zone-avoid" : zone.id === "zone-preferred" ? "zone-preferred" : "zone-moderate";
  return (
    <article className={`zone-row ${zoneTone}`}>
      <div className="zone-rank">{rank}</div>
      <div className="zone-main">
        <div className="flex items-start justify-between gap-2"><div><h3>{zone.name} <span>— {zone.direction}</span></h3><p>Climate suitability <Score value={zone.climateSuitability} /></p></div><Button variant="secondary" onClick={() => void focusZone(zone.id)}>Highlight in Forma<ExternalLink size={13} /></Button></div>
        <ul>{zone.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
        <div className="recommended-for"><span>Recommended for</span><p>{zone.recommendedFor.join(" · ")}</p></div>
      </div>
    </article>
  );
}

function Constraints() {
  const constraints = useSiteMorphStore((state) => state.climateDNA?.constraints ?? []);
  const categories: DesignConstraint["category"][] = ["Placement", "Building", "Envelope / Landscape"];
  return (
    <Section>
      <SectionHeading eyebrow="Design intelligence" title="SiteMorph recommendations" />
      <p className="section-intro">Architectural constraints grounded in visible climate evidence. Expand any recommendation to audit why it was made.</p>
      <div className="constraint-groups">
        {categories.map((category) => <div key={category}><h3>{category}</h3>{constraints.filter((item) => item.category === category).map((item) => <details key={item.id} className="constraint-row"><summary><div><span>{item.title}</span><strong>{item.value}</strong></div><ChevronDown size={14} /></summary><div className="why"><b>Why?</b><p>{item.why}</p><small>Evidence: {item.evidenceIds.join(" · ")}</small></div></details>)}</div>)}
      </div>
    </Section>
  );
}

function ClimateDesignBriefCard() {
  const brief = useSiteMorphStore((state) => state.climateDNA?.designBrief);
  const setActiveTab = useSiteMorphStore((state) => state.setActiveTab);
  if (!brief) return null;
  return (
    <Section className="design-brief-section">
      <SectionHeading eyebrow="Climate-to-design handoff" title="Climate Design Brief" action={<SourceChip source="sitemorph">Evidence translated</SourceChip>} />
      <div className="brief-confidence"><ClipboardList size={18} /><span>Thermal zoning confidence</span><strong className={brief.thermalZoningConfidence === "LOW" ? "risk-high" : "risk-low"}>{brief.thermalZoningConfidence}</strong></div>
      <p className="section-intro">{brief.summary}</p>
      <div className="brief-priorities">{brief.priorities.map((priority) => <article key={priority.label}><span>{priority.level}</span><strong>{priority.label}</strong><p>{priority.reason}</p></article>)}</div>
      <div className="brief-list"><h3>Site-wide constraints</h3><ul>{brief.siteWideConstraints.map((constraint) => <li key={constraint}>{constraint}</li>)}</ul></div>
      <div className="brief-list"><h3>Forma takes over here</h3><ol>{brief.formaActions.map((action) => <li key={action}>{action}</li>)}</ol></div>
      <Button className="w-full" onClick={() => setActiveTab("design")}>Prepare one building mass<ArrowRight size={15} /></Button>
    </Section>
  );
}

export function ClimateTab() {
  const climate = useSiteMorphStore((state) => state.climateDNA);
  const setActiveTab = useSiteMorphStore((state) => state.setActiveTab);
  if (!climate) return <div className="tab-content"><EmptyState icon={<Layers3 size={20} />} title="Climate DNA not generated" description="Analyze a selected Forma Site Limit to request multi-date temperature, persistence, exceedance, peak-time, and ranked-zone evidence." action={<Button onClick={() => setActiveTab("site")}>Go to Site analysis</Button>} /></div>;

  const profile = climate.profile;
  return (
    <div className="tab-content climate-tab">
      <div className="live-banner"><span className="live-dot" /><div><strong>{appConfig.mockMode ? "DEMO CLIMATE DNA" : "LIVE CLIMATE DNA"}</strong><span>{appConfig.mockMode ? "Mock dataset" : "FortyGuard"} · {climate.provenance.thermal?.resolution ?? "60 m"} · {climate.provenance.thermal?.dateRange ?? "Historical analysis"}</span></div><SourceChip source="fortyguard">{appConfig.mockMode ? "Mock source" : "FortyGuard source"}</SourceChip></div>
      <div className="differentiator"><Gauge size={25} /><div><strong>FortyGuard adds historical thermal context to Forma.</strong><span>Observed persistence, not just averages.</span></div></div>
      <Section className="profile-section">
        <SectionHeading eyebrow={appConfig.mockMode ? "Historical site behavior" : "Hot-season site behavior"} title="Site climate profile" action={<Info size={15} />} />
        <div className="profile-grid">
          <div><span>{appConfig.mockMode ? "Thermal Exposure" : "Hot-season Exposure"}</span><strong className={riskTone(profile.thermalExposure)}>{profile.thermalExposure}</strong></div>
          <div><span>{appConfig.mockMode ? "Persistence" : "Summer Persistence"}</span><strong className={riskTone(profile.persistence)}>{profile.persistence}</strong></div>
          {profile.vegetation && <div><span>Vegetation</span><strong className={riskTone(profile.vegetation)}>{profile.vegetation}</strong></div>}
          {profile.solarBurden && <div><span>Solar Burden</span><strong className={riskTone(profile.solarBurden)}>{profile.solarBurden}</strong></div>}
        </div>
        <div className="brief-confidence compact"><span>Thermal zoning confidence</span><strong className={climate.designBrief.thermalZoningConfidence === "LOW" ? "risk-high" : "risk-low"}>{climate.designBrief.thermalZoningConfidence}</strong></div>
        {profile.recommendedBuildZone && <div className="build-zone"><MapPinned size={18} /><span>Recommended Build Zone</span><strong>{profile.recommendedBuildZone}</strong></div>}
      </Section>
      <LayerControls />
      <DataCards />
      <ClimateDesignBriefCard />
      {climate.designBrief.thermalZoningConfidence !== "LOW" && climate.zones.length > 0 && climate.provenance.zones && <Section>
        <SectionHeading eyebrow="60 m heatmap tiles" title="Ranked site zones" action={<SourceChip source="sitemorph">Derived score</SourceChip>} />
        <div className="zone-list">{climate.zones.map((zone, index) => <ZoneCard key={zone.id} zone={zone} rank={index + 1} />)}</div>
        <Provenance title="Zone suitability" source={climate.provenance.zones} />
      </Section>}
      {climate.constraints.length > 0 && <Constraints />}
    </div>
  );
}
