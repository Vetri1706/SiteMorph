import siteFixture from "../mocks/site.json";
import type { SiteContext } from "../types";

/**
 * JSON imports widen coordinate tuples to `number[]`. Normalize the local
 * boundary once so mock mode obeys the same SiteGeometry contract as Forma.
 */
export const mockSiteContext: SiteContext = {
  ...siteFixture,
  geometry: siteFixture.geometry
    ? {
        ...siteFixture.geometry,
        localBoundary: siteFixture.geometry.localBoundary.map(([x, y]) => [x, y] as [number, number]),
        geojson: {
          ...siteFixture.geometry.geojson,
          type: "Feature",
          geometry: {
            ...siteFixture.geometry.geojson.geometry,
            type: "Polygon",
          },
        },
      }
    : undefined,
};
