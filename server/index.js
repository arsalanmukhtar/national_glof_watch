import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { parametersRouter } from './routes/parameters.js';
import { secondaryRouter } from './routes/secondary.js';
import { uploadRouter } from './routes/upload.js';
import { ensureSchema, pool } from './lib/db.js';
import { storeAllElements } from './lib/store.js';

const app = express();
const PORT = Number(process.env.PORT ?? 3001);

// Cron cadence for the auto-fetch cycle. 10-minute default gives dense
// enough samples for hourly/daily averages on the trend chart; the DB's
// UNIQUE(station_id, element, last_update) constraint dedupes any repeats
// when a sensor's lastUpdate hasn't advanced between fetches.
const STORE_INTERVAL_MIN = Number(process.env.STORE_INTERVAL_MIN ?? 10);
const STORE_INTERVAL_MS = Math.max(1, STORE_INTERVAL_MIN) * 60 * 1000;

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

async function runStoreCycle(reason = 'scheduled') {
  const at = new Date().toISOString();
  console.log(`[cron] ${reason} cycle @ ${at}`);
  try {
    const results = await storeAllElements();
    for (const r of results) {
      if (r.error) console.error(`  [${r.element}] ERROR: ${r.error}`);
      else
        console.log(
          `  [${r.element}] +${r.readingsInserted} new / ${r.readingsSkipped} dedup, stations=${r.stationsUpserted}`,
        );
    }
  } catch (err) {
    console.error('[cron] cycle failed:', err);
  }
}

ensureSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[server] listening on http://localhost:${PORT}`);
      console.log(`[server] auto-store every ${STORE_INTERVAL_MIN} min`);
      // Initial store on startup (delayed so the listen log lands first)
      setTimeout(() => {
        runStoreCycle('initial');
        setInterval(() => runStoreCycle('scheduled'), STORE_INTERVAL_MS);
      }, 2000);
    });
  })
  .catch((err) => {
    console.error('[server] schema setup failed:', err);
    process.exit(1);
  });
