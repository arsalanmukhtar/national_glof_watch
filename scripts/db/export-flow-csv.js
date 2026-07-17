#!/usr/bin/env node
// export-flow-csv.js
//
// One-shot data export for the four flow parameters, scoped to
// stations that fall inside Gilgit Baltistan. Window is fixed to
// "yesterday (local midnight) → now".
//
// Produces (under exports/ at repo root):
//   • one CSV per parameter                      —  4 files
//   • one combined XLSX with one sheet per param  —  1 file
//
// Each row carries station identity, geographic + admin context,
// value, unit, state classification, and both timestamps
// (last_update from the sensor + fetched_at from the ingest cron).
//
// Usage (repo root):
//   node scripts/db/export-flow-csv.js

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { pool } from '../../server/lib/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXPORTS_DIR = path.resolve(__dirname, '../../exports');

// The four flow parameters visible in the parameter selector.
// Names must match `station_elements.element_name` verbatim, which
// is also the value stored in `station_readings.element`.
const PARAMETERS = [
  'Cumulative Flow',
  'Index Flow Speed',
  'Instantaneous Flow',
  'Mean Flow Rate',
];

const CSV_COLUMNS = [
  'station_id',
  'station_name',
  'district',
  'division',
  'province',
  'latitude',
  'longitude',
  'parameter',
  'value',
  'unit',
  'state_id',
  'element_id',
  'last_update',
  'fetched_at',
];

// Start of yesterday in the machine's local timezone. Backend
// timestamps are stored without tz (`TIMESTAMP`) and written from
// the same machine, so local midnight is the intended anchor.
function windowStart() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmtCell(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function toCSV(rows) {
  const header = CSV_COLUMNS.join(',');
  const body = rows
    .map((r) =>
      CSV_COLUMNS.map((k) => {
        const s = fmtCell(r[k]);
        // Quote anything with comma / quote / newline; double any
        // embedded quotes per RFC 4180.
        return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(','),
    )
    .join('\n');
  return `${header}\n${body}\n`;
}

async function fetchParameter(parameter, since) {
  const { rows } = await pool.query(
    `
    WITH gb_stations AS (
      -- Every PMD station whose lat/lon falls inside a district
      -- polygon tagged as Gilgit Baltistan. DISTINCT because a
      -- station on a district boundary can (rarely) match two
      -- polygons.
      SELECT DISTINCT ON (s.station_id)
             s.station_id,
             s.station_name,
             s.lat,
             s.lon,
             INITCAP(d.districts) AS district,
             INITCAP(d.division)  AS division,
             INITCAP(d.province)  AS province
      FROM stations s
      JOIN secondary.district_boundary d
        ON ST_Contains(d.geom, ST_SetSRID(ST_MakePoint(s.lon, s.lat), 4326))
      WHERE UPPER(d.province) = 'GILGIT BALTISTAN'
      ORDER BY s.station_id, d.districts
    ),
    station_unit AS (
      -- Fallback unit source when the reading row doesn't carry one
      -- (legacy EWS rows have unit=NULL). Take the most-recently-seen
      -- catalog entry per (station, element_name).
      SELECT DISTINCT ON (station_id)
             station_id, meas_unit
      FROM station_elements
      WHERE element_name = $1
      ORDER BY station_id, last_seen DESC
    )
    SELECT
      gs.station_id,
      gs.station_name,
      gs.district,
      gs.division,
      gs.province,
      gs.lat AS latitude,
      gs.lon AS longitude,
      sr.element AS parameter,
      sr.value,
      COALESCE(sr.unit, su.meas_unit) AS unit,
      sr.state_id,
      sr.element_id,
      sr.last_update,
      sr.fetched_at
    FROM gb_stations gs
    JOIN station_readings sr ON sr.station_id = gs.station_id
    LEFT JOIN station_unit  su ON su.station_id = gs.station_id
    WHERE sr.element = $1
      AND sr.last_update >= $2
    ORDER BY gs.station_name, sr.last_update
    `,
    [parameter, since],
  );
  return rows;
}

// XLSX sheet cells serialise Date as ISO by default; explicit
// conversion here keeps the CSV and XLSX outputs byte-identical
// on the timestamp columns.
function rowsForXlsx(rows) {
  return rows.map((r) => {
    const out = {};
    for (const k of CSV_COLUMNS) out[k] = fmtCell(r[k]);
    return out;
  });
}

async function main() {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
  const since = windowStart();
  const now = new Date();
  const stamp = now
    .toISOString()
    .slice(0, 16)
    .replace(/[T:]/g, '-'); // e.g. 2026-07-16-13-30

  console.log('[export-flow-csv] Gilgit Baltistan flow parameters');
  console.log(`  window:  ${since.toISOString()}  ->  ${now.toISOString()}`);
  console.log(`  target:  ${EXPORTS_DIR}`);
  console.log(`  stamp:   ${stamp}\n`);

  const wb = XLSX.utils.book_new();
  const summary = [];

  for (const parameter of PARAMETERS) {
    const rows = await fetchParameter(parameter, since);
    const distinctStations = new Set(rows.map((r) => r.station_id)).size;

    // Per-parameter CSV.
    const slug = parameter.toLowerCase().replace(/\s+/g, '_');
    const csvPath = path.join(EXPORTS_DIR, `gb_${slug}_${stamp}.csv`);
    fs.writeFileSync(csvPath, toCSV(rows), 'utf8');

    // XLSX sheet — sheet names must be <=31 chars, no [ ] : \ / ? *.
    const sheetName = parameter.slice(0, 31);
    const ws = XLSX.utils.json_to_sheet(rowsForXlsx(rows), {
      header: CSV_COLUMNS,
    });
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    summary.push({
      parameter,
      stations: distinctStations,
      rows: rows.length,
      csv: path.basename(csvPath),
    });
    console.log(
      `  ${parameter.padEnd(20)}  ${String(distinctStations).padStart(3)} stations,  ${String(rows.length).padStart(5)} rows  ->  ${path.basename(csvPath)}`,
    );
  }

  const xlsxPath = path.join(EXPORTS_DIR, `gb_flow_parameters_${stamp}.xlsx`);
  XLSX.writeFile(wb, xlsxPath);
  console.log(`\n  combined workbook  ->  ${path.basename(xlsxPath)}\n`);

  console.log('[export-flow-csv] done.');
  await pool.end();
}

main().catch(async (err) => {
  console.error('[export-flow-csv] failed:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
