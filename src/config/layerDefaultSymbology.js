// ---------------------------------------------------------------------------
// Per-layer default symbology partials.
//
// Composed into the base style by `effectiveStyle()` BEFORE the user's
// override is applied. So the listed layers ship with the right type +
// colorBy / rangeBy + slate stroke out of the box; whatever the user
// changes in the style panel always wins.
//
// Categories layers also need a populated `categories` array to actually
// render distinct colors — that's seeded at fetch time by the data-aware
// hook in MapPanel (it can't live here because we don't know the
// distinct values until the GeoJSON is in memory).
// ---------------------------------------------------------------------------

// Station-inventory marker — a coloured disc with a black ring and a
// black centre dot, emitted as a self-contained SVG data URL. The same
// data URL drives the map marker and the sidebar / table legend glyphs,
// so every station network reads identically everywhere.
function stationMarkerIcon(fill) {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
    `<circle cx="12" cy="12" r="9.5" fill="${fill}" stroke="#000000" stroke-width="2"/>` +
    '<circle cx="12" cy="12" r="3.6" fill="#000000"/>' +
    '</svg>';
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// One fill colour per station network; the ring + centre dot are black.
function stationSymbology(fill) {
  return {
    radius: 8,
    fillColor: fill,
    strokeColor: '#000000',
    strokeWidth: 0,
    marker: {
      shape: 'none',
      icon: stationMarkerIcon(fill),
      backgroundColor: null,
    },
  };
}

// Stroke color shared by the four GLOF reference layers when they fall
// back to default symbology — slate-gray reads well on top of any of
// the colormap fills we apply below.
export const GLOF_DEFAULT_STROKE = '#475569';

// Lake polygons — a water-blue fill + outline so lakes actually read as
// water instead of the lime polygon default. The semi-transparent fill
// keeps the basemap visible underneath.
const LAKE_SYMBOLOGY = {
  type: 'simple',
  fillColor: '#3b82f6',
  fillOpacity: 0.4,
  strokeColor: '#1d4ed8',
  strokeOpacity: 1,
};

export const LAYER_DEFAULT_SYMBOLOGY = {
  glof_districts: {
    type: 'colorRange',
    rangeBy: 'Area_km2',
    rampId: 'viridis',
    classMode: 'continuous',
    fillOpacity: 0.5,
    strokeColor: GLOF_DEFAULT_STROKE,
  },
  glof_basins: {
    type: 'categories',
    colorBy: 'BASIN',
    catPaletteId: 'paired',
    fillOpacity: 1,
    strokeColor: GLOF_DEFAULT_STROKE,
  },
  glof_valley: {
    type: 'categories',
    colorBy: 'Area_Sqkm',
    catPaletteId: 'tableau',
    fillOpacity: 0.5,
    strokeColor: GLOF_DEFAULT_STROKE,
  },
  // Lake polygons — water-blue fill + outline (overrides the lime
  // polygon default; GLOF Lakes also drops its by-elevation categories
  // so every lake reads uniformly as water).
  glof_lakes:            { ...LAKE_SYMBOLOGY },
  glacial_lakes:         { ...LAKE_SYMBOLOGY },
  vulnerable_lakes_2026: { ...LAKE_SYMBOLOGY },
  // Melting glaciers — a light icy-blue fill + sky-blue outline so they
  // read as ice rather than the lime polygon default.
  vulnerable_melting_glaciers_2026: {
    type: 'simple',
    fillColor: '#bae6fd',
    fillOpacity: 0.5,
    strokeColor: '#0ea5e9',
    strokeOpacity: 1,
  },
  // Station inventories — a unified disc-with-centre-dot symbol, one
  // fill colour per network so they stay distinguishable when several
  // are on at once: All Stations white, AKAH green, GMRC / WAPDA blue,
  // BRI-FF China red. All share a black ring + black centre dot.
  all_stations:         stationSymbology('#ffffff'),
  akah_sensors:         stationSymbology('#22c55e'),
  gmrc_wapda_stations:  stationSymbology('#3b82f6'),
  bri_ff_china_sensors: stationSymbology('#ef4444'),

  // ─── Static reference layers (imported from data/geojsons/static/) ──
  // Colours picked so each feature reads as it naturally would on a map:
  // rivers/reservoirs in water blues, watersheds in a warm earth tone,
  // BTS towers in signal orange, dams in a major/minor red/amber pair,
  // monsoon-basin gauges in a rainfall sky-blue. Point radii step up so
  // major dams pop as high-priority structures while numerous BTS +
  // minor-dam points don't clutter the map.
  //
  // LINE geometry paint (paintExprsFor with geometry='line') reads the
  // line-family names: `color`, `width`, `opacity`. The polygon-family
  // `strokeColor` / `strokeWidth` are IGNORED for lines — setting them
  // here would silently fall back to the base lime default. Both river
  // families paint in natural water blues, major thicker + fully
  // opaque, minor thinner + slightly translucent so major rivers
  // dominate visually where the two overlap.
  major_rivers: {
    type: 'simple',
    color: '#1e40af',   // blue-800 — deep water
    width: 2.5,
    opacity: 1,
  },
  minor_rivers: {
    type: 'simple',
    color: '#3b82f6',   // blue-500 — lighter tributaries
    width: 1.25,
    opacity: 0.9,
  },
  reservoirs: {
    type: 'simple',
    fillColor: '#06b6d4',       // cyan-500 — still water bodies
    fillOpacity: 0.55,
    strokeColor: '#0e7490',     // cyan-700
    strokeOpacity: 1,
    strokeWidth: 1.25,
  },
  watersheds: {
    type: 'simple',
    fillColor: '#facc15',       // yellow-400 — earthy basin fill
    fillOpacity: 0.08,          // barely tinted so multiple basins layer without drowning basemap
    strokeColor: '#a16207',     // yellow-800 — warm boundary line
    strokeOpacity: 0.9,
    strokeWidth: 1.25,
  },
  bts_cell_sites: {
    // Telecom towers — orange for radio/signal.
    radius: 4,
    fillColor: '#f97316',       // orange-500
    fillOpacity: 0.9,
    strokeColor: '#c2410c',     // orange-700
    strokeWidth: 1,
    strokeOpacity: 1,
  },
  minor_dams: {
    // Amber for less-critical dam structures.
    radius: 5,
    fillColor: '#f59e0b',       // amber-500
    fillOpacity: 0.95,
    strokeColor: '#b45309',     // amber-700
    strokeWidth: 1.25,
    strokeOpacity: 1,
  },
  major_dams: {
    // Bigger + red so major dams stand out as high-priority structures.
    radius: 7,
    fillColor: '#dc2626',       // red-600
    fillOpacity: 1,
    strokeColor: '#7f1d1d',     // red-900
    strokeWidth: 1.5,
    strokeOpacity: 1,
  },
  monsoon_basins: {
    // Rainfall gauges — sky-blue centre, deeper stroke.
    radius: 5,
    fillColor: '#0284c7',       // sky-600
    fillOpacity: 0.95,
    strokeColor: '#075985',     // sky-800
    strokeWidth: 1.25,
    strokeOpacity: 1,
  },
  glacial_inventory: {
    // RGI glaciers — icy pale-blue fill with a slightly darker outline
    // so 28k polygons don't drown the map in solid colour. Thin stroke
    // (0.75 px) keeps individual glacier boundaries readable at wide
    // zooms without turning the layer into a mesh of thick lines.
    type: 'simple',
    fillColor: '#bae6fd',       // sky-200 — light ice blue
    fillOpacity: 0.55,
    strokeColor: '#0369a1',     // sky-700 — deeper glacier outline
    strokeOpacity: 0.9,
    strokeWidth: 0.75,
  },
};

// True when the layer id has a configured default — used by MapPanel to
// gate the data-driven seeding below, and by the renderer to decide
// whether to bother computing categories at all.
export function hasLayerDefaultSymbology(id) {
  return Object.prototype.hasOwnProperty.call(LAYER_DEFAULT_SYMBOLOGY, id);
}
