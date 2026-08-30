import { Trees } from "lucide-react";
import type { SubdivisionPoint, SubdivisionVariant } from "../../types/subdivision";

interface SubdivisionPlanDiagramProps {
  variant: SubdivisionVariant;
  compact?: boolean;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const VIEWBOX_WIDTH = 440;
const VIEWBOX_HEIGHT = 270;
const PLAN_PADDING = 20;

function allVariantPoints(variant: SubdivisionVariant): SubdivisionPoint[] {
  return [
    ...variant.lots.flatMap((lot) => lot.polygon),
    ...variant.dwellings.flatMap((dwelling) => dwelling.footprint),
    ...variant.roads.flatMap((road) => road.polygon),
    ...variant.openSpaces.flatMap((space) => space.polygon),
    ...variant.trees.map((tree) => tree.point),
  ];
}

function getBounds(points: SubdivisionPoint[]): Bounds {
  if (points.length === 0) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return points.reduce<Bounds>((bounds, [x, y]) => ({
    minX: Math.min(bounds.minX, x),
    minY: Math.min(bounds.minY, y),
    maxX: Math.max(bounds.maxX, x),
    maxY: Math.max(bounds.maxY, y),
  }), { minX: points[0][0], minY: points[0][1], maxX: points[0][0], maxY: points[0][1] });
}

function makeProjector(bounds: Bounds) {
  const width = Math.max(bounds.maxX - bounds.minX, 0.001);
  const height = Math.max(bounds.maxY - bounds.minY, 0.001);
  const scale = Math.min(
    (VIEWBOX_WIDTH - PLAN_PADDING * 2) / width,
    (VIEWBOX_HEIGHT - PLAN_PADDING * 2) / height,
  );
  const renderedWidth = width * scale;
  const renderedHeight = height * scale;
  const offsetX = (VIEWBOX_WIDTH - renderedWidth) / 2;
  const offsetY = (VIEWBOX_HEIGHT - renderedHeight) / 2;

  return ([x, y]: SubdivisionPoint): SubdivisionPoint => [
    offsetX + (x - bounds.minX) * scale,
    VIEWBOX_HEIGHT - offsetY - (y - bounds.minY) * scale,
  ];
}

function polygonPoints(points: SubdivisionPoint[], project: (point: SubdivisionPoint) => SubdivisionPoint) {
  return points.map((point) => project(point).join(",")).join(" ");
}

export function SubdivisionPlanDiagram({ variant, compact = false }: SubdivisionPlanDiagramProps) {
  const project = makeProjector(getBounds(allVariantPoints(variant)));

  return (
    <figure className={`subdivision-plan-diagram ${compact ? "subdivision-plan-diagram-compact" : ""}`}>
      <figcaption>
        <div>
          <span>SiteMorph deterministic plan</span>
          <strong>{variant.label}</strong>
        </div>
        <div className="subdivision-plan-north" aria-label="North marker"><b>↑</b><span>N</span></div>
      </figcaption>
      <svg viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`} role="img" aria-label={`${variant.label}: ${variant.metrics.lotCount} lots, separate dwelling blocks, roads, open space and preliminary trees`}>
        <rect className="subdivision-plan-canvas" width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} rx="6" />
        {variant.openSpaces.map((space) => (
          <polygon key={space.id} className={`subdivision-plan-open-space subdivision-plan-open-${space.kind}`} points={polygonPoints(space.polygon, project)}>
            <title>{space.label} · {Math.round(space.areaSqFt).toLocaleString()} ft²</title>
          </polygon>
        ))}
        {variant.lots.map((lot, index) => (
          <polygon key={lot.id} className={`subdivision-plan-lot subdivision-plan-lot-${lot.rowId}`} points={polygonPoints(lot.polygon, project)}>
            <title>Lot {index + 1} · {Math.round(lot.areaSqFt).toLocaleString()} ft²</title>
          </polygon>
        ))}
        {variant.roads.map((road) => (
          <g key={road.id}>
            <polygon className={`subdivision-plan-road subdivision-plan-road-${road.kind}`} points={polygonPoints(road.polygon, project)}>
              <title>{road.label} · {Math.round(road.widthMeters * 3.28084)} ft wide</title>
            </polygon>
            {road.centerline.length > 1 && <polyline className="subdivision-plan-road-center" points={polygonPoints(road.centerline, project)} />}
          </g>
        ))}
        {variant.dwellings.map((dwelling) => (
          <polygon key={dwelling.id} className="subdivision-plan-dwelling" points={polygonPoints(dwelling.footprint, project)}>
            <title>{dwelling.id} · {Math.round(dwelling.grossFloorAreaSqFt).toLocaleString()} ft² GFA · {dwelling.floors} floor{dwelling.floors === 1 ? "" : "s"}</title>
          </polygon>
        ))}
        {variant.trees.map((tree) => {
          const [cx, cy] = project(tree.point);
          const radius = Math.max(2.4, Math.min(5.4, tree.canopyDiameterMeters * 0.8));
          return <g key={tree.id} className="subdivision-plan-tree"><circle cx={cx} cy={cy} r={radius} /><circle cx={cx} cy={cy} r={1.2} /><title>Preliminary tree · {tree.role.replaceAll("-", " ")}</title></g>;
        })}
      </svg>
      {!compact && <div className="subdivision-plan-legend" aria-label="Plan legend">
        <span><i className="subdivision-legend-lot" />Lot boundary</span>
        <span><i className="subdivision-legend-building" />Separate dwelling</span>
        <span><i className="subdivision-legend-road" />Access road</span>
        <span><i className="subdivision-legend-green" />Heat-relief landscape</span>
        <span><Trees size={11} />Assumed tree</span>
      </div>}
      {!compact && <p>Concept overlay only. Lots, roads, landscape and trees are SiteMorph planning assumptions; selected dwellings are the only elements prepared for native Forma creation.</p>}
    </figure>
  );
}
