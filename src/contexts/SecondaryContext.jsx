import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

// Catalog of layers loaded into the `secondary` PostGIS schema. The
// `geometry` field decides which style controls are shown in the panel
// (polygons get fill+stroke, points get radius+fill+stroke, lines get
// line-only controls).
export const SECONDARY_LAYERS = [
  { id: 'national_boundary',                  label: 'National Boundary',                  geometry: 'polygon', table: 'secondary.national_boundary' },
  { id: 'provincial_boundary',                label: 'Provincial Boundary',                geometry: 'polygon', table: 'secondary.provincial_boundary' },
  // GLOF reference layers — fetched live from PMD's GIS host via the
  // /api/gis proxy. No local table backing them.
  { id: 'glof_districts',                     label: 'GLOF Districts',                     geometry: 'polygon', table: null },
  { id: 'glof_basins',                        label: 'GLOF Basins',                        geometry: 'polygon', table: null },
  { id: 'glof_lakes',                         label: 'GLOF Lakes',                         geometry: 'polygon', table: null },
  { id: 'glof_valley',                        label: 'GLOF Valley',                        geometry: 'polygon', table: null },
  { id: 'akah_infrastructure',                label: 'AKAH Infrastructure',                geometry: 'point',   table: 'secondary.akah_infrastructure' },
  { id: 'akah_hazard_exposure',               label: 'AKAH Hazard Exposure',               geometry: 'polygon', table: 'secondary.akah_hazard_exposure' },
  { id: 'akah_sensors',                       label: 'AKAH Sensors',                       geometry: 'point',   table: 'secondary.akah_sensors' },
  { id: 'all_stations',                       label: 'GLOF II PMD Stations',               geometry: 'point',   table: 'secondary.all_stations' },
  { id: 'damaged_stations',                   label: 'Damaged Stations',                   geometry: 'point',   table: 'secondary.damaged_stations' },
  { id: 'bri_ff_china_sensors',               label: 'BRI-FF China Sensors',               geometry: 'point',   table: 'secondary.bri_ff_china_sensors' },
  { id: 'gmrc_wapda_stations',                label: 'GMRC / WAPDA Stations',              geometry: 'point',   table: 'secondary.gmrc_wapda_stations' },
  { id: 'glacial_lakes',                      label: 'Glacial Lakes',                      geometry: 'polygon', table: 'secondary.glacial_lakes' },
  { id: 'settlements',                        label: 'Settlements',                        geometry: 'point',   table: 'secondary.settlements' },
  { id: 'cell_towers',                        label: 'Cell Towers',                        geometry: 'point',   table: 'secondary.cell_towers' },
  // 2026 vulnerability assessment — year-namespaced so successive
  // annual updates can land alongside without clobbering history.
  { id: 'vulnerable_lakes_2026',              label: 'Vulnerable Lakes (2026)',            geometry: 'polygon', table: 'secondary.vulnerable_lakes_2026' },
  { id: 'vulnerable_melting_glaciers_2026',   label: 'Vulnerable Melting Glaciers (2026)', geometry: 'polygon', table: 'secondary.vulnerable_melting_glaciers_2026' },
  { id: 'vulnerable_melting_points_2026',     label: 'Vulnerable Melting Points (2026)',   geometry: 'point',   table: 'secondary.vulnerable_melting_points_2026' },
  { id: 'vulnerable_sites_2026',              label: 'Vulnerable Sites (2026)',            geometry: 'point',   table: 'secondary.vulnerable_sites_2026' },

  // ─── Vector-tile layers (GeoServer GWC TMS/MVT) ──────────────────────
  // These are NOT loaded via the /api/secondary endpoint — Mapbox
  // requests tiles directly from GeoServer's GWC. `vectorTile` carries
  // the source spec (tile URL template, source-layer name inside the
  // MVT, TMS y-axis convention, and the zoom bounds GWC was seeded at).
  // `table: null` keeps the attribute-table paths inert for these
  // layers since we don't have a full FeatureCollection on the client.
  //
  // NOTE: GeoServer GWC MVT tile URLs are TMS (y flipped from XYZ).
  //       `scheme: 'tms'` MUST be set on the source or tiles render
  //       upside-down. `EPSG:900913` = EPSG:3857 (Web Mercator).
  //
  // "Zoom to extent" strategy:
  //   1. The frontend hits `/api/tiles/bounds/:workspace/:sourceLayer`
  //      which parses GeoServer's WMS 1.3.0 GetCapabilities and returns
  //      the actual `<EX_GeographicBoundingBox>` for the layer.
  //   2. If that request fails (backend down, GeoServer unreachable,
  //      caps XML changed shape), we fall back to the static `bounds`
  //      declared here — currently framed on Pakistan since these are
  //      global datasets used in Pakistan context.
  // Add a `workspace` to each entry so the resolver knows which
  // GeoServer workspace to query.
  {
    id: 'vt_bts_sites', label: 'BTS Cell Sites', geometry: 'point', table: null,
    vectorTile: {
      tiles: ['http://172.18.7.21:8080/geoserver/gwc/service/tms/1.0.0/telecom_infrastructure_global:bts_site_details@EPSG:900913@pbf/{z}/{x}/{y}.pbf'],
      workspace: 'telecom_infrastructure_global',
      sourceLayer: 'bts_site_details', scheme: 'tms', minzoom: 0, maxzoom: 14,
      bounds: [60.878, 23.7, 77.837, 37.084],
    },
  },
  // Rivers turned out to be polygon layers in the source tiles (river
  // channel outlines, not centrelines) — hence `polygon` here so the
  // `fill` layer picks them up. A `line` layer against polygon tile
  // geometry rendered nothing at all.
  {
    id: 'vt_major_rivers', label: 'Major Rivers', geometry: 'polygon', table: null,
    vectorTile: {
      tiles: ['http://172.18.7.21:8080/geoserver/gwc/service/tms/1.0.0/hydrological_global:major_rivers@EPSG:900913@pbf/{z}/{x}/{y}.pbf'],
      workspace: 'hydrological_global',
      sourceLayer: 'major_rivers', scheme: 'tms', minzoom: 0, maxzoom: 14,
      bounds: [60.878, 23.7, 77.837, 37.084],
    },
  },
  {
    id: 'vt_minor_rivers', label: 'Minor Rivers', geometry: 'polygon', table: null,
    vectorTile: {
      tiles: ['http://172.18.7.21:8080/geoserver/gwc/service/tms/1.0.0/hydrological_global:minor_rivers@EPSG:900913@pbf/{z}/{x}/{y}.pbf'],
      workspace: 'hydrological_global',
      sourceLayer: 'minor_rivers', scheme: 'tms', minzoom: 0, maxzoom: 14,
      bounds: [60.878, 23.7, 77.837, 37.084],
    },
  },
  {
    id: 'vt_reservoirs', label: 'Reservoirs', geometry: 'polygon', table: null,
    vectorTile: {
      tiles: ['http://172.18.7.21:8080/geoserver/gwc/service/tms/1.0.0/hydrological_global:reservoirs@EPSG:900913@pbf/{z}/{x}/{y}.pbf'],
      workspace: 'hydrological_global',
      sourceLayer: 'reservoirs', scheme: 'tms', minzoom: 0, maxzoom: 14,
      bounds: [60.878, 23.7, 77.837, 37.084],
    },
  },
  {
    id: 'vt_watersheds', label: 'Watersheds', geometry: 'polygon', table: null,
    vectorTile: {
      tiles: ['http://172.18.7.21:8080/geoserver/gwc/service/tms/1.0.0/hydrological_global:water_shed@EPSG:900913@pbf/{z}/{x}/{y}.pbf'],
      workspace: 'hydrological_global',
      sourceLayer: 'water_shed', scheme: 'tms', minzoom: 0, maxzoom: 14,
      bounds: [60.878, 23.7, 77.837, 37.084],
    },
  },
  // Dam layers — best guess is point geometry (structure locations).
  // If they turn out to be polygons in the tile, flip the `geometry`
  // field here to 'polygon' — nothing else needs to change.
  {
    id: 'vt_minor_dams', label: 'Minor Dams', geometry: 'point', table: null,
    vectorTile: {
      tiles: ['http://172.18.7.21:8080/geoserver/gwc/service/tms/1.0.0/hydrological_global:minor_dams@EPSG:900913@pbf/{z}/{x}/{y}.pbf'],
      workspace: 'hydrological_global',
      sourceLayer: 'minor_dams', scheme: 'tms', minzoom: 0, maxzoom: 14,
      bounds: [60.878, 23.7, 77.837, 37.084],
    },
  },
  {
    id: 'vt_major_dams', label: 'Major Dams', geometry: 'point', table: null,
    vectorTile: {
      tiles: ['http://172.18.7.21:8080/geoserver/gwc/service/tms/1.0.0/hydrological_global:major_dams@EPSG:900913@pbf/{z}/{x}/{y}.pbf'],
      workspace: 'hydrological_global',
      sourceLayer: 'major_dams', scheme: 'tms', minzoom: 0, maxzoom: 14,
      bounds: [60.878, 23.7, 77.837, 37.084],
    },
  },
];

// Sensible defaults per geometry type. The accent color (#84cc16) keeps
// uploaded layers visually consistent with the rest of the app's UI.
export const DEFAULT_STYLES = {
  point: {
    radius: 6,
    fillColor: '#84cc16',
    fillOpacity: 0.85,
    strokeColor: '#4d7c0f',
    strokeWidth: 1.5,
    strokeOpacity: 1,
    // Marker symbology — when `marker.shape !== 'none'` OR `marker.icon`
    // is set, the renderer swaps the layer from `circle` to `symbol`
    // and registers a generated PNG via `map.addImage()`. Defaults below
    // keep behaviour identical to the pre-marker version.
    //
    // Colour semantics:
    //   • fillColor      → ICON colour (always)
    //   • strokeColor    → halo / outline colour around the marker
    //   • marker.backgroundColor → shape fill, only used when shape
    //                              is 'circle' or 'square'. null falls
    //                              back to fillColor for back-compat.
    marker: {
      shape: 'none',           // 'none' | 'circle' | 'square'
      icon: null,              // string id from src/config/markerIcons.js, or null
      backgroundColor: null,   // hex string or null (= use fillColor)
    },
  },
  line: {
    color: '#84cc16',
    width: 2,
    opacity: 1,
    dashed: false,
  },
  polygon: {
    fillColor: '#84cc16',
    fillOpacity: 0.3,
    strokeColor: '#4d7c0f',
    strokeWidth: 1.5,
    strokeOpacity: 1,
  },
};

const SecondaryContext = createContext(null);

// Layer ids that should be toggled ON the very first time the app
// renders — the consolidated published reference set we want users to
// land on. Subsequent toggling is normal context state so flipping any
// of these off persists for the session.
const DEFAULT_VISIBLE_LAYERS = [
  'all_stations',
  'akah_sensors',
  'gmrc_wapda_stations',
  'vulnerable_lakes_2026',
  'vulnerable_melting_glaciers_2026',
  'vulnerable_melting_points_2026',
  'vulnerable_sites_2026',
];

export function SecondaryProvider({ children }) {
  // visible layers (server-side secondary schema)
  const [visibleLayers, setVisibleLayers] = useState(
    () => new Set(DEFAULT_VISIBLE_LAYERS),
  );
  // per-layer style overrides — keyed by layer id (region composite, secondary
  // id, or upload id). Empty by default; entries appear lazily once the user
  // tweaks something. Readers should compose with `effectiveStyle()` so they
  // get the right defaults (including region-tint seeding) when no override
  // exists yet.
  const [styles, setStyles] = useState(() => ({}));
  // user-uploaded layers (client-side, kept in memory)
  const [uploads, setUploads] = useState([]);
  // db-loaded layers — entries pulled live from the connected PostGIS DB
  // via the BrowseDatabaseModal. Each entry is shaped like an upload
  // ({ id, label, geometry, data }) so the existing render path can treat
  // them uniformly.
  const [dbLayers, setDbLayers] = useState([]);

  const toggleLayer = useCallback((id) => {
    setVisibleLayers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setLayerStyle = useCallback((id, partial) => {
    setStyles((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...partial },
    }));
  }, []);

  const resetLayerStyle = useCallback((id) => {
    setStyles((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const addUpload = useCallback((upload) => {
    setUploads((prev) => [...prev, upload]);
    // Style entry is created lazily on first edit; readers compose defaults
    // with `effectiveStyle()`.
    setVisibleLayers((prev) => {
      const next = new Set(prev);
      next.add(upload.id);
      return next;
    });
  }, []);

  const removeUpload = useCallback((id) => {
    setUploads((prev) => prev.filter((u) => u.id !== id));
    setVisibleLayers((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setStyles((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const addDbLayers = useCallback((layers) => {
    if (!Array.isArray(layers) || !layers.length) return;
    setDbLayers((prev) => {
      const seen = new Set(prev.map((l) => l.id));
      const fresh = layers.filter((l) => l && l.id && !seen.has(l.id));
      return fresh.length ? [...prev, ...fresh] : prev;
    });
    setVisibleLayers((prev) => {
      const next = new Set(prev);
      for (const l of layers) if (l?.id) next.add(l.id);
      return next;
    });
  }, []);

  const removeDbLayer = useCallback((id) => {
    setDbLayers((prev) => prev.filter((l) => l.id !== id));
    setVisibleLayers((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setStyles((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      layers: SECONDARY_LAYERS,
      visibleLayers,
      toggleLayer,
      styles,
      setLayerStyle,
      resetLayerStyle,
      uploads,
      addUpload,
      removeUpload,
      dbLayers,
      addDbLayers,
      removeDbLayer,
    }),
    [
      visibleLayers,
      styles,
      uploads,
      dbLayers,
      toggleLayer,
      setLayerStyle,
      resetLayerStyle,
      addUpload,
      removeUpload,
      addDbLayers,
      removeDbLayer,
    ],
  );

  return (
    <SecondaryContext.Provider value={value}>
      {children}
    </SecondaryContext.Provider>
  );
}

export function useSecondary() {
  const ctx = useContext(SecondaryContext);
  if (!ctx) {
    throw new Error('useSecondary must be used inside SecondaryProvider');
  }
  return ctx;
}
