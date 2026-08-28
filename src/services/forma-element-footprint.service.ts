import type { Footprint } from "forma-embedded-view-sdk/geometry";
import { delay } from "../utils/config";
import { assertFootprintInsideSite, projectTriangleMeshToFootprint, type Point2D } from "../utils/geometry-validation";
import type { getFormaClient } from "./forma.service";

type FormaClient = Awaited<ReturnType<typeof getFormaClient>>;

export type FormaFootprintSource = "direct-footprint" | "recursive-mesh" | "validated-generated-outline";

export interface ResolvedFormaFootprint {
  coordinates: Point2D[];
  source: FormaFootprintSource;
}

function directPolygon(footprint: Footprint | undefined): Point2D[] {
  if (footprint?.type !== "Polygon") return [];
  return footprint.coordinates
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
    .map(([x, y]) => [x, y] as Point2D);
}

/**
 * Resolves the actual generated element outline without assuming the floor-
 * stack parent owns a footprint representation. Forma documents that
 * getFootprint() does not traverse children, while getTriangles() does.
 */
export async function resolveFormaElementFootprint(
  Forma: FormaClient,
  path: string,
  plannedFootprint: Point2D[],
  siteBoundary: Point2D[],
): Promise<ResolvedFormaFootprint> {
  assertFootprintInsideSite(plannedFootprint, siteBoundary);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const direct = directPolygon(await Forma.geometry.getFootprint({ path }).catch(() => undefined));
    if (direct.length >= 3) {
      assertFootprintInsideSite(direct, siteBoundary);
      return { coordinates: direct, source: "direct-footprint" };
    }

    const mesh = await Forma.geometry.getTriangles({ path }).catch(() => new Float32Array());
    const projected = projectTriangleMeshToFootprint(mesh);
    if (projected.length >= 3) {
      assertFootprintInsideSite(projected, siteBoundary);
      console.info("[forma-footprint] Resolved floor-stack outline from recursive child mesh.", { path, attempt: attempt + 1 });
      return { coordinates: projected, source: "recursive-mesh" };
    }

    if (attempt < 3) await delay(250 * (attempt + 1));
  }

  // addElement() succeeded and the proposal is persisted, but some Forma
  // floor-stack roots expose neither representation immediately. Confirm the
  // element exists, then retain the exact outline used to create and transform
  // the native mass. It was validated above against the real Site Limit.
  await Forma.elements.getByPath({ path, recursive: true });
  console.warn("[forma-footprint] Forma did not expose a readable representation; using the validated generated outline.", { path });
  return { coordinates: plannedFootprint, source: "validated-generated-outline" };
}
