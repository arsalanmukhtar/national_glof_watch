import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

// Grid layout catalog. Each layout is a fixed number of cells with a
// CSS-grid template that MonitoringGrid drops into `style`. `cells`
// controls how many parameter slots the config panel exposes. The
// single-cell layout is deliberately omitted — a monitoring surface
// with one cell is functionally identical to the main dashboard's
// map, so we lean on the multi-cell comparison views (which is the
// entire reason this feature exists).
export const MONITORING_LAYOUTS = [
  {
    id: '2x2',
    label: '2 × 2',
    cells: 4,
    template: {
      gridTemplateColumns: '1fr 1fr',
      gridTemplateRows: '1fr 1fr',
      gridTemplateAreas: '"a b" "c d"',
    },
    areas: ['a', 'b', 'c', 'd'],
  },
  {
    id: '1|2',
    label: '1 | 2',
    cells: 3,
    // Left column spans both rows; right column splits into two stacked.
    template: {
      gridTemplateColumns: '1fr 1fr',
      gridTemplateRows: '1fr 1fr',
      gridTemplateAreas: '"a b" "a c"',
    },
    areas: ['a', 'b', 'c'],
  },
  {
    id: '2+1',
    label: '2 + 1',
    cells: 3,
    // Top row spans both columns; bottom row splits into two cells.
    template: {
      gridTemplateColumns: '1fr 1fr',
      gridTemplateRows: '1fr 1fr',
      gridTemplateAreas: '"a a" "b c"',
    },
    areas: ['a', 'b', 'c'],
  },
];

export function layoutById(id) {
  return MONITORING_LAYOUTS.find((l) => l.id === id) ?? MONITORING_LAYOUTS[0];
}

// District overlay colour presets. Deliberately out-of-theme
// (grayscale + earth tones) so the reference boundary reads as neutral
// chrome and never competes with the station-dot palette. Each preset
// pairs a soft fill with a stronger outline in the same family.
export const DISTRICT_COLOR_PRESETS = [
  { id: 'beige',    label: 'Beige',    fill: '#d4b483', line: '#7a5a2b' },
  { id: 'sand',     label: 'Sand',     fill: '#e7d5b7', line: '#a68a5b' },
  { id: 'gray',     label: 'Gray',     fill: '#cbd5e1', line: '#334155' },
  { id: 'charcoal', label: 'Charcoal', fill: '#94a3b8', line: '#0f172a' },
  { id: 'mocha',    label: 'Mocha',    fill: '#c8a97e', line: '#5d4a2b' },
];

export function districtPresetById(id) {
  return (
    DISTRICT_COLOR_PRESETS.find((p) => p.id === id) ?? DISTRICT_COLOR_PRESETS[0]
  );
}

// Basemap is dimmed to a fixed 60% so overlays (districts + station
// dots) always read clearly on top of dense satellite imagery. Fixed
// rather than a slider — the operator was tuning this the same way
// every time; removing the control is one less thing between them and
// the data.
export const BASEMAP_OPACITY = 0.6;

const MonitoringContext = createContext(null);

// Default map view — mirrors DEFAULT_MAP_VIEW in @/config/mapbox but kept
// local so a Monitoring reset doesn't accidentally rewire the main map.
const DEFAULT_VIEW = {
  center: [72.5, 35.5],
  zoom: 6,
  bearing: 0,
  pitch: 0,
};

// localStorage-backed useState. Persists the value under a namespaced,
// versioned key so a schema change (bump `version`) drops stale
// entries automatically instead of hydrating an incompatible shape.
// Skipped during SSR (window guard) — this app doesn't SSR but the
// guard costs nothing and keeps the hook portable.
const STORAGE_PREFIX = 'monitoring';
function usePersistentState(key, initial, { version = 1 } = {}) {
  const storageKey = `${STORAGE_PREFIX}:${key}:v${version}`;
  const [value, setValue] = useState(() => {
    if (typeof window === 'undefined') {
      return typeof initial === 'function' ? initial() : initial;
    }
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw != null) return JSON.parse(raw);
    } catch { /* corrupt entry — fall through to default */ }
    return typeof initial === 'function' ? initial() : initial;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(value));
    } catch { /* quota exceeded / private mode — silent */ }
  }, [storageKey, value]);
  return [value, setValue];
}

export function MonitoringProvider({ children }) {
  // Every user-facing preference below is persisted to localStorage
  // via usePersistentState so a page reload restores the operator's
  // exact working state (parameters picked per cell, stations they
  // clicked, map pan/zoom, basemap, terrain, districts styling,
  // classification method, chart window). Ephemeral state
  // (fullscreen, sync counters, refs) stays in-memory only.
  const [active, setActive] = usePersistentState('active', false);
  const [layoutId, setLayoutId] = usePersistentState('layoutId', '2x2');
  // Per-cell parameter assignment. Keyed by cell area letter (`a` /
  // `b` / …) so switching layouts doesn't shuffle the map you already
  // configured — the same 'a' cell keeps its parameter when the layout
  // grows or shrinks.
  const [cellParameters, setCellParameters] = usePersistentState('cellParameters', {});

  // Fullscreen flag — MonitoringGrid targets its own wrapper so the
  // parameter pickers + basic controls travel with the maps. NOT
  // persisted: fullscreen on reload without operator intent is a
  // surprise, not a convenience.
  const [fullscreen, setFullscreen] = useState(false);

  // Basemap + 3D terrain apply to every cell simultaneously — a
  // comparison view stops being one the moment individual cells drift
  // in style. Basemap key matches BASEMAPS in @/config/mapbox.
  // Defaults: satellite + 3D terrain on. Ops asked for the satellite
  // basemap by default because station dots read best over imagery,
  // and terrain on so the topography around each station is legible
  // at the small cell size; exaggeration is trimmed vs. the main map
  // (1.0 not 1.5) so the effect is subtle rather than dominant.
  const [basemap, setBasemap] = usePersistentState('basemap', 'satellite');
  const [terrain, setTerrain] = usePersistentState('terrain', true);

  // Districts overlay configuration. The overlay sits above the
  // basemap and below the station dots in every cell. Colours are
  // deliberately OUT of the app's lime/emerald palette — a boundary
  // reference layer should read as neutral chrome, not compete with
  // the station colouring for attention. Presets are exported so the
  // config panel can render swatches without duplicating the source
  // of truth.
  const [districtsColorId, setDistrictsColorId] = usePersistentState('districtsColorId', 'beige');
  // Fill opacity is derived as `districtsOpacity * FILL_RATIO` in the
  // map; the slider primarily drives the outline strength (which is
  // what the operator visually reads as "how prominent are the
  // districts"). Range 0–1.
  const [districtsOpacity, setDistrictsOpacity] = usePersistentState('districtsOpacity', 0.8);
  // Outline width in Mapbox line pixels. 1.25 was the original fixed
  // value; slider extends 0.5–3.5 for finer / bolder emphasis.
  const [districtsOutlineWidth, setDistrictsOutlineWidth] = usePersistentState('districtsOutlineWidth', 1.5);
  // Label toggle — labels themselves are a fixed red-on-yellow-halo
  // style (see MonitoringMap) so this is a pure on/off. On by
  // default now that names are InitCap (not shouty uppercase) and the
  // layer's `minzoom: 6` gate keeps them from crowding the small
  // cells at overview zoom.
  const [districtsLabels, setDistrictsLabels] = usePersistentState('districtsLabels', true);

  // Trend window shared across every chart row AND used by the report
  // generator to label + fetch the right slice. Lifted out of the
  // ChartsPanel local state so the report modal can display the
  // effective window and hand it to the PDF pipeline.
  const [chartWindowMode, setChartWindowMode] = usePersistentState('chartWindowMode', 'daily'); // 'daily' | 'weekly' | 'custom'
  const [chartCustomDays, setChartCustomDays] = usePersistentState('chartCustomDays', 14);
  const chartDays =
    chartWindowMode === 'daily'
      ? 1
      : chartWindowMode === 'weekly'
        ? 7
        : Math.max(1, Math.min(60, Number(chartCustomDays) || 1));

  // Independent NDMA early-warning toggle for the Monitoring surface —
  // deliberately NOT wired to ParameterContext's earlyWarning so the
  // operator can compare PMD-classified data on the main dashboard
  // against NDMA-classified data in the monitoring grid at the same
  // time. Factor mirrors the value used elsewhere.
  const [earlyWarning, setEarlyWarning] = usePersistentState('earlyWarning', false);
  const EARLY_WARNING_FACTOR = 0.9;

  const setCellParameter = useCallback((cellKey, elementName) => {
    setCellParameters((prev) => ({ ...prev, [cellKey]: elementName || null }));
  }, []);

  // Per-cell selected station — set by clicking a dot in a cell (or by
  // the manual picker inside the Charts panel row). Drives both the
  // per-cell yellow ripple animation on the map AND which station the
  // corresponding chart row plots. Keyed by cellKey so cells stay
  // independent — selecting station X on cell A doesn't touch cell B.
  const [selectedStations, setSelectedStations] = usePersistentState('selectedStations', {});
  const setSelectedStation = useCallback((cellKey, station) => {
    setSelectedStations((prev) => {
      const cur = prev[cellKey];
      // Toggle: clicking the same station a second time clears it.
      if (station == null || (cur && cur.stationId === station?.stationId)) {
        const next = { ...prev };
        delete next[cellKey];
        return next;
      }
      return { ...prev, [cellKey]: station };
    });
  }, []);
  // Clear a cell's selection when its parameter changes — the previously
  // selected station may not report the new parameter, so the ripple +
  // chart would go stale.
  useEffect(() => {
    setSelectedStations((prev) => {
      const next = {};
      for (const key of Object.keys(prev)) {
        if (cellParameters[key]) next[key] = prev[key];
      }
      return next;
    });
  }, [cellParameters]);

  // Shared view state broadcast across every cell so pan/zoom/rotate on
  // any one map propagates to all the others. `view` is persisted so
  // reloads restore the operator's exact map pose. `moveEpoch` and
  // `originId` are transient sync coordinators — persisting them
  // would trigger a spurious jumpTo on the first mount after reload.
  const [view, setView] = usePersistentState('view', DEFAULT_VIEW);
  const [moveEpoch, setMoveEpoch] = useState(0);
  const [originId, setOriginId] = useState(null);

  const broadcastView = useCallback((nextView, origin) => {
    setView((prev) => ({ ...prev, ...nextView }));
    setOriginId(origin ?? null);
    setMoveEpoch((n) => n + 1);
  }, []);

  const resetView = useCallback(() => {
    setView(DEFAULT_VIEW);
    setOriginId(null);
    setMoveEpoch((n) => n + 1);
  }, []);

  // Per-cell map API registry — each MonitoringMap registers a small
  // interface (currently { snapshot, getMap }) on mount so the report
  // generator can grab live map pixels + coordinates on demand
  // without threading refs through a dozen components. Kept as a
  // mutable Map inside a ref so re-registration doesn't churn React
  // state and trigger re-renders across the tree.
  const mapApisRef = useRef(new Map());
  const registerMapApi = useCallback((cellKey, api) => {
    mapApisRef.current.set(cellKey, api);
    return () => {
      // Only clear if this exact api is still registered — a rapid
      // remount can otherwise wipe the newly-registered api.
      if (mapApisRef.current.get(cellKey) === api) {
        mapApisRef.current.delete(cellKey);
      }
    };
  }, []);
  const getMapApi = useCallback((cellKey) => mapApisRef.current.get(cellKey), []);
  const listMapApis = useCallback(
    () => Array.from(mapApisRef.current.entries()),
    [],
  );

  // Same pattern for chart rows — MonitoringChartRow registers
  // { snapshot, getData } so the report generator can grab the
  // exact chart image + resolved data the operator is looking at
  // without re-fetching or off-screen rendering.
  //
  // Additionally exposes `chartApisVersion` — a monotonically
  // increasing counter that bumps on every register/unregister. UI
  // that wants to react to chart data changes (e.g. the report
  // modal previewing which station each cell resolved to) can key
  // a useMemo off it and stay in sync without polling.
  const chartApisRef = useRef(new Map());
  const [chartApisVersion, setChartApisVersion] = useState(0);
  const registerChartApi = useCallback((cellKey, api) => {
    chartApisRef.current.set(cellKey, api);
    setChartApisVersion((n) => n + 1);
    return () => {
      if (chartApisRef.current.get(cellKey) === api) {
        chartApisRef.current.delete(cellKey);
        setChartApisVersion((n) => n + 1);
      }
    };
  }, []);
  const getChartApi = useCallback((cellKey) => chartApisRef.current.get(cellKey), []);

  const value = useMemo(
    () => ({
      active,
      setActive,
      layoutId,
      setLayoutId,
      cellParameters,
      setCellParameter,
      fullscreen,
      setFullscreen,
      basemap,
      setBasemap,
      terrain,
      setTerrain,
      districtsColorId,
      setDistrictsColorId,
      districtsOpacity,
      setDistrictsOpacity,
      districtsOutlineWidth,
      setDistrictsOutlineWidth,
      districtsLabels,
      setDistrictsLabels,
      earlyWarning,
      setEarlyWarning,
      earlyWarningFactor: EARLY_WARNING_FACTOR,
      chartWindowMode,
      setChartWindowMode,
      chartCustomDays,
      setChartCustomDays,
      chartDays,
      selectedStations,
      setSelectedStation,
      view,
      moveEpoch,
      originId,
      broadcastView,
      resetView,
      registerMapApi,
      getMapApi,
      listMapApis,
      registerChartApi,
      getChartApi,
      chartApisVersion,
    }),
    [
      active,
      layoutId,
      cellParameters,
      setCellParameter,
      fullscreen,
      basemap,
      terrain,
      districtsColorId,
      districtsOpacity,
      districtsOutlineWidth,
      districtsLabels,
      earlyWarning,
      chartWindowMode,
      chartCustomDays,
      chartDays,
      selectedStations,
      setSelectedStation,
      view,
      moveEpoch,
      originId,
      broadcastView,
      resetView,
      registerMapApi,
      getMapApi,
      listMapApis,
      registerChartApi,
      getChartApi,
      chartApisVersion,
    ],
  );

  return (
    <MonitoringContext.Provider value={value}>
      {children}
    </MonitoringContext.Provider>
  );
}

export function useMonitoring() {
  const ctx = useContext(MonitoringContext);
  if (!ctx) {
    throw new Error('useMonitoring must be used inside MonitoringProvider');
  }
  return ctx;
}
