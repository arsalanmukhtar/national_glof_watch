#!/usr/bin/env node
// seed-station-photos.js
//
// Loads `data/csv/station_photos.json` into the `station_photos` table.
// Idempotent — the row's natural key is (station_id, filename), so
// re-running updates the URL and position without piling duplicates.
//
// Usage (repo root):
//   node scripts/db/seed-station-photos.js
//
// Env: reads PG_HOST / PG_PORT / PG_DATABASE / PG_USER / PG_PASSWORD
// from the root .env via dotenv, matching the server/index.js pattern.

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import pg from 'pg';

const { Pool } = pg;

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const photosPath = join(repoRoot, 'data', 'csv', 'station_photos.json');

async function main() {
  const raw = await readFile(photosPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.data)) {
    throw new Error(
      `Expected { data: [...] } at ${photosPath}, got: ${typeof parsed.data}`,
    );
  }

  const pool = new Pool({
    host: process.env.PG_HOST,
    port: Number(process.env.PG_PORT ?? 5432),
    database: process.env.PG_DATABASE,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
  });

  // Make sure the table exists before seeding — keeps the script
  // standalone so it can run before the Express boot script does.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS station_photos (
      id         BIGSERIAL PRIMARY KEY,
      station_id BIGINT NOT NULL,
      filename   TEXT NOT NULL,
      url        TEXT NOT NULL,
      position   INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_station_photo UNIQUE (station_id, filename)
    );
    CREATE INDEX IF NOT EXISTS idx_station_photos_station
      ON station_photos(station_id, position);
  `);

  const client = await pool.connect();
  let inserted = 0;
  let updated = 0;
  let stationsSeen = 0;
  let stationsWithPhotos = 0;

  try {
    await client.query('BEGIN');

    for (const entry of parsed.data) {
      stationsSeen++;
      const stationId = Number(entry.stationId);
      if (!Number.isFinite(stationId)) continue;
      const photos = Array.isArray(entry.data) ? entry.data : [];
      if (photos.length === 0) continue;
      stationsWithPhotos++;

      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        if (!photo?.filename || !photo?.url) continue;

        const result = await client.query(
          `INSERT INTO station_photos (station_id, filename, url, position)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (station_id, filename)
             DO UPDATE SET url = EXCLUDED.url, position = EXCLUDED.position
             WHERE station_photos.url <> EXCLUDED.url
                OR station_photos.position <> EXCLUDED.position
           RETURNING (xmax = 0) AS inserted`,
          [stationId, photo.filename, photo.url, i],
        );
        if (result.rows[0]?.inserted) inserted++;
        else updated++;
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const { rows: countRow } = await pool.query(
    'SELECT COUNT(*)::int AS total FROM station_photos',
  );

  console.log('[seed-station-photos] done');
  console.log(`  stations in JSON          : ${stationsSeen}`);
  console.log(`  stations with photos      : ${stationsWithPhotos}`);
  console.log(`  rows inserted             : ${inserted}`);
  console.log(`  rows updated/unchanged    : ${updated}`);
  console.log(`  station_photos row count  : ${countRow[0].total}`);

  await pool.end();
}

main().catch((err) => {
  console.error('[seed-station-photos] FAILED:', err);
  process.exit(1);
});
