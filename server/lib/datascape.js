// Datascape v3 API client.
//
// The PMD "Datascape" API is the source of the full element catalog, the
// live per-station readings (incl. the upstream-computed `stateId` alert
// classification) and the alert thresholds (`entryCfgs`). It is plain
// HTTP and token-authenticated — a different API than the legacy EWS
// endpoint in pmd.js. Flow:
//   1. POST /connect/token                       -> Bearer access_token
//   2. GET  /v1/elements                         -> network-wide station list
//   3. GET  /v3/elements?station_id=X            -> a station's live elements
//   4. GET  /v3/elements/{elementId}             -> one element's entryCfgs
//
// Mirrors the verified Python probe in scripts/python/test_v3_elements.py.

const BASE = (
  process.env.DATASCAPE_BASE ?? 'http://115.186.56.181/datascapea'
).replace(/\/+$/, '');

const USERNAME = process.env.DATASCAPE_USER ?? 'DatascapeUser';
const PASSWORD = process.env.DATASCAPE_PASSWORD ?? 'hQKPv8N27RxWQu3t4DE0';
const CLIENT_ID = process.env.DATASCAPE_CLIENT_ID ?? 'GenericClient';
const CLIENT_INSTANCE = process.env.DATASCAPE_CLIENT_INSTANCE ?? '12345';

const REQUEST_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Token cache
// ---------------------------------------------------------------------------
// One token is reused across a whole fetch cycle. `expiresAt` drives a
// proactive refresh; authedGet() also refreshes reactively on any 401.
let tokenCache = { token: null, expiresAt: 0 };

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function getToken(force = false) {
  if (!force && tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }
  const body = new URLSearchParams({
    username: USERNAME,
    password: PASSWORD,
    grant_type: 'password',
    client_id: CLIENT_ID,
    client_instance: CLIENT_INSTANCE,
  });
  const res = await fetchWithTimeout(`${BASE}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const err = new Error(`Datascape token ${res.status} ${res.statusText}`);
    err.status = 502;
    throw err;
  }
  const data = await res.json();
  const token = data?.access_token;
  if (!token) throw new Error('Datascape token response had no access_token');
  // Refresh a minute before the stated expiry; fall back to 50 min if the
  // response omits expires_in.
  const ttlSec = Number(data?.expires_in) || 3000;
  tokenCache = {
    token,
    expiresAt: Date.now() + Math.max(60, ttlSec - 60) * 1000,
  };
  return token;
}

// ---------------------------------------------------------------------------
// Authenticated GET
// ---------------------------------------------------------------------------
// `params` may be a plain object or an array of [key, value] pairs (use the
// array form for repeated keys like `field`). Returns parsed JSON, or null
// for an empty 204/404 body. Retries once on 401 with a fresh token.
async function authedGet(path, params = []) {
  const url = new URL(`${BASE}${path}`);
  const entries = Array.isArray(params) ? params : Object.entries(params);
  for (const [k, v] of entries) url.searchParams.append(k, v);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await getToken(attempt > 0);
    const res = await fetchWithTimeout(url, {
      headers: { Accept: '*/*', Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 && attempt === 0) continue; // refresh + retry
    if (res.status === 204 || res.status === 404) return null;
    if (!res.ok) {
      const err = new Error(
        `Datascape ${path} ${res.status} ${res.statusText}`,
      );
      err.status = 502;
      throw err;
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  const err = new Error(`Datascape ${path} 401 (token refresh failed)`);
  err.status = 502;
  throw err;
}

// ---------------------------------------------------------------------------
// /v1/elements — network-wide station list
// ---------------------------------------------------------------------------
// Returns element records for the whole network; we dedupe to unique
// (stationId, stationName) pairs. Ports extract_stations_from_elements
// from scripts/python/aegis_apis.py.
export async function fetchStationList() {
  const data = await authedGet('/v1/elements', [
    ['category', 'All'],
    ['field', 'StationId'],
    ['field', 'StationName'],
    ['ui_culture', 'en-US'],
  ]);

  let records = [];
  if (Array.isArray(data)) records = data;
  else if (data && typeof data === 'object') {
    for (const key of ['items', 'data', 'results', 'elements']) {
      if (Array.isArray(data[key])) {
        records = data[key];
        break;
      }
    }
  }

  const seen = new Map();
  for (const rec of records) {
    if (!rec || typeof rec !== 'object') continue;
    const stationId = Number(rec.StationId ?? rec.stationId ?? rec.station_id);
    if (!Number.isFinite(stationId)) continue;
    const stationName =
      rec.StationName ?? rec.stationName ?? rec.station_name ?? '';
    if (!seen.has(stationId) || (!seen.get(stationId) && stationName)) {
      seen.set(stationId, stationName);
    }
  }

  return [...seen.entries()]
    .map(([stationId, stationName]) => ({ stationId, stationName }))
    .sort((a, b) => a.stationId - b.stationId);
}

// ---------------------------------------------------------------------------
// /v3/elements?station_id=X — one station's live elements
// ---------------------------------------------------------------------------
// Each item: { elementName, elementId, decimals, measUnit, time, value,
//              trend, stateId, stateDescr, isQueryable, ... }.
export async function fetchStationElements(stationId) {
  const fields = [
    'ElementName',
    'Time',
    'Value',
    'Decimals',
    'MeasUnit',
    'Trend',
    'StateId',
    'IsQueryable',
  ];
  const params = [
    ['station_id', stationId],
    ['longitude', ''],
    ['latitude', ''],
    ['category', '1'],
    ['ui_culture', 'en'],
    ...fields.map((f) => ['field', f]),
    ['filter_central_id', ''],
    ['filter_id', ''],
    ['_', Date.now()],
  ];
  const data = await authedGet('/v3/elements', params);
  return Array.isArray(data) ? data : [];
}

// ---------------------------------------------------------------------------
// /v3/elements/{elementId} — one element's detail (incl. entryCfgs, coords)
// ---------------------------------------------------------------------------
export async function fetchElementDetail(elementId) {
  return authedGet(`/v3/elements/${elementId}`, [
    ['ui_culture', 'en'],
    ['_', Date.now()],
  ]);
}

// ===========================================================================
// entryCfgs decoder — ports parse_entry_cfgs from test_v3_elements.py
// ===========================================================================
// thresholdOperator -> comparison symbol. 1/5/6/7 confirmed from live data.
const OPERATOR_SYMBOL = { 1: '<', 2: '≤', 5: '≥', 6: '>', 7: 'range' };

// Map a 0-100 alertStateId severity score to a human label. stateDescr in
// the response is unreliable (often null/""), so the label is bucketed
// from the score: 0=Normal, 20=Error, 50/60=Warning, 70/80=Pre-alarm,
// 90/100=Alarm.
export function stateLabel(stateId) {
  if (stateId === 0) return 'Normal';
  if (stateId === 20) return 'Error';
  if (stateId >= 40 && stateId < 70) return 'Warning';
  if (stateId >= 70 && stateId < 90) return 'Pre-alarm';
  if (stateId >= 90) return 'Alarm';
  return `State ${stateId}`;
}

function fmtNum(x, decimals) {
  if (x == null) return 'null';
  return Number(x).toFixed(decimals);
}

function conditionText(op, value, maxValue, subject, decimals) {
  const v = fmtNum(value, decimals);
  if (op === 7) return `${v} ≤ ${subject} < ${fmtNum(maxValue, decimals)}`;
  if (op === 1) return `${subject} < ${v}`;
  if (op === 2) return `${subject} ≤ ${v}`;
  if (op === 5) return `${subject} ≥ ${v}`;
  if (op === 6) return `${subject} > ${v}`;
  return `${subject} ?op${op} ${v}`;
}

function fmtTrendPeriod(minutes) {
  if (minutes == null || minutes === 0) return null;
  return minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
}

// ---------------------------------------------------------------------------
// Direction-aware threshold tightening. Used for NDMA's "early-warning"
// classification: same alarm bands as PMD, but each threshold is nudged
// 10% *closer* to the safe zone regardless of operator direction.
//
//   Operator '>' or '≥' → threshold is an UPPER bound (alarm above X).
//   Tighten by MULTIPLYING by `factor` (< 1) so the threshold moves DOWN.
//   PMD: alarm if value > 30; factor 0.9 → ours: alarm if value > 27.
//
//   Operator '<' or '≤' → threshold is a LOWER bound (alarm below X).
//   Tighten by MULTIPLYING by 1/factor (> 1) so the threshold moves UP.
//   PMD: alarm if value < 12; factor 0.9 → ours: alarm if value < 13.33.
//
// Range operator ('range') is left alone — the safe zone is bounded on
// both sides and tightening it needs a policy call we don't have (does
// 10% mean shrink each side by 5%? symmetric absolute? etc.). Anything
// we can't classify falls back to PMD's own stateId elsewhere.
//
// classifyAgainstTightened(value, alarms, factor) returns:
//   { stateId, crossed: { label, operator, threshold, ...state } | null }
// where `stateId` is the WORST (highest-severity) `alertStateId` whose
// tightened band the current value crosses, and `crossed` is a copy of
// that state entry with `threshold` set to the actual tightened value.
// If nothing crosses, returns { stateId: 0, crossed: null } — same "no
// alert" semantic PMD uses (Normal = 0).
// ---------------------------------------------------------------------------

const UPPER_OPS = new Set(['>', '≥', '>=', 'gt', 'ge']);
const LOWER_OPS = new Set(['<', '≤', '<=', 'lt', 'le']);

// Per-element-name overrides for the early-warning classifier. The
// default (multiplicative ×0.9 / ÷0.9) misbehaves for parameters whose
// safe value is far from zero:
//   • Atmospheric Pressure — normal ~1013 hPa, PMD alarm ≤ 990.
//     ÷0.9 → tightened Warning ≤ 1100, which every normal reading
//     satisfies → 100% false-positive rate.
//   • Any parameter whose thresholds cluster tightly around a non-zero
//     baseline (pH, calibrated depth sensors, etc.).
// For these, we skip early-warning and fall back to PMD's own stateId
// — better to under-warn than cry wolf on every reading. Extend this
// map as new parameters surface the same problem.
const EARLY_WARNING_OVERRIDES = {
  'Atmospheric Pressure': { mode: 'skip' },
};

// Given an alarm's ordered `states` array, decide whether severity
// climbs with value (ascending) or drops with it (descending). Look at
// pairs of states that both have numeric `min`s and both have
// `alertStateId > 0` (the Normal band is uninformative). If EVERY such
// pair has higher-min → higher-severity, ascending. If EVERY pair goes
// the other way, descending. Anything else defaults to ascending (the
// PMD-typical case), which is safe: an ascending classifier applied to
// descending bands under-warns, it never falsely alarms.
function detectDirection(states) {
  const points = [];
  for (const s of states) {
    if (s?.operator !== 'range') continue;
    const min = Number(s?.min);
    const sid = Number(s?.alertStateId);
    if (!Number.isFinite(min) || !Number.isFinite(sid) || sid <= 0) continue;
    points.push({ min, sid });
  }
  if (points.length < 2) return 'ascending';
  points.sort((a, b) => a.min - b.min);
  let asc = 0;
  let desc = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].sid > points[i - 1].sid) asc++;
    else if (points[i].sid < points[i - 1].sid) desc++;
  }
  if (desc > 0 && asc === 0) return 'descending';
  return 'ascending';
}

export function classifyAgainstTightened(value, alarms, factor, elementName) {
  if (value == null) return { stateId: null, crossed: null };
  const v = Number(value);
  if (!Number.isFinite(v)) return { stateId: null, crossed: null };
  if (!Array.isArray(alarms) || alarms.length === 0) {
    return { stateId: null, crossed: null };
  }
  const f = Number(factor);
  if (!Number.isFinite(f) || f <= 0) return { stateId: null, crossed: null };
  const invF = 1 / f;

  // Per-parameter safety hatch. `mode: 'skip'` returns null so the
  // client falls back to PMD's stateId — matches how a station without
  // captured thresholds is treated.
  const override = elementName ? EARLY_WARNING_OVERRIDES[elementName] : null;
  if (override?.mode === 'skip') return { stateId: null, crossed: null };

  let worstStateId = 0;
  let worstCrossed = null;

  for (const alarm of alarms) {
    // Direction is per-alarm — a station can have both a
    // heat-risk alarm (ascending) and a battery-low alarm (descending)
    // on the same element in theory. In practice a single alarm's
    // states all point the same way.
    const direction = detectDirection(alarm?.states ?? []);
    for (const state of alarm?.states ?? []) {
      const op = state?.operator;
      const sid = Number(state?.alertStateId);
      if (!Number.isFinite(sid)) continue;

      const minRaw = state?.min;
      const maxRaw = state?.max;
      const minV = minRaw == null ? null : Number(minRaw);
      const maxV = maxRaw == null ? null : Number(maxRaw);

      let tightened = null;
      let crossed = false;

      if (UPPER_OPS.has(op) && minV != null && Number.isFinite(minV)) {
        // "value > X" / "value ≥ X" — tighten X down so alert fires earlier.
        tightened = minV * f;
        crossed =
          op === '≥' || op === '>=' ? v >= tightened : v > tightened;
      } else if (LOWER_OPS.has(op) && minV != null && Number.isFinite(minV)) {
        // "value < X" / "value ≤ X" — tighten X up so alert fires earlier.
        tightened = minV * invF;
        crossed =
          op === '≤' || op === '<=' ? v <= tightened : v < tightened;
      } else if (op === 'range') {
        // Cascading range bands — the vast majority of PMD's
        // definitions. Direction of severity matters:
        //   ascending  — higher min → higher severity (heat, water level,
        //     rainfall, wind, etc.). Tighten the LOWER edge downward and
        //     match `value >= tightened_min` — worst-band-wins gives the
        //     right classification.
        //   descending — higher min → lower severity (battery voltage,
        //     reservoir level for drought, etc.). Tighten the UPPER edge
        //     upward and match `value < tightened_max`.
        if (direction === 'ascending' && minV != null && Number.isFinite(minV)) {
          tightened = minV * f;
          crossed = v >= tightened;
        } else if (
          direction === 'descending' &&
          maxV != null &&
          Number.isFinite(maxV)
        ) {
          tightened = maxV * invF;
          crossed = v < tightened;
        } else {
          continue;
        }
      } else {
        continue;
      }

      if (crossed && sid > worstStateId) {
        worstStateId = sid;
        worstCrossed = { ...state, threshold: tightened };
      }
    }
  }

  return { stateId: worstStateId, crossed: worstCrossed };
}

// Decode a raw entryCfgs array into labelled threshold blocks, grouped by
// alarmId. Each block: { alarmId, alarmName, type, trendPeriod, states[] }.
export function parseEntryCfgs(entryCfgs, decimals = 2) {
  const groups = new Map();
  for (const e of entryCfgs ?? []) {
    if (!groups.has(e.alarmId)) groups.set(e.alarmId, []);
    groups.get(e.alarmId).push(e);
  }

  const blocks = [];
  for (const [alarmId, entries] of groups) {
    const first = entries[0];
    const isTrend = first.thresholdType === 2;
    const subject = isTrend ? 'trend' : 'value';
    // Keep the API's array order — it is entryId/insertion order, which
    // matches how the Datascape UI panel lists the states.
    const states = entries.map((e) => {
      const op = e.thresholdOperator;
      return {
        label: e.stateDescr || stateLabel(e.alertStateId ?? 0),
        alertStateId: e.alertStateId ?? null,
        operator: OPERATOR_SYMBOL[op] ?? op,
        min: e.value ?? null,
        max: e.maxValue ?? null,
        condition: conditionText(op, e.value, e.maxValue, subject, decimals),
      };
    });
    blocks.push({
      alarmId,
      alarmName: first.alarmName ?? null,
      type: isTrend ? 'TREND' : 'VALUE',
      trendPeriod: isTrend ? fmtTrendPeriod(first.trendPeriod) : null,
      states,
    });
  }
  return blocks;
}
