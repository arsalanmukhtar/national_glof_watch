// Fetch + persist logic for the 10-minute value cron, on the Datascape
// v3 API. For each station, /v3/elements returns every element's live
// value plus `stateId` (PMD's own alert classification). We upsert the
// element catalog and append readings.
//
// Idempotent: the UNIQUE(station_id, element, last_update) constraint
// makes replaying a cycle with no advanced readings a no-op.
//
// Station coordinates are NOT touched here — the v3 list call carries no
// lat/lon. A station must already exist in `stations` (seeded by the
// threshold job) for its readings to land; unknown stations are skipped.

import { fetchStationList, fetchStationElements } from './datascape.js';
import { pool } from './db.js';

const STATION_DELAY_MS = 80;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fetch one station's elements, upsert the catalog, append readings.
export async function storeStationElements(stationId) {
  const sid = Number(stationId);
  if (!Number.isFinite(sid)) {
    return { stationId, catalogUpserted: 0, readingsInserted: 0, readingsSkipped: 0 };
  }

  const elements = await fetchStationElements(sid);
  if (elements.length === 0) {
    return { stationId: sid, catalogUpserted: 0, readingsInserted: 0, readingsSkipped: 0 };
  }

  const client = await pool.connect();
  try {
    // station_elements + station_readings both FK to `stations`. The v3
    // value feed has no coordinates, so we cannot create a station here —
    // skip any station the threshold/seed job hasn't registered yet.
    const known = await client.query(
      'SELECT 1 FROM stations WHERE station_id = $1',
      [sid],
    );
    if (known.rowCount === 0) {
      return {
        stationId: sid,
        catalogUpserted: 0,
        readingsInserted: 0,
        readingsSkipped: 0,
        skipped: 'unknown-station',
      };
    }

    await client.query('BEGIN');

    let catalogUpserted = 0;
    let readingsInserted = 0;
    let readingsBackfilled = 0;

    for (const el of elements) {
      const elementId = Number(el.elementId);
      const elementName = el.elementName ?? '';
      if (!Number.isFinite(elementId) || !elementName) continue;

      const decimals = Number.isFinite(Number(el.decimals))
        ? Number(el.decimals)
        : null;

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
               is_queryable = EXCLUDED.is_queryable,
               last_seen    = NOW()`,
        [
          elementId,
          sid,
          elementName,
          el.measUnit ?? null,
          decimals,
          Number.isFinite(Number(el.category)) ? Number(el.category) : null,
          el.isQueryable ?? null,
        ],
      );
      catalogUpserted += 1;

      const rawValue = el.value;
      const value =
        rawValue == null || rawValue === '' ? null : Number(rawValue);
      const stateId = Number.isFinite(Number(el.stateId))
        ? Number(el.stateId)
        : null;

      // A station that has gone quiet keeps re-presenting the SAME
      // (station_id, element, last_update) every cycle. With DO NOTHING that
      // row froze forever — and any such row inserted by the legacy EWS
      // cron has element_id/state_id NULL, which the catalog-driven /latest
      // join cannot match. DO UPDATE lets a later v3 cycle backfill those
      // columns onto the existing row. The WHERE guard keeps a fully-healed
      // row a true no-op (no write, nothing returned).
      const insert = await client.query(
        `INSERT INTO station_readings
           (station_id, element, element_id, value, unit, state_id, last_update)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (station_id, element, last_update) DO UPDATE
           SET element_id = EXCLUDED.element_id,
               state_id   = EXCLUDED.state_id,
               value      = EXCLUDED.value,
               unit       = EXCLUDED.unit
         WHERE station_readings.element_id IS DISTINCT FROM EXCLUDED.element_id
            OR station_readings.state_id  IS DISTINCT FROM EXCLUDED.state_id
            OR station_readings.value     IS DISTINCT FROM EXCLUDED.value
            OR station_readings.unit      IS DISTINCT FROM EXCLUDED.unit
         RETURNING (xmax = 0) AS inserted`,
        [
          sid,
          elementName,
          elementId,
          Number.isFinite(value) ? value : null,
          el.measUnit ?? null,
          stateId,
          el.time ?? null,
        ],
      );
      if (insert.rowCount > 0) {
        if (insert.rows[0].inserted) readingsInserted += 1;
        else readingsBackfilled += 1;
      }
    }

    await client.query('COMMIT');

    return {
      stationId: sid,
      catalogUpserted,
      readingsInserted,
      readingsBackfilled,
      readingsSkipped: elements.length - readingsInserted - readingsBackfilled,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// One full value cycle: every station, sequentially. A failing station is
// recorded and skipped so it cannot abort the cycle.
export async function storeAllStations() {
  const runAt = new Date().toISOString();
  const stations = await fetchStationList();

  let totalReadingsInserted = 0;
  let totalReadingsBackfilled = 0;
  let totalCatalogUpserted = 0;
  let skipped = 0;
  const errors = [];

  for (const station of stations) {
    try {
      const r = await storeStationElements(station.stationId);
      totalReadingsInserted += r.readingsInserted;
      totalReadingsBackfilled += r.readingsBackfilled || 0;
      totalCatalogUpserted += r.catalogUpserted;
      if (r.skipped) skipped += 1;
    } catch (err) {
      errors.push({ stationId: station.stationId, error: err.message });
    }
    await sleep(STATION_DELAY_MS);
  }

  return {
    runAt,
    stationCount: stations.length,
    totalReadingsInserted,
    totalReadingsBackfilled,
    totalCatalogUpserted,
    skipped,
    errorCount: errors.length,
    errors,
  };
}
