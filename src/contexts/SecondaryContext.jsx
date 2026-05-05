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
  { id: 'national_boundary',     label: 'National Boundary',     geometry: 'polygon', table: 'secondary.national_boundary' },
  { id: 'provincial_boundary',   label: 'Provincial Boundary',   geometry: 'polygon', table: 'secondary.provincial_boundary' },
  { id: 'district_boundary',     label: 'District Boundary',     geometry: 'polygon', table: 'secondary.district_boundary' },
  { id: 'akah_infrastructure',   label: 'AKAH Infrastructure',   geometry: 'point',   table: 'secondary.akah_infrastructure' },
  { id: 'akah_hazard_exposure',  label: 'AKAH Hazard Exposure',  geometry: 'polygon', table: 'secondary.akah_hazard_exposure' },
  { id: 'all_stations',          label: 'All Stations',          geometry: 'point',   table: 'secondary.all_stations' },
  { id: 'glacial_lakes',         label: 'Glacial Lakes',         geometry: 'polygon', table: 'secondary.glacial_lakes' },
  { id: 'settlements',           label: 'Settlements',           geometry: 'point',   table: 'secondary.settlements' },
];

// Sensible defaults per geometry type. The accent color (#16a085) keeps
// uploaded layers visually consistent with the rest of the app's UI.
export const DEFAULT_STYLES = {
  point: {
    radius: 6,
    fillColor: '#16a085',
    fillOpacity: 0.85,
    strokeColor: '#0f7560',
    strokeWidth: 1.5,
    strokeOpacity: 1,
  },
  line: {
    color: '#16a085',
    width: 2,
    opacity: 1,
    dashed: false,
  },
  polygon: {
    fillColor: '#16a085',
    fillOpacity: 0.3,
    strokeColor: '#0f7560',
    strokeWidth: 1.5,
    strokeOpacity: 1,
  },
};

function defaultStyleFor(geometry) {
  return { ...DEFAULT_STYLES[geometry] };
}

const SecondaryContext = createContext(null);

export function SecondaryProvider({ children }) {
  // visible layers (server-side secondary schema)
  const [visibleLayers, setVisibleLayers] = useState(() => new Set());
  // per-layer style overrides — keyed by layer id (or upload id)
  const [styles, setStyles] = useState(() => {
    const seed = {};
    for (const l of SECONDARY_LAYERS) seed[l.id] = defaultStyleFor(l.geometry);
    return seed;
  });
  // user-uploaded layers (client-side, kept in memory)
  const [uploads, setUploads] = useState([]);
  // which layer's style controls are expanded (single open at a time)
  const [expandedLayer, setExpandedLayer] = useState(null);

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

  const resetLayerStyle = useCallback((id, geometry) => {
    setStyles((prev) => ({
      ...prev,
      [id]: defaultStyleFor(geometry),
    }));
  }, []);

  const addUpload = useCallback((upload) => {
    setUploads((prev) => [...prev, upload]);
    setStyles((prev) => ({
      ...prev,
      [upload.id]: defaultStyleFor(upload.geometry || 'polygon'),
    }));
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
    setExpandedLayer((cur) => (cur === id ? null : cur));
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
      expandedLayer,
      setExpandedLayer,
    }),
    [
      visibleLayers,
      styles,
      uploads,
      expandedLayer,
      toggleLayer,
      setLayerStyle,
      resetLayerStyle,
      addUpload,
      removeUpload,
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
