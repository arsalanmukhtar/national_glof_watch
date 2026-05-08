// ---------------------------------------------------------------------------
// Local raster catalog. Lists `.tif` / `.tiff` files in the configured
// directory (env `RASTER_DIR`, default `data/rasters/`) and serves the
// raw bytes on demand.
//
// Phase 1 = discovery only (this file). Phase 2 will add metadata
// extraction (bounds, CRS, band stats) and, optionally, on-the-fly
// reprojection for the map renderer.
// ---------------------------------------------------------------------------

import { Router } from 'express';
import { promises as fs } from 'node:fs';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

export const rastersRouter = Router();

// Per-file upload cap. Anything larger should land on the host
// directly via SCP / shared mount — pushing >500 MB through the
// browser is a UX trap (long uploads with no resume).
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

const PROJECT_ROOT = path.resolve(process.cwd());
const DEFAULT_DIR = path.join(PROJECT_ROOT, 'data', 'rasters');
const RASTER_DIR = path.resolve(process.env.RASTER_DIR ?? DEFAULT_DIR);

// Patterns we try, in order, for "did this filename embed a date?".
// First match wins. Anything outside this list returns `null` and the
// frontend falls back to mtime for ordering.
const FILENAME_DATE_PATTERNS = [
  // ISO: 2024-06-15 or 2024_06_15
  { re: /(\d{4})[-_](\d{2})[-_](\d{2})/, build: (m) => `${m[1]}-${m[2]}-${m[3]}` },
  // Compact: 20240615
  { re: /(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/, build: (m) => `${m[1]}-${m[2]}-${m[3]}` },
  // Year-month: 2024-06
  { re: /(\d{4})[-_](\d{2})(?!\d)/, build: (m) => `${m[1]}-${m[2]}-01` },
  // Year only: at a word boundary so "USGS3DEP" doesn't snag "3DEP"
  { re: /(?:^|[^\d])(\d{4})(?:$|[^\d])/, build: (m) => `${m[1]}-01-01` },
];

function parseDateFromName(name) {
  for (const { re, build } of FILENAME_DATE_PATTERNS) {
    const m = name.match(re);
    if (!m) continue;
    const iso = build(m);
    const d = new Date(`${iso}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) return iso;
  }
  return null;
}

// Defence-in-depth: every served filename must (a) come straight from
// our listing, and (b) resolve back inside RASTER_DIR. Anything else
// (`../etc/passwd`, absolute paths, symlink escapes) gets a 400.
function safeResolve(name) {
  if (!name || typeof name !== 'string') return null;
  if (name.includes('\0')) return null;
  const joined = path.join(RASTER_DIR, name);
  const resolved = path.resolve(joined);
  const root = path.resolve(RASTER_DIR);
  if (!(resolved === root || resolved.startsWith(root + path.sep))) return null;
  return resolved;
}

async function ensureDir() {
  try {
    await fs.mkdir(RASTER_DIR, { recursive: true });
  } catch {
    /* let the read paths surface the error */
  }
}

// GET /api/rasters
//   → { dir, files: [{ name, size, mtime, parsedDate }] }
//
// Only `.tif` / `.tiff` files at the top level are surfaced — keep the
// listing flat for now so the panel UX doesn't have to handle nesting.
rastersRouter.get('/', async (_req, res) => {
  try {
    await ensureDir();
    const entries = await fs.readdir(RASTER_DIR, { withFileTypes: true });
    const files = [];
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const lower = ent.name.toLowerCase();
      if (!(lower.endsWith('.tif') || lower.endsWith('.tiff'))) continue;
      const stat = await fs.stat(path.join(RASTER_DIR, ent.name));
      files.push({
        name: ent.name,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        parsedDate: parseDateFromName(ent.name),
      });
    }
    // Default sort: parsedDate ascending where present, name otherwise.
    files.sort((a, b) => {
      const da = a.parsedDate ?? '';
      const db = b.parsedDate ?? '';
      if (da && db) return da.localeCompare(db);
      if (da) return -1;
      if (db) return 1;
      return a.name.localeCompare(b.name);
    });
    res.json({ dir: RASTER_DIR, files });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to list rasters' });
  }
});

// POST /api/rasters/upload?name=<filename>
//
// Raw binary upload (`Content-Type: application/octet-stream`). The
// browser sets the body to the File contents directly, so we stream
// req → disk without buffering. An existing file with the same name is
// overwritten — same-name re-upload is read as "the user means to
// replace the previous version".
rastersRouter.post('/upload', async (req, res) => {
  const rawName = String(req.query.name || '').trim();
  if (!rawName) return res.status(400).json({ error: 'Missing ?name' });
  // Strip path components — never trust the client to set directories.
  const baseName = path.basename(rawName);
  if (!/\.tiff?$/i.test(baseName)) {
    return res.status(400).json({ error: 'Only .tif / .tiff files accepted' });
  }
  const resolved = safeResolve(baseName);
  if (!resolved) return res.status(400).json({ error: 'Invalid filename' });

  await ensureDir();

  // Track byte count and tear the connection down on overflow so the
  // attacker can't fill disk with an open-ended POST.
  let bytes = 0;
  let aborted = false;
  req.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > MAX_UPLOAD_BYTES) {
      aborted = true;
      req.destroy(new Error('upload-too-large'));
    }
  });

  try {
    await pipeline(req, createWriteStream(resolved));
    if (aborted) {
      await fs.unlink(resolved).catch(() => {});
      return res.status(413).json({ error: 'Upload exceeds 500 MB cap' });
    }
    const stat = await fs.stat(resolved);
    res.json({
      name: baseName,
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      parsedDate: parseDateFromName(baseName),
    });
  } catch (err) {
    // Best-effort cleanup of a half-written file.
    await fs.unlink(resolved).catch(() => {});
    if (aborted) {
      return res.status(413).json({ error: 'Upload exceeds 500 MB cap' });
    }
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

// DELETE /api/rasters/file/:name
//
// Removes a file from the catalog. Same path-traversal guard as the
// reader; missing-file → 404 so the panel can show a stale-state
// message instead of swallowing the click silently.
rastersRouter.delete('/file/:name', async (req, res) => {
  const resolved = safeResolve(req.params.name);
  if (!resolved) return res.status(400).json({ error: 'Invalid filename' });
  try {
    await fs.unlink(resolved);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'Not found' });
    }
    res.status(500).json({ error: err.message || 'Delete failed' });
  }
});

// GET /api/rasters/file/:name
//   → raw TIFF bytes, with Content-Type / Content-Length set so the
//     frontend (geotiff.js) can stream-decode without extra round-trips.
rastersRouter.get('/file/:name', async (req, res) => {
  const resolved = safeResolve(req.params.name);
  if (!resolved) return res.status(400).json({ error: 'Invalid filename' });
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) return res.status(404).json({ error: 'Not a file' });
    res.set('Content-Type', 'image/tiff');
    res.set('Content-Length', String(stat.size));
    // Files in data/rasters/ get rewritten in place when overviews
    // are embedded (scripts/python/generate_pyramids.py) or when a
    // user re-uploads the same name. Browser caching here masks
    // those changes — the user re-adds the file, the browser serves
    // the pre-pyramid bytes from cache, and the decoder hits the
    // same "too large to render" error. no-store sidesteps the
    // entire cache layer; mtime/ETag-based revalidation would also
    // work but is overkill for a dev-time pipeline.
    res.set('Cache-Control', 'no-store');
    createReadStream(resolved).pipe(res);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'Not found' });
    }
    res.status(500).json({ error: err.message || 'Read failed' });
  }
});
