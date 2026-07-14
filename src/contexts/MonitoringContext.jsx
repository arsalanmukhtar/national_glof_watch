import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

export function MonitoringProvider({ children }) {
  const [active, setActive] = useState(false);
  const [layoutId, setLayoutId] = useState('2x2');
  // Per-cell parameter assignment. Keyed by cell area letter (`a` /
  // `b` / …) so switching layouts doesn't shuffle the map you already
  // configured — the same 'a' cell keeps its parameter when the layout
  // grows or shrinks.
  const [cellParameters, setCellParameters] = useState({});

  // Fullscreen flag — MonitoringGrid targets its own wrapper so the
  // parameter pickers + basic controls travel with the maps.
  const [fullscreen, setFullscreen] = useState(false);

  // Basemap + 3D terrain apply to every cell simultaneously — a
  // comparison view stops being one the moment individual cells drift
  // in style. Basemap key matches BASEMAPS in @/config/mapbox.
  // Defaults: satellite + 3D terrain on. Ops asked for the satellite
  // basemap by default because station dots read best over imagery,
  // and terrain on so the topography around each station is legible
  // at the small cell size; exaggeration is trimmed vs. the main map
  // (1.0 not 1.5) so the effect is subtle rather than dominant.
  const [basemap, setBasemap] = useState('satellite');
  const [terrain, setTerrain] = useState(true);

  // Districts overlay configuration. The overlay sits above the
  // basemap and below the station dots in every cell. Colours are
  // deliberately OUT of the app's lime/emerald palette — a boundary
  // reference layer should read as neutral chrome, not compete with
  // the station colouring for attention. Presets are exported so the
  // config panel can render swatches without duplicating the source
  // of truth.
  const [districtsColorId, setDistrictsColorId] = useState('beige');
  // Fill opacity is derived as `districtsOpacity * FILL_RATIO` in the
  // map; the slider primarily drives the outline strength (which is
  // what the operator visually reads as "how prominent are the
  // districts"). Range 0–1.
  const [districtsOpacity, setDistrictsOpacity] = useState(0.8);
  // Outline width in Mapbox line pixels. 1.25 was the original fixed
  // value; slider extends 0.5–3.5 for finer / bolder emphasis.
  const [districtsOutlineWidth, setDistrictsOutlineWidth] = useState(1.5);
  // Label toggle — labels themselves are a fixed red-on-yellow-halo
  // style (see MonitoringMap) so this is a pure on/off. On by
  // default now that names are InitCap (not shouty uppercase) and the
  // layer's `minzoom: 6` gate keeps them from crowding the small
  // cells at overview zoom.
  const [districtsLabels, setDistrictsLabels] = useState(true);

  // Independent NDMA early-warning toggle for the Monitoring surface —
  // deliberately NOT wired to ParameterContext's earlyWarning so the
  // operator can compare PMD-classified data on the main dashboard
  // against NDMA-classified data in the monitoring grid at the same
  // time. Factor mirrors the value used elsewhere.
  const [earlyWarning, setEarlyWarning] = useState(false);
  const EARLY_WARNING_FACTOR = 0.9;

  const setCellParameter = useCallback((cellKey, elementName) => {
    setCellParameters((prev) => ({ ...prev, [cellKey]: elementName || null }));
  }, []);

  // Per-cell selected station — set by clicking a dot in a cell (or by
  // the manual picker inside the Charts panel row). Drives both the
  // per-cell yellow ripple animation on the map AND which station the
  // corresponding chart row plots. Keyed by cellKey so cells stay
  // independent — selecting station X on cell A doesn't touch cell B.
  const [selectedStations, setSelectedStations] = useState({});
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
  // any one map propagates to all the others. `moveEpoch` is a monotonic
  // counter each cell reads to know a change happened; a cell that
  // originated the move skips its own frame (via `originId`) to avoid
  // a feedback loop.
  const [view, setView] = useState(DEFAULT_VIEW);
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
      selectedStations,
      setSelectedStation,
      view,
      moveEpoch,
      originId,
      broadcastView,
      resetView,
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
      selectedStations,
      setSelectedStation,
      view,
      moveEpoch,
      originId,
      broadcastView,
      resetView,
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
