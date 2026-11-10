// Validated RGB triplet parser for canvas `rgba(...)` color strings.
//
// Accepts "r g b" (space-separated channel triplet) and returns "r, g, b".
// Null / missing / malformed input falls back to a safe default so callers
// never throw on `colorRgb={null}` nor emit `rgba(NaN, ...)` (which browsers
// silently drop). Used by both FluidMembraneInput and FluidPointerCanvas.
const DEFAULT_RGB = '37 99 235';

export function parseColorRgb(colorRgb?: string | null, fallback = DEFAULT_RGB): string {
  if (typeof colorRgb !== 'string' || !colorRgb.trim()) return fallback;

  const parts = colorRgb.trim().split(/\s+/);
  if (parts.length !== 3) return fallback;

  const values = parts.map((part) => Number(part));
  if (values.some((value) => !Number.isFinite(value))) return fallback;

  return values
    .map((value) => Math.min(255, Math.max(0, Math.round(value))))
    .join(', ');
}
