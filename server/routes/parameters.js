import { Router } from 'express';
import { Readable } from 'node:stream';
import {
  fetchPmd,
  fetchStationStatus,
  toGeoJSON,
  VALID_ELEMENTS,
  isValidElement,
} from '../lib/pmd.js';
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

// GET /api/parameters/station-status
// Live PMD network status — total + active station counts plus the
// windowMinutes bucket the upstream uses to decide "active". Cached
// 30 s so the titlebar badge can poll without hammering upstream.
parametersRouter.get('/station-status', async (_req, res) => {
  try {
    const data = await fetchStationStatus();
    res.set('Cache-Control', 'public, max-age=30');
    res.json(data);
  } catch (err) {
    console.error('[GET station-status]', err.message);
    res.status(err.status ?? 500).json({ error: err.message });
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

// GET /api/parameters/stations/:stationId/photos
// Returns the photo catalog for one station — used by the Feature
// Details "Image Catalog" tile to populate its slider modal.
// Cached 5 min because the underlying rows are seeded once and rarely
// updated.
//
// The `url` field is rewritten to point at the in-house binary proxy
// below. The PMD upstream only serves HTTP, so a direct <img src> from
// the HTTPS-fronted Vercel build is blocked as mixed content. Routing
// through `/api/parameters/station-photo` lets the frontend stay
// HTTPS-only end-to-end (Vercel rewrites /api → VM, VM fetches the
// upstream binary over HTTP server-side, browser never sees HTTP).
parametersRouter.get('/stations/:stationId/photos', async (req, res) => {
  const stationId = Number(req.params.stationId);
  if (!Number.isFinite(stationId)) {
    return res.status(400).json({ error: 'Invalid stationId' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT filename, url, position
         FROM station_photos
        WHERE station_id = $1
        ORDER BY position ASC, filename ASC`,
      [stationId],
    );
    res.set('Cache-Control', 'public, max-age=300');
    res.json({
      stationId,
      count: rows.length,
      photos: rows.map((r) => ({
        filename: r.filename,
        position: r.position,
        // Original URL kept for debugging / direct-access fallback,
        // but the frontend should always render `url` (the proxy).
        sourceUrl: r.url,
        url:
          `/api/parameters/station-photo?stationId=${stationId}` +
          `&filename=${encodeURIComponent(r.filename)}`,
      })),
    });
  } catch (err) {
    console.error('[GET station photos]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/parameters/station-photo?stationId=X&filename=Y
// Streams the image binary for one station photo through the backend
// so the browser never has to talk to the HTTP-only PMD host. The
// upstream URL is looked up from `station_photos` by (station_id,
// filename) — we never accept an arbitrary URL from the client, so
// there's no SSRF surface here.
parametersRouter.get('/station-photo', async (req, res) => {
  const stationId = Number(req.query.stationId);
  const filename = String(req.query.filename ?? '');
  if (!Number.isFinite(stationId) || !filename) {
    return res.status(400).json({ error: 'Missing stationId or filename' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT url
         FROM station_photos
        WHERE station_id = $1 AND filename = $2
        LIMIT 1`,
      [stationId, filename],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Photo not found' });
    }
    const upstreamUrl = rows[0].url;
    const upstream = await fetch(upstreamUrl);
    if (!upstream.ok) {
      return res
        .status(upstream.status)
        .json({ error: `Upstream returned ${upstream.status}` });
    }
    res.set(
      'Content-Type',
      upstream.headers.get('content-type') || 'image/jpeg',
    );
    const len = upstream.headers.get('content-length');
    if (len) res.set('Content-Length', len);
    // Photos are effectively immutable — cache aggressively at the
    // browser and any intermediary.
    res.set('Cache-Control', 'public, max-age=86400, immutable');
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    console.error('[GET station-photo proxy]', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
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
