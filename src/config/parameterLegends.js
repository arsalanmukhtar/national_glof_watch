// Trend-chart gradient stops + shared reading helpers.
//
// Map symbology now lives in src/config/alertStates.js (alert-state
// classification against per-station thresholds). What remains here is
// the per-parameter color gradient that paints the "PMD Data Trend"
// chart line, plus the small staleness + value-formatting helpers shared
// across the dashboard.

export const STALE_THRESHOLD_HOURS = 10;
const STALE_MS = STALE_THRESHOLD_HOURS * 60 * 60 * 1000;

// Anchor stops for the chart y-axis gradient. Each stop pins a color at
// a representative value. The chart builds a CanvasGradient by mapping
// these into the visible y range. Only a few elements have a curated
// gradient — every other element falls back to the brand gradient in
// ChartsRow, so this map does not need to cover the full v3 catalog.
export const PARAMETER_GRADIENTS = {
  'Air Temperature': [
    { value: -5, color: '#1d4ed8' },
    { value: 5, color: '#38bdf8' },
    { value: 15, color: '#facc15' },
    { value: 25, color: '#f97316' },
    { value: 35, color: '#dc2626' },
  ],
  'Total Rain': [
    // White is invisible against light surfaces; nudge the 0 anchor to a
    // pale gray so the line still reads when rainfall is zero.
    { value: 0, color: '#cbd5e1' },
    { value: 5, color: '#22c55e' },
    { value: 20, color: '#3b82f6' },
    { value: 50, color: '#a855f7' },
  ],
  'Water Level': [
    { value: 0.5, color: '#22c55e' },
    { value: 1.5, color: '#facc15' },
    { value: 2.5, color: '#dc2626' },
  ],
};

// Build a vertical CanvasGradient that maps the parameter's bin colors
// onto the chart's y-axis range. Returns null if any inputs are missing
// — the caller should fall back to a solid color in that case.
export function buildLegendGradient(ctx, chartArea, yScale, element, alpha = 1) {
  if (!ctx || !chartArea || !yScale || !element) return null;
  const stops = PARAMETER_GRADIENTS[element];
  if (!stops?.length) return null;

  const yMin = yScale.min;
  const yMax = yScale.max;
  const range = yMax - yMin;
  if (!Number.isFinite(range) || range <= 0) return null;

  const gradient = ctx.createLinearGradient(
    0, chartArea.bottom,
    0, chartArea.top,
  );

  // Anchor color at y-min so the bottom of the line/fill is a real color.
  gradient.addColorStop(0, applyAlpha(colorAtValue(stops, yMin), alpha));

  // Internal stops that land inside the visible range.
  for (const { value, color } of stops) {
    const t = (value - yMin) / range;
    if (t > 0 && t < 1) {
      gradient.addColorStop(t, applyAlpha(color, alpha));
    }
  }

  // Anchor at y-max.
  gradient.addColorStop(1, applyAlpha(colorAtValue(stops, yMax), alpha));

  return gradient;
}

function colorAtValue(stops, v) {
  if (v <= stops[0].value) return stops[0].color;
  if (v >= stops[stops.length - 1].value) return stops[stops.length - 1].color;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (v >= a.value && v <= b.value) {
      const t = (v - a.value) / (b.value - a.value);
      return lerpHex(a.color, b.color, t);
    }
  }
  return stops[stops.length - 1].color;
}

function lerpHex(c1, c2, t) {
  const a = parseHex(c1);
  const b = parseHex(c2);
  if (!a || !b) return c1;
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

function parseHex(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex ?? '');
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function applyAlpha(color, alpha) {
  if (alpha == null || alpha === 1) return color;
  if (color.startsWith('rgb(')) {
    return color.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
  }
  if (color.startsWith('#')) {
    const rgb = parseHex(color);
    if (!rgb) return color;
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
  }
  return color;
}

// True if the reading hasn't been refreshed in over 10 hours.
export function isStale(lastUpdate) {
  if (!lastUpdate) return true;
  const t = new Date(lastUpdate).getTime();
  if (!Number.isFinite(t)) return true;
  return Date.now() - t > STALE_MS;
}

// Human-friendly value for table cells — appends the unit when present.
export function formatValue(value, unit) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return unit ? `${n} ${unit}` : String(n);
}
