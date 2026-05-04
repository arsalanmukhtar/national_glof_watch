const env = import.meta.env;

export const MAPBOX_TOKEN = env.VITE_MAPBOX_TOKEN ?? '';
export const GEOSERVER_BASE_URL = env.VITE_GEOSERVER_BASE_URL ?? '';
export const GEOSERVER_PROVINCIAL_URL = env.VITE_GEOSERVER_PROVINCIAL_URL ?? '';

export const DEFAULT_MAP_CENTER = [
  Number(env.VITE_DEFAULT_MAP_CENTER_LNG ?? 72.98695108531231),
  Number(env.VITE_DEFAULT_MAP_CENTER_LAT ?? 35.323007094843575),
];

export const DEFAULT_MAP_ZOOM = Number(env.VITE_DEFAULT_MAP_ZOOM ?? 7);
export const DEFAULT_MAP_PITCH = Number(env.VITE_DEFAULT_MAP_PITCH ?? 60);

export const IS_DEV = env.DEV === true;
export const IS_PROD = env.PROD === true;
