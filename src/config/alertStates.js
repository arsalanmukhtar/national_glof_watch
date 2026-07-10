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

// Pseudo-state for a station that is currently INACTIVE — either has no
// classified reading at all, OR its latest reading is older than
// `INACTIVE_THRESHOLD_MS`. Not part of the numeric match set; a slightly
// lighter gray than `error` so the two read as distinct rows in the
// legend. Formerly labelled "No data".
export const INACTIVE_STATE = {
  id: 'inactive',
  label: 'Inactive',
  color: '#9ca3af',
};

// Backwards-compatible alias kept because `MapPanel`'s Mapbox paint
// expressions and a handful of other spots reference `NODATA_STATE.color`
// as the coalesce fallback for `['get', 'color']`. Same object, so any
// touch to `INACTIVE_STATE.color` is picked up automatically.
export const NODATA_STATE = INACTIVE_STATE;

// A reading whose `lastUpdate` timestamp is older than this counts as
// inactive on the map, in the legend, and in the stations table —
// regardless of the numeric stateId PMD stamped on it. Two days matches
// how the operators triage the network: anything not reporting inside
// 48 h is treated as offline until it comes back.
export const INACTIVE_THRESHOLD_MS = 48 * 60 * 60 * 1000;

// Every legend row, in display order.
export const LEGEND_STATES = [...ALERT_STATES, INACTIVE_STATE];

const STATE_BY_ID = Object.fromEntries(LEGEND_STATES.map((s) => [s.id, s]));

export function stateById(id) {
  return STATE_BY_ID[id] ?? INACTIVE_STATE;
}

// True if the reading is missing OR older than the inactive threshold.
export function isInactive(lastUpdate) {
  if (!lastUpdate) return true;
  const t = new Date(lastUpdate).getTime();
  if (!Number.isFinite(t)) return true;
  return Date.now() - t > INACTIVE_THRESHOLD_MS;
}

// Classify a station reading into an alert-state descriptor. Priority:
//   1. Stale/missing reading (>48 h old OR no timestamp) → Inactive.
//   2. Missing/non-numeric stateId → Inactive (no classified reading).
//   3. Otherwise bucket by stateId (Normal / Warning / Pre-alarm / Alarm / Error).
//
// `lastUpdate` is optional — callers that don't have a timestamp (e.g.
// threshold-table rows that already carry a definite alertStateId) can
// omit it and get the pre-Inactive-rule behaviour.
export function classifyState(stateId, lastUpdate) {
  if (lastUpdate !== undefined && isInactive(lastUpdate)) return INACTIVE_STATE;
  if (stateId == null || !Number.isFinite(Number(stateId))) return INACTIVE_STATE;
  const s = Number(stateId);
  for (const state of ALERT_STATES) {
    if (state.match(s)) return state;
  }
  return INACTIVE_STATE;
}

// Convenience — just the color.
export function colorForState(stateId, lastUpdate) {
  return classifyState(stateId, lastUpdate).color;
}

// Map a raw alertStateId from a threshold definition to its palette state.
// No value/staleness context here — classify purely on the score. Used by
// the Feature Details threshold table.
export function stateForAlertId(alertStateId) {
  const s = Number(alertStateId);
  if (!Number.isFinite(s)) return INACTIVE_STATE;
  for (const state of ALERT_STATES) {
    if (state.match(s)) return state;
  }
  return INACTIVE_STATE;
}

// Severity rank for table sorting — lower is calmer, nodata sorts last.
export function stateRank(id) {
  const idx = LEGEND_STATES.findIndex((s) => s.id === id);
  return idx < 0 ? LEGEND_STATES.length : idx;
}
