export type Point2D = [number, number];

export interface TerrainElevationResult {
  elevationMeters: number;
  requestedSampleCount: number;
  successfulSampleCount: number;
}

const MIN_GRID_DIVISIONS = 4;
const MAX_GRID_DIVISIONS = 12;
const MAX_SAMPLE_SPACING_METERS = 10;
const MAX_CONCURRENT_TERRAIN_REQUESTS = 8;
const TERRAIN_SAMPLE_ATTEMPTS = 3;

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
  if (ring.length < 3 || ring.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) return [];
  const doubledArea = ring.reduce((sum, [x, y], index) => {
    const next = ring[(index + 1) % ring.length];
    return sum + x * next[1] - next[0] * y;
  }, 0);
  if (Math.abs(doubledArea) < 0.001) return [];
  const center: Point2D = [
    ring.reduce((sum, [x]) => sum + x, 0) / ring.length,
    ring.reduce((sum, [, y]) => sum + y, 0) / ring.length,
  ];

  const pointOnBoundary = (point: Point2D): boolean => ring.some((start, index) => {
    const next = ring[(index + 1) % ring.length];
    const dx = next[0] - start[0];
    const dy = next[1] - start[1];
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]) <= 0.001;
    const position = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
    return Math.hypot(point[0] - (start[0] + position * dx), point[1] - (start[1] + position * dy)) <= 0.001;
  });

  const pointInFootprint = (point: Point2D): boolean => {
    if (pointOnBoundary(point)) return true;
    let inside = false;
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
      const [x, y] = ring[index];
      const [previousX, previousY] = ring[previous];
      if ((y > point[1]) !== (previousY > point[1])
        && point[0] < ((previousX - x) * (point[1] - y)) / (previousY - y) + x) inside = !inside;
    }
    return inside;
  };

  const edgeSamples = ring.flatMap((start, index) => {
    const end = ring[(index + 1) % ring.length];
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const divisions = Math.max(1, Math.ceil(length / MAX_SAMPLE_SPACING_METERS));
    return Array.from({ length: divisions + 1 }, (_, sample) => {
      const position = sample / divisions;
      return [start[0] + (end[0] - start[0]) * position, start[1] + (end[1] - start[1]) * position] as Point2D;
    });
  });

  const xs = ring.map(([x]) => x);
  const ys = ring.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const xDivisions = Math.min(MAX_GRID_DIVISIONS, Math.max(MIN_GRID_DIVISIONS, Math.ceil((maxX - minX) / MAX_SAMPLE_SPACING_METERS)));
  const yDivisions = Math.min(MAX_GRID_DIVISIONS, Math.max(MIN_GRID_DIVISIONS, Math.ceil((maxY - minY) / MAX_SAMPLE_SPACING_METERS)));
  const clippedGrid: Point2D[] = [];
  for (let row = 0; row <= yDivisions; row += 1) {
    for (let column = 0; column <= xDivisions; column += 1) {
      const point: Point2D = [
        minX + (maxX - minX) * (column / xDivisions),
        minY + (maxY - minY) * (row / yDivisions),
      ];
      if (pointInFootprint(point)) clippedGrid.push(point);
    }
  }

  return uniquePoints([center, ...edgeSamples, ...clippedGrid].filter(pointInFootprint));
}

export async function sampleTerrainBaseElevation(
  footprint: Point2D[],
  getElevationAt: (point: Point2D) => Promise<number>,
): Promise<TerrainElevationResult> {
  const points = terrainSamplePoints(footprint);
  if (!points.length) throw new Error("The generated footprint is not a valid polygon for terrain sampling.");
  const samples = new Array<number>(points.length).fill(Number.NaN);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(MAX_CONCURRENT_TERRAIN_REQUESTS, points.length) }, async () => {
    while (nextIndex < points.length) {
      const index = nextIndex;
      nextIndex += 1;
      for (let attempt = 0; attempt < TERRAIN_SAMPLE_ATTEMPTS; attempt += 1) {
        try {
          const elevation = await getElevationAt(points[index]);
          if (Number.isFinite(elevation)) {
            samples[index] = elevation;
            break;
          }
        } catch {
          // Retry this exact point. A missing high point must never be hidden by
          // accepting a lower subset of the footprint samples.
        }
      }
    }
  });
  await Promise.all(workers);
  const valid = samples.filter(Number.isFinite);
  if (valid.length !== points.length) {
    throw new Error(`Forma returned real terrain elevation for only ${valid.length} of ${points.length} footprint samples after retrying. No building was added because incomplete grade coverage could place it below the site.`);
  }
  return {
    elevationMeters: Number(Math.max(...valid).toFixed(3)),
    requestedSampleCount: points.length,
    successfulSampleCount: valid.length,
  };
}

export async function resolveTerrainBaseElevation(
  footprint: Point2D[],
  getElevationAt: (point: Point2D) => Promise<number>,
): Promise<number> {
  return (await sampleTerrainBaseElevation(footprint, getElevationAt)).elevationMeters;
}
