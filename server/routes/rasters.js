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
import {
  createReadStream,
  createWriteStream,
  existsSync,
} from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

export const rastersRouter = Router();

// Per-file upload cap. Anything larger should land on the host
// directly via SCP / shared mount — pushing >500 MB through the
// browser is a UX trap (long uploads with no resume).
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

const PROJECT_ROOT = path.resolve(process.cwd());
const DEFAULT_DIR = path.join(PROJECT_ROOT, 'data', 'rasters');
const RASTER_DIR = path.resolve(process.env.RASTER_DIR ?? DEFAULT_DIR);

// Path to the pyramid-building helper that runs after every successful
// upload. Lives under scripts/python/ — see that script for the
// rasterio-based implementation.
const PYRAMID_SCRIPT = path.join(
  PROJECT_ROOT,
  'scripts',
  'python',
  'generate_pyramids.py',
);

// Resolve the Python interpreter to use for pyramid generation. We
// prefer the project's `.venv` so the user doesn't have to install
// rasterio globally; if that's missing we fall back to whatever
// `python` is on PATH and let the script's own ImportError surface
// the install instructions.
function resolvePythonBin() {
  const winPy = path.join(PROJECT_ROOT, '.venv', 'Scripts', 'python.exe');
  const unixPy = path.join(PROJECT_ROOT, '.venv', 'bin', 'python');
  if (existsSync(winPy)) return winPy;
  if (existsSync(unixPy)) return unixPy;
  return process.platform === 'win32' ? 'python.exe' : 'python';
}

// Track the child process for any pyramid build currently running on
// a given absolute file path. The Python script opens the file via
// `rasterio.open(path, 'r+')` which on Windows takes an exclusive
// handle for the entire (minute-long for big rasters) build — any
// concurrent `fs.rename` onto the same path fails with EPERM. When
// a fresh upload lands on a path that already has a build in flight,
// we kill the prior build (its output is about to be replaced by the
// new bytes anyway) before attempting the rename.
const inFlightPyramids = new Map();

// Run the pyramid script for a single freshly-uploaded file. Resolves
// `{ ok, log }` so the upload handler can include the outcome in its
// JSON response without ever rejecting — a missing rasterio or a
// transient script failure shouldn't fail the upload itself (the
// file is still on disk and renderable, just slower for big rasters).
async function buildPyramidsFor(filePath) {
  return await new Promise((resolve) => {
    const py = resolvePythonBin();
    const proc = spawn(py, [PYRAMID_SCRIPT, filePath], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    inFlightPyramids.set(filePath, proc);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (err) => {
      if (inFlightPyramids.get(filePath) === proc) {
        inFlightPyramids.delete(filePath);
      }
      resolve({ ok: false, log: `spawn failed: ${err.message}` });
    });
    proc.on('close', (code) => {
      // Only clear the slot if we're still the registered build for
      // this path — a newer upload may have killed us and registered
      // its own replacement.
      if (inFlightPyramids.get(filePath) === proc) {
        inFlightPyramids.delete(filePath);
      }
      const log = (stdout + (stderr ? `\nSTDERR:\n${stderr}` : '')).trim();
      resolve({ ok: code === 0, log });
    });
  });
}

// Terminate any pyramid build currently running on `filePath`. On
// Windows, ChildProcess.kill maps to TerminateProcess which releases
// file handles immediately — by the time this returns, fs.rename onto
// the same path is unblocked. Returns true if a build was actually
// killed.
function killInFlightPyramid(filePath) {
  const proc = inFlightPyramids.get(filePath);
  if (!proc) return false;
  try {
    proc.kill();
  } catch {
    /* already dead */
  }
  inFlightPyramids.delete(filePath);
  return true;
}

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

// Atomic replace with Windows-friendly retry + copyFile fallback.
//
// fs.rename on Windows fails with EPERM/EBUSY/EACCES whenever either
// side of the rename is held open without FILE_SHARE_DELETE. Common
// causes we've actually hit here:
//   * Our own WriteStream's file descriptor closing asynchronously
//     after pipeline()'s 'finish' (caller should await 'close', but
//     this retry covers timing slop).
//   * A prior `GET /api/rasters/file/:name` whose read handle the
//     kernel hasn't fully released yet.
//   * Antivirus mid-scan of the freshly written temp file.
//   * Explorer's thumbnail handler.
//
// Most of those clear in well under a second. When they don't, fall
// back to copyFile + unlink — fs.copyFile uses a different share-mode
// check than MoveFileExW(REPLACE_EXISTING) and frequently succeeds in
// cases where rename refuses (notably when the dest is held with
// FILE_SHARE_WRITE but not FILE_SHARE_DELETE).
async function renameWithRetry(from, to) {
  const delays = [25, 50, 100, 200, 400, 800, 1500];
  let lastErr;
  for (let i = 0; i <= delays.length; i++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      lastErr = err;
      const transient =
        err.code === 'EPERM' ||
        err.code === 'EBUSY' ||
        err.code === 'EACCES';
      if (!transient || i === delays.length) break;
      await new Promise((r) => setTimeout(r, delays[i]));
    }
  }

  // All rename retries exhausted; try the copy fallback before giving
  // up. If copy also fails we still surface the original rename error
  // since that's the one we tried first and best describes the lock.
  try {
    await fs.copyFile(from, to);
    await fs.unlink(from).catch(() => {});
    return;
  } catch {
    throw lastErr;
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
  // A multi-hundred-MB upload over a slow link can sit on the socket
  // for many minutes. Node/Express defaults are fine in practice, but
  // some proxies in front impose their own idle timeouts — make the
  // route's intent explicit so nobody up the chain decides to cut the
  // connection mid-stream and surface a bare "Network error" in the
  // browser.
  req.setTimeout(0);
  res.setTimeout(0);

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

  // Atomic write pattern: stream to `<file>.uploading`, rename on
  // success. createWriteStream with 'w' truncates the destination
  // before any bytes arrive — so a half-finished upload over an
  // existing file used to wipe the original (the user's pyramidised
  // raster vanished the moment a re-upload was started). Writing to a
  // temp path and renaming only on success means the real file is
  // never touched until the upload is complete and intact.
  const tempPath = `${resolved}.uploading`;

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
    const ws = createWriteStream(tempPath);
    await pipeline(req, ws);
    // pipeline resolves on the WriteStream's 'finish' event (data
    // flushed to the OS), but the underlying file descriptor closes
    // asynchronously after that. On Windows, renaming a file whose
    // fd is still held — even by our own process — fails with EPERM.
    // Wait for the explicit 'close' so the fd is released before we
    // attempt the rename below.
    if (!ws.closed) {
      await new Promise((resolve) => {
        const done = () => {
          ws.off('close', done);
          ws.off('error', done);
          resolve();
        };
        ws.once('close', done);
        ws.once('error', done);
      });
    }
    if (aborted) {
      await fs.unlink(tempPath).catch(() => {});
      return res.status(413).json({ error: 'Upload exceeds 500 MB cap' });
    }

    // If a previous upload's pyramid build is still running on this
    // path, it has the file open via rasterio's r+ handle and the
    // rename below would fail with EPERM. Kill it first — its output
    // is moot since we're about to overwrite the file with fresh
    // bytes anyway.
    if (killInFlightPyramid(resolved)) {
      console.log(
        `[rasters] cancelled in-flight pyramid build on ${baseName} ` +
          `to make way for re-upload`,
      );
    }

    // Atomic replace of the (possibly pre-existing) destination.
    // fs.rename overwrites on POSIX and on Windows ≥10 via the
    // underlying NTFS replace primitive; see renameWithRetry above
    // for why this needs the Windows-friendly retry wrapper.
    await renameWithRetry(tempPath, resolved);

    // Respond as soon as the bytes are on disk. Building pyramids for
    // a multi-gigapixel raster can take minutes — long enough to trip
    // the HTTP idle/request timeouts in the browser, Vite's proxy, or
    // Node itself (`server.requestTimeout` defaults to 5 min). When
    // any of those drop the socket the XHR surfaces a bare
    // "Network error" with no useful detail. Run the pyramid script
    // in the background so the upload critical path stays under a
    // second once the bytes finish landing. If the user activates a
    // freshly uploaded raster before pyramids are ready, the in-
    // browser decoder already prints a "too large to render — run
    // generate_pyramids.py" hint they can retry on.
    const stat = await fs.stat(resolved);
    res.json({
      name: baseName,
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      parsedDate: parseDateFromName(baseName),
      pyramids: { status: 'building' },
    });

    const pyramidStart = Date.now();
    buildPyramidsFor(resolved)
      .then((pyramid) => {
        const ms = Date.now() - pyramidStart;
        if (!pyramid.ok) {
          console.warn(
            `[rasters] pyramid build failed for ${baseName} (${ms} ms):\n${pyramid.log}`,
          );
        } else {
          console.log(
            `[rasters] pyramid build for ${baseName} ok in ${ms} ms`,
          );
        }
      })
      .catch((err) => {
        console.warn(`[rasters] pyramid build crashed for ${baseName}:`, err);
      });
  } catch (err) {
    // Best-effort cleanup of the temp file. Never touch `resolved` —
    // the previous version of the file (if any) is still intact.
    await fs.unlink(tempPath).catch(() => {});
    console.warn(
      `[rasters] upload failed for ${baseName} after ${bytes} bytes:`,
      err?.message || err,
    );
    if (aborted) {
      return res.status(413).json({ error: 'Upload exceeds 500 MB cap' });
    }
    if (!res.headersSent) {
      const code = err.code || 'UNKNOWN';
      const locked = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
      // Always surface the real error code + message so we don't lose
      // the diagnostic. The hint about uploading-from-data/rasters
      // covers the most common cause we've actually seen — the
      // browser holds the source open while reading bytes, so
      // dragging a file from data/rasters/ to upload it back into
      // data/rasters/ produces a self-conflicting rename.
      const message = locked
        ? `${code}: ${err.message || 'rename blocked'}. ` +
          'If the file you dropped lives inside data/rasters/, copy ' +
          'it to another folder first — the browser holds the source ' +
          'file open while uploading and the server can\'t overwrite ' +
          'the same path.'
        : err.message || 'Upload failed';
      res.status(500).json({ error: message });
    }
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
