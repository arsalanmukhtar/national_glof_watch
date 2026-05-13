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

// Bundled marker icons — Vite resolves these to URLs (or inline data
// URLs for small files) at build time. Used as defaults for the two
// sensor inventories so they ship with their partner branding instead
// of a generic teal dot.
import akahSensorsIcon from '@/assets/images/layer-icons/akah-sensors.webp';
import wapdaSensorsIcon from '@/assets/images/layer-icons/wapda-sensors.webp';
import briSensorsIcon from '@/assets/images/layer-icons/bri-sensors.webp';

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
    fillOpacity: 1,
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
  // AKAH Sensors — ships with the AKAH partner mark at 13.5 px radius
  // so users see the branded sensor footprint on first load without
  // having to open the style panel.
  akah_sensors: {
    radius: 13.5,
    marker: {
      shape: 'none',
      icon: akahSensorsIcon,
      backgroundColor: null,
    },
  },
  // GMRC / WAPDA Stations — same treatment with the WAPDA partner
  // mark, same 13.5 px radius for visual parity across the two
  // sensor inventories.
  gmrc_wapda_stations: {
    radius: 13.5,
    marker: {
      shape: 'none',
      icon: wapdaSensorsIcon,
      backgroundColor: null,
    },
  },
  // BRI-FF China Sensors — Chinese partner sensor inventory, same
  // 13.5 px radius for visual parity with the AKAH / WAPDA stations.
  bri_ff_china_sensors: {
    radius: 13.5,
    marker: {
      shape: 'none',
      icon: briSensorsIcon,
      backgroundColor: null,
    },
  },
};

// True when the layer id has a configured default — used by MapPanel to
// gate the data-driven seeding below, and by the renderer to decide
// whether to bother computing categories at all.
export function hasLayerDefaultSymbology(id) {
  return Object.prototype.hasOwnProperty.call(LAYER_DEFAULT_SYMBOLOGY, id);
}
