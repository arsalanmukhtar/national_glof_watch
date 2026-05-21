// Shared per-parameter color palette. Used by the ParametersPanel element list
// (the colored dot per row) and the ChartsRow trend-line fallback so an
// element reads as the same color everywhere.

// Curated colors for the long-standing elements — pinned so they never shift.
const CURATED = {
  'Air Temperature': '#f97316',          // orange-500
  'Total Rain': '#3b82f6',               // blue-500
  'Water Level': '#06b6d4',              // cyan-500
  'Compact GAS State (WPs)': '#8b5cf6',  // violet-500
  'Istantaneous Flow': '#10b981',        // emerald-500
};

// A spread of 30 visually-distinct hues. The PMD network exposes 40+ elements,
// so any name not in CURATED is mapped deterministically into this palette by
// a hash of its name — every element gets a stable, distinctive color.
const PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
  '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#b91c1c',
  '#c2410c', '#b45309', '#4d7c0f', '#15803d', '#0f766e', '#0e7490',
  '#1d4ed8', '#4338ca', '#6d28d9', '#a21caf', '#be185d', '#9f1239',
];

export const DEFAULT_PARAMETER_COLOR = '#84cc16';

// Backwards-compatible export of the curated map.
export const PARAMETER_COLORS = CURATED;

// Small, stable 32-bit string hash (djb2-ish) — deterministic across reloads.
function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export function colorFor(element) {
  if (!element) return DEFAULT_PARAMETER_COLOR;
  return CURATED[element] ?? PALETTE[hashString(element) % PALETTE.length];
}

// Returns `hex` as an `rgba()` string at the given alpha (0–1).
export function withAlpha(hex, alpha) {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Picks a readable text color (near-black or white) for a solid `hex` fill.
export function textOn(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#0f172a' : '#ffffff';
}
