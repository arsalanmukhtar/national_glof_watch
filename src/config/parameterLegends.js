// Per-parameter legend bins. Drive both the map circle colors and the
// bottom-left MapLegend overlay. Mirror the thresholds used in the legacy
// EWS dashboard screenshots.

export const STALE_COLOR = '#6b7280';        // gray-500
export const STALE_LABEL = 'No update (> 10h)';
export const STALE_THRESHOLD_HOURS = 10;
const STALE_MS = STALE_THRESHOLD_HOURS * 60 * 60 * 1000;

export const PARAMETER_LEGENDS = {
  'Air Temperature': {
    unit: '°C',
    bins: [
      { color: '#1d4ed8', label: '< 0°C',     test: (v) => v < 0 },
      { color: '#38bdf8', label: '0 – 10°C',  test: (v) => v >= 0 && v < 10 },
      { color: '#facc15', label: '10 – 20°C', test: (v) => v >= 10 && v < 20 },
      { color: '#f97316', label: '20 – 30°C', test: (v) => v >= 20 && v < 30 },
      { color: '#dc2626', label: '> 30°C',    test: (v) => v >= 30 },
    ],
  },
  'Total Rain': {
    unit: 'mm',
    bins: [
      { color: '#ffffff', label: '0 mm',       test: (v) => v === 0 },
      { color: '#22c55e', label: '1 – 10 mm',  test: (v) => v > 0 && v <= 10 },
      { color: '#3b82f6', label: '11 – 30 mm', test: (v) => v > 10 && v <= 30 },
      { color: '#a855f7', label: '> 30 mm',    test: (v) => v > 30 },
    ],
  },
  'Water Level': {
    unit: 'm',
    bins: [
      { color: '#22c55e', label: 'Low',    test: (v) => v < 1 },
      { color: '#facc15', label: 'Medium', test: (v) => v >= 1 && v < 2 },
      { color: '#dc2626', label: 'High',   test: (v) => v >= 2 },
    ],
  },
  'Istantaneous Flow': {
    displayName: 'Instantaneous Flow',
    unit: 'm³/s',
    bins: [
      { color: '#22c55e', label: '< 20 m³/s',     test: (v) => v < 20 },
      { color: '#facc15', label: '20 – 40 m³/s',  test: (v) => v >= 20 && v <= 40 },
      { color: '#dc2626', label: '> 40 m³/s',     test: (v) => v > 40 },
    ],
  },
  'Compact GAS State (WPs)': {
    // Upstream tags Battery Voltage readings under this element name.
    // The bins below are voltage thresholds for typical 12 V remote-station
    // batteries — anything below 12 V is a fading battery, 13–14 V is the
    // normal float/operating range, > 14 V means actively charging.
    displayName: 'Compact Gas State (WPs)',
    unit: 'V',
    bins: [
      { color: '#dc2626', label: '< 12 V',     test: (v) => v < 12 },
      { color: '#f97316', label: '12 – 13 V',  test: (v) => v >= 12 && v < 13 },
      { color: '#22c55e', label: '13 – 14 V',  test: (v) => v >= 13 && v < 14 },
      { color: '#3b82f6', label: '≥ 14 V',     test: (v) => v >= 14 },
    ],
  },
};

// Anchor stops for the chart y-axis gradient. Each stop pins a color at
// a representative value of its bin (typically the midpoint). The chart
// builds a CanvasGradient by mapping these into the visible y range.
export const PARAMETER_GRADIENTS = {
  'Air Temperature': [
    { value: -5,  color: '#1d4ed8' },
    { value: 5,   color: '#38bdf8' },
    { value: 15,  color: '#facc15' },
    { value: 25,  color: '#f97316' },
    { value: 35,  color: '#dc2626' },
  ],
  'Total Rain': [
    // White is invisible against light surfaces; nudge the 0 anchor to a
    // pale gray so the line still reads when rainfall is zero.
    { value: 0,   color: '#cbd5e1' },
    { value: 5,   color: '#22c55e' },
    { value: 20,  color: '#3b82f6' },
    { value: 50,  color: '#a855f7' },
  ],
  'Water Level': [
    { value: 0.5, color: '#22c55e' },
    { value: 1.5, color: '#facc15' },
    { value: 2.5, color: '#dc2626' },
  ],
  'Istantaneous Flow': [
    { value: 10,  color: '#22c55e' },
    { value: 30,  color: '#facc15' },
    { value: 50,  color: '#dc2626' },
  ],
  'Compact GAS State (WPs)': [
    { value: 11,   color: '#dc2626' },  // critical
    { value: 12.5, color: '#f97316' },  // low
    { value: 13.5, color: '#22c55e' },  // normal operating
    { value: 14.5, color: '#3b82f6' },  // charging
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

// Resolve the right bin color for a station reading, falling back to the
// stale gray when value is null/non-numeric or the timestamp is too old.
export function colorForReading(element, value, lastUpdate) {
  if (value == null || value === '') return STALE_COLOR;
  const n = Number(value);
  if (!Number.isFinite(n)) return STALE_COLOR;
  if (isStale(lastUpdate)) return STALE_COLOR;
  const legend = PARAMETER_LEGENDS[element];
  if (!legend) return STALE_COLOR;
  for (const bin of legend.bins) {
    if (bin.test(n)) return bin.color;
  }
  return STALE_COLOR;
}

// Human-friendly value for table cells. GAS state gets a label suffix;
// the other elements just append their unit.
export function formatValue(element, value, unit) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);

  const u = unit ?? PARAMETER_LEGENDS[element]?.unit ?? '';
  return u ? `${n} ${u}` : String(n);
}

export function legendDisplayName(element) {
  return PARAMETER_LEGENDS[element]?.displayName ?? element;
}
