// PMD EWS station fetcher. The upstream serves HTTPS with a self-signed
// or private-CA cert, so we route through an undici Agent that tolerates
// it — scoped to PMD requests only, not a global setting.

import { Agent, fetch as undiciFetch } from 'undici';

const PMD_BASE = 'https://115.186.56.181/ews/classes/stations.php';

const insecureDispatcher = new Agent({
  connect: { rejectUnauthorized: false },
});

export const VALID_ELEMENTS = [
  'Air Temperature',
  'Total Rain',
  'Water Level',
  'Compact GAS State (WPs)',
  'Istantaneous Flow', // PMD endpoint preserves this misspelling
];

export function isValidElement(el) {
  return VALID_ELEMENTS.includes(el);
}

export async function fetchPmd(element) {
  if (!isValidElement(element)) {
    const err = new Error(`Unknown element: ${element}`);
    err.status = 400;
    throw err;
  }
  const url = new URL(PMD_BASE);
  url.searchParams.set('element', element);
  url.searchParams.set('_', Date.now().toString());

  const res = await undiciFetch(url.toString(), {
    dispatcher: insecureDispatcher,
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    const err = new Error(`PMD upstream ${res.status} ${res.statusText}`);
    err.status = 502;
    throw err;
  }

  const json = await res.json();
  return json; // { serverTime, stations: [...] }
}

export function toGeoJSON(pmdResponse, element) {
  const stations = Array.isArray(pmdResponse?.stations) ? pmdResponse.stations : [];
  return {
    type: 'FeatureCollection',
    metadata: {
      element,
      serverTime: pmdResponse?.serverTime ?? null,
      count: stations.length,
    },
    features: stations
      .filter((s) => Number.isFinite(Number(s?.lat)) && Number.isFinite(Number(s?.lon)))
      .map((s) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [Number(s.lon), Number(s.lat)],
        },
        properties: {
          stationId: s.stationId,
          stationName: s.stationName,
          // Use the canonical element we asked for, not s.element — the
          // upstream sometimes returns a different label per station
          // (e.g. "Battery Voltage" rows for a "Compact GAS State (WPs)" query).
          element,
          value: s.value,
          unit: s.unit,
          lastUpdate: s.lastUpdate,
        },
      })),
  };
}
