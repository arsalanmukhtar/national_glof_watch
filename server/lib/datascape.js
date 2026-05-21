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
