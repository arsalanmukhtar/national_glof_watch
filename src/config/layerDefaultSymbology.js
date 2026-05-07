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

// Stroke color shared by the four GLOF reference layers when they fall
// back to default symbology — slate-gray reads well on top of any of
// the colormap fills we apply below.
export const GLOF_DEFAULT_STROKE = '#475569';

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
    fillOpacity: 0.5,
    strokeColor: GLOF_DEFAULT_STROKE,
  },
  glof_lakes: {
    type: 'categories',
    colorBy: 'Elevation',
    catPaletteId: 'set2',
    fillOpacity: 0.65,
    strokeColor: GLOF_DEFAULT_STROKE,
  },
  glof_valley: {
    type: 'categories',
    colorBy: 'Area_Sqkm',
    catPaletteId: 'tableau',
    fillOpacity: 0.5,
    strokeColor: GLOF_DEFAULT_STROKE,
  },
};

// True when the layer id has a configured default — used by MapPanel to
// gate the data-driven seeding below, and by the renderer to decide
// whether to bother computing categories at all.
export function hasLayerDefaultSymbology(id) {
  return Object.prototype.hasOwnProperty.call(LAYER_DEFAULT_SYMBOLOGY, id);
}
