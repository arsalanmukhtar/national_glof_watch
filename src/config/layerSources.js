// Layer URL resolution + GeoJSON fetch helpers.
//
// Every map layer is now backed by an API endpoint, so this module is
// just URL construction + a small fetch cache. Three URL families:
//
//   /api/region/:region/:layerKey  → server/routes/region.js (PostGIS,
//        per-region tables under lakes/rivers/glaciers/.../risk_zones).
//   /api/secondary/:layer          → server/routes/secondary.js (PostGIS,
//        cross-region reference layers under the `secondary` schema).
//   /api/gis/:layer                → server/routes/gis.js (live PMD
//        proxy with insecure-TLS dispatcher; cached server-side).
//
// The dev Vite proxy forwards /api → :3001, the VM nginx forwards it to
// the backend container, and Vercel rewrites it to the VM. The same
// path string works in all three environments.

// Cross-region reference layers served from PostGIS via /api/secondary.
// Must stay in sync with server/routes/secondary.js `ALLOWED_LAYERS` and
// the catalog in src/contexts/SecondaryContext.jsx `SECONDARY_LAYERS`.
const SECONDARY_API_LAYERS = new Set([
  'national_boundary',
  'provincial_boundary',
  'akah_infrastructure',
  'akah_hazard_exposure',
  'akah_sensors',
  'all_stations',
  'damaged_stations',
  'bri_ff_china_sensors',
  'gmrc_wapda_stations',
  'glacial_lakes',
  'settlements',
  'cell_towers',
  'vulnerable_lakes_2026',
  'vulnerable_melting_glaciers_2026',
  'vulnerable_melting_points_2026',
  'vulnerable_sites_2026',
]);

// Live PMD GIS layers proxied via /api/gis. Upstream uses a private CA
// so the backend handles TLS; the browser never talks to PMD directly.
const SECONDARY_GIS_LAYERS = new Set([
  'glof_districts',
  'glof_basins',
  'glof_lakes',
  'glof_valley',
]);

// Region layer URL. layerKey is one of the keys recognised by the
// region router (lake, river, glacier, faultline, building, school,
// road, risk:low, risk:medium, risk:high). The router 200s with an
// empty FeatureCollection when the underlying table doesn't exist —
// e.g. chatiboi has no risk:low — so callers can toggle freely without
// pre-checking which combinations exist.
export function regionLayerUrl(regionId, layerKey) {
  if (!regionId || !layerKey) return null;
  return `/api/region/${regionId}/${encodeURIComponent(layerKey)}`;
}

export function secondaryLayerUrl(layerId) {
  if (SECONDARY_GIS_LAYERS.has(layerId)) {
    return `/api/gis/${layerId}`;
  }
  if (SECONDARY_API_LAYERS.has(layerId)) {
    return `/api/secondary/${layerId}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Region layer styling — colors mirror the outline tints used in the
// LayerMenu accordion so the legend reads consistently. Risk zones use the
// same yellow/orange/red ramp as the pill toggles.
// ---------------------------------------------------------------------------
const REGION_LAYER_COLORS = {
  lake:        '#3b82f6', // blue-500
  river:       '#06b6d4', // cyan-500
  glacier:     '#0ea5e9', // sky-500
  faultline:   '#f97316', // orange-500
  building:    '#8b5cf6', // violet-500
  school:      '#10b981', // emerald-500
  road:        '#64748b', // slate-500
  'risk:low':    '#facc15', // yellow-400
  'risk:medium': '#f97316', // orange-500
  'risk:high':   '#ef4444', // red-500
};

export function regionLayerColor(layerKey) {
  return REGION_LAYER_COLORS[layerKey] ?? '#16a085';
}

// Best-effort geometry detection for region layers, used so MapPanel can
// pick fill vs line vs circle paint without fetching first.
const REGION_LAYER_GEOMETRY = {
  lake: 'polygon',
  river: 'line',
  glacier: 'polygon',
  faultline: 'line',
  building: 'polygon',
  school: 'point',
  road: 'line',
  'risk:low':    'polygon',
  'risk:medium': 'polygon',
  'risk:high':   'polygon',
};

export function regionLayerGeometry(layerKey) {
  return REGION_LAYER_GEOMETRY[layerKey] ?? 'polygon';
}

// Detect geometry from a parsed GeoJSON FeatureCollection — used as a
// fallback / refinement once data is fetched (some "river" files contain
// MultiPolygons, etc.).
export function detectGeometry(parsed) {
  const features = Array.isArray(parsed?.features)
    ? parsed.features
    : parsed?.type === 'Feature'
      ? [parsed]
      : [];
  for (const f of features) {
    const t = f?.geometry?.type;
    if (!t) continue;
    if (t.includes('Point')) return 'point';
    if (t.includes('LineString')) return 'line';
    if (t.includes('Polygon')) return 'polygon';
  }
  return 'polygon';
}

// Cache fetched GeoJSON keyed by URL so re-toggling doesn't re-download.
const fetchCache = new Map();

export async function fetchGeoJson(url) {
  if (!url) return null;
  if (fetchCache.has(url)) return fetchCache.get(url);
  const promise = (async () => {
    const t0 = performance.now();
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    const contentLength = r.headers.get('content-length');
    const contentType = r.headers.get('content-type');
    // Read as text first so a parse failure can include diagnostics
    // (header-claimed size vs. bytes actually received vs. body tail).
    // Without this, "Unexpected end of JSON input" leaves no clue
    // whether the body was truncated or never arrived at all.
    const text = await r.text();
    const elapsedMs = Math.round(performance.now() - t0);

    if (!text) {
      throw new Error(
        `Empty body for ${url} (content-length: ${contentLength}, ${elapsedMs}ms)`,
      );
    }
    try {
      const parsed = JSON.parse(text);
      // eslint-disable-next-line no-console
      console.debug(
        `[fetchGeoJson] ok ${url}`,
        `\n  size: ${(text.length / 1024 / 1024).toFixed(2)} MB`,
        `\n  type: ${contentType ?? '?'}`,
        `\n  time: ${elapsedMs}ms`,
        `\n  features: ${parsed?.features?.length ?? '?'}`,
      );
      return parsed;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[fetchGeoJson] JSON parse failed for ${url}`,
        `\n  content-length header: ${contentLength}`,
        `\n  bytes received:        ${text.length}`,
        `\n  content-type:          ${contentType ?? '?'}`,
        `\n  elapsed:               ${elapsedMs}ms`,
        `\n  starts: ${text.slice(0, 120)}`,
        `\n  ends:   …${text.slice(-120)}`,
      );
      throw err;
    }
  })();
  fetchCache.set(url, promise);
  // Don't poison the cache with rejections — clear so a retry can start
  // fresh after a transient network blip.
  promise.catch(() => fetchCache.delete(url));
  return promise;
}
