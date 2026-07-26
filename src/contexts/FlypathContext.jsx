import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

// FlypathContext — global state for the Lake Flypath surface.
// ---------------------------------------------------------------------------
// Data model:
//   • routes            — Route[]: every uploaded flypath. All routes
//                         are drawn on the map at once so the user can
//                         see multiple melt paths converging on the
//                         same lake.
//   • selectedRouteId   — which route the animation + elevation chart
//                         are bound to. Only the selected route's
//                         chevron marker moves; the rest stay static.
//   • features          — single FeatureCollection layer of contextual
//                         polygons/points (lakes) shown under all routes.
//
// A Route is { id, name, kind, fc, style } where `style` is the paint
// config for that route's line + casing.

const FlypathContext = createContext(null);

// Distinct paint config per route. `outlineColor` renders as a wider
// casing beneath the main line for legibility. `color` and `width`
// drive the primary line.
const DEFAULT_ROUTE_STYLE_BASE = {
  // Outline colour matches the fill so the "no outline" default
  // reads as a plain solid line. When outlineColor === color the
  // casing layer is suppressed on the map (see FlypathMapLayer),
  // so the visible width matches the width knob exactly.
  outlineColor: '#dc2626',
  width:        2,
  opacity:      1,
};

// Colour palette used when auto-assigning a colour to a new route.
// First slot is sharp red (default per request); subsequent routes
// cycle through other high-contrast picks so multiples still stay
// distinguishable.
const ROUTE_COLOR_CYCLE = [
  '#dc2626', // red-600 — sharp red, default for the first route
  '#38bdf8', // sky-500
  '#a3e635', // lime-400
  '#f472b6', // pink-400
  '#fbbf24', // amber-400
  '#22d3ee', // cyan-400
  '#c084fc', // violet-400
  '#4ade80', // green-400
];

const DEFAULT_FEATURES_STYLE = {
  color:        '#38bdf8',   // sky-500 — the "custom blue"
  outlineColor: '#0079fa',   // deeper blue — outline stays crisp on top
                             // of the translucent fill and reads as a
                             // clear boundary.
  width:        2,
  opacity:      0.30,
};

// Small stable id generator — crypto.randomUUID where available,
// timestamp + random fallback otherwise.
function genId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch { /* ignore */ }
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function FlypathProvider({ children }) {
  const [routes, setRoutes] = useState([]);
  const [selectedRouteId, setSelectedRouteId] = useState(null);

  const [features, setFeaturesRaw] = useState(null);
  const [featuresStyle, setFeaturesStyleRaw] = useState(DEFAULT_FEATURES_STYLE);
  const setFeaturesStyle = useCallback((partial) =>
    setFeaturesStyleRaw((prev) => ({ ...prev, ...partial })), []);

  // Playback state machine: 'stopped' | 'playing' | 'paused'.
  const [playState, setPlayState] = useState('stopped');

  // Fly-to nonces per layer group.
  const [routesFlyTick,   setRoutesFlyTick]   = useState(0);
  const [featuresFlyTick, setFeaturesFlyTick] = useState(0);
  const requestFlyToRoutes   = useCallback(() => setRoutesFlyTick((n) => n + 1), []);
  const requestFlyToFeatures = useCallback(() => setFeaturesFlyTick((n) => n + 1), []);

  // Panel-open broadcast for the chart tab auto-switch.
  const [active, setActiveRaw] = useState(false);
  const setActive = useCallback((v) => setActiveRaw(Boolean(v)), []);

  // Elevation profile of the currently-selected route.
  const [elevationProfile, setElevationProfile] = useState(null);

  // Shared animation phase.
  const phaseRef = useRef(0);

  // User-configurable flight duration — defaults to 1.5 min so a
  // typical route reads as a leisurely guided tour rather than a
  // brisk 30-second flyover.
  const [flightDuration, setFlightDurationRaw] = useState(90_000);
  const setFlightDuration = useCallback((ms) => {
    const num = Number(ms);
    if (!Number.isFinite(num)) return;
    setFlightDurationRaw(Math.max(5_000, Math.min(300_000, num)));
  }, []);

  // ---------------------------------------------------------------
  // Digitize (on-map draw) state.
  //   • digitizing    — true while the user is actively drawing a
  //                     new route on the map. The FlypathDigitizer
  //                     component owns the map interactions; this
  //                     flag drives both its lifecycle and the
  //                     panel's floating toolbar.
  //   • drawnCoords   — the in-progress LineString vertices. Update
  //                     through addDrawnVertex / undoDrawnVertex /
  //                     replaceDrawnCoords so the map preview stays
  //                     in sync.
  //   • pendingDrawn  — set on Finish; carries the finished coords
  //                     until the user picks a save format or dismisses.
  // ---------------------------------------------------------------
  const [digitizing, setDigitizing]   = useState(false);
  const [drawnCoords, setDrawnCoords] = useState([]);
  const [pendingDrawn, setPendingDrawn] = useState(null);

  const startDigitize = useCallback(() => {
    setDrawnCoords([]);
    setPendingDrawn(null);
    setDigitizing(true);
  }, []);

  const cancelDigitize = useCallback(() => {
    setDrawnCoords([]);
    setDigitizing(false);
    setPendingDrawn(null);
  }, []);

  const addDrawnVertex = useCallback((lngLat) => {
    if (!Array.isArray(lngLat) || lngLat.length < 2) return;
    setDrawnCoords((prev) => [...prev, [lngLat[0], lngLat[1]]]);
  }, []);
  const undoDrawnVertex = useCallback(() => {
    setDrawnCoords((prev) => (prev.length ? prev.slice(0, -1) : prev));
  }, []);
  const replaceDrawnCoords = useCallback((coords) => {
    if (!Array.isArray(coords)) return;
    setDrawnCoords(coords);
  }, []);

  const finishDigitize = useCallback(() => {
    setDrawnCoords((coords) => {
      if (coords.length >= 2) {
        setPendingDrawn({ coords });
      }
      setDigitizing(false);
      return [];
    });
  }, []);

  const clearPendingDrawn = useCallback(() => setPendingDrawn(null), []);

  // ---------------------------------------------------------------
  // Route actions.
  // ---------------------------------------------------------------
  const addRoute = useCallback((parsed) => {
    if (!parsed?.fc?.features?.length) return null;
    const id = genId();
    setRoutes((prev) => {
      const next = [
        ...prev,
        {
          id,
          name: parsed.name,
          kind: parsed.kind,
          fc:   parsed.fc,
          style: {
            ...DEFAULT_ROUTE_STYLE_BASE,
            color: ROUTE_COLOR_CYCLE[prev.length % ROUTE_COLOR_CYCLE.length],
          },
        },
      ];
      return next;
    });
    // Auto-select the first route added. Subsequent additions leave
    // the current selection in place — the operator chose it deliberately.
    setSelectedRouteId((prev) => prev ?? id);
    // Invalidate playback + the sampled profile — the map now has
    // extra routes to fit and the selected route may or may not have
    // changed but the caller will re-sample either way.
    setPlayState('stopped');
    setElevationProfile(null);
    return id;
  }, []);

  const removeRoute = useCallback((id) => {
    setRoutes((prev) => prev.filter((r) => r.id !== id));
    setSelectedRouteId((prev) => {
      if (prev !== id) return prev;
      // If we removed the selected one, hand selection to the first
      // remaining route (or null if none left).
      // Note: we read the current routes via the setter below in a
      // second call — cleaner to compute here inside a functional
      // update chain, but this is clearer.
      return null;
    });
    setPlayState('stopped');
    setElevationProfile(null);
  }, []);

  const selectRoute = useCallback((id) => {
    setSelectedRouteId(id);
    setPlayState('stopped');
    setElevationProfile(null);
  }, []);

  const setRouteStyleFor = useCallback((id, partial) => {
    setRoutes((prev) => prev.map((r) =>
      r.id === id ? { ...r, style: { ...r.style, ...partial } } : r,
    ));
  }, []);

  // Auto-repair: if selectedRouteId falls out of routes (e.g. after a
  // remove), snap selection to the first remaining route.
  const effectiveSelectedId = useMemo(() => {
    if (routes.length === 0) return null;
    if (routes.some((r) => r.id === selectedRouteId)) return selectedRouteId;
    return routes[0].id;
  }, [routes, selectedRouteId]);

  const selectedRoute = useMemo(
    () => routes.find((r) => r.id === effectiveSelectedId) ?? null,
    [routes, effectiveSelectedId],
  );

  // ---------------------------------------------------------------
  // Features actions.
  // ---------------------------------------------------------------
  const setFeatures    = useCallback((payload) => setFeaturesRaw(payload), []);
  const clearFeatures  = useCallback(() => setFeaturesRaw(null), []);

  // ---------------------------------------------------------------
  // Playback transitions. `hasRoute` is now "at least one route
  // present"; the animation binds to the selected route.
  // ---------------------------------------------------------------
  const hasRoute = routes.length > 0 && selectedRoute?.fc?.features?.length > 0;

  const start = useCallback(() => {
    if (!hasRoute) return;
    setPlayState('playing');
  }, [hasRoute]);
  const pause  = useCallback(() => setPlayState((s) => (s === 'playing' ? 'paused' : s)), []);
  const resume = useCallback(() => setPlayState((s) => (s === 'paused' ? 'playing' : s)), []);
  const stop   = useCallback(() => setPlayState('stopped'), []);
  const togglePlayPause = useCallback(() => {
    setPlayState((s) => {
      if (s === 'playing') return 'paused';
      if (s === 'paused')  return 'playing';
      if (hasRoute) return 'playing';
      return s;
    });
  }, [hasRoute]);

  const value = useMemo(() => ({
    // Route collection
    routes,
    selectedRoute,
    selectedRouteId: effectiveSelectedId,
    hasRoute,
    addRoute,
    removeRoute,
    selectRoute,
    setRouteStyleFor,

    // Features
    features,
    featuresStyle,
    setFeatures,
    clearFeatures,
    setFeaturesStyle,

    // Fly-to
    routesFlyTick,
    featuresFlyTick,
    requestFlyToRoutes,
    requestFlyToFeatures,

    // Panel + chart wiring
    active,
    setActive,
    elevationProfile,
    setElevationProfile,
    phaseRef,

    // Playback
    playState,
    start,
    pause,
    resume,
    stop,
    togglePlayPause,
    flightDuration,
    setFlightDuration,

    // Digitize
    digitizing,
    drawnCoords,
    pendingDrawn,
    startDigitize,
    cancelDigitize,
    finishDigitize,
    addDrawnVertex,
    undoDrawnVertex,
    replaceDrawnCoords,
    clearPendingDrawn,
  }), [
    routes, selectedRoute, effectiveSelectedId, hasRoute,
    addRoute, removeRoute, selectRoute, setRouteStyleFor,
    features, featuresStyle,
    setFeatures, clearFeatures, setFeaturesStyle,
    routesFlyTick, featuresFlyTick,
    requestFlyToRoutes, requestFlyToFeatures,
    active, setActive, elevationProfile,
    playState, start, pause, resume, stop, togglePlayPause,
    flightDuration, setFlightDuration,
    digitizing, drawnCoords, pendingDrawn,
    startDigitize, cancelDigitize, finishDigitize,
    addDrawnVertex, undoDrawnVertex, replaceDrawnCoords,
    clearPendingDrawn,
  ]);

  return <FlypathContext.Provider value={value}>{children}</FlypathContext.Provider>;
}

export function useFlypath() {
  const ctx = useContext(FlypathContext);
  if (!ctx) throw new Error('useFlypath must be used inside FlypathProvider');
  return ctx;
}
