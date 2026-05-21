#!/usr/bin/env node
// seed-station-elements.js
//
// One-time / monthly discovery: sweeps the whole PMD network via the
// Datascape v3 API and populates `station_elements` (the element catalog)
// and `element_thresholds` (the decoded alert bands). Also refreshes
// stations.lat/lon from the v3 element detail.
//
// This is a heavy batch (~one detail call per element network-wide) and
// takes several minutes. Run it once before the new /api/parameters
// routes go live, then monthly (the server also schedules it).
//
// Usage (repo root):
//   node scripts/db/seed-station-elements.js
//   npm run db:seed-elements
//
// Env: reads PG_* and DATASCAPE_* from the root .env via dotenv.

import 'dotenv/config';
import { ensureSchema, pool } from '../../server/lib/db.js';
import { refreshAllThresholds } from '../../server/lib/thresholds.js';

async function main() {
  console.log('[seed-station-elements] ensuring schema...');
  await ensureSchema();

  console.log(
    '[seed-station-elements] sweeping Datascape v3 for elements + thresholds',
  );
  console.log('  (heavy network batch — expect several minutes)\n');

  const result = await refreshAllThresholds((done, total, station) => {
    if (done % 25 === 0 || done === total) {
      console.log(`  [${done}/${total}] swept (last station ${station.stationId})`);
    }
  });

  const { rows: nameRow } = await pool.query(
    'SELECT COUNT(DISTINCT element_name)::int AS n FROM station_elements',
  );

  console.log('\n[seed-station-elements] done');
  console.log(`  stations swept        : ${result.stationCount}`);
  console.log(`  element rows upserted : ${result.elementCount}`);
  console.log(`  distinct element names: ${nameRow[0].n}`);
  console.log(`  threshold rows        : ${result.thresholdsUpserted}`);
  console.log(`  errors                : ${result.errorCount}`);
  for (const e of result.errors.slice(0, 10)) {
    console.log(`    station ${e.stationId}: ${e.error}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error('[seed-station-elements] FAILED:', err);
  process.exit(1);
});
