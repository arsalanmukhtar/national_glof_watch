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
    displayName: 'Compact GAS State (WPs)',
    unit: '',
    bins: [
      { color: '#22c55e', label: 'State = 0 (Normal)',    test: (v) => v === 0 },
      { color: '#dc2626', label: 'State = 1 (Triggered)', test: (v) => v === 1 },
    ],
  },
};

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

  if (element === 'Compact GAS State (WPs)') {
    if (n === 0) return '0 — Normal';
    if (n === 1) return '1 — Triggered';
    return String(n);
  }

  const u = unit ?? PARAMETER_LEGENDS[element]?.unit ?? '';
  return u ? `${n} ${u}` : String(n);
}

export function legendDisplayName(element) {
  return PARAMETER_LEGENDS[element]?.displayName ?? element;
}
