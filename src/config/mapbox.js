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

export const BASEMAPS = {
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
  streets: 'mapbox://styles/mapbox/streets-v12',
  outdoors: 'mapbox://styles/mapbox/outdoors-v12',
  light: 'mapbox://styles/mapbox/light-v11',
  dark: 'mapbox://styles/mapbox/dark-v11',
};

export { mapboxgl };
