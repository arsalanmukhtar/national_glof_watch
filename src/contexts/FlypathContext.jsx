import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { extractFeatureAttributes } from '@/utils/labelExpression';
import { featureCollectionLengthMeters } from '@/utils/spatialUpload';

// Persistence key — bumped whenever the on-disk shape changes so a
// stale snapshot from an older version doesn't crash the app on
// rehydration.
const STORAGE_KEY = 'flypath.v1';

// Debounce writes so slider drags in the style popover don't hammer
// localStorage with per-frame JSON.stringify + setItem calls.
const PERSIST_DEBOUNCE_MS = 300;

function loadPersisted() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function savePersisted(snapshot) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch (err) {
    // Uploaded shapefiles can push the payload past the ~5 MB per-origin
    // quota; log once and continue rather than crashing the panel.
    if (err && err.name === 'QuotaExceededError') {
      console.warn('Flypath: localStorage quota exceeded — configuration not persisted');
    } else {
      console.warn('Flypath: failed to persist configuration', err);
    }
  }
}

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

// Text-symbology defaults for the Lakes / features layer. Enabled
// only when the operator picks at least one attribute — the symbol
// layer's text-field is empty otherwise, so nothing paints.
const DEFAULT_FEATURES_LABEL_STYLE = {
  enabled:    false,
  expression: '',            // SQL-style: `name || ' - ' || area`
  unit:       'none',        // key from LABEL_UNITS
  color:      '#ffffff',
  haloColor:  '#0f172a',
  haloWidth:  1.5,           // pixels
  size:       12,            // text-size in pixels
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
  // Load the persisted snapshot ONCE on mount. Subsequent renders
  // reuse the same object via useMemo's empty deps.
  const persisted = useMemo(() => loadPersisted() ?? {}, []);

  const [routes, setRoutes] = useState(() =>
    Array.isArray(persisted.routes) ? persisted.routes : [],
  );
  const [selectedRouteId, setSelectedRouteId] = useState(
    () => persisted.selectedRouteId ?? null,
  );

  const [features, setFeaturesRaw] = useState(() => persisted.features ?? null);
  const [featuresStyle, setFeaturesStyleRaw] = useState(() => ({
    ...DEFAULT_FEATURES_STYLE,
    ...(persisted.featuresStyle ?? {}),
  }));
  const setFeaturesStyle = useCallback((partial) =>
    setFeaturesStyleRaw((prev) => ({ ...prev, ...partial })), []);

  const [featuresLabelStyle, setFeaturesLabelStyleRaw] = useState(() => ({
    ...DEFAULT_FEATURES_LABEL_STYLE,
    ...(persisted.featuresLabelStyle ?? {}),
  }));
  const setFeaturesLabelStyle = useCallback((partial) =>
    setFeaturesLabelStyleRaw((prev) => ({ ...prev, ...partial })), []);
  const resetFeaturesLabelStyle = useCallback(
    () => setFeaturesLabelStyleRaw(DEFAULT_FEATURES_LABEL_STYLE), []);

  // Property-key union across the uploaded features. This is the
  // "possible attributes" the operator picks from when building a
  // label. Recomputed only on features reference change so a 10k-row
  // shapefile doesn't get walked on every panel re-render.
  const featureAttributes = useMemo(
    () => extractFeatureAttributes(features?.fc),
    [features],
  );

  // Playback state machine: 'stopped' | 'playing' | 'paused'.
  const [playState, setPlayState] = useState('stopped');

  // Fly-to nonces per layer group.
  const [routesFlyTick,   setRoutesFlyTick]   = useState(0);
  const [selectedRouteFlyTick, setSelectedRouteFlyTick] = useState(0);
  const [featuresFlyTick, setFeaturesFlyTick] = useState(0);
  const requestFlyToRoutes   = useCallback(() => setRoutesFlyTick((n) => n + 1), []);
  const requestFlyToSelectedRoute = useCallback(() => setSelectedRouteFlyTick((n) => n + 1), []);
  const requestFlyToFeatures = useCallback(() => setFeaturesFlyTick((n) => n + 1), []);

  // Panel-open broadcast for the chart tab auto-switch.
  const [active, setActiveRaw] = useState(false);
  const setActive = useCallback((v) => setActiveRaw(Boolean(v)), []);

  // Elevation profile of the currently-selected route.
  const [elevationProfile, setElevationProfile] = useState(null);

  // Shared animation phase.
  const phaseRef = useRef(0);

  // Speed model — the operator sets a relative multiplier (0.25 × …
  // 8 ×) and the actual flight duration is derived from the selected
  // route's length. Baseline is a soft linear curve: short routes
  // (< 10 km) land around 15 s; a 100 km melt path around a minute;
  // a Pakistan-scale route around 10 minutes at 1 ×. The multiplier
  // then scales inversely (2 × = half duration, 0.5 × = double).
  //
  // Why relative: a fixed 5-180 s range couldn't accommodate long
  // routes at all — the tiles / DEM never had time to stream in
  // before the marker had already flown past. A distance-driven
  // baseline makes "1 ×" feel consistent regardless of extent, and
  // the operator still gets one obvious knob (Nx) rather than
  // having to eyeball the right absolute duration.
  const [speedMultiplier, setSpeedMultiplierRaw] = useState(() => {
    const v = Number(persisted.speedMultiplier);
    return Number.isFinite(v) && v > 0 ? Math.max(0.1, Math.min(10, v)) : 1;
  });
  const setSpeedMultiplier = useCallback((n) => {
    const num = Number(n);
    if (!Number.isFinite(num)) return;
    setSpeedMultiplierRaw(Math.max(0.1, Math.min(10, num)));
  }, []);

  // Loop mode — when true, the animation restarts from the beginning
  // instead of transitioning to 'stopped' at phase 1. Handy for demo
  // / kiosk viewing so an operator doesn't have to hit Play every
  // minute-and-a-half.
  const [loop, setLoopRaw] = useState(() => Boolean(persisted.loop));
  const setLoop    = useCallback((v) => setLoopRaw(Boolean(v)), []);
  const toggleLoop = useCallback(() => setLoopRaw((v) => !v), []);

  // Camera mode.
  //   'focused' → chase-cam: adaptive pitch tied to terrain slope,
  //               bearing follows path tangent responsively.
  //   'drone'   → near-nadir plan view (fixed ~10 ° pitch), heavily
  //               damped bearing so the marker glides above the
  //               route like a drone rather than snapping around
  //               every bend.
  const [flightMode, setFlightModeRaw] = useState(() =>
    persisted.flightMode === 'drone' ? 'drone' : 'focused',
  );
  const setFlightMode = useCallback((mode) => {
    if (mode !== 'focused' && mode !== 'drone') return;
    setFlightModeRaw(mode);
  }, []);

  // Broadcast from FlypathMapLayer while it is waiting on the DEM /
  // basemap tiles to finish streaming before starting the RAF. The
  // panel uses this to swap the Play button into a "preparing"
  // affordance so the operator doesn't think the click was ignored.
  const [awaitingTerrain, setAwaitingTerrain] = useState(false);

  // ---------------------------------------------------------------
  // Export animation.
  //   The panel dispatches `requestExport()` when the operator clicks
  //   the "Export animation" button. `exportTick` increments so the
  //   FlypathExportRecorder — which lives inside the map wrapper —
  //   sees the request via a useEffect on the counter and enters its
  //   bounding-box selection state. Using a tick rather than a
  //   boolean means every click is a fresh request even if the
  //   recorder is already in the middle of a session (it will just
  //   restart).
  // ---------------------------------------------------------------
  const [exportTick, setExportTick] = useState(0);
  const requestExport = useCallback(() => setExportTick((n) => n + 1), []);

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
          style: (() => {
            const c = ROUTE_COLOR_CYCLE[prev.length % ROUTE_COLOR_CYCLE.length];
            // Fill and outline default to the same colour so a new
            // route reads as a single crisp line — matching outline
            // triggers the casingWidth=0 code path in buildRoutesFC.
            return { ...DEFAULT_ROUTE_STYLE_BASE, color: c, outlineColor: c };
          })(),
          // Manual origin override. When set to 'first' the raw coord
          // order is kept as-is; 'last' reverses. null falls back to
          // DEM-based automatic detection.
          originVertex: null,
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

  // ---------------------------------------------------------------
  // Manual origin selection — the "Select origin" mode. When the DEM
  // isn't tall enough to tell which end is uphill (or the operator
  // just wants to override), they can flip this on, hover a green
  // buffer over one of the route's endpoints, and click to lock it
  // in as the flight origin.
  // ---------------------------------------------------------------
  const [selectingOrigin, setSelectingOrigin] = useState(false);
  const beginSelectOrigin  = useCallback(() => setSelectingOrigin(true), []);
  const cancelSelectOrigin = useCallback(() => setSelectingOrigin(false), []);

  const setRouteOrigin = useCallback((id, which) => {
    if (which !== 'first' && which !== 'last' && which !== null) return;
    setRoutes((prev) => prev.map((r) =>
      r.id === id ? { ...r, originVertex: which } : r,
    ));
    // Any change to the origin implicitly invalidates the current
    // flight — force a stop + clear the sampled profile so the next
    // Play re-orients + re-samples against the new origin.
    setPlayState('stopped');
    setElevationProfile(null);
    setSelectingOrigin(false);
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

  // Base duration for the selected route at 1 × speed. Recomputed
  // whenever the operator switches routes. See setSpeedMultiplier
  // above for the design rationale — this baseline plus the Nx knob
  // replaces the old absolute 5-180 s slider.
  const baseDurationMs = useMemo(() => {
    if (!selectedRoute?.fc) return 30_000;
    const km = (featureCollectionLengthMeters(selectedRoute.fc) || 0) / 1000;
    // 8 s startup + ~0.55 s per km ≈ 15 s at 12 km, 63 s at 100 km,
    // 558 s (~9m 20s) at 1000 km, 1108 s (~18m 30s) at 2000 km.
    const seconds = 8 + km * 0.55;
    return Math.max(6_000, Math.round(seconds * 1000));
  }, [selectedRoute]);

  // What the animation loop actually reads — clamped to a floor of
  // 3 s so a 100 × multiplier can't reduce a 5 km route to sub-frame
  // duration.
  const flightDuration = useMemo(
    () => Math.max(3_000, Math.round(baseDurationMs / speedMultiplier)),
    [baseDurationMs, speedMultiplier],
  );

  // ---------------------------------------------------------------
  // Features actions. Setting or clearing features also wipes the
  // label expression + unit — a new file almost certainly has
  // different attribute names so the previous expression would
  // silently render '' everywhere.
  // ---------------------------------------------------------------
  const setFeatures = useCallback((payload) => {
    setFeaturesRaw(payload);
    resetFeaturesLabelStyle();
  }, [resetFeaturesLabelStyle]);
  const clearFeatures = useCallback(() => {
    setFeaturesRaw(null);
    resetFeaturesLabelStyle();
  }, [resetFeaturesLabelStyle]);

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

  // Debounced persist. Every change to a persisted field bumps this
  // effect, which schedules a single localStorage write 300 ms later
  // — a slider drag that fires 30 updates/s collapses down to one
  // write once the operator releases. Playback state, elevation
  // profile, digitize buffers, and export ticks are intentionally
  // NOT persisted (they're ephemeral to the current session).
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      savePersisted({
        routes,
        selectedRouteId,
        features,
        featuresStyle,
        featuresLabelStyle,
        speedMultiplier,
        flightMode,
        loop,
      });
    }, PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(timeoutId);
  }, [
    routes,
    selectedRouteId,
    features,
    featuresStyle,
    featuresLabelStyle,
    speedMultiplier,
    flightMode,
    loop,
  ]);

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
    selectingOrigin,
    beginSelectOrigin,
    cancelSelectOrigin,
    setRouteOrigin,

    // Features
    features,
    featuresStyle,
    setFeatures,
    clearFeatures,
    setFeaturesStyle,
    featuresLabelStyle,
    setFeaturesLabelStyle,
    featureAttributes,

    // Fly-to
    routesFlyTick,
    selectedRouteFlyTick,
    featuresFlyTick,
    requestFlyToRoutes,
    requestFlyToSelectedRoute,
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
    baseDurationMs,
    speedMultiplier,
    setSpeedMultiplier,
    loop,
    setLoop,
    toggleLoop,
    flightMode,
    setFlightMode,
    awaitingTerrain,
    setAwaitingTerrain,

    // Export animation
    exportTick,
    requestExport,

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
    selectingOrigin, beginSelectOrigin, cancelSelectOrigin, setRouteOrigin,
    features, featuresStyle,
    setFeatures, clearFeatures, setFeaturesStyle,
    featuresLabelStyle, setFeaturesLabelStyle, featureAttributes,
    routesFlyTick, selectedRouteFlyTick, featuresFlyTick,
    requestFlyToRoutes, requestFlyToSelectedRoute, requestFlyToFeatures,
    active, setActive, elevationProfile,
    playState, start, pause, resume, stop, togglePlayPause,
    flightDuration, baseDurationMs, speedMultiplier, setSpeedMultiplier,
    loop, setLoop, toggleLoop,
    flightMode, setFlightMode,
    awaitingTerrain,
    exportTick, requestExport,
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
