// Monthly threshold-discovery job.
//
// Walks the whole PMD network via the Datascape v3 API and rebuilds two
// tables:
//   - station_elements   : the element catalog (which station has which
//                          element, + unit/decimals)
//   - element_thresholds : the decoded alert bands (entryCfgs)
//
// It also opportunistically refreshes stations.lat/lon — the v3 element
// detail is the only call that carries coordinates.
//
// Thresholds are alarm *configuration* and change rarely, so this runs
// monthly (server/index.js) or on demand (scripts/db/seed-station-elements.js,
// POST /api/parameters/thresholds/refresh). It is a heavy batch (~one
// detail call per element network-wide); commits per station so a crash
// leaves valid partial data the next run overwrites.

import { pool } from './db.js';
import {
  fetchStationList,
  fetchStationElements,
  fetchElementDetail,
  parseEntryCfgs,
} from './datascape.js';

const DETAIL_DELAY_MS = 80;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function finiteOrNull(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

// Process one station: catalog its elements, decode each element's
// thresholds, and persist — all in a single per-station transaction.
async function refreshStation(station) {
  const stationId = Number(station.stationId);
  if (!Number.isFinite(stationId)) return { elements: 0, thresholds: 0 };

  const elements = await fetchStationElements(stationId);
  if (elements.length === 0) return { elements: 0, thresholds: 0 };

  // Fetch every element's detail first (coords + entryCfgs live here).
  const details = [];
  let lat = null;
  let lon = null;
  for (const el of elements) {
    const elementId = Number(el.elementId);
    if (!Number.isFinite(elementId)) continue;
    let detail = null;
    try {
      detail = await fetchElementDetail(elementId);
    } catch {
      detail = null; // skip a bad element, keep the station
    }
    if (detail && lat == null) {
      const dLat = finiteOrNull(detail.latitude);
      const dLon = finiteOrNull(detail.longitude);
      if (dLat != null && dLon != null) {
        lat = dLat;
        lon = dLon;
      }
    }
    details.push({ el, elementId, detail });
    await sleep(DETAIL_DELAY_MS);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Ensure the station row exists (station_elements has an FK to it).
    if (lat != null && lon != null) {
      await client.query(
        `INSERT INTO stations (station_id, station_name, lat, lon, first_seen, last_seen)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         ON CONFLICT (station_id) DO UPDATE
           SET station_name = EXCLUDED.station_name,
               lat = EXCLUDED.lat,
               lon = EXCLUDED.lon,
               last_seen = NOW()`,
        [stationId, station.stationName ?? '', lat, lon],
      );
    } else {
      const { rowCount } = await client.query(
        'SELECT 1 FROM stations WHERE station_id = $1',
        [stationId],
      );
      if (rowCount === 0) {
        // No coords anywhere and not previously seen — cannot satisfy the
        // NOT NULL lat/lon. Skip this station; a later run may find coords.
        await client.query('ROLLBACK');
        return { elements: 0, thresholds: 0, skipped: 'no-coords' };
      }
    }

    let elementsUpserted = 0;
    let thresholdsUpserted = 0;

    for (const { el, elementId, detail } of details) {
      const decimals =
        finiteOrNull(detail?.decimals) ?? finiteOrNull(el.decimals) ?? 2;

      await client.query(
        `INSERT INTO station_elements
           (element_id, station_id, element_name, meas_unit, decimals,
            category, is_queryable, last_seen)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (element_id) DO UPDATE
           SET station_id   = EXCLUDED.station_id,
               element_name = EXCLUDED.element_name,
               meas_unit    = EXCLUDED.meas_unit,
               decimals     = EXCLUDED.decimals,
               category     = EXCLUDED.category,
               is_queryable = EXCLUDED.is_queryable,
               last_seen    = NOW()`,
        [
          elementId,
          stationId,
          el.elementName ?? '',
          el.measUnit ?? null,
          decimals,
          finiteOrNull(el.category),
          el.isQueryable ?? null,
        ],
      );
      elementsUpserted += 1;

      const alarms = parseEntryCfgs(detail?.entryCfgs, decimals);
      await client.query(
        `INSERT INTO element_thresholds
           (element_id, station_id, element_name, decimals, alarms, fetched_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
         ON CONFLICT (element_id) DO UPDATE
           SET station_id   = EXCLUDED.station_id,
               element_name = EXCLUDED.element_name,
               decimals     = EXCLUDED.decimals,
               alarms       = EXCLUDED.alarms,
               fetched_at   = NOW()`,
        [
          elementId,
          stationId,
          el.elementName ?? '',
          decimals,
          JSON.stringify(alarms),
        ],
      );
      thresholdsUpserted += 1;
    }

    await client.query('COMMIT');
    return { elements: elementsUpserted, thresholds: thresholdsUpserted };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Full network sweep. `onProgress(done, total, station)` is optional.
export async function refreshAllThresholds(onProgress) {
  const runAt = new Date().toISOString();
  const stations = await fetchStationList();

  let elementCount = 0;
  let thresholdsUpserted = 0;
  const errors = [];

  for (let i = 0; i < stations.length; i += 1) {
    const station = stations[i];
    try {
      const r = await refreshStation(station);
      elementCount += r.elements;
      thresholdsUpserted += r.thresholds;
    } catch (err) {
      errors.push({ stationId: station.stationId, error: err.message });
    }
    onProgress?.(i + 1, stations.length, station);
  }

  return {
    runAt,
    stationCount: stations.length,
    elementCount,
    thresholdsUpserted,
    errorCount: errors.length,
    errors,
  };
}
