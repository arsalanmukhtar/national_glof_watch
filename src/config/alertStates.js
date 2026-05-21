// Alert-state symbology — the single source of truth for how PMD stations
// are colored on the map, in the legend, and in the stations table.
//
// Every station reading carries a `stateId` (0-100) that PMD computed
// against that station's own alert thresholds. We bucket it into five
// categorical states. Because each station has its own numeric thresholds,
// a shared numeric legend is impossible — the legend is categorical.
//
// This replaces the per-element value-bin system in parameterLegends.js
// for map symbology. The chart's gradient logic there is untouched.

// Ordered by escalating severity. `match` buckets a numeric stateId —
// kept in lockstep with stateLabel() in server/lib/datascape.js.
// Colors reuse hexes already present elsewhere in the app.
export const ALERT_STATES = [
  { id: 'normal', label: 'Normal', color: '#22c55e', match: (s) => s === 0 },
  { id: 'warning', label: 'Warning', color: '#facc15', match: (s) => s >= 40 && s < 70 },
  { id: 'prealarm', label: 'Pre-alarm', color: '#f97316', match: (s) => s >= 70 && s < 90 },
  { id: 'alarm', label: 'Alarm', color: '#dc2626', match: (s) => s >= 90 },
  { id: 'error', label: 'Error', color: '#6b7280', match: (s) => s === 20 },
];

// Pseudo-state for a station with no classified reading at all (no
// stateId). Not part of the numeric match set; a slightly lighter gray
// than `error` so the two read as distinct rows in the legend. Reading
// age is NOT folded in here — an old-but-valid reading keeps its real
// alert state and its age is surfaced in the "Updated" column.
export const NODATA_STATE = {
  id: 'nodata',
  label: 'No data',
  color: '#9ca3af',
};

// Every legend row, in display order.
export const LEGEND_STATES = [...ALERT_STATES, NODATA_STATE];

const STATE_BY_ID = Object.fromEntries(LEGEND_STATES.map((s) => [s.id, s]));

export function stateById(id) {
  return STATE_BY_ID[id] ?? NODATA_STATE;
}

// Classify a station reading into an alert-state descriptor purely by its
// PMD `stateId`. Reading age does not change the classification — a real
// reading keeps its true alert state however old it is (the "Updated"
// column carries the age). Only a missing/non-numeric stateId — i.e. no
// classified reading at all — falls back to the no-data state.
export function classifyState(stateId) {
  if (stateId == null || !Number.isFinite(Number(stateId))) return NODATA_STATE;
  const s = Number(stateId);
  for (const state of ALERT_STATES) {
    if (state.match(s)) return state;
  }
  return NODATA_STATE;
}

// Convenience — just the color.
export function colorForState(stateId) {
  return classifyState(stateId).color;
}

// Map a raw alertStateId from a threshold definition to its palette state.
// No value/staleness context here — classify purely on the score. Used by
// the Feature Details threshold table.
export function stateForAlertId(alertStateId) {
  const s = Number(alertStateId);
  if (!Number.isFinite(s)) return NODATA_STATE;
  for (const state of ALERT_STATES) {
    if (state.match(s)) return state;
  }
  return NODATA_STATE;
}

// Severity rank for table sorting — lower is calmer, nodata sorts last.
export function stateRank(id) {
  const idx = LEGEND_STATES.findIndex((s) => s.id === id);
  return idx < 0 ? LEGEND_STATES.length : idx;
}
