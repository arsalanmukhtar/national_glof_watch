import { useEffect, useRef } from 'react';
import { mapboxgl } from '@/config/mapbox';
import { useFlypath } from '@/contexts/FlypathContext';
import { buildMapboxTextField, unitById } from '@/utils/labelExpression';

// FlypathMapLayer — invisible component. Owns four things on the map:
//   • one GeoJSON source of every uploaded route (data-driven paint)
//   • one GeoJSON source of the contextual features layer
//   • terrain DEM so queryTerrainElevation works for the profile chart
//   • a chevron marker (mapboxgl.Marker) attached to the selected
//     route during playback
//
// Camera model:
//   • On Start we fit bounds to ALL uploaded routes so multi-flypath
//     scenes ("melt paths converging on one lake") stay in view for
//     the whole flight. No chase — the camera holds the wide view;
//     the marker moves along the selected route.
//   • Pitch is fixed at NAV_PITCH so terrain relief is visible while
//     still keeping enough overview to see every route.
//   • Bearing is auto-derived from the direction of travel along the
//     selected route so the arrow feels like it's actually driving.

const ROUTES_SRC          = 'flypath-routes-src';
const FEATURES_SRC        = 'flypath-features-src';
const ROUTES_CASING       = 'flypath-routes-casing';
const ROUTES_LINE         = 'flypath-routes-line';
const FEATURES_FILL       = 'flypath-features-fill';
const FEATURES_POLY_OUTLINE = 'flypath-features-outline';
const FEATURES_LINESTRING = 'flypath-features-line';
const FEATURES_POINT      = 'flypath-features-point';
const FEATURES_LABEL      = 'flypath-features-label';

const DEM_SRC         = 'mapbox-dem';
const DEM_URL         = 'mapbox://mapbox.mapbox-terrain-dem-v1';
const DEM_MAX_ZOOM    = 14;
const TERRAIN_EXAG    = 1.3;

const NAV_PITCH       = 50;
const FLIGHT_ZOOM     = 15;     // chase-cam altitude — pulled back so surrounding ridges stay in view
const LOOK_AHEAD_FRAC = 0.02;
const FIT_PADDING     = 60;
const ELEV_SAMPLES    = 150;

// Zoom cap applied when fitting bounds. Prevents a single very short
// route from zooming in past what the marker + terrain read well at.
const FIT_MAX_ZOOM    = 15;

// Adaptive-pitch tuning. In gentle terrain we run at NAV_PITCH (close
// chase-cam). As soon as the local slope ahead steepens past
// SLOPE_LOW we ease the pitch down toward TOP_DOWN_PITCH so the
// marker doesn't disappear behind a ridge — a shallower angle sees
// over the crest. Values in degrees.
const TOP_DOWN_PITCH  = 15;   // near-plan view for cliff / steep faces
const SLOPE_LOW_DEG   = 12;   // below this — full NAV_PITCH
const SLOPE_HIGH_DEG  = 32;   // above this — full TOP_DOWN_PITCH
const PITCH_LERP      = 0.10; // per-frame ease factor toward the target
// Window (in profile-sample count) used to average the local slope
// ahead of the marker — short enough to respond to a wall coming up,
// long enough that a single noisy DEM tile doesn't yank the pitch.
const SLOPE_WINDOW_SAMPLES = 6;

// Drone-view pitch — near nadir. Camera hangs directly above the
// marker so the whole route reads like a plan view.
const DRONE_PITCH     = 10;

// Bearing smoothing. The path-tangent bearing snaps at every vertex
// / sharp bend; the RAF loop eases the actual camera bearing toward
// that target with these per-frame lerp factors. Lower value = more
// smoothing (more damping). Drone view damps hard so the marker
// glides above the route with barely any yaw; Focused view keeps
// enough responsiveness that the chase-cam still turns with the
// path.
const FOCUSED_BEARING_LERP = 0.10;   // ~10 frames to converge (166 ms @ 60fps)
const DRONE_BEARING_LERP   = 0.025;  // ~40 frames (~660 ms) — silky drone glide
// Look-ahead used to derive the target bearing. A longer window
// smears direction changes across more of the path so the bearing
// input itself is already less spiky before the lerp gets a shot
// at it. Drone view averages over an even longer stretch.
const FOCUSED_BEARING_LOOK = 0.02;
const DRONE_BEARING_LOOK   = 0.06;

export default function FlypathMapLayer({ map }) {
  const {
    routes,
    selectedRoute,
    features,
    featuresStyle,
    featuresLabelStyle,
    playState,
    routesFlyTick,
    selectedRouteFlyTick,
    featuresFlyTick,
    elevationProfile,
    phaseRef,
    flightDuration,
    loop,
    flightMode,
    setElevationProfile,
    setAwaitingTerrain,
    stop,
  } = useFlypath();

  // Live mirror of the camera mode so the RAF tick can pick it up
  // without restarting the effect on every mode toggle.
  const flightModeRef = useRef(flightMode);
  flightModeRef.current = flightMode;

  const flightDurationRef = useRef(flightDuration);
  flightDurationRef.current = flightDuration;

  // Loop flag mirrored to a ref so the RAF tick can decide whether
  // to restart at phase 1 without recreating the effect (which would
  // cancel + re-jumpTo the camera every time the user toggles it
  // mid-flight).
  const loopRef = useRef(loop);
  loopRef.current = loop;

  // Cached FCs so ensureLayers can rebuild sources after a basemap
  // swap without needing to observe context changes.
  const routesFCRef       = useRef(emptyFC());
  const featuresDataRef   = useRef(emptyFC());
  const featuresStyleRef  = useRef(featuresStyle);
  featuresStyleRef.current = featuresStyle;
  const featuresLabelStyleRef = useRef(featuresLabelStyle);
  featuresLabelStyleRef.current = featuresLabelStyle;

  // Live mirror of `elevationProfile` state so the RAF tick can read
  // it via ref without forcing the playback effect to re-run whenever
  // the elevation sample updates. Before this ref the profile was in
  // the effect's dep array, and each incoming `idle`-driven sample
  // cancelled the RAF + re-jumpTo'd the camera → visible jerk.
  const elevationProfileRef = useRef(elevationProfile);
  elevationProfileRef.current = elevationProfile;

  // Coordinate list the animator flies along — the SELECTED route's
  // first LineString, oriented high → low. Recomputed at Start.
  const flightCoordsRef = useRef(null);

  // Oriented coords cache, shared between the elevation sampler and
  // the play effect. Populated the moment we can reliably tell which
  // endpoint is the higher one (from DEM window-sampling). Cleared
  // when the selected route changes so a new route re-decides
  // orientation from its own terrain profile.
  const orientedCoordsRef = useRef(null);

  const lastFrameRef = useRef(0);
  const rafRef       = useRef(0);
  const markerRef    = useRef(null);
  // Live pitch used by the chase-cam. Eased toward the terrain-derived
  // target every frame so steep sections tilt to a plan view smoothly
  // instead of snapping.
  const currentPitchRef = useRef(NAV_PITCH);
  // Live bearing — eased per-frame with a mode-dependent lerp so
  // sharp bends don't snap the camera around. Initialised to the
  // first-frame tangent on fresh Start.
  const currentBearingRef = useRef(0);

  // ---------------------------------------------------------------
  // Bootstrap sources, layers, terrain. Runs on mount + basemap swap.
  // ---------------------------------------------------------------
  useEffect(() => {
    if (!map) return undefined;
    let pending = false;

    const ensureLayers = () => {
      try {
        if (!map.getSource(DEM_SRC)) {
          map.addSource(DEM_SRC, {
            type: 'raster-dem',
            url: DEM_URL,
            tileSize: 512,
            maxzoom: DEM_MAX_ZOOM,
          });
        }
        if (!map.getTerrain()) {
          map.setTerrain({ source: DEM_SRC, exaggeration: TERRAIN_EXAG });
        }

        if (!map.getSource(ROUTES_SRC)) {
          map.addSource(ROUTES_SRC, { type: 'geojson', data: routesFCRef.current });
        }
        if (!map.getSource(FEATURES_SRC)) {
          map.addSource(FEATURES_SRC, { type: 'geojson', data: featuresDataRef.current });
        }

        const fs = featuresStyleRef.current;

        if (!map.getLayer(FEATURES_FILL)) {
          // The opacity slider had been driving `fill-opacity` — but
          // once terrain is enabled, Mapbox drapes fill layers onto
          // the DEM and the composited alpha visibly ignores the
          // slider (colour reads the same at 5 % as at 95 %). Baking
          // the alpha into the colour via rgba() sidesteps the drape
          // path entirely and gives us predictable translucency.
          map.addLayer({
            id: FEATURES_FILL,
            type: 'fill',
            source: FEATURES_SRC,
            filter: ['any',
              ['==', ['geometry-type'], 'Polygon'],
              ['==', ['geometry-type'], 'MultiPolygon'],
            ],
            paint: {
              'fill-color':   hexToRgba(fs.color, fs.opacity),
              'fill-opacity': 1,
            },
          });
        }
        if (!map.getLayer(FEATURES_POLY_OUTLINE)) {
          map.addLayer({
            id: FEATURES_POLY_OUTLINE,
            type: 'line',
            source: FEATURES_SRC,
            filter: ['any',
              ['==', ['geometry-type'], 'Polygon'],
              ['==', ['geometry-type'], 'MultiPolygon'],
            ],
            paint: { 'line-color': fs.outlineColor, 'line-width': fs.width },
          });
        }
        if (!map.getLayer(FEATURES_LINESTRING)) {
          map.addLayer({
            id: FEATURES_LINESTRING,
            type: 'line',
            source: FEATURES_SRC,
            filter: ['any',
              ['==', ['geometry-type'], 'LineString'],
              ['==', ['geometry-type'], 'MultiLineString'],
            ],
            paint: {
              'line-color':   fs.color,
              'line-width':   fs.width,
              'line-opacity': fs.opacity,
            },
          });
        }
        if (!map.getLayer(FEATURES_POINT)) {
          map.addLayer({
            id: FEATURES_POINT,
            type: 'circle',
            source: FEATURES_SRC,
            filter: ['==', ['geometry-type'], 'Point'],
            paint: {
              'circle-radius':       5,
              'circle-color':        fs.color,
              'circle-opacity':      fs.opacity,
              'circle-stroke-color': fs.outlineColor,
              'circle-stroke-width': Math.max(1, fs.width * 0.6),
            },
          });
        }
        if (!map.getLayer(FEATURES_LABEL)) {
          const ls = featuresLabelStyleRef.current;
          // Initial text-field is '' when the label style isn't
          // enabled yet — the panel flips it on later and the
          // dedicated effect below refreshes text-field / paint.
          const textField = ls.enabled
            ? buildMapboxTextField(ls.expression, unitById(ls.unit).suffix)
            : '';
          map.addLayer({
            id: FEATURES_LABEL,
            type: 'symbol',
            source: FEATURES_SRC,
            layout: {
              'text-field':        textField,
              'text-size':         Number(ls.size) || 12,
              'text-font':         ['DIN Pro Bold', 'Open Sans Semibold', 'Arial Unicode MS Bold'],
              'text-anchor':       'center',
              'text-justify':      'center',
              'text-allow-overlap': false,
              'symbol-placement':  'point',
            },
            paint: {
              'text-color':      ls.color,
              'text-halo-color': ls.haloColor,
              // Coerce because a stale string from a form field
              // would silently no-op the paint update.
              'text-halo-width': Number(ls.haloWidth) || 0,
            },
          });
        }

        // Routes — one source, data-driven paint. Each feature carries
        // its own color/width/opacity in its properties so we don't
        // need one layer per route.
        if (!map.getLayer(ROUTES_CASING)) {
          map.addLayer({
            id: ROUTES_CASING,
            type: 'line',
            source: ROUTES_SRC,
            paint: {
              'line-color':   ['get', 'outlineColor'],
              'line-width':   ['get', 'casingWidth'],
              'line-opacity': ['get', 'opacity'],
            },
            layout: { 'line-cap': 'round', 'line-join': 'round' },
          });
        }
        if (!map.getLayer(ROUTES_LINE)) {
          map.addLayer({
            id: ROUTES_LINE,
            type: 'line',
            source: ROUTES_SRC,
            paint: {
              'line-color':   ['get', 'color'],
              'line-width':   ['get', 'width'],
              'line-opacity': ['get', 'opacity'],
            },
            layout: { 'line-cap': 'round', 'line-join': 'round' },
          });
        }

        // Re-push cached data — cheap no-op in the normal path; carries
        // through when re-registering after a basemap swap.
        map.getSource(ROUTES_SRC)?.setData(routesFCRef.current);
        map.getSource(FEATURES_SRC)?.setData(featuresDataRef.current);

        pending = false;
      } catch {
        pending = true;
      }
    };

    const onIdle = () => { if (pending) ensureLayers(); };

    // Keep the labels on the very top of the layer stack. Any other
    // component that mounts a layer later (raster overlay, station
    // circles, region fills) would otherwise get painted above the
    // labels because `addLayer` without `beforeId` pushes to the top.
    const hoistLabels = () => {
      if (map.getLayer(FEATURES_LABEL)) {
        try { map.moveLayer(FEATURES_LABEL); } catch { /* transient */ }
      }
    };

    ensureLayers();
    map.on('load', ensureLayers);
    map.on('style.load', ensureLayers);
    map.on('idle', onIdle);
    map.on('styledata', hoistLabels);
    return () => {
      map.off('load', ensureLayers);
      map.off('style.load', ensureLayers);
      map.off('idle', onIdle);
      map.off('styledata', hoistLabels);
    };
  }, [map]);

  // ---------------------------------------------------------------
  // Sync routes → one FeatureCollection, data-driven properties.
  // ---------------------------------------------------------------
  useEffect(() => {
    const fc = buildRoutesFC(routes);
    routesFCRef.current = fc;
    if (!map) return;
    try {
      map.getSource(ROUTES_SRC)?.setData(fc);
      // Force a repaint — data-driven paint expressions (['get',
      // 'opacity'] etc.) can sit on cached tiles until the next
      // camera move otherwise, which makes slider changes look
      // like nothing is happening.
      map.triggerRepaint?.();
    } catch { /* transient */ }
  }, [map, routes]);

  // ---------------------------------------------------------------
  // Sync features data + paint.
  // ---------------------------------------------------------------
  useEffect(() => {
    const fc = features?.fc ?? emptyFC();
    featuresDataRef.current = fc;
    if (!map) return;
    try { map.getSource(FEATURES_SRC)?.setData(fc); }
    catch { /* transient */ }
  }, [map, features]);

  // Labels: on every style change, drop the existing symbol layer
  // and re-add it with the new paint/layout. `setPaintProperty` on
  // symbol layers with terrain enabled sometimes gets absorbed by
  // the tile cache — only layout changes force a re-raster, which
  // is why text-size updated live but text-color / text-halo-color /
  // text-halo-width silently didn't. Removing + re-adding sidesteps
  // the cache entirely and is cheap even for large feature counts
  // (only the glyphs re-raster). We also move the layer to the very
  // top of the stack afterwards so raster / station layers loaded
  // after us can never hide the labels.
  useEffect(() => {
    if (!map) return;
    const ls = featuresLabelStyle;
    try {
      if (map.getLayer(FEATURES_LABEL)) map.removeLayer(FEATURES_LABEL);
      if (!map.getSource(FEATURES_SRC)) return;
      const textField = ls.enabled
        ? buildMapboxTextField(ls.expression, unitById(ls.unit).suffix)
        : '';
      map.addLayer({
        id: FEATURES_LABEL,
        type: 'symbol',
        source: FEATURES_SRC,
        layout: {
          'text-field':        textField,
          'text-size':         Number(ls.size) || 12,
          'text-font':         ['DIN Pro Bold', 'Open Sans Semibold', 'Arial Unicode MS Bold'],
          'text-anchor':       'center',
          'text-justify':      'center',
          'text-allow-overlap': false,
          'symbol-placement':  'point',
        },
        paint: {
          'text-color':      ls.color,
          'text-halo-color': ls.haloColor,
          'text-halo-width': Number(ls.haloWidth) || 0,
        },
      });
      map.moveLayer(FEATURES_LABEL); // pin to top of layer stack
      map.triggerRepaint?.();
    } catch { /* transient */ }
  }, [map, featuresLabelStyle]);

  useEffect(() => {
    if (!map) return;
    const s = featuresStyle;
    try {
      if (map.getLayer(FEATURES_FILL)) {
        // See addLayer comment — alpha lives inside the colour, so
        // fill-opacity stays at 1 and setPaintProperty targets the
        // rgba string instead.
        map.setPaintProperty(FEATURES_FILL, 'fill-color', hexToRgba(s.color, s.opacity));
        map.setPaintProperty(FEATURES_FILL, 'fill-opacity', 1);
      }
      if (map.getLayer(FEATURES_POLY_OUTLINE)) {
        map.setPaintProperty(FEATURES_POLY_OUTLINE, 'line-color', s.outlineColor);
        map.setPaintProperty(FEATURES_POLY_OUTLINE, 'line-width', s.width);
      }
      if (map.getLayer(FEATURES_LINESTRING)) {
        map.setPaintProperty(FEATURES_LINESTRING, 'line-color',   s.color);
        map.setPaintProperty(FEATURES_LINESTRING, 'line-width',   s.width);
        map.setPaintProperty(FEATURES_LINESTRING, 'line-opacity', s.opacity);
      }
      if (map.getLayer(FEATURES_POINT)) {
        map.setPaintProperty(FEATURES_POINT, 'circle-color',        s.color);
        map.setPaintProperty(FEATURES_POINT, 'circle-opacity',      s.opacity);
        map.setPaintProperty(FEATURES_POINT, 'circle-stroke-color', s.outlineColor);
        map.setPaintProperty(FEATURES_POINT, 'circle-stroke-width', Math.max(1, s.width * 0.6));
      }
      // Data-driven paint updates can sit on cached tiles until the
      // next camera move — force a repaint so the opacity slider
      // visibly moves the fill as it drags (same fix we shipped
      // for the routes source).
      map.triggerRepaint?.();
    } catch { /* transient */ }
  }, [map, featuresStyle]);

  // ---------------------------------------------------------------
  // Fly-to-bounds on demand.
  // ---------------------------------------------------------------
  useEffect(() => {
    if (!map || routesFlyTick === 0) return;
    fitToRoutes(map, routes);
  }, [map, routesFlyTick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!map || selectedRouteFlyTick === 0) return;
    if (selectedRoute?.fc) fitToFeatureCollection(map, selectedRoute.fc);
  }, [map, selectedRouteFlyTick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!map || featuresFlyTick === 0) return;
    fitToFeatureCollection(map, features?.fc);
  }, [map, featuresFlyTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------
  // Elevation profile — sampled from the SELECTED route's coords.
  // Also owns the orientation decision so both the chart's x-axis
  // and the flight direction come from the same source of truth.
  // ---------------------------------------------------------------
  // Invalidate the orientation cache when the selected route changes
  // (not on every sample tick — otherwise the sampler would keep
  // re-deciding orientation and could flap if a tile briefly returned
  // an outlier value).
  useEffect(() => {
    orientedCoordsRef.current = null;
  }, [selectedRoute]);

  useEffect(() => {
    if (!map) return undefined;
    if (elevationProfile?.complete) return undefined;

    const coords = extractFirstLineString(selectedRoute?.fc);
    if (!coords || coords.length < 2) {
      // No selected route — clear the profile if present so the chart
      // shows its empty state.
      if (elevationProfile) setElevationProfile(null);
      return undefined;
    }

    const trySample = () => {
      // Decide orientation once. Manual override (originVertex) wins
      // — the operator explicitly told us which end is the start.
      // Otherwise fall back to DEM window sampling around each
      // endpoint. If the terrain tiles aren't in yet we skip this
      // pass — a later idle will try again. This is what keeps the
      // flight from ever starting bottom-to-top: no orientation,
      // no sample → sampler retries until DEM is available.
      if (!orientedCoordsRef.current) {
        const manual = selectedRoute?.originVertex;
        if (manual === 'first') {
          orientedCoordsRef.current = coords;
        } else if (manual === 'last') {
          orientedCoordsRef.current = coords.slice().reverse();
        } else {
          const dir = determineOrientation(map, coords);
          if (dir === 0) return;
          orientedCoordsRef.current = dir === 1 ? coords : coords.slice().reverse();
        }
      }
      const oriented = orientedCoordsRef.current;
      const profile = sampleElevationProfile(map, oriented, ELEV_SAMPLES);
      if (!profile) return;
      const complete = profile.samples.every((p) => Number.isFinite(p.elevation));
      setElevationProfile((prev) => {
        if (prev?.complete) return prev;
        // Skip the state update entirely when neither completeness
        // nor sample values changed — a stray `idle` firing during
        // tile streaming shouldn't recreate the profile object and
        // cascade into re-renders + effect restarts.
        if (prev
            && prev.totalDistance === profile.totalDistance
            && prev.samples.length === profile.samples.length
            && !complete
            && sampleValuesEqual(prev.samples, profile.samples)) {
          return prev;
        }
        return { ...profile, complete };
      });
    };

    trySample();
    map.on('idle', trySample);
    return () => map.off('idle', trySample);
  }, [map, selectedRoute, elevationProfile, setElevationProfile]);

  // ---------------------------------------------------------------
  // Playback → rAF loop.
  // ---------------------------------------------------------------
  useEffect(() => {
    if (!map) return undefined;

    if (playState === 'stopped') {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      phaseRef.current = 0;
      removeMarker(markerRef);
      // Fly camera back to the selected route's extent so the
      // operator immediately sees where the flight starts, ready to
      // restart from a familiar view. `pitch: 0` returns from the
      // chase-cam tilt to a flat overview.
      if (selectedRoute?.fc) {
        fitToFeatureCollection(map, selectedRoute.fc, { pitch: 0 });
      }
      // Invalidate cached oriented coords so the next Start
      // recomputes direction (in case terrain has since loaded).
      flightCoordsRef.current = null;
      return undefined;
    }

    if (playState === 'paused') {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      return undefined;
    }

    // playState === 'playing'.
    const raw = extractFirstLineString(selectedRoute?.fc);
    if (!raw || raw.length < 2) {
      stop();
      return undefined;
    }

    // Fresh Start? — recompute oriented coords. No pre-fit call:
    // the first jumpTo below hard-snaps the camera onto the start of
    // the route (with FLIGHT_ZOOM + NAV_PITCH), which is exactly
    // what a chase camera should do rather than fighting a 800 ms
    // fitBounds tween.
    const fresh = !flightCoordsRef.current || phaseRef.current <= 0 || phaseRef.current >= 1;
    if (fresh) {
      // Prefer the sampler's cached orientation — it decided from
      // DEM window sampling under `idle` conditions and is the same
      // orientation the chart is drawn against. If the user hit Play
      // before the sampler could commit (rare), fall back here to
      // manual override first, then a fresh DEM check; only if all
      // three fail do we use raw order.
      let oriented = orientedCoordsRef.current;
      if (!oriented) {
        const manual = selectedRoute?.originVertex;
        if (manual === 'first') {
          oriented = raw;
        } else if (manual === 'last') {
          oriented = raw.slice().reverse();
        } else {
          const dir = determineOrientation(map, raw);
          if (dir !== 0) {
            oriented = dir === 1 ? raw : raw.slice().reverse();
          } else {
            oriented = raw;
          }
        }
        orientedCoordsRef.current = oriented;
      }
      flightCoordsRef.current = oriented;
      if (phaseRef.current >= 1 || phaseRef.current <= 0) phaseRef.current = 0;
    }
    const coords = flightCoordsRef.current;

    // First frame: snap the camera onto the route start (chase-cam
    // initial pose) + place the marker. Marker updates are DOM-only
    // and always safe. Initial pitch is decided by the current mode
    // — drone view opens near nadir, focused view uses the terrain
    // slope at phase 0 so a cliff-face start opens top-down rather
    // than pointing straight into a mountain. Bearing is seeded from
    // the tangent so the per-frame lerp starts from the correct
    // heading (no giant swing on frame 1).
    const startLook = flightModeRef.current === 'drone'
      ? DRONE_BEARING_LOOK
      : FOCUSED_BEARING_LOOK;
    const startFrame = computeFrame(coords, phaseRef.current, startLook);
    if (startFrame) {
      const startPitch = flightModeRef.current === 'drone'
        ? DRONE_PITCH
        : pitchForSlope(localSlopeDeg(elevationProfileRef.current, phaseRef.current));
      currentPitchRef.current   = startPitch;
      currentBearingRef.current = startFrame.bearing;
      try {
        map.jumpTo({
          center:  startFrame.center,
          bearing: startFrame.bearing,
          pitch:   startPitch,
          zoom:    FLIGHT_ZOOM,
        });
      } catch { /* transient */ }
      ensureMarker(
        map, markerRef, startFrame,
        elevationAtPhase(elevationProfileRef.current, phaseRef.current),
      );
    }

    lastFrameRef.current = performance.now();
    const tick = (now) => {
      // Cap dt so a GC pause, tab-hide, or dropped frame doesn't
      // teleport the marker 30 % down the route on the next tick —
      // a big dt reads as jerky "jumps" rather than smooth motion.
      const raw = now - lastFrameRef.current;
      const dt  = raw > 100 ? 100 : raw;
      lastFrameRef.current = now;
      phaseRef.current = Math.min(1, phaseRef.current + dt / flightDurationRef.current);

      const isDrone = flightModeRef.current === 'drone';
      const look = isDrone ? DRONE_BEARING_LOOK : FOCUSED_BEARING_LOOK;
      const frame = computeFrame(coords, phaseRef.current, look);
      if (frame) {
        // ---- Pitch --------------------------------------------------
        // Drone mode: fixed near-nadir. Focused mode: adaptive
        // slope-based pitch that tilts to plan view over cliffs.
        // Either way, eased toward the target so a mid-flight mode
        // toggle glides in.
        const targetPitch = isDrone
          ? DRONE_PITCH
          : pitchForSlope(localSlopeDeg(elevationProfileRef.current, phaseRef.current));
        currentPitchRef.current +=
          (targetPitch - currentPitchRef.current) * PITCH_LERP;

        // ---- Bearing ------------------------------------------------
        // Ease along the shortest-path angular delta so a bend from
        // 350° → 10° doesn't spin the camera the long way around.
        // Drone view damps hard for a drone-glide feel; Focused view
        // stays responsive enough to still turn with the path.
        const bearingLerp = isDrone ? DRONE_BEARING_LERP : FOCUSED_BEARING_LERP;
        const dBearing = shortestAngleDelta(currentBearingRef.current, frame.bearing);
        currentBearingRef.current =
          (currentBearingRef.current + dBearing * bearingLerp + 360) % 360;

        // Chase cam — jumpTo per frame keeps the camera centred on
        // the marker with the marker's heading as the bearing.
        // Google-Maps-turn-by-turn feel. Zoom omitted so the user
        // can pinch to zoom mid-flight without us fighting them.
        try {
          map.jumpTo({
            center:  frame.center,
            bearing: currentBearingRef.current,
            pitch:   currentPitchRef.current,
          });
        } catch { /* transient — next frame retries */ }
        ensureMarker(
          map, markerRef, frame,
          elevationAtPhase(elevationProfileRef.current, phaseRef.current),
        );
      }

      if (phaseRef.current >= 1) {
        if (loopRef.current) {
          // Wrap: snap the phase back to 0 and let the next tick
          // pick up rendering at the route start. Camera jumpTo on
          // the following frame handles the visual reset. Skip the
          // overshoot leftover — starting exactly at 0 keeps the
          // loop's timing consistent across iterations.
          phaseRef.current = 0;
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        stop();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    // Defer the RAF start until DEM tiles + basemap tiles under the
    // start pose are fully rendered. Playing straight away shows the
    // marker flying over blank blue-grey terrain for the first second
    // while satellite tiles stream in. We poll `idle` because tiles
    // load asynchronously and only `idle` guarantees the current
    // viewport is fully rendered. Hard timeout at 8 s so a stubborn
    // tile can never freeze play permanently.
    const beginRaf = () => {
      setAwaitingTerrain(false);
      // Defensive: cancel any RAF that's still queued from a prior
      // call before starting a new one. Prevents two concurrent tick
      // loops from ever running, which would double-advance the
      // phase every frame and manifest as an unexplained speed-up.
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      lastFrameRef.current = performance.now();
      rafRef.current = requestAnimationFrame(tick);
    };

    // Fullscreen enter/exit and tab visibility flips can pause RAF
    // for a beat while the browser recomposites. Without this
    // handler, the first frame after the pause carries a large dt
    // (the wall-clock time we spent NOT running) and pushes the
    // phase forward more than a single frame's worth — perceived by
    // the operator as an animation speed-up when they close the
    // fullscreen view. Rebase lastFrameRef so post-transition frames
    // resume from "now" rather than accumulating the paused gap.
    const rebaseFrameClock = () => {
      lastFrameRef.current = performance.now();
    };
    document.addEventListener('fullscreenchange', rebaseFrameClock);
    document.addEventListener('visibilitychange',  rebaseFrameClock);
    const isTerrainReady = () => {
      try {
        return map.isSourceLoaded(DEM_SRC) && map.areTilesLoaded();
      } catch { return true; }
    };
    let waitTimeout = 0;
    let idleHandler = null;
    const clearWait = () => {
      if (idleHandler) map.off('idle', idleHandler);
      if (waitTimeout) clearTimeout(waitTimeout);
      idleHandler = null;
      waitTimeout = 0;
    };
    if (isTerrainReady()) {
      beginRaf();
    } else {
      // Announce to the panel that we're waiting on tiles so the
      // Play button reads as "Preparing…" instead of appearing dead.
      setAwaitingTerrain(true);
      idleHandler = () => {
        if (isTerrainReady()) {
          clearWait();
          beginRaf();
        }
      };
      map.on('idle', idleHandler);
      waitTimeout = setTimeout(() => { clearWait(); beginRaf(); }, 8000);
    }

    return () => {
      clearWait();
      setAwaitingTerrain(false);
      document.removeEventListener('fullscreenchange', rebaseFrameClock);
      document.removeEventListener('visibilitychange',  rebaseFrameClock);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
    // `elevationProfile` is intentionally excluded — read via ref
    // inside tick so mid-flight sample updates don't restart the RAF
    // (and snap the camera back to FLIGHT_ZOOM).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, playState, selectedRoute, stop, phaseRef]);

  useEffect(() => () => removeMarker(markerRef), []);

  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyFC() {
  return { type: 'FeatureCollection', features: [] };
}

// Convert a #rgb or #rrggbb hex + [0..1] alpha into an rgba() string.
// Used to bake alpha into the fill colour instead of relying on the
// terrain-composited `fill-opacity` paint property.
function hexToRgba(hex, alpha) {
  const a = Math.max(0, Math.min(1, Number(alpha)));
  const fallback = `rgba(56, 189, 248, ${a || 1})`;
  let h = String(hex || '').trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) return fallback;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (!Number.isFinite(r + g + b)) return fallback;
  return `rgba(${r}, ${g}, ${b}, ${Number.isFinite(a) ? a : 1})`;
}

// Flatten every route's FeatureCollection into one FC where each
// feature carries its route's style in its properties. The
// data-driven paint expressions on ROUTES_LINE / ROUTES_CASING read
// these props per feature.
function buildRoutesFC(routes) {
  const features = [];
  for (const r of routes) {
    const s = r.style ?? {};
    // Casing width = 0 when the outline colour matches the fill —
    // suppresses the wider under-line entirely so a "no outline"
    // configuration renders as a single crisp line at exactly the
    // width knob value. Any other outline colour keeps the +2 px
    // halo.
    const sameColor = String(s.color ?? '').toLowerCase()
                   === String(s.outlineColor ?? '').toLowerCase();
    const casingWidth = sameColor ? 0 : (s.width ?? 3) + 2;
    for (const f of r.fc?.features ?? []) {
      if (!f?.geometry) continue;
      features.push({
        type: 'Feature',
        properties: {
          routeId:      r.id,
          color:        s.color,
          outlineColor: s.outlineColor,
          width:        s.width,
          casingWidth,
          opacity:      s.opacity,
        },
        geometry: f.geometry,
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

function extractFirstLineString(fc) {
  if (!fc?.features?.length) return null;
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'LineString' && Array.isArray(g.coordinates)) {
      return g.coordinates.filter((c) => Array.isArray(c) && c.length >= 2);
    }
    if (g.type === 'MultiLineString' && Array.isArray(g.coordinates)) {
      return g.coordinates.flat().filter((c) => Array.isArray(c) && c.length >= 2);
    }
  }
  return null;
}

// Decide flight direction: origin at the higher-elevation endpoint,
// destination at the lower one. GLOF scenarios always flow downhill,
// so the animation must start high and drop low — never the reverse.
//
// Returns  1  → keep coords as-is (first vertex is higher).
//         -1  → reverse coords     (last vertex is higher).
//          0  → cannot decide right now (DEM tiles at both endpoints
//              still loading). Caller should treat as "try again on
//              the next idle" rather than falling back to raw order,
//              since raw order is often low-to-high for user-drawn
//              paths and defeats the whole downhill contract.
function determineOrientation(map, coords) {
  if (!coords || coords.length < 2) return 0;
  const first = coords[0];
  const last  = coords[coords.length - 1];

  // 1. Coord Z. KML / some GeoJSON sources carry altitude as the 3rd
  //    element of each coord tuple. Cheapest signal, and it beats DEM
  //    when the source has authored elevations.
  const fz = first[2];
  const lz = last[2];
  if (Number.isFinite(fz) && Number.isFinite(lz) && Math.abs(fz - lz) > 0.5) {
    return fz >= lz ? 1 : -1;
  }

  // 2. DEM window sampling around each endpoint. Querying a single
  //    coord is fragile — Mapbox `queryTerrainElevation` returns null
  //    if THAT specific tile hasn't streamed in yet, even when the
  //    surrounding tiles are loaded. Averaging over a small window
  //    of nearby vertices makes the decision reliable at the exact
  //    moment the map first goes idle, so the first Play press
  //    doesn't get stuck with raw order.
  const fe = queryTerrainWindow(map, coords, 0);
  const le = queryTerrainWindow(map, coords, coords.length - 1);
  if (Number.isFinite(fe) && Number.isFinite(le) && Math.abs(fe - le) > 0.5) {
    return fe >= le ? 1 : -1;
  }
  return 0;
}

// Query DEM elevation over a small window of coords around `idx`,
// averaging every valid reading. Falls back to null only when NO
// point in the window has a loaded tile.
function queryTerrainWindow(map, coords, idx, window = 4) {
  if (!map || !coords?.length) return null;
  let hasTerrain = false;
  try {
    hasTerrain = !!(map.getTerrain && map.getTerrain());
  } catch { /* ignore */ }
  if (!hasTerrain) return null;

  const N = coords.length;
  let sum = 0;
  let n = 0;
  for (let k = -window; k <= window; k++) {
    const i = idx + k;
    if (i < 0 || i >= N) continue;
    const c = coords[i];
    if (!Array.isArray(c) || c.length < 2) continue;
    try {
      const e = map.queryTerrainElevation(
        { lng: c[0], lat: c[1] },
        { exaggerated: false },
      );
      if (Number.isFinite(e)) { sum += e; n++; }
    } catch { /* skip this coord */ }
  }
  return n > 0 ? sum / n : null;
}

function computeFrame(coords, phase, look = LOOK_AHEAD_FRAC) {
  const center = interpolateAlong(coords, phase);
  if (!center) return null;
  const lookAhead = interpolateAlong(coords, Math.min(1, phase + look));
  const behind    = interpolateAlong(coords, Math.max(0, phase - look));
  const bearing = pointDelta(lookAhead, center) > 1e-9
    ? computeBearing(center, lookAhead)
    : computeBearing(behind, center);
  return { center, bearing };
}

// Shortest signed angular delta in degrees, wrapping across the
// 0/360 boundary. Result lies in (-180, 180].
function shortestAngleDelta(from, to) {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

function pointDelta(a, b) {
  if (!a || !b) return 0;
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function computeBearing(a, b) {
  if (!a || !b) return 0;
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const dLon = toRad(b[0] - a[0]);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2)
          - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function interpolateAlong(coords, t) {
  if (!coords || coords.length < 2) return null;
  const clamped = Math.max(0, Math.min(1, t));
  let total = 0;
  const segs = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segs.push({ a, b, d });
    total += d;
  }
  if (total === 0) return coords[0];
  const target = clamped * total;
  let acc = 0;
  for (const s of segs) {
    if (acc + s.d >= target) {
      const local = s.d === 0 ? 0 : (target - acc) / s.d;
      return [
        s.a[0] + (s.b[0] - s.a[0]) * local,
        s.a[1] + (s.b[1] - s.a[1]) * local,
      ];
    }
    acc += s.d;
  }
  return coords[coords.length - 1];
}

function haversineMeters(a, b) {
  if (!a || !b) return 0;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2
          + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function sampleElevationProfile(map, coords, count) {
  if (!coords || coords.length < 2) return null;
  const segs = [];
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const d = haversineMeters(a, b);
    segs.push({ a, b, d });
    total += d;
  }
  if (total === 0) return null;
  const samples = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const target = t * total;
    let acc = 0;
    let point = coords[coords.length - 1];
    for (const s of segs) {
      if (acc + s.d >= target) {
        const local = s.d === 0 ? 0 : (target - acc) / s.d;
        point = [
          s.a[0] + (s.b[0] - s.a[0]) * local,
          s.a[1] + (s.b[1] - s.a[1]) * local,
        ];
        break;
      }
      acc += s.d;
    }
    let elevation = null;
    try {
      const ele = map.queryTerrainElevation(
        { lng: point[0], lat: point[1] },
        { exaggerated: false },
      );
      if (Number.isFinite(ele)) elevation = ele;
    } catch { /* not ready */ }
    samples.push({ distance: t * total, elevation });
  }
  return { totalDistance: total, samples };
}

// Shallow value-equality on two sample arrays. Used to skip a
// setElevationProfile call when the underlying elevations haven't
// actually changed — silences pointless re-renders during the
// tile-loading window.
function sampleValuesEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const av = a[i]?.elevation;
    const bv = b[i]?.elevation;
    if (av !== bv && !(av == null && bv == null)) return false;
  }
  return true;
}

// Average slope angle (degrees, |ascent| or |descent|) over a small
// window starting at `phase`. Uses the already-sampled elevation
// profile so no extra terrain queries are needed inside the RAF
// loop. Returns 0 when the profile isn't available yet — the caller
// then defaults to NAV_PITCH via pitchForSlope.
function localSlopeDeg(profile, phase) {
  const samples = profile?.samples;
  if (!samples || samples.length < 2) return 0;
  const N = samples.length;
  const idx = Math.max(0, Math.min(N - 2, Math.floor(phase * (N - 1))));
  const end = Math.min(N - 1, idx + SLOPE_WINDOW_SAMPLES);
  const a = samples[idx];
  const b = samples[end];
  if (!a || !b) return 0;
  if (!Number.isFinite(a.elevation) || !Number.isFinite(b.elevation)) return 0;
  const dz = Math.abs(b.elevation - a.elevation);
  const dx = Math.abs(b.distance  - a.distance);
  if (dx <= 0) return 0;
  return Math.atan2(dz, dx) * 180 / Math.PI;
}

// Map slope angle → chase-cam pitch. Below SLOPE_LOW we run the full
// NAV_PITCH chase-cam; above SLOPE_HIGH we drop to TOP_DOWN_PITCH so
// the marker stays visible over a cliff / ridge; between the two we
// linearly interpolate.
function pitchForSlope(slopeDeg) {
  if (slopeDeg <= SLOPE_LOW_DEG)  return NAV_PITCH;
  if (slopeDeg >= SLOPE_HIGH_DEG) return TOP_DOWN_PITCH;
  const t = (slopeDeg - SLOPE_LOW_DEG) / (SLOPE_HIGH_DEG - SLOPE_LOW_DEG);
  return NAV_PITCH + (TOP_DOWN_PITCH - NAV_PITCH) * t;
}

// Interpolate elevation from the sampled profile at fractional phase
// (0..1). Skips over any null samples caused by unloaded terrain tiles.
function elevationAtPhase(profile, phase) {
  const samples = profile?.samples;
  if (!samples || samples.length === 0) return null;
  const idx = Math.max(0, Math.min(samples.length - 1, phase * (samples.length - 1)));
  const lo = Math.floor(idx);
  const hi = Math.min(samples.length - 1, lo + 1);
  const t  = idx - lo;
  const a  = samples[lo].elevation;
  const b  = samples[hi].elevation;
  if (a == null && b == null) return null;
  if (a == null) return b;
  if (b == null) return a;
  return a + (b - a) * t;
}

// Chevron marker ------------------------------------------------------------

// Pulsating black dot with yellow ripples radiating outwards. The
// dot itself gently scales in/out to feel alive; three ripple rings
// are staggered so a new ring is always underway before the previous
// one has faded — reads as a continuous "sonar" beat rather than a
// discrete pulse. All timings driven by the Web Animations API so
// we don't need to inject any global CSS.
function makeMarkerElement() {
  const el = document.createElement('div');
  el.style.cssText =
    'width:64px;height:64px;pointer-events:none;position:relative;';

  const RIPPLE_COUNT    = 3;
  const RIPPLE_DUR_MS   = 2000;
  const RIPPLE_START_PX = 10;
  const RIPPLE_END_PX   = 60;

  for (let i = 0; i < RIPPLE_COUNT; i++) {
    const ring = document.createElement('div');
    ring.style.cssText =
      'position:absolute;top:50%;left:50%;' +
      'transform:translate(-50%,-50%);' +
      'border-radius:50%;border:2px solid #facc15;' +
      'width:' + RIPPLE_START_PX + 'px;height:' + RIPPLE_START_PX + 'px;' +
      'opacity:0;pointer-events:none;' +
      'box-shadow:0 0 6px rgba(250,204,21,0.35);';
    el.appendChild(ring);
    ring.animate(
      [
        { width: RIPPLE_START_PX + 'px', height: RIPPLE_START_PX + 'px',
          borderWidth: '3px', opacity: 0.85 },
        { width: RIPPLE_END_PX + 'px', height: RIPPLE_END_PX + 'px',
          borderWidth: '1px', opacity: 0, offset: 1 },
      ],
      {
        duration: RIPPLE_DUR_MS,
        delay: (i * RIPPLE_DUR_MS) / RIPPLE_COUNT,
        iterations: Infinity,
        easing: 'ease-out',
      },
    );
  }

  const dot = document.createElement('div');
  dot.style.cssText =
    'position:absolute;top:50%;left:50%;' +
    'transform:translate(-50%,-50%);' +
    'width:14px;height:14px;border-radius:50%;' +
    'background:#000000;' +
    'border:2px solid #facc15;' +
    'box-shadow:0 0 6px rgba(0,0,0,0.55), 0 0 12px rgba(250,204,21,0.35);' +
    'pointer-events:none;';
  el.appendChild(dot);
  dot.animate(
    [
      { transform: 'translate(-50%,-50%) scale(1)' },
      { transform: 'translate(-50%,-50%) scale(1.18)' },
      { transform: 'translate(-50%,-50%) scale(1)' },
    ],
    {
      duration: 1400,
      iterations: Infinity,
      easing: 'ease-in-out',
    },
  );

  // Live elevation chip — floats just above the dot, yellow chip
  // with black text (same palette as the ripples). Kept as a
  // dataset-exposed element so ensureMarker can update its text
  // per frame without rebuilding the DOM.
  const chip = document.createElement('div');
  chip.dataset.role = 'elevation-chip';
  chip.style.cssText =
    'position:absolute;left:50%;bottom:calc(50% + 14px);' +
    'transform:translateX(-50%);' +
    'padding:2px 6px;border-radius:4px;' +
    'background:#facc15;color:#0b1220;' +
    'font:600 11px/1 system-ui,-apple-system,sans-serif;' +
    'white-space:nowrap;pointer-events:none;' +
    'box-shadow:0 1px 3px rgba(0,0,0,0.5);' +
    'display:none;';
  el.appendChild(chip);

  return el;
}

// Update the chip text on the marker element in place. Called every
// frame from ensureMarker so the on-map elevation matches the chart's
// live label.
function setMarkerElevation(markerElement, elevation) {
  if (!markerElement) return;
  const chip = markerElement.querySelector('[data-role="elevation-chip"]');
  if (!chip) return;
  if (Number.isFinite(elevation)) {
    chip.textContent = `${Math.round(elevation)} m`;
    chip.style.display = 'block';
  } else {
    chip.style.display = 'none';
  }
}

function ensureMarker(map, markerRef, frame, elevation) {
  if (!markerRef.current) {
    // occludedOpacity: 1 keeps the marker fully visible even when
    // Mapbox's terrain DEM says a ridge / peak sits between the
    // camera and the anchor point. Without this, in mountainous
    // sections the pulsating dot fades to ~20 % and briefly reads
    // as "the marker vanished". The pulsating dot is rotationally
    // symmetric so no rotationAlignment tricks are needed.
    const marker = new mapboxgl.Marker({
      element: makeMarkerElement(),
      occludedOpacity: 1,
    });
    marker.setLngLat(frame.center);
    marker.addTo(map);
    markerRef.current = marker;
  } else {
    markerRef.current.setLngLat(frame.center);
  }
  setMarkerElevation(markerRef.current.getElement(), elevation);
}

function removeMarker(markerRef) {
  if (markerRef.current) {
    markerRef.current.remove();
    markerRef.current = null;
  }
}

// Camera / bounds -----------------------------------------------------------

function fitToRoutes(map, routes, extraOpts) {
  const fcs = routes.map((r) => r.fc).filter(Boolean);
  if (!fcs.length) return;
  const combined = { type: 'FeatureCollection', features: fcs.flatMap((f) => f.features ?? []) };
  fitToFeatureCollection(map, combined, extraOpts);
}

function fitToFeatureCollection(map, fc, extraOpts) {
  if (!fc?.features?.length) return;
  // No isStyleLoaded guard — fitBounds is a pure camera operation
  // and works fine while satellite tiles are still streaming.
  // (`map.once('load', ...)` only fires on the very first load, so
  // the old guard silently dropped any fit request that happened
  // during subsequent tile-loading windows — which is why "add a
  // route" did nothing on the map.)
  let minLng =  Infinity;
  let minLat =  Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  const consume = (coord) => {
    if (!Array.isArray(coord) || coord.length < 2) return;
    const [lng, lat] = coord;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  };
  const walk = (arr) => {
    if (!Array.isArray(arr)) return;
    if (typeof arr[0] === 'number') { consume(arr); return; }
    for (const x of arr) walk(x);
  };
  for (const f of fc.features) walk(f?.geometry?.coordinates);
  if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) return;
  map.fitBounds(
    [[minLng, minLat], [maxLng, maxLat]],
    {
      padding: FIT_PADDING,
      duration: 800,
      maxZoom: FIT_MAX_ZOOM,
      ...extraOpts,
    },
  );
}
