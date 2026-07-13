// Legacy PMD EWS endpoint — retained only for the network-wide station
// status badge. The main data pipeline now runs on the Datascape v3 API
// (server/lib/datascape.js). The EWS host serves HTTPS with a self-signed
// / private-CA cert, so this one call routes through an undici Agent that
// tolerates it — scoped to this request only.

import { Agent, fetch as undiciFetch } from 'undici';

const PMD_STATUS_URL = 'https://115.186.56.181/ews/classes/station_status.php';

const insecureDispatcher = new Agent({
  connect: { rejectUnauthorized: false },
});

// Lightweight network-wide status: total stations + how many are
// active/currently reporting. Used by the titlebar status badge.
// Shape: { totalStations, totalActive, currentActive, windowMinutes }.
export async function fetchStationStatus() {
  const res = await undiciFetch(PMD_STATUS_URL, {
    dispatcher: insecureDispatcher,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const err = new Error(`PMD upstream ${res.status} ${res.statusText}`);
    err.status = 502;
    throw err;
  }
  return res.json();
}

// ─── Warm cache for station-status ────────────────────────────────────
// The upstream PHP endpoint has been observed to take anywhere between
// 20 s and 100+ s to respond. That's fine as a background job but kills
// the titlebar badge — the browser abandons the fetch, the component
// falls through to its error state and returns null, and the badge
// disappears. To keep the badge always populated we:
//   1. Keep the latest good response in-process here.
//   2. Serve every /api/parameters/station-status request from this
//      cache — no wait for the caller.
//   3. Refresh in the background on a cron (kicked from server/index.js).
// The cron is guarded against re-entry so a slow upstream doesn't
// stack overlapping requests.

const CACHE = { data: null, fetchedAt: null, error: null, refreshing: false };

// Read the currently-cached status. Returns `{ data, fetchedAt, error }`.
// A caller getting `data: null` and `error != null` should surface a 5xx
// with the error text; a caller getting `data: null, error: null` means
// the cron has not run yet (very early boot).
export function getCachedStationStatus() {
  return {
    data: CACHE.data,
    fetchedAt: CACHE.fetchedAt,
    error: CACHE.error,
  };
}

// Kick the upstream and refresh the cache. Never throws — every failure
// mode gets recorded on the cache so the endpoint can 5xx cleanly if
// the very first attempt fails. Returns `{ ok, elapsedMs, error? }` so
// the cron log line reflects what actually happened.
export async function refreshStationStatusCache() {
  if (CACHE.refreshing) {
    return { ok: false, elapsedMs: 0, error: 'refresh already in flight' };
  }
  CACHE.refreshing = true;
  const t0 = Date.now();
  try {
    const data = await fetchStationStatus();
    CACHE.data = data;
    CACHE.fetchedAt = new Date().toISOString();
    CACHE.error = null;
    return { ok: true, elapsedMs: Date.now() - t0 };
  } catch (err) {
    // Preserve the last-good `data` — a transient PMD outage shouldn't
    // wipe the badge; only `error` gets updated so the endpoint can
    // report freshness alongside the served payload.
    CACHE.error = err.message;
    return { ok: false, elapsedMs: Date.now() - t0, error: err.message };
  } finally {
    CACHE.refreshing = false;
  }
}
