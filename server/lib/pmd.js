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
