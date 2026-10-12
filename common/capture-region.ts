/** Rectangle normalized to the recorded image, independent of DPI and desktop origin. */
export interface CaptureRegion { x: number; y: number; width: number; height: number }
export function isCaptureRegion(value: unknown): value is CaptureRegion {
  if (!value || typeof value !== "object") return false;
  const r = value as CaptureRegion;
  return [r.x,r.y,r.width,r.height].every(Number.isFinite) && r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0 && r.x+r.width <= 1.000001 && r.y+r.height <= 1.000001;
}

export interface CapturePoint { x: number; y: number }
export function isCapturePoint(value: unknown): value is CapturePoint {
  if (!value || typeof value !== "object") return false;
  const p = value as CapturePoint;
  return Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
}

export type AnnotationMode = "region" | "click" | "crop";
