export type Point2D = [number, number];

function uniquePoints(points: Point2D[]): Point2D[] {
  const seen = new Set<string>();
  return points.filter(([x, y]) => {
    const key = `${x.toFixed(6)}:${y.toFixed(6)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function terrainSamplePoints(footprint: Point2D[]): Point2D[] {
  const ring = footprint.length > 1
    && footprint[0][0] === footprint.at(-1)?.[0]
    && footprint[0][1] === footprint.at(-1)?.[1]
    ? footprint.slice(0, -1)
    : footprint;
  if (!ring.length) return [];
  const center: Point2D = [
    ring.reduce((sum, [x]) => sum + x, 0) / ring.length,
    ring.reduce((sum, [, y]) => sum + y, 0) / ring.length,
  ];
  const edgeMidpoints = ring.map(([x, y], index) => {
    const next = ring[(index + 1) % ring.length];
    return [(x + next[0]) / 2, (y + next[1]) / 2] as Point2D;
  });
  return uniquePoints([center, ...ring, ...edgeMidpoints]);
}

export async function resolveTerrainBaseElevation(
  footprint: Point2D[],
  getElevationAt: (point: Point2D) => Promise<number>,
  fallbackMeters = 0,
): Promise<number> {
  const samples = await Promise.all(terrainSamplePoints(footprint).map((point) => getElevationAt(point).catch(() => Number.NaN)));
  const valid = samples.filter(Number.isFinite);
  const elevation = valid.length ? Math.max(...valid) : fallbackMeters;
  if (!Number.isFinite(elevation)) throw new Error("Forma did not return a valid terrain elevation for the generated mass.");
  return Number(elevation.toFixed(3));
}
