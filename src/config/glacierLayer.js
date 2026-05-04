// Real-time glacier / snow-cover monitoring overlay.
//
// Source: NASA GIBS WMTS — MODIS Terra NDSI Snow Cover.
// Open / free / no key required. Updated daily (best-available imagery).
// Docs: https://nasa-gibs.github.io/gibs-api-docs/
//
// NDSI (Normalized Difference Snow Index) highlights snow + glacier ice.
// The source bounds limit tile requests to Pakistan's glacier-bearing region
// (Hindu Kush / Karakoram / Western Himalaya) so we don't pull tiles globally.

// [west, south, east, north] — covers all major Pakistan glaciers.
export const PAKISTAN_BOUNDS = [60.87, 23.69, 77.84, 37.13];

export const GLACIER_SOURCE_ID = 'glacier-ndsi';
export const GLACIER_LAYER_ID = 'glacier-ndsi-layer';

// "default/default" = latest available date in the GIBS catalogue.
export const GLACIER_TILE_TEMPLATE =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_NDSI_Snow_Cover/default/default/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png';

export const glacierSourceSpec = {
  type: 'raster',
  tiles: [GLACIER_TILE_TEMPLATE],
  tileSize: 256,
  bounds: PAKISTAN_BOUNDS,
  minzoom: 0,
  maxzoom: 8,
  scheme: 'xyz',
  attribution: 'Snow cover: NASA GIBS · MODIS Terra (NDSI)',
};

export const glacierLayerSpec = {
  id: GLACIER_LAYER_ID,
  type: 'raster',
  source: GLACIER_SOURCE_ID,
  layout: { visibility: 'none' },
  paint: {
    'raster-opacity': 0.7,
    'raster-fade-duration': 200,
  },
};
