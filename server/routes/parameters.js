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
