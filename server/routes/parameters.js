import { Router } from 'express';
import { fetchPmd, toGeoJSON, VALID_ELEMENTS, isValidElement } from '../lib/pmd.js';
import { storeElement, storeAllElements } from '../lib/store.js';
import { pool } from '../lib/db.js';

export const parametersRouter = Router();

// GET /api/parameters
// Lists the supported PMD element names for the frontend.
parametersRouter.get('/', (_req, res) => {
  res.json({ elements: VALID_ELEMENTS });
});

// GET /api/parameters/status
// Returns the most recent fetched_at + station count per element from the DB.
// Used by the frontend to show "Last updated X ago" labels.
parametersRouter.get('/status', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT element,
              MAX(fetched_at)            AS last_fetched_at,
              COUNT(DISTINCT station_id) AS station_count
         FROM station_readings
        GROUP BY element`,
    );

    const map = Object.fromEntries(
      VALID_ELEMENTS.map((el) => [el, { lastFetchedAt: null, stationCount: 0 }]),
    );
    for (const row of result.rows) {
      map[row.element] = {
        lastFetchedAt: row.last_fetched_at?.toISOString?.() ?? row.last_fetched_at,
        stationCount: Number(row.station_count) || 0,
      };
    }
    res.json(map);
  } catch (err) {
    console.error('[GET status]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/parameters/:element/latest
// DB-backed: latest reading per station for the given element, as GeoJSON.
// This is what the map renders — drains from local DB so we don't hit PMD
// upstream on every parameter click.
parametersRouter.get('/:element/latest', async (req, res) => {
  const element = decodeURIComponent(req.params.element);
  if (!isValidElement(element)) {
    return res.status(400).json({ error: `Unknown element: ${element}` });
  }
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (sr.station_id)
              s.station_id,
              s.station_name,
              s.lat,
              s.lon,
              sr.element,
              sr.value,
              sr.unit,
              sr.last_update,
              sr.fetched_at
         FROM station_readings sr
         JOIN stations s ON s.station_id = sr.station_id
        WHERE sr.element = $1
        ORDER BY sr.station_id, sr.last_update DESC NULLS LAST`,
      [element],
    );

    res.json({
      type: 'FeatureCollection',
      metadata: { element, count: rows.length, source: 'db' },
      features: rows.map((r) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [Number(r.lon), Number(r.lat)] },
        properties: {
          stationId: Number(r.station_id),
          stationName: r.station_name,
          element: r.element,
          value: r.value,
          unit: r.unit,
          lastUpdate: r.last_update?.toISOString?.() ?? r.last_update,
          fetchedAt: r.fetched_at?.toISOString?.() ?? r.fetched_at,
        },
      })),
    });
  } catch (err) {
    console.error('[GET latest]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/parameters/:element/geojson
// Fetch live data from PMD for one element, return as GeoJSON FeatureCollection.
parametersRouter.get('/:element/geojson', async (req, res) => {
  const element = decodeURIComponent(req.params.element);
  if (!isValidElement(element)) {
    return res.status(400).json({ error: `Unknown element: ${element}` });
  }
  try {
    const data = await fetchPmd(element);
    res.json(toGeoJSON(data, element));
  } catch (err) {
    console.error('[GET geojson]', err);
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// GET /api/parameters/:element/stations/:stationId/trend?days=N
// Returns raw station_readings rows over the last N days for one station +
// element — no aggregation. PMD writes every ~10 minutes, so the response
// is the full point cloud. `?days=` defaults to 1 and caps at 365 to keep
// a typo from pulling years of rows.
parametersRouter.get(
  '/:element/stations/:stationId/trend',
  async (req, res) => {
    const element = decodeURIComponent(req.params.element);
    if (!isValidElement(element)) {
      return res.status(400).json({ error: `Unknown element: ${element}` });
    }
    const stationId = Number(req.params.stationId);
    if (!Number.isFinite(stationId)) {
      return res.status(400).json({ error: 'Invalid stationId' });
    }

    const requested = Number(req.query.days);
    const days =
      Number.isFinite(requested) && requested > 0 && requested <= 365
        ? Math.floor(requested)
        : 1;
    const interval = `${days} days`;

    try {
      const { rows } = await pool.query(
        `SELECT last_update AS ts, value
           FROM station_readings
          WHERE station_id = $1
            AND element    = $2
            AND last_update IS NOT NULL
            AND last_update >= NOW() - $3::interval
          ORDER BY last_update ASC`,
        [stationId, element, interval],
      );

      res.json({
        element,
        stationId,
        days,
        points: rows.map((r) => ({
          ts: r.ts?.toISOString?.() ?? r.ts,
          value: r.value == null ? null : Number(r.value),
        })),
      });
    } catch (err) {
      console.error('[GET trend]', err);
      res.status(500).json({ error: err.message });
    }
  },
);

// POST /api/parameters/:element/store
// Fetch live data from PMD and persist to the database.
parametersRouter.post('/:element/store', async (req, res) => {
  const element = decodeURIComponent(req.params.element);
  if (!isValidElement(element)) {
    return res.status(400).json({ error: `Unknown element: ${element}` });
  }
  try {
    const result = await storeElement(element);
    res.json(result);
  } catch (err) {
    console.error('[POST store]', err);
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// POST /api/parameters/refresh-all
// Trigger an immediate fetch+store for every element (mirrors the cron cycle).
parametersRouter.post('/refresh-all', async (_req, res) => {
  try {
    const results = await storeAllElements();
    res.json({ runAt: new Date().toISOString(), results });
  } catch (err) {
    console.error('[POST refresh-all]', err);
    res.status(500).json({ error: err.message });
  }
});
