import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { parametersRouter } from './routes/parameters.js';
import { secondaryRouter } from './routes/secondary.js';
import { uploadRouter } from './routes/upload.js';
import { dbRouter } from './routes/db.js';
import { gisRouter } from './routes/gis.js';
import { regionRouter } from './routes/region.js';
import { csvRouter } from './routes/csv.js';
import { rastersRouter } from './routes/rasters.js';
import { ensureSchema, pool } from './lib/db.js';
import { storeAllStations } from './lib/store.js';
import { refreshAllThresholds } from './lib/thresholds.js';

const app = express();
const PORT = Number(process.env.PORT ?? 3001);

// Cron cadence for the auto-fetch cycle. 10-minute default gives dense
// enough samples for hourly/daily averages on the trend chart; the DB's
// UNIQUE(station_id, element, last_update) constraint dedupes any repeats
// when a sensor's lastUpdate hasn't advanced between fetches.
const STORE_INTERVAL_MIN = Number(process.env.STORE_INTERVAL_MIN ?? 10);
const STORE_INTERVAL_MS = Math.max(1, STORE_INTERVAL_MIN) * 60 * 1000;

// Threshold (entryCfgs) config changes rarely — sweep it monthly. The
// sweep is a heavy ~thousands-of-calls batch, so it must never overlap
// the value cron's window.
const THRESHOLD_INTERVAL_DAYS = Number(process.env.THRESHOLD_INTERVAL_DAYS ?? 30);
const THRESHOLD_INTERVAL_MS = Math.max(1, THRESHOLD_INTERVAL_DAYS) * 86400 * 1000;

app.use(cors());
// Default 1mb is fine for the parameter API. The /api/upload/import
// endpoint accepts user-uploaded GeoJSON FeatureCollections — those can
// run into the tens of MB for a county-scale shapefile, so the body
// parser needs more headroom for that route specifically.
app.use('/api/upload', express.json({ limit: '100mb' }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'up' });
  } catch (err) {
    res.status(500).json({ ok: false, db: 'down', error: err.message });
  }
});

app.use('/api/parameters', parametersRouter);
app.use('/api/secondary', secondaryRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/db', dbRouter);
app.use('/api/gis', gisRouter);
app.use('/api/region', regionRouter);
app.use('/api/csv', csvRouter);
app.use('/api/rasters', rastersRouter);

// Guard against an overrunning value cycle being re-entered by the next
// scheduled tick — ~279 sequential station calls can run a few minutes.
let storeCycleRunning = false;

async function runStoreCycle(reason = 'scheduled') {
  if (storeCycleRunning) {
    console.log(`[cron] ${reason} cycle skipped — previous still running`);
    return;
  }
  storeCycleRunning = true;
  const at = new Date().toISOString();
  console.log(`[cron] ${reason} value cycle @ ${at}`);
  try {
    const r = await storeAllStations();
    console.log(
      `  stations=${r.stationCount} +${r.totalReadingsInserted} new` +
        ` ~${r.totalReadingsBackfilled} backfilled` +
        `, catalog=${r.totalCatalogUpserted}, skipped=${r.skipped}` +
        `, errors=${r.errorCount}`,
    );
  } catch (err) {
    console.error('[cron] value cycle failed:', err);
  } finally {
    storeCycleRunning = false;
  }
}

let thresholdCycleRunning = false;

async function runThresholdCycle(reason = 'scheduled') {
  if (thresholdCycleRunning) {
    console.log(`[cron] ${reason} threshold cycle skipped — already running`);
    return;
  }
  thresholdCycleRunning = true;
  console.log(`[cron] ${reason} threshold cycle @ ${new Date().toISOString()}`);
  try {
    const r = await refreshAllThresholds();
    console.log(
      `  stations=${r.stationCount}, elements=${r.elementCount}` +
        `, thresholds=${r.thresholdsUpserted}, errors=${r.errorCount}`,
    );
  } catch (err) {
    console.error('[cron] threshold cycle failed:', err);
  } finally {
    thresholdCycleRunning = false;
  }
}

ensureSchema()
  .then(() => {
    app.listen(PORT, async () => {
      console.log(`[server] listening on http://localhost:${PORT}`);
      console.log(`[server] value cron every ${STORE_INTERVAL_MIN} min`);
      console.log(`[server] threshold cron every ${THRESHOLD_INTERVAL_DAYS} days`);

      // Run the threshold sweep at boot only if the table is empty — a
      // normal restart must not trigger the heavy batch every time.
      let thresholdsEmpty = false;
      try {
        const { rows } = await pool.query(
          'SELECT COUNT(*)::int AS n FROM element_thresholds',
        );
        thresholdsEmpty = rows[0].n === 0;
      } catch {
        thresholdsEmpty = false;
      }

      // Initial cycles, delayed so the listen logs land first.
      setTimeout(() => {
        runStoreCycle('initial');
        setInterval(() => runStoreCycle('scheduled'), STORE_INTERVAL_MS);

        if (thresholdsEmpty) {
          console.log('[server] element_thresholds empty — seeding once');
          runThresholdCycle('initial');
        }
        setInterval(() => runThresholdCycle('scheduled'), THRESHOLD_INTERVAL_MS);
      }, 2000);
    });
  })
  .catch((err) => {
    console.error('[server] schema setup failed:', err);
    process.exit(1);
  });
