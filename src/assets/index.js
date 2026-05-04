// Barrel exports for src/assets — Vite-importable URLs.
// Add more entries here as the React app needs them.

// Logos
import ndmaLogo from './images/logos/ndma_logo.webp';

// Common map / UI icons
import iconGlacier from './images/icons/glacier.png';
import iconGlacierBadge from './images/icons/glacier_icon.png';
import iconLakes from './images/icons/lakes.png';
import iconMountain from './images/icons/mountain.png';
import iconHighTempWarning from './images/icons/high_temp_warning.svg';
import iconOsm from './images/icons/osm.webp';
import iconDark from './images/icons/dark.webp';
import iconHybrid from './images/icons/hybrid.webp';
import iconTerrain from './images/icons/terrain.webp';

// Misc
import glofGif from './images/misc/glof.gif';
import locationGif from './images/misc/location1.gif';

// Representative alert and map samples
import alertDarkutGb from './images/alerts/darkut_gb_08_04_2026.jpeg';
import mapChatboiLake from './images/maps/chatboi_lake.jpg';

// Representative video
import bgVideo from './videos/bg_video.mp4';

export const logos = {
  ndma: ndmaLogo,
};

export const icons = {
  glacier: iconGlacier,
  glacierBadge: iconGlacierBadge,
  lakes: iconLakes,
  mountain: iconMountain,
  highTempWarning: iconHighTempWarning,
  basemapOsm: iconOsm,
  basemapDark: iconDark,
  basemapHybrid: iconHybrid,
  basemapTerrain: iconTerrain,
};

export const misc = {
  glof: glofGif,
  location: locationGif,
};

export const alerts = {
  darkutGb: alertDarkutGb,
};

export const maps = {
  chatboiLake: mapChatboiLake,
};

export const videos = {
  background: bgVideo,
};

// String-path fallback (for code that prefers building paths manually,
// e.g. dynamic loaders or non-Vite tooling). Paths are relative to src/assets.
export const paths = {
  logos: {
    ndma: 'images/logos/ndma_logo.webp',
  },
  icons: {
    base: 'images/icons',
    glacier: 'images/icons/glacier.png',
    glacierBadge: 'images/icons/glacier_icon.png',
    lakes: 'images/icons/lakes.png',
    mountain: 'images/icons/mountain.png',
    highTempWarning: 'images/icons/high_temp_warning.svg',
    basemap: {
      osm: 'images/icons/osm.webp',
      dark: 'images/icons/dark.webp',
      hybrid: 'images/icons/hybrid.webp',
      terrain: 'images/icons/terrain.webp',
    },
  },
  misc: {
    glof: 'images/misc/glof.gif',
    location: 'images/misc/location1.gif',
  },
  alerts: {
    base: 'images/alerts',
  },
  maps: {
    base: 'images/maps',
  },
  videos: {
    base: 'videos',
    background: 'videos/bg_video.mp4',
  },
  data: {
    csv: 'data/csv',
    excel: 'data/excel',
    geojson: 'data/geojson',
  },
};

export default { logos, icons, misc, alerts, maps, videos, paths };
