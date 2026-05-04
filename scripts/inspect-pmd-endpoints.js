#!/usr/bin/env node
// Probe the PMD EWS station endpoints and print a normalized GeoJSON
// FeatureCollection per element (one HTTP call per element).
//
// Usage:
//   node scripts/inspect-pmd-endpoints.js                # full GeoJSON to stdout
//   node scripts/inspect-pmd-endpoints.js --summary      # skip GeoJSON dump, show shape only
//   node scripts/inspect-pmd-endpoints.js --out tmp/pmd  # also write per-element .geojson files
//
// The endpoint serves JSON over HTTPS with a self-signed / private-CA cert,
// so this script forces NODE_TLS_REJECT_UNAUTHORIZED=0 for inspection only.
// Do NOT reuse that flag in production — wire the proxy through the backend
// or import the proper CA cert.

import { argv, env, exit } from 'node:process';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// ---------- config ----------
const BASE_URL = 'https://115.186.56.181/ews/classes/stations.php';
const ELEMENTS = [
  'Air Temperature',
  'Total Rain',
  'Water Level',
  'Compact GAS State (WPs)',
  'Istantaneous Flow', // endpoint preserves this misspelling
];
const TIMEOUT_MS = 20000;

// ---------- args ----------
function takeFlag(name, list) {
  const i = list.indexOf(name);
  return i >= 0 ? list[i + 1] ?? null : null;
}
const args = argv.slice(2);
const outDir = takeFlag('--out', args);
const summaryOnly = args.includes('--summary');

if (!env.NODE_TLS_REJECT_UNAUTHORIZED) {
  env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  console.warn('[warn] NODE_TLS_REJECT_UNAUTHORIZED=0 (self-signed cert tolerated for inspection).');
}

// ---------- shape detection ----------
const LAT_KEYS = ['lat', 'latitude', 'Latitude', 'LAT', 'Y', 'y'];
const LNG_KEYS = ['lng', 'lon', 'long', 'longitude', 'Longitude', 'LNG', 'LON', 'LONG', 'X', 'x'];

function pickCoord(obj, keys) {
  for (const k of keys) {
    if (obj[k] == null) continue;
    const n = Number(obj[k]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toFeature(row) {
  if (!row || typeof row !== 'object') return null;
  let lat = pickCoord(row, LAT_KEYS);
  let lng = pickCoord(row, LNG_KEYS);
  if (lat == null || lng == null) return null;
  // Heuristic: catch swapped values. Pakistan: lng 60..78, lat 23..38.
  if (Math.abs(lat) > 60 && Math.abs(lng) < 60) [lat, lng] = [lng, lat];
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: { ...row },
  };
}

function extractRows(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    for (const k of ['data', 'stations', 'rows', 'result', 'results', 'records', 'items']) {
      if (Array.isArray(parsed[k])) return parsed[k];
    }
    if (Array.isArray(parsed.features)) {
      return parsed.features.map((f) => ({
        ...(f.properties ?? {}),
        _geometry: f.geometry,
      }));
    }
  }
  return null;
}

function buildUrl(element) {
  const u = new URL(BASE_URL);
  u.searchParams.set('element', element);
  u.searchParams.set('_', Date.now().toString());
  return u.toString();
}

function fileSafe(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// ---------- probe ----------
async function probe(element) {
  const url = buildUrl(element);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const start = performance.now();
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    const body = await res.text();
    let parsed = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      /* leave null */
    }
    return {
      element,
      url,
      ms: Math.round(performance.now() - start),
      status: res.status,
      type: res.headers.get('content-type') ?? '',
      bytes: body.length,
      body,
      parsed,
    };
  } catch (err) {
    return {
      element,
      url,
      ms: Math.round(performance.now() - start),
      error: err.message ?? String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- main ----------
async function main() {
  if (outDir) await mkdir(outDir, { recursive: true });

  for (const element of ELEMENTS) {
    const r = await probe(element);
    const sep = '─'.repeat(78);
    console.log(`\n${sep}\n[${element}]`);
    console.log(`  URL    ${r.url}`);
    console.log(`  ms     ${r.ms}`);

    if (r.error) {
      console.log(`  ERROR  ${r.error}`);
      continue;
    }
    console.log(`  HTTP   ${r.status}`);
    console.log(`  Type   ${r.type || '(unset)'}`);
    console.log(`  Bytes  ${r.bytes}`);

    if (!r.parsed) {
      console.log('  Body   not JSON; first 400 chars:');
      console.log('  ' + r.body.slice(0, 400).replace(/\n/g, '\n  '));
      continue;
    }

    const rows = extractRows(r.parsed);
    if (!rows) {
      const keys = Object.keys(r.parsed).slice(0, 12).join(', ');
      console.log(`  Shape  object — top-level keys: ${keys}`);
      console.log('  (no array of rows detected; cannot build FeatureCollection)');
      continue;
    }

    const features = rows.map(toFeature).filter(Boolean);
    const fc = { type: 'FeatureCollection', features };
    console.log(`  Rows   ${rows.length}`);
    console.log(`  Coords ${features.length}/${rows.length} usable`);
    console.log(
      `  Keys   ${rows[0] ? Object.keys(rows[0]).join(', ') : '(empty)'}`,
    );

    if (outDir) {
      const file = join(outDir, `${fileSafe(element)}.geojson`);
      await writeFile(file, JSON.stringify(fc, null, 2));
      console.log(`  Wrote  ${file}`);
    }

    if (!summaryOnly) {
      console.log('  GeoJSON:');
      const indented = JSON.stringify(fc, null, 2)
        .split('\n')
        .map((l) => '    ' + l)
        .join('\n');
      console.log(indented);
    }
  }
}

main().catch((e) => {
  console.error(e);
  exit(1);
});
