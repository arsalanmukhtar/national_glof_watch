// Maps logical layer ids → URL of the bundled GeoJSON file. The actual
// fetch happens lazily when a layer is toggled on (see MapPanel), so the
// initial bundle stays small. `import.meta.glob('?url', eager: true)`
// gives us URL strings at build time without inlining the JSON contents.
//
// The district-boundary file is excluded from this glob: at 642 MB it
// blows past Vite's dev-server streaming limits, and the client now
// loads that layer from `/api/secondary/district_boundary` (PostGIS-
// backed) — see SECONDARY_API_LAYERS below.
const GEOJSON_URLS = import.meta.glob(
  [
    '../../data/geojsons/**/*.geojson',
    '!../../data/geojsons/administrative_boundaries/pak_boundaries_district_boundary_updated.geojson',
  ],
  { query: '?url', import: 'default', eager: true },
);

// Layer ids that are served by the Express backend instead of being
// bundled as static assets. Keep this set tight — files we can ship as
// static assets remain faster (no DB hop, browser-cacheable, hashed).
const SECONDARY_API_LAYERS = new Set(['district_boundary']);

// Resolve a relative path (e.g. "badswat/badswat_lake.geojson") to the
// Vite-hashed URL emitted into the build output. Returns null when the
// file is missing so callers can skip-and-warn instead of throwing.
function urlFor(relPath) {
  const key = `../../data/geojsons/${relPath}`;
  return GEOJSON_URLS[key] ?? null;
}

// ---------------------------------------------------------------------------
// Region layers — keyed by `${regionId}:${layerKey}`. layerKey is the
// lowercase singular form of the LayerMenu label, with risk zones split
// into three sublevels: `risk:low`, `risk:medium`, `risk:high`.
// ---------------------------------------------------------------------------
const REGION_FILES = {
  badswat: {
    lake:        'badswat/badswat_lake.geojson',
    glacier:     'badswat/badswat_glaciers.geojson',
    faultline:   'badswat/badswat_faultline.geojson',
    'risk:high':   'badswat/glof_badswat_high.geojson',
    'risk:medium': 'badswat/glof_badswat_medium.geojson',
    'risk:low':    'badswat/glof_badswat_low.geojson',
  },
  brep: {
    'risk:high':   'brep/glof_brep_high.geojson',
    'risk:medium': 'brep/glof_brep_medium.geojson',
    'risk:low':    'brep/glof_brep_low.geojson',
  },
  chatiboi: {
    lake:  'chatiboi/glof_chatiboi_lake.geojson',
    river: 'chatiboi/glof_chatiboi_run_off.geojson',
    'risk:high':   'chatiboi/glof_high_risk_chatiboi.geojson',
    'risk:medium': 'chatiboi/glof_medium_risk_chatiboi.geojson',
    // chatiboi has no low-risk file shipped — toggle becomes a no-op.
  },
  chitral: {
    river: 'chitral/chitral_river.geojson',
  },
  darkot: {
    river:     'darkot/darkot_river.geojson',
    glacier:   'darkot/darkot_glaciers.geojson',
    building:  'darkot/darkot_buildings.geojson',
    school:    'darkot/darkot_schools.geojson',
    'risk:high':   'darkot/glof_darkot_high.geojson',
    'risk:medium': 'darkot/glof_darkot_medium.geojson',
    'risk:low':    'darkot/glof_darkot_low.geojson',
  },
  gulmit: {
    river:    'gulmit/gulmit_rivers.geojson',
    road:     'gulmit/gulmit_roads.geojson',
    building: 'gulmit/gulmit_buildings.geojson',
    school:   'gulmit/gulmit_schools.geojson',
    'risk:high':   'gulmit/glof_gulmit_high.geojson',
    'risk:medium': 'gulmit/glof_gulmit_medium.geojson',
    'risk:low':    'gulmit/glof_gulmit_low.geojson',
  },
  hinarchi: {
    lake: 'hinarchi/hinarchi_lake.geojson',
    'risk:high':   'hinarchi/glof_hinarchi_high.geojson',
    'risk:medium': 'hinarchi/glof_hinarchi_medium.geojson',
    'risk:low':    'hinarchi/glof_hinarchi_low.geojson',
  },
  ishokoman: {
    river: 'ishokoman/ishokoman_river.geojson',
    'risk:high':   'ishokoman/glof_ishokoman_high.geojson',
    'risk:medium': 'ishokoman/glof_ishokoman_medium.geojson',
    'risk:low':    'ishokoman/glof_ishokoman_low.geojson',
  },
  karambar: {
    lake: 'karambar/karambar_lake.geojson',
  },
  lusht: {
    'risk:high':   'lusht/glof_lusht_high.geojson',
    'risk:medium': 'lusht/glof_lusht_medium.geojson',
    'risk:low':    'lusht/glof_lusht_low.geojson',
  },
  pindoru_chaat: {
    lake: 'pindoru_chaat/glof_pindoru_chaat_lake.geojson',
    'risk:high':   'pindoru_chaat/glof_pindoru_chaat_high_risk.geojson',
    'risk:medium': 'pindoru_chaat/glof_pindoru_chaat_medium_risk.geojson',
    'risk:low':    'pindoru_chaat/glof_pindoru_chaat_low_risk.geojson',
  },
  reshun: {
    river:     'reshun/nullah_reshun.geojson',
    glacier:   'reshun/glacier_reshun.geojson',
    faultline: 'reshun/faultline_reshun.geojson',
    'risk:high':   'reshun/glof_reshun_high.geojson',
    'risk:medium': 'reshun/glof_reshun_medium.geojson',
    'risk:low':    'reshun/glof_reshun_low.geojson',
  },
  sardar_gol: {
    'risk:high':   'sardar_gol/glof_sardar_gol_high.geojson',
    'risk:medium': 'sardar_gol/glof_sardar_gol_medium.geojson',
    'risk:low':    'sardar_gol/glof_sardar_gol_low.geojson',
  },
  shisper: {
    lake: 'shisper/glof_shisper_lake.geojson',
    'risk:high':   'shisper/glof_shisper_high.geojson',
    'risk:medium': 'shisper/glof_shisper_medium.geojson',
    'risk:low':    'shisper/glof_shisper_low.geojson',
  },
  terset_hundur: {
    lake:  'terset_hundur/glof_lakes_terset_hundur.geojson',
    river: 'terset_hundur/glof_river_terset_hundur.geojson',
    'risk:high':   'terset_hundur/glof_high_terset_hundur.geojson',
    'risk:medium': 'terset_hundur/glof_medium_terset_hundur.geojson',
    'risk:low':    'terset_hundur/glof_low_terset_hundur.geojson',
  },
  ultar: {
    'risk:high':   'ultar/glof_high_risk_ultar_lake.geojson',
    'risk:medium': 'ultar/glof_medium_risk_ultar_lake.geojson',
    'risk:low':    'ultar/glof_low_risk_ultar_lake.geojson',
  },
};

// ---------------------------------------------------------------------------
// Secondary layers — keyed by SECONDARY_LAYERS[id] in SecondaryContext.
// ---------------------------------------------------------------------------
const SECONDARY_FILES = {
  national_boundary:    'administrative_boundaries/pak_boundaries_national_boundary.geojson',
  provincial_boundary:  'administrative_boundaries/pak_boundaries_provincial_boundary.geojson',
  district_boundary:    'administrative_boundaries/pak_boundaries_district_boundary_updated.geojson',
  akah_infrastructure:  'akah/glof_akahp_infrastructure_data_final.geojson',
  akah_hazard_exposure: 'akah/glof_akahp_hazardexposure_final.geojson',
  all_stations:         'all_stations/glof_stations.geojson',
  glacial_lakes:        'glaciel_lakes/glaciel_lakes.geojson',
  settlements:          'settlements/settlements.geojson',
  cell_towers:          'cell_towers/cell_towers.geojson',
};

// ---------------------------------------------------------------------------
// Public lookup helpers
// ---------------------------------------------------------------------------

// Region layer URL. layerKey is one of: lake, river, glacier, faultline,
// building, school, road, risk:low, risk:medium, risk:high.
export function regionLayerUrl(regionId, layerKey) {
  const file = REGION_FILES[regionId]?.[layerKey];
  return file ? urlFor(file) : null;
}

export function secondaryLayerUrl(layerId) {
  if (SECONDARY_API_LAYERS.has(layerId)) {
    return `/api/secondary/${layerId}`;
  }
  const file = SECONDARY_FILES[layerId];
  return file ? urlFor(file) : null;
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
