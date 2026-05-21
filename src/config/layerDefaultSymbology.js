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
};

// True when the layer id has a configured default — used by MapPanel to
// gate the data-driven seeding below, and by the renderer to decide
// whether to bother computing categories at all.
export function hasLayerDefaultSymbology(id) {
  return Object.prototype.hasOwnProperty.call(LAYER_DEFAULT_SYMBOLOGY, id);
}
