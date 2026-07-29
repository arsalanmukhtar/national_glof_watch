import mapboxgl from 'mapbox-gl';
import {
  MAPBOX_TOKEN,
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
  DEFAULT_MAP_PITCH,
} from './env';

// Mapbox token must come from env per security review (never inline in source).
mapboxgl.accessToken = MAPBOX_TOKEN;

export const DEFAULT_MAP_STYLE = 'mapbox://styles/mapbox/satellite-streets-v12';

export const DEFAULT_MAP_VIEW = {
  center: DEFAULT_MAP_CENTER,
  zoom: DEFAULT_MAP_ZOOM,
  pitch: DEFAULT_MAP_PITCH,
  bearing: 0,
};

// ESRI World Imagery — free (no API key) satellite hybrid alternative
// to Google Hybrid. Composed as a plain Mapbox StyleSpecification with
// three raster sources stacked bottom-to-top:
//   1. imagery       — the base satellite tiles (Maxar / Landsat mix)
//   2. transportation — thin road overlay
//   3. boundaries + places — administrative outlines + city / place names
// `map.setStyle(styleSpec)` accepts an inline object exactly like a
// style URL, so this drops into BASEMAPS alongside the Mapbox entries.
// Attribution is required per Esri's public services ToS.
const ESRI_ATTRIBUTION =
  'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community';

export const ESRI_WORLD_IMAGERY_STYLE = {
  version: 8,
  // Glyphs must resolve for any downstream label logic that inherits
  // the style; point at Mapbox's public font endpoint (requires the
  // access token that's already set on mapboxgl above).
  glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
  sources: {
    'esri-world-imagery': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: ESRI_ATTRIBUTION,
    },
    'esri-transportation': {
      type: 'raster',
      tiles: [
        'https://services.arcgisonline.com/arcgis/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
    },
    'esri-boundaries-places': {
      type: 'raster',
      tiles: [
        'https://services.arcgisonline.com/arcgis/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
    },
  },
  layers: [
    { id: 'esri-world-imagery',     type: 'raster', source: 'esri-world-imagery' },
    { id: 'esri-transportation',    type: 'raster', source: 'esri-transportation' },
    { id: 'esri-boundaries-places', type: 'raster', source: 'esri-boundaries-places' },
  ],
};

export const BASEMAPS = {
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
  streets:   'mapbox://styles/mapbox/streets-v12',
  outdoors:  'mapbox://styles/mapbox/outdoors-v12',
  light:     'mapbox://styles/mapbox/light-v11',
  dark:      'mapbox://styles/mapbox/dark-v11',
  esri:      ESRI_WORLD_IMAGERY_STYLE,
};

export { mapboxgl };
