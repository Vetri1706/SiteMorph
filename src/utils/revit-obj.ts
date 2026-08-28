import type { GeneratedBuilding } from "../types";

function appendPrism(
  vertices: number[][],
  faces: number[][],
  points: Array<[number, number]>,
  bottom: number,
  top: number,
): void {
  const start = vertices.length + 1;
  vertices.push(...points.map(([x, y]) => [x, y, bottom]), ...points.map(([x, y]) => [x, y, top]));
  const count = points.length;
  for (let index = 1; index < count - 1; index += 1) {
    faces.push([start, start + index + 1, start + index]);
    faces.push([start + count, start + count + index, start + count + index + 1]);
  }
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    faces.push([start + index, start + next, start + count + next, start + count + index]);
  }
}

export function createRevitObj(building: GeneratedBuilding): string {
  const ring = building.projectFootprint;
  const points = ring.length > 1 && ring[0][0] === ring.at(-1)?.[0] && ring[0][1] === ring.at(-1)?.[1]
    ? ring.slice(0, -1)
    : ring;
  if (points.length < 3) throw new Error("The generated building has no exportable footprint.");
  const vertices: number[][] = [];
  const faces: number[][] = [];
  const partialTopFloorAreaSqFt = building.partialTopFloorAreaSqFt ?? building.mezzanineAreaSqFt;
  if (partialTopFloorAreaSqFt && points.length === 4) {
    const mezzanineRatio = Math.min(1, partialTopFloorAreaSqFt / building.footprintSqFt);
    const mezzanineHeightFt = Math.min(12, Math.max(9, building.heightFt * 0.3));
    const mezzanineBottom = building.heightMeters - mezzanineHeightFt / 3.280839895;
    const [bottomLeft, bottomRight, topRight, topLeft] = points;
    const mezzanineStartLeft: [number, number] = [
      bottomLeft[0] + (topLeft[0] - bottomLeft[0]) * (1 - mezzanineRatio),
      bottomLeft[1] + (topLeft[1] - bottomLeft[1]) * (1 - mezzanineRatio),
    ];
    const mezzanineStartRight: [number, number] = [
      bottomRight[0] + (topRight[0] - bottomRight[0]) * (1 - mezzanineRatio),
      bottomRight[1] + (topRight[1] - bottomRight[1]) * (1 - mezzanineRatio),
    ];
    appendPrism(vertices, faces, points, 0, mezzanineBottom);
    appendPrism(vertices, faces, [mezzanineStartLeft, mezzanineStartRight, topRight, topLeft], mezzanineBottom, building.heightMeters);
  } else {
    appendPrism(vertices, faces, points, 0, building.heightMeters);
  }
  return [
    "# SiteMorph optional generic mass reference (not native BIM)",
    "# Units: meters; coordinates use the Forma project-local coordinate system",
    `# Forma element: ${building.elementPath}`,
    `o ${building.name.replaceAll(/[^a-zA-Z0-9_-]/g, "_")}`,
    ...vertices.map(([x, y, z]) => `v ${x.toFixed(4)} ${y.toFixed(4)} ${z.toFixed(4)}`),
    "s off",
    ...faces.map((face) => `f ${face.join(" ")}`),
    "",
  ].join("\n");
}
