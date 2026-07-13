import { Router } from 'express';

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
