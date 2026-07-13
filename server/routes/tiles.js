import { Router } from 'express';
import { pool } from '../lib/db.js';

export const tilesRouter = Router();

// GeoServer host — same LAN box the vector tiles come from. Env override
// so a different environment (staging / prod behind TLS) can point at
// its own GeoServer without a code change.
const GEOSERVER_HOST = process.env.GEOSERVER_HOST || 'http://172.18.7.21:8080';

// In-memory cache. Layer extents change only when the underlying data
// gets re-published — a 6 h TTL is aggressive enough for correctness
// and keeps the "zoom to extent" button feeling instant on repeat
// clicks. Cache lives per-process (dies on server restart).
const BOUNDS_TTL_MS = 6 * 60 * 60 * 1000;
const boundsCache = new Map(); // key `${workspace}:${layer}` → { at, bounds }

// GET /api/tiles/bounds/:workspace/:layer
// Resolves the true geographic extent of a GeoServer-published layer
// from its WMS 1.3.0 GetCapabilities document. Powers the "zoom to
// extent" button for vector-tile overlays whose full FeatureCollection
// never touches the client.
//
// Response: { bounds: [w, s, e, n], cached: boolean }
tilesRouter.get('/bounds/:workspace/:layer', async (req, res) => {
  const { workspace, layer } = req.params;

  // GeoServer workspace + layer identifiers are alphanumerics + _ / -.
  // Anything else is either a typo or a probing attempt — reject early
  // so we never interpolate untrusted data into the outgoing URL.
  if (!/^[A-Za-z0-9_-]+$/.test(workspace) || !/^[A-Za-z0-9_-]+$/.test(layer)) {
    return res.status(400).json({ error: 'Invalid workspace/layer identifier' });
  }

  const cacheKey = `${workspace}:${layer}`;
  const cached = boundsCache.get(cacheKey);
  if (cached && Date.now() - cached.at < BOUNDS_TTL_MS) {
    res.set('Cache-Control', 'public, max-age=3600');
    return res.json({ bounds: cached.bounds, cached: true });
  }

  try {
    // Scope the caps to the workspace so the XML is small — a
    // workspace-scoped OWS URL only advertises its own layers instead
    // of the whole GeoServer instance.
    const url =
      `${GEOSERVER_HOST}/geoserver/${workspace}` +
      `/ows?service=WMS&version=1.3.0&request=GetCapabilities`;
    const r = await fetch(url, { headers: { Accept: 'application/xml' } });
    if (!r.ok) throw new Error(`GeoServer HTTP ${r.status}`);
    const xml = await r.text();

    // Find `<Name>layer</Name>` inside a `<Layer>` block. GeoServer's
    // workspace-scoped caps drop the `workspace:` prefix from Names
    // (only the top-level `/geoserver/ows` caps include it), so we
    // match the bare layer id — with a fallback to the qualified form
    // in case a caller pointed us at the unscoped endpoint. Regex-
    // parsing this XML is safe because GeoServer's caps output is
    // stable and machine-generated.
    const bareToken = `<Name>${layer}</Name>`;
    let nameIdx = xml.indexOf(bareToken);
    if (nameIdx < 0) {
      const qualifiedToken = `<Name>${cacheKey}</Name>`;
      nameIdx = xml.indexOf(qualifiedToken);
    }
    if (nameIdx < 0) throw new Error(`Layer ${cacheKey} not in GetCapabilities`);

    const openIdx = xml.lastIndexOf('<Layer', nameIdx);
    const closeIdx = xml.indexOf('</Layer>', nameIdx);
    if (openIdx < 0 || closeIdx < 0) {
      throw new Error(`Cannot delimit <Layer> block for ${cacheKey}`);
    }
    const block = xml.slice(openIdx, closeIdx);

    // WMS 1.3.0 puts geographic extent in <EX_GeographicBoundingBox>.
    const west  = extractFloatTag(block, 'westBoundLongitude');
    const east  = extractFloatTag(block, 'eastBoundLongitude');
    const south = extractFloatTag(block, 'southBoundLatitude');
    const north = extractFloatTag(block, 'northBoundLatitude');
    if (west == null || east == null || south == null || north == null) {
      throw new Error(`Missing bounding-box tags for ${cacheKey}`);
    }

    const bounds = [west, south, east, north];
    boundsCache.set(cacheKey, { at: Date.now(), bounds });
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ bounds, cached: false });
  } catch (err) {
    console.error(`[GET tiles/bounds/${cacheKey}]`, err.message);
    res.status(502).json({ error: err.message });
  }
});

function extractFloatTag(xml, tag) {
  const m = new RegExp(`<${tag}>([^<]+)</${tag}>`).exec(xml);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------
// PostGIS-backed MVT tiles
// ---------------------------------------------------------------------
// For layers stored in our own DB that are too large to ship as one
// FeatureCollection (e.g. the 28k-polygon glacier inventory, ~180 MB
// GeoJSON), we serve Mapbox Vector Tiles built on-the-fly with
// ST_AsMVT. Each tile is ~10-200 kB and only the tiles currently in
// view are requested by Mapbox, so the layer loads incrementally
// instead of stalling the browser on a big JSON parse.
//
// Endpoint pattern intentionally mirrors GeoServer's TMS/XYZ shape so
// the frontend `vectorTile` descriptor can point at either backend
// without knowing which is which.
// ---------------------------------------------------------------------

// Only tables in these schemas may be requested. Keeps the SQL
// interpolation safe and hides internal schemas by default.
const MVT_ALLOWED_SCHEMAS = new Set([
  'secondary',
  'lakes',
  'rivers',
  'glaciers',
  'buildings',
  'faultlines',
  'schools',
  'roads',
  'risk_zones',
]);

// Same tolerant identifier rule PostGIS itself follows for
// unquoted names — alphanumerics + underscore, no leading digit.
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// GET /api/tiles/mvt/:schema/:table/:z/:x/:y.pbf
// Streams a single Mapbox Vector Tile built from the requested table.
// Uses ST_AsMVTGeom to clip + reproject to the tile envelope and
// ST_AsMVT to encode the protobuf. Empty tiles come back as 204 so
// Mapbox can cache the miss instead of retrying.
tilesRouter.get('/mvt/:schema/:table/:z/:x/:y.pbf', async (req, res) => {
  const { schema, table } = req.params;
  const z = Number(req.params.z);
  const x = Number(req.params.x);
  const y = Number(req.params.y);

  if (!MVT_ALLOWED_SCHEMAS.has(schema)) {
    return res.status(404).json({ error: `Schema ${schema} not allowed` });
  }
  if (!IDENT_RE.test(schema) || !IDENT_RE.test(table)) {
    return res.status(400).json({ error: 'Invalid identifier' });
  }
  if (![z, x, y].every((n) => Number.isInteger(n) && n >= 0)) {
    return res.status(400).json({ error: 'Invalid z/x/y' });
  }
  if (z > 22) return res.status(400).json({ error: 'z out of range' });

  try {
    // ST_TileEnvelope returns a 3857-projected envelope for the given
    // z/x/y. ST_AsMVTGeom clips + snaps geometry to that envelope in
    // MVT tile-coordinate space (0..4096). extent=4096 is the MVT
    // spec default; buffer=64 avoids clipping artefacts at tile edges.
    // We drop the geom column from properties to keep the payload
    // small — clients get all attributes plus the transformed geom.
    const sql = `
      WITH tile AS (
        SELECT ST_TileEnvelope($1, $2, $3) AS env
      ),
      src AS (
        SELECT ST_AsMVTGeom(
                 ST_Transform(t.geom, 3857),
                 tile.env,
                 4096, 64, true
               ) AS geom,
               to_jsonb(t) - 'geom' AS props
          FROM "${schema}"."${table}" t, tile
         WHERE t.geom && ST_Transform(tile.env, 4326)
      )
      SELECT ST_AsMVT(src.*, $4, 4096, 'geom') AS mvt
        FROM src
       WHERE geom IS NOT NULL
    `;
    const { rows } = await pool.query(sql, [z, x, y, table]);
    const mvt = rows[0]?.mvt;
    if (!mvt || mvt.length === 0) {
      // Signal empty tile — Mapbox handles 204 as "no features here"
      // and stops retrying. Setting Cache-Control keeps the miss
      // cached by any intermediate proxy.
      res.set('Cache-Control', 'public, max-age=3600');
      return res.status(204).end();
    }
    res.set('Content-Type', 'application/vnd.mapbox-vector-tile');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(mvt);
  } catch (err) {
    console.error(`[GET mvt/${schema}/${table}/${z}/${x}/${y}]`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tiles/mvt-bounds/:schema/:table
// Layer extent for the "zoom to extent" button. Computed on-the-fly
// with ST_Extent and cached for the process lifetime — geometry
// footprints for these tables change on data reloads (rare), so
// there's no reason to re-run the aggregate per request.
const mvtBoundsCache = new Map();

tilesRouter.get('/mvt-bounds/:schema/:table', async (req, res) => {
  const { schema, table } = req.params;

  if (!MVT_ALLOWED_SCHEMAS.has(schema)) {
    return res.status(404).json({ error: `Schema ${schema} not allowed` });
  }
  if (!IDENT_RE.test(schema) || !IDENT_RE.test(table)) {
    return res.status(400).json({ error: 'Invalid identifier' });
  }

  const cacheKey = `${schema}.${table}`;
  const cached = mvtBoundsCache.get(cacheKey);
  if (cached && Date.now() - cached.at < BOUNDS_TTL_MS) {
    res.set('Cache-Control', 'public, max-age=3600');
    return res.json({ bounds: cached.bounds, cached: true });
  }

  try {
    const { rows } = await pool.query(
      `SELECT ST_XMin(ext) AS w, ST_YMin(ext) AS s,
              ST_XMax(ext) AS e, ST_YMax(ext) AS n
         FROM (
           SELECT ST_Extent(geom)::geometry AS ext
             FROM "${schema}"."${table}"
         ) t`,
    );
    const b = rows[0];
    if (!b || b.w == null) {
      throw new Error('Table has no features');
    }
    const bounds = [Number(b.w), Number(b.s), Number(b.e), Number(b.n)];
    mvtBoundsCache.set(cacheKey, { at: Date.now(), bounds });
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ bounds, cached: false });
  } catch (err) {
    console.error(`[GET mvt-bounds/${cacheKey}]`, err.message);
    res.status(500).json({ error: err.message });
  }
});
