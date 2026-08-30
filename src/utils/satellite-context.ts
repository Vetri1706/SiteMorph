import type { SurfaceSegmentation } from "../types";

function isRenderableImageSource(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  const separator = trimmed.indexOf(",");
  const isImageDataUrl = separator > 0
    && /^data:image\/[a-z0-9.+-]+;base64$/i.test(trimmed.slice(0, separator))
    && trimmed.slice(separator + 1).length > 0;
  if (isImageDataUrl) return true;
  try {
    return new URL(trimmed).protocol === "https:";
  } catch {
    return false;
  }
}

/** Percentages alone are not visible context; one saved image must render. */
export function hasVisibleSatelliteContext(surface: SurfaceSegmentation | undefined): boolean {
  return Boolean(surface && (
    isRenderableImageSource(surface.originalImageDataUrl)
    || isRenderableImageSource(surface.segmentedImageDataUrl)
  ));
}
