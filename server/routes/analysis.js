// ---------------------------------------------------------------------------
// On-demand Sentinel-2 index analysis.
//
// POST /api/analysis/sentinel
//   body { geometry, windowA, windowB?, index, maxCloud? }
//   → spawns scripts/python/sentinel_analysis.py, returns the JSON it
//     emits + rewrites cogPath fields to absolute HTTP URLs the
//     frontend can hand to geotiff-js.
//
// GET /api/analysis/cog/:hash/:name
//   → streams a generated COG from data/rasters/analysis/<hash>/ so
//     the browser raster decoder can read it. Path-traversal-safe:
//     both segments must match a narrow character class.
//
// Results are cached on disk under data/rasters/analysis/<hash>/. The
// hash is a SHA-256 of the request body (geometry, windows, index),
// so re-submitting the same request skips Python entirely.
// ---------------------------------------------------------------------------

import { Router } from 'express';
import { promises as fs } from 'node:fs';
import { createReadStream, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

export const analysisRouter = Router();

const PROJECT_ROOT = path.resolve(process.cwd());
const ANALYSIS_ROOT = path.join(PROJECT_ROOT, 'data', 'rasters', 'analysis');
const SCRIPT_PATH  = path.join(PROJECT_ROOT, 'scripts', 'python', 'sentinel_analysis.py');

// Sentinel-2 STAC / COG reads over the network can occasionally sit for
// tens of seconds when the AWS us-west-2 endpoint is quiet. Give the
// full pipeline a hard ceiling that keeps the frontend from spinning
// forever without cutting off legitimate slow runs.
//
// Budget breakdown observed from Pakistan → us-west-2:
//   • Small single-window (10x10 km, NDVI): ~15 s
//   • Small two-window compare:            ~30 s
//   • ~30 x 44 km two-window compare:      ~60-90 s
//   • Larger multi-band (NDBI/NDSI mix):   push to 120 s
// Cap at 180 s — a two-window compare that doesn't finish in three
// minutes is almost certainly a stuck AWS connection, not real work.
// nginx's proxy_read_timeout is set slightly above this (see
// docker/nginx.conf) so backend always wins the deadline.
const PROCESS_TIMEOUT_MS = 180_000;

const VALID_INDEX  = new Set(['NDVI', 'NDWI', 'NDBI', 'NDSI']);
const VALID_HASH   = /^[a-f0-9]{16}$/;
const VALID_FILE   = /^[A-Za-z0-9_.-]+\.tif$/;

// Pick a Python interpreter. Preference order:
//   1. project venv (dev machines that ran `python -m venv .venv`)
//   2. `python3` (Debian / Docker container — the Dockerfile installs
//      `python3` + `python3-pip`, so this is what runs in production)
//   3. `python` fallback (some minimal Linux distros only expose the
//      unversioned name; Windows `python.exe` if the venv isn't set up)
// The script's imports (pystac-client, shapely) are non-stdlib, so a
// bare interpreter without them will surface an ImportError from
// sentinel_analysis.py's own guard.
function resolvePythonBin() {
  const winPy  = path.join(PROJECT_ROOT, '.venv', 'Scripts', 'python.exe');
  const unixPy = path.join(PROJECT_ROOT, '.venv', 'bin', 'python');
  if (existsSync(winPy))  return winPy;
  if (existsSync(unixPy)) return unixPy;
  if (process.platform === 'win32') return 'python.exe';
  // On Debian / Ubuntu / manylinux the `python` symlink is often
  // absent — python3 is guaranteed on any modern install.
  return 'python3';
}

function hashRequest(body) {
  // Stable hash: JSON.stringify of the keys in a fixed order, hex
  // truncated to 16 chars (64 bits — collision-resistant enough for a
  // per-user cache key and short enough to fit in a directory name).
  const canonical = JSON.stringify({
    geometry: body.geometry,
    windowA:  body.windowA,
    windowB:  body.windowB ?? null,
    index:    body.index,
    maxCloud: Number(body.maxCloud ?? 40),
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

// Rewrite Python-emitted absolute cogPath strings into browser-safe
// URLs served by GET /api/analysis/cog/:hash/:name. The Python side
// writes to <ANALYSIS_ROOT>/<hash>/<name>.tif — we only need to swap
// the prefix for the URL form.
function toCogUrl(hash, cogPath) {
  if (!cogPath) return null;
  const name = path.basename(cogPath);
  return `/api/analysis/cog/${hash}/${name}`;
}

analysisRouter.post('/sentinel', async (req, res) => {
  const body = req.body ?? {};
  const { geometry, windowA, windowB, index } = body;
  const maxCloud = Number(body.maxCloud ?? 40);

  if (!geometry || typeof geometry !== 'object') {
    return res.status(400).json({ error: 'geometry (GeoJSON) is required' });
  }
  if (!windowA || typeof windowA !== 'string') {
    return res.status(400).json({ error: 'windowA is required (YYYY-MM or YYYY-MM-DD/YYYY-MM-DD)' });
  }
  if (!VALID_INDEX.has(index)) {
    return res.status(400).json({ error: `index must be one of ${[...VALID_INDEX].join(', ')}` });
  }
  if (!Number.isFinite(maxCloud) || maxCloud < 0 || maxCloud > 100) {
    return res.status(400).json({ error: 'maxCloud must be a percentage in [0, 100]' });
  }

  const hash = hashRequest(body);
  const outDir = path.join(ANALYSIS_ROOT, hash);

  // Cache hit — the summary is saved next to the COGs on every
  // successful run, so a repeat request skips Python entirely.
  const summaryPath = path.join(outDir, 'summary.json');
  if (existsSync(summaryPath)) {
    try {
      const cached = JSON.parse(await fs.readFile(summaryPath, 'utf-8'));
      return res.json({ ...cached, hash, cached: true });
    } catch {
      // Corrupt summary — fall through and re-run.
    }
  }

  await fs.mkdir(outDir, { recursive: true });

  // Persist the AOI as GeoJSON so the Python side reads it from disk
  // (avoids escaping GeoJSON through argv, which trips up Windows shell
  // quoting for polygons with many vertices).
  const geojsonPath = path.join(outDir, 'aoi.geojson');
  await fs.writeFile(geojsonPath, JSON.stringify({
    type: 'Feature',
    properties: {},
    geometry,
  }));

  const args = [
    SCRIPT_PATH,
    '--geojson',  geojsonPath,
    '--window-a', windowA,
    '--index',    index,
    '--max-cloud', String(maxCloud),
    '--out',      outDir,
  ];
  if (windowB) args.push('--window-b', windowB);

  const t0 = Date.now();
  const py = resolvePythonBin();
  // The Python script self-configures PROJ_DATA / PROJ_LIB by walking
  // sys.path for rasterio's bundled proj_data/ — works in both the
  // Windows venv and the Debian container. We inherit the parent env
  // otherwise so anything set in the compose file / systemd unit
  // reaches Python.
  const proc = spawn(py, args, {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  let stdout = '';
  let stderr = '';
  let done = false;

  // Track whether we're the ones who killed the child, so the
  // exit-code branch can emit a specific "timed out" error instead
  // of the generic "exited non-zero".
  let killedByTimeout = false;
  const timer = setTimeout(() => {
    if (done) return;
    killedByTimeout = true;
    proc.kill('SIGTERM');
  }, PROCESS_TIMEOUT_MS);

  proc.stdout.on('data', (c) => { stdout += c.toString(); });
  proc.stderr.on('data', (c) => { stderr += c.toString(); });

  proc.on('error', (err) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    res.status(500).json({
      error: 'Failed to spawn Python',
      detail: err.message,
      hint:   'Install the project venv: python -m venv .venv && .venv/Scripts/pip install -r scripts/python/requirements.txt',
    });
  });

  proc.on('close', async (code) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    const elapsedMs = Date.now() - t0;

    if (code !== 0) {
      // Try to parse a structured error the script may have emitted.
      let scriptError = null;
      try { scriptError = JSON.parse(stdout).error; } catch { /* not JSON */ }
      const timedOut = killedByTimeout || code === null;
      const errorMsg = timedOut
        ? `Analysis timed out after ${Math.round(PROCESS_TIMEOUT_MS / 1000)}s (Python killed by SIGTERM).`
          + ' Try a smaller AOI, single window, or NDVI/NDWI (10 m bands only).'
        : scriptError ?? `Python script exited with code ${code}`;
      // Log to the container so a `docker logs` grep can find the
      // actual Python stack trace after the fact — the response
      // envelope only carries the last 2 KB and the frontend renders
      // even less.
      console.error(
        `[analysis] Python ${timedOut ? 'TIMED OUT' : 'failed'} `
        + `(exit ${code}, ${elapsedMs}ms) `
        + `for index=${index} windowA=${windowA} windowB=${windowB ?? '-'} hash=${hash}\n`
        + `  scriptError: ${scriptError ?? '(none)'}\n`
        + `  stderr tail:\n${stderr.slice(-3000)}`,
      );
      return res.status(timedOut ? 504 : 502).json({
        error:      errorMsg,
        exitCode:   code,
        timedOut,
        elapsedMs,
        stderrTail: stderr.slice(-2000),
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch (err) {
      return res.status(502).json({
        error:      'Python script emitted invalid JSON',
        detail:     err.message,
        stdoutTail: stdout.slice(-2000),
        stderrTail: stderr.slice(-2000),
      });
    }
    if (!parsed.ok) {
      return res.status(502).json({ error: parsed.error ?? 'Unknown analysis failure', elapsedMs });
    }

    // Rewrite every cogPath into a URL the browser can fetch.
    if (parsed.windowA?.cogPath) parsed.windowA.cogUrl = toCogUrl(hash, parsed.windowA.cogPath);
    if (parsed.windowB?.cogPath) parsed.windowB.cogUrl = toCogUrl(hash, parsed.windowB.cogPath);
    if (parsed.delta?.cogPath)   parsed.delta.cogUrl   = toCogUrl(hash, parsed.delta.cogPath);

    const summary = { ...parsed, hash, elapsedMs, cached: false };
    try {
      await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
    } catch {
      // Cache miss on future requests isn't fatal — just log.
      console.warn(`[analysis] failed to persist summary for ${hash}`);
    }
    res.json(summary);
  });
});

// Serve a generated COG. Both path segments are validated against
// tight regexes so a caller can't traverse out of ANALYSIS_ROOT.
analysisRouter.get('/cog/:hash/:name', async (req, res) => {
  const { hash, name } = req.params;
  if (!VALID_HASH.test(hash) || !VALID_FILE.test(name)) {
    return res.status(400).json({ error: 'Invalid path' });
  }
  const abs = path.join(ANALYSIS_ROOT, hash, name);
  // Defence-in-depth: resolve and re-check the prefix in case the
  // filename ever contains a traversal that slipped past the regex.
  const resolved = path.resolve(abs);
  const root = path.resolve(ANALYSIS_ROOT);
  if (!resolved.startsWith(root + path.sep)) {
    return res.status(400).json({ error: 'Path outside analysis root' });
  }
  try {
    const stat = await fs.stat(resolved);
    res.set('Content-Type', 'image/tiff');
    res.set('Content-Length', String(stat.size));
    res.set('Cache-Control', 'private, max-age=86400');
    createReadStream(resolved).pipe(res);
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'COG not found' });
    return res.status(500).json({ error: err.message });
  }
});

// Diagnostic — list cached analyses. Handy while debugging without
// having to shell into the server. Not stable API, don't expose to
// users.
analysisRouter.get('/_debug/cache', async (_req, res) => {
  try {
    await fs.mkdir(ANALYSIS_ROOT, { recursive: true });
    const dirs = await fs.readdir(ANALYSIS_ROOT);
    res.json({ hashes: dirs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
