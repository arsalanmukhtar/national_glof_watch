// Fetch + persist logic shared by the POST /:el/store route and the
// background cron. Idempotent thanks to the UNIQUE constraint on
// (station_id, element, last_update) — replaying a cycle with no new
// upstream readings is a no-op.

import { fetchPmd, VALID_ELEMENTS } from './pmd.js';
import { pool } from './db.js';

export async function storeElement(element) {
  const data = await fetchPmd(element);
  const stations = Array.isArray(data?.stations) ? data.stations : [];
  const fetchedAt = new Date().toISOString();

  if (stations.length === 0) {
    return {
      element,
      serverTime: data?.serverTime ?? null,
      fetchedAt,
      stationsUpserted: 0,
      readingsInserted: 0,
      readingsSkipped: 0,
    };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let stationsUpserted = 0;
    let readingsInserted = 0;

    for (const s of stations) {
      const stationId = Number(s.stationId);
      const lat = Number(s.lat);
      const lon = Number(s.lon);
      if (!Number.isFinite(stationId) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      await client.query(
        `INSERT INTO stations (station_id, station_name, lat, lon, first_seen, last_seen)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         ON CONFLICT (station_id) DO UPDATE
           SET station_name = EXCLUDED.station_name,
               lat = EXCLUDED.lat,
               lon = EXCLUDED.lon,
               last_seen = NOW()`,
        [stationId, s.stationName ?? '', lat, lon],
      );
      stationsUpserted += 1;

      const value = s.value == null || s.value === '' ? null : Number(s.value);
      // Always store under the canonical element we requested. The upstream
      // labels per-station readings inconsistently (e.g. requesting
      // "Compact GAS State (WPs)" returns stations tagged "Battery Voltage";
      // "Istantaneous Flow" comes back as "Istantaneous flow"), which would
      // otherwise orphan the rows from the frontend's lookups.
      const insert = await client.query(
        `INSERT INTO station_readings (station_id, element, value, unit, last_update)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (station_id, element, last_update) DO NOTHING
         RETURNING id`,
        [
          stationId,
          element,
          Number.isFinite(value) ? value : null,
          s.unit ?? null,
          s.lastUpdate ?? null,
        ],
      );
      if (insert.rowCount > 0) readingsInserted += 1;
    }

    await client.query('COMMIT');

    return {
      element,
      serverTime: data?.serverTime ?? null,
      fetchedAt,
      stationsUpserted,
      readingsInserted,
      readingsSkipped: stations.length - readingsInserted,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function storeAllElements() {
  const results = [];
  for (const element of VALID_ELEMENTS) {
    try {
      results.push(await storeElement(element));
    } catch (err) {
      results.push({ element, error: err.message });
    }
  }
  return results;
}
