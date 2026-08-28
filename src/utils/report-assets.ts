import type { SiteContext, SiteGeometry } from "../types";

export interface SiteReportAssets {
  mastheadDataUrl?: string;
  logoDataUrl?: string;
  archivedSatelliteDataUrl?: string;
  archivedSurfaceSegmentationDataUrl?: string;
  archivedStreetDataUrl?: string;
  archivedStreetSegmentationDataUrl?: string;
}

export function hasSouthPhoenixArchive(site: SiteContext, geometry?: SiteGeometry | null): boolean {
  const locationMatch = /south phoenix/i.test(`${site.projectName} ${site.location}`);
  const centroidMatch = Boolean(geometry
    && Math.abs(geometry.centroid.latitude - 33.4062) < 0.01
    && Math.abs(geometry.centroid.longitude + 112.0722) < 0.01);
  return locationMatch || centroidMatch;
}

async function assetToDataUrl(path: string): Promise<string | undefined> {
  try {
    const response = await fetch(path);
    if (!response.ok) return undefined;
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

export async function loadSiteReportAssets(site: SiteContext, geometry?: SiteGeometry | null): Promise<SiteReportAssets> {
  const includeArchive = hasSouthPhoenixArchive(site, geometry);
  const [mastheadDataUrl, logoDataUrl, archivedSatelliteDataUrl, archivedSurfaceSegmentationDataUrl, archivedStreetDataUrl, archivedStreetSegmentationDataUrl] = await Promise.all([
    assetToDataUrl("/sitemorph-report-masthead.jpg"),
    assetToDataUrl("/sitemorph-logo-256.png"),
    includeArchive ? assetToDataUrl("/evidence/south-phoenix-satellite-source.png") : undefined,
    includeArchive ? assetToDataUrl("/evidence/south-phoenix-surface-segmentation.png") : undefined,
    includeArchive ? assetToDataUrl("/evidence/south-phoenix-street-source.jpg") : undefined,
    includeArchive ? assetToDataUrl("/evidence/south-phoenix-street-segmentation.png") : undefined,
  ]);

  return {
    mastheadDataUrl,
    logoDataUrl,
    archivedSatelliteDataUrl,
    archivedSurfaceSegmentationDataUrl,
    archivedStreetDataUrl,
    archivedStreetSegmentationDataUrl,
  };
}
