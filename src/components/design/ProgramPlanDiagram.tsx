import { ArrowUp, Ruler } from "lucide-react";
import type { ProgramPlan, ProgramPlanZone } from "../../types";

interface ProgramPlanDiagramProps {
  plan: ProgramPlan;
  title?: string;
  compact?: boolean;
}

const area = (value: number) => `${value.toLocaleString()} ft²`;
const dimensions = (zone: ProgramPlanZone) => `${zone.widthFt.toLocaleString()}′ × ${zone.depthFt.toLocaleString()}′`;

function ZoneContent({ zone }: { zone: ProgramPlanZone }) {
  const levelLabel = zone.levelCount && zone.levelCount > 1 ? `${zone.levelCount} upper levels · representative level` : zone.level;
  return <div className="plan-zone-content"><strong>{zone.name}</strong><span>{area(zone.areaSqFt)}{zone.levelCount && zone.levelCount > 1 ? " aggregate" : ""}</span><small>{dimensions(zone)} · {levelLabel}</small></div>;
}

function OperationsStrip({ plan }: { plan: ProgramPlan }) {
  const visibleItemCount = Math.min(18, plan.operations.itemCount);
  const plural = plan.operations.itemCount === 1 ? plan.operations.itemLabel : `${plan.operations.itemLabel}s`;
  return <div className="plan-loading-strip">
    <div><strong>{plan.operations.edgeLabel}</strong><span>{plan.operations.itemCount ? `${plan.operations.itemCount} ${plural}` : "Access and servicing to be resolved"}</span></div>
    {visibleItemCount > 0 && <ol className="plan-dock-bays" aria-label={`${plan.operations.itemCount} ${plural}`}>{Array.from({ length: visibleItemCount }, (_, index) => <li key={index}>{plan.typology === "logistics" ? `D${String(index + 1).padStart(2, "0")}` : `S${String(index + 1).padStart(2, "0")}`}</li>)}</ol>}
  </div>;
}

export function ProgramPlanDiagram({ plan, title = "Dimensioned program plan", compact = false }: ProgramPlanDiagramProps) {
  const groundZones = plan.zones.filter((zone) => zone.level === "ground");
  const upperZones = plan.zones.filter((zone) => zone.level !== "ground");

  return <figure className={`program-plan ${compact ? "program-plan-compact" : ""}`}>
    <figcaption><div><span>SiteMorph 2D · {plan.typologyLabel}</span><strong>{title}</strong></div><div className="plan-north"><ArrowUp size={13} /><b>N</b></div></figcaption>
    <div className="plan-program-status">{plan.programSummary}</div>
    <div className="plan-width"><span /><b><Ruler size={11} />{plan.buildingWidthFt.toLocaleString()}′ building width</b><span /></div>
    <div className="plan-body">
      <div className="plan-depth"><span /><b>{plan.buildingDepthFt.toLocaleString()}′</b><span /></div>
      <table className="program-plan-table" aria-label={`${title}, ${plan.buildingWidthFt} feet by ${plan.buildingDepthFt} feet`}>
        <tbody>
          <tr className="plan-row-loading"><td colSpan={3}><OperationsStrip plan={plan} /></td></tr>
          <tr className="plan-row-canopy"><td colSpan={3}><strong>{plan.operations.shelteredBandLabel}</strong><span>{plan.operations.shelteredBandDepthFt}′ concept depth</span></td></tr>
          <tr><td colSpan={3} className="plan-zone-grid-cell"><div className="plan-zone-grid">
            {groundZones.map((zone) => <div key={zone.id} className={`plan-zone plan-zone-${zone.role}`}><ZoneContent zone={zone} /></div>)}
            {upperZones.map((zone) => <div key={zone.id} className="plan-zone plan-zone-upper"><ZoneContent zone={zone} /><small>{zone.side} side overlay</small></div>)}
          </div></td></tr>
          {!compact && <>
            <tr className="plan-row-truck"><td colSpan={3}><strong>{plan.operations.outdoorZoneLabel}</strong><span>{plan.operations.outdoorZoneDepthFt}′ concept depth · verify access and fire operations</span></td></tr>
            <tr className="plan-row-access"><td colSpan={2}><strong>Preferred access</strong><span>{plan.access.preferredRoad}</span></td><td><strong>Parking</strong><span>{plan.parking.requiredSpaces ? `${plan.parking.requiredSpaces} spaces` : "Not specified"}</span></td></tr>
          </>}
        </tbody>
      </table>
    </div>
    {!compact && <>
      <div className="plan-summary"><span><b>{area(plan.footprintSqFt)}</b> footprint</span><span><b>{area(plan.grossFloorAreaSqFt)}</b> gross area</span><span><b>{plan.heightFt}′</b> maximum height</span></div>
      <ul className="plan-climate-moves">{plan.climateMoves.map((move) => <li key={move}>{move}</li>)}</ul>
      <p className="plan-disclaimer">{plan.disclaimer}</p>
    </>}
  </figure>;
}
