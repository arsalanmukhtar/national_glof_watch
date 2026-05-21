import { Router } from 'express';
import { Readable } from 'node:stream';
import { fetchStationStatus } from '../lib/pmd.js';
import { stateLabel } from '../lib/datascape.js';
import { storeAllStations } from '../lib/store.js';
import { refreshAllThresholds } from '../lib/thresholds.js';
import { pool } from '../lib/db.js';

export const parametersRouter = Router();

// ---------------------------------------------------------------------------
// Element catalog
// ---------------------------------------------------------------------------
// GET /api/parameters/elements
// The full element catalog discovered network-wide from the Datascape v3
// API — one entry per distinct element NAME, with its unit and how many
// stations carry it. Drives the frontend element selector.
async function listElements(_req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT element_name              AS name,
              MAX(meas_unit)            AS unit,
              COUNT(DISTINCT station_id)::int AS station_count
         FROM station_elements
        GROUP BY element_name
        ORDER BY element_name`,
    );
    res.json({
      elements: rows.map((r) => ({
        name: r.name,
        unit: r.unit ?? '',
        stationCount: r.station_count,
      })),
    });
  } catch (err) {
    console.error('[GET elements]', err);
    res.status(500).json({ error: err.message });
  }
}

parametersRouter.get('/elements', listElements);
// Legacy alias — kept so anything still hitting `GET /` keeps working.
parametersRouter.get('/', listElements);

// GET /api/parameters/status
// Most recent fetched_at + station count per element. Used for the
// "Last updated X ago" labels. Every catalog element appears, even if it
// has no readings yet (LEFT JOIN).
parametersRouter.get('/status', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      // Join on (station_id, element name), NOT element_id: element_id is
      // NULL on every reading written before the v3 migration, so an
      // element_id join silently drops the bulk of the history.
      `SELECT se.element_name                  AS element,
              MAX(sr.fetched_at)               AS last_fetched_at,
              COUNT(DISTINCT sr.station_id)    AS station_count
         FROM station_elements se
         LEFT JOIN station_readings sr
                ON sr.station_id = se.station_id
               AND sr.element    = se.element_name
        GROUP BY se.element_name`,
    );
    const map = {};
    for (const row of rows) {
      map[row.element] = {
        lastFetchedAt:
          row.last_fetched_at?.toISOString?.() ?? row.last_fetched_at,
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
// Live PMD network status (total + active station counts) from the legacy
// EWS status endpoint. Powers the titlebar status badge. Cached 30 s.
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

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------
// In-memory tracker for the heavy threshold sweep so the manual trigger
// can return immediately and the UI can poll for completion.
let thresholdJob = {
  running: false,
  startedAt: null,
  finishedAt: null,
  result: null,
  error: null,
};

// GET /api/parameters/element/:elementId/thresholds
// The decoded alert bands for one element instance (used by the Feature
// Details threshold table).
parametersRouter.get('/element/:elementId/thresholds', async (req, res) => {
  const elementId = Number(req.params.elementId);
  if (!Number.isFinite(elementId)) {
    return res.status(400).json({ error: 'Invalid elementId' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT element_id, element_name, decimals, alarms
         FROM element_thresholds
        WHERE element_id = $1`,
      [elementId],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'No thresholds for this element' });
    }
    const r = rows[0];
    res.set('Cache-Control', 'public, max-age=300');
    res.json({
      elementId: Number(r.element_id),
      elementName: r.element_name,
      decimals: r.decimals,
      alarms: r.alarms ?? [],
    });
  } catch (err) {
    console.error('[GET thresholds]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/parameters/thresholds/status
// Job state + DB coverage, for polling after a manual refresh.
parametersRouter.get('/thresholds/status', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS total, MAX(fetched_at) AS last_fetched_at
         FROM element_thresholds`,
    );
    res.json({
      job: {
        running: thresholdJob.running,
        startedAt: thresholdJob.startedAt,
        finishedAt: thresholdJob.finishedAt,
        result: thresholdJob.result,
        error: thresholdJob.error,
      },
      total: rows[0].total,
      lastFetchedAt:
        rows[0].last_fetched_at?.toISOString?.() ?? rows[0].last_fetched_at,
    });
  } catch (err) {
    console.error('[GET thresholds/status]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/parameters/thresholds/refresh
// Kicks off the network-wide threshold sweep in the background (~thousands
// of upstream calls). Returns 202 immediately; poll /thresholds/status.
parametersRouter.post('/thresholds/refresh', (_req, res) => {
  if (thresholdJob.running) {
    return res.status(409).json({ error: 'Threshold refresh already running' });
  }
  thresholdJob = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    result: null,
    error: null,
  };
  refreshAllThresholds()
    .then((result) => {
      thresholdJob = {
        ...thresholdJob,
        running: false,
        finishedAt: new Date().toISOString(),
        result,
      };
      console.log(
        `[thresholds] manual refresh done: ${result.thresholdsUpserted} rows`,
      );
    })
    .catch((err) => {
      thresholdJob = {
        ...thresholdJob,
        running: false,
        finishedAt: new Date().toISOString(),
        error: err.message,
      };
      console.error('[thresholds] manual refresh failed:', err);
    });
  res.status(202).json({ accepted: true, startedAt: thresholdJob.startedAt });
});

// ---------------------------------------------------------------------------
// Readings
// ---------------------------------------------------------------------------
// GET /api/parameters/:element/latest
// One feature per station that *has* this element (catalog-driven, from
// station_elements), LEFT JOINed to its latest reading. Each feature
// carries `stateId` (PMD's alert classification) which the map colors by.
// A station whose sensor isn't currently reporting comes back with a null
// value/stateId — the frontend renders it as the gray "No data" state
// rather than dropping it, so the station roster stays stable and an
// operator can see which sites have gone silent.
parametersRouter.get('/:element/latest', async (req, res) => {
  const element = decodeURIComponent(req.params.element);
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (se.station_id)
              se.station_id,
              s.station_name,
              s.lat,
              s.lon,
              se.element_id,
              se.element_name AS element,
              se.meas_unit,
              lr.value,
              lr.unit,
              lr.state_id,
              lr.last_update,
              lr.fetched_at
         FROM station_elements se
         JOIN stations s ON s.station_id = se.station_id
         LEFT JOIN LATERAL (
           -- Match on (station_id, element name), NOT element_id: a reading
           -- written before the v3 migration has element_id NULL, so an
           -- element_id join would miss it and the station would show as
           -- "No data" even though its last reading is sitting right here.
           SELECT value, unit, state_id, last_update, fetched_at
             FROM station_readings sr
            WHERE sr.station_id = se.station_id
              AND sr.element    = se.element_name
            ORDER BY sr.last_update DESC NULLS LAST
            LIMIT 1
         ) lr ON true
        WHERE se.element_name = $1
        ORDER BY se.station_id, lr.last_update DESC NULLS LAST`,
      [element],
    );

    res.json({
      type: 'FeatureCollection',
      metadata: { element, count: rows.length, source: 'db' },
      features: rows.map((r) => {
        const stateId = r.state_id == null ? null : Number(r.state_id);
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [Number(r.lon), Number(r.lat)] },
          properties: {
            stationId: Number(r.station_id),
            stationName: r.station_name,
            elementId: r.element_id == null ? null : Number(r.element_id),
            element: r.element,
            value: r.value,
            unit: r.unit ?? r.meas_unit ?? null,
            stateId,
            stateDescr: stateId == null ? null : stateLabel(stateId),
            lastUpdate: r.last_update?.toISOString?.() ?? r.last_update,
            fetchedAt: r.fetched_at?.toISOString?.() ?? r.fetched_at,
          },
        };
      }),
    });
  } catch (err) {
    console.error('[GET latest]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/parameters/:element/stations/:stationId/trend?days=N
// Raw station_readings rows over the last N days for one station+element
// — no aggregation. Keyed on element NAME + station_id so legacy EWS rows
// and new v3 rows merge into one continuous series. `?days=` caps at 365.
parametersRouter.get(
  '/:element/stations/:stationId/trend',
  async (req, res) => {
    const element = decodeURIComponent(req.params.element);
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

// ---------------------------------------------------------------------------
// Station photos
// ---------------------------------------------------------------------------
// GET /api/parameters/stations/:stationId/photos
// Photo catalog for one station — used by the Feature Details "Image
// Catalog" tile. The `url` field is rewritten to the in-house binary
// proxy below so the HTTPS frontend never has to load the HTTP-only PMD
// host directly (mixed-content). Cached 5 min.
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
// Streams a station photo binary through the backend (the PMD host is
// HTTP-only). The upstream URL is looked up from station_photos by
// (station_id, filename) — never an arbitrary client URL, so no SSRF.
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
    const upstream = await fetch(rows[0].url);
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
    res.set('Cache-Control', 'public, max-age=86400, immutable');
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    console.error('[GET station-photo proxy]', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

// ---------------------------------------------------------------------------
// Manual refresh
// ---------------------------------------------------------------------------
// POST /api/parameters/refresh-all
// Runs one full value cycle now (mirrors the 10-min cron).
parametersRouter.post('/refresh-all', async (_req, res) => {
  try {
    const result = await storeAllStations();
    res.json(result);
  } catch (err) {
    console.error('[POST refresh-all]', err);
    res.status(500).json({ error: err.message });
  }
});
