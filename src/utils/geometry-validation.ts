export type Point2D = [number, number];

export interface PolygonBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function cross(origin: Point2D, first: Point2D, second: Point2D): number {
  return (first[0] - origin[0]) * (second[1] - origin[1])
    - (first[1] - origin[1]) * (second[0] - origin[0]);
}

/**
 * Projects Forma's recursive triangle mesh onto the project XY plane and
 * returns the smallest convex outline containing the mesh. Floor-stack roots
 * do not always expose their own footprint representation, while their child
 * meshes are traversed by geometry.getTriangles().
 */
export function projectTriangleMeshToFootprint(mesh: Float32Array): Point2D[] {
  if (mesh.length < 9) return [];
  const unique = new Map<string, Point2D>();
  for (let index = 0; index + 2 < mesh.length; index += 3) {
    const x = mesh[index];
    const y = mesh[index + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const key = `${x.toFixed(5)}:${y.toFixed(5)}`;
    if (!unique.has(key)) unique.set(key, [x, y]);
  }
  const points = [...unique.values()].sort((first, second) => first[0] - second[0] || first[1] - second[1]);
  if (points.length < 3) return [];

  const lower: Point2D[] = [];
  for (const point of points) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: Point2D[] = [];
  for (const point of [...points].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop();
    upper.push(point);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  return hull.length >= 3 ? [...hull, hull[0]] : [];
}

export function polygonBounds(points: Point2D[]): PolygonBounds {
  if (points.length < 3) throw new Error("A polygon needs at least three points.");
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

export function boundsOverlap(first: PolygonBounds, second: PolygonBounds, tolerance = 0): boolean {
  return first.maxX + tolerance >= second.minX
    && first.minX - tolerance <= second.maxX
    && first.maxY + tolerance >= second.minY
    && first.minY - tolerance <= second.maxY;
}

function distanceToSegment(point: Point2D, start: Point2D, end: Point2D): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const position = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
  return Math.hypot(point[0] - (start[0] + position * dx), point[1] - (start[1] + position * dy));
}

export function pointInPolygon(point: Point2D, polygon: Point2D[], tolerance = 0.05): boolean {
  if (polygon.length < 3) return false;
  for (let index = 0; index < polygon.length; index += 1) {
    const next = (index + 1) % polygon.length;
    if (distanceToSegment(point, polygon[index], polygon[next]) <= tolerance) return true;
  }
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const [x, y] = polygon[index];
    const [previousX, previousY] = polygon[previous];
    if ((y > point[1]) !== (previousY > point[1]) && point[0] < ((previousX - x) * (point[1] - y)) / (previousY - y) + x) inside = !inside;
  }
  return inside;
}

export function polygonInsidePolygon(inner: Point2D[], outer: Point2D[], tolerance = 0.5): boolean {
  if (inner.length < 3 || outer.length < 3) return false;
  for (let index = 0; index < inner.length; index += 1) {
    const start = inner[index];
    const end = inner[(index + 1) % inner.length];
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const samples = Math.max(1, Math.ceil(length / 2));
    for (let sample = 0; sample <= samples; sample += 1) {
      const position = sample / samples;
      const point: Point2D = [start[0] + (end[0] - start[0]) * position, start[1] + (end[1] - start[1]) * position];
      if (!pointInPolygon(point, outer, tolerance)) return false;
    }
  }
  return true;
}

export function assertFootprintInsideSite(footprint: Point2D[], siteBoundary: Point2D[]): void {
  if (!polygonInsidePolygon(footprint, siteBoundary)) {
    throw new Error("Forma placed the generated footprint outside the selected Site Limit. The invalid element was removed; no analysis was accepted.");
  }
}
