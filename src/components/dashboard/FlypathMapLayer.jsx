import { useEffect, useRef } from 'react';
import { mapboxgl } from '@/config/mapbox';
import { useFlypath } from '@/contexts/FlypathContext';

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

const DEM_SRC         = 'mapbox-dem';
const DEM_URL         = 'mapbox://mapbox.mapbox-terrain-dem-v1';
const DEM_MAX_ZOOM    = 14;
const TERRAIN_EXAG    = 1.3;

const NAV_PITCH       = 50;
const FLIGHT_ZOOM     = 16.5;   // chase-cam altitude — close enough to feel like flying
const LOOK_AHEAD_FRAC = 0.02;
const FIT_PADDING     = 60;
const ELEV_SAMPLES    = 150;

// Zoom cap applied when fitting bounds. Prevents a single very short
// route from zooming in past what the marker + terrain read well at.
const FIT_MAX_ZOOM    = 15;

export default function FlypathMapLayer({ map }) {
  const {
    routes,
    selectedRoute,
    features,
    featuresStyle,
    playState,
    routesFlyTick,
    featuresFlyTick,
    elevationProfile,
    phaseRef,
    flightDuration,
    setElevationProfile,
    stop,
  } = useFlypath();

  const flightDurationRef = useRef(flightDuration);
  flightDurationRef.current = flightDuration;

  // Cached FCs so ensureLayers can rebuild sources after a basemap
  // swap without needing to observe context changes.
  const routesFCRef       = useRef(emptyFC());
  const featuresDataRef   = useRef(emptyFC());
  const featuresStyleRef  = useRef(featuresStyle);
  featuresStyleRef.current = featuresStyle;

  // Coordinate list the animator flies along — the SELECTED route's
  // first LineString, oriented high → low. Recomputed at Start.
  const flightCoordsRef = useRef(null);

  const lastFrameRef = useRef(0);
  const rafRef       = useRef(0);
  const markerRef    = useRef(null);

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
          map.addLayer({
            id: FEATURES_FILL,
            type: 'fill',
            source: FEATURES_SRC,
            filter: ['any',
              ['==', ['geometry-type'], 'Polygon'],
              ['==', ['geometry-type'], 'MultiPolygon'],
            ],
            paint: { 'fill-color': fs.color, 'fill-opacity': fs.opacity },
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

    ensureLayers();
    map.on('load', ensureLayers);
    map.on('style.load', ensureLayers);
    map.on('idle', onIdle);
    return () => {
      map.off('load', ensureLayers);
      map.off('style.load', ensureLayers);
      map.off('idle', onIdle);
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

  useEffect(() => {
    if (!map) return;
    const s = featuresStyle;
    try {
      if (map.getLayer(FEATURES_FILL)) {
        map.setPaintProperty(FEATURES_FILL, 'fill-color',   s.color);
        map.setPaintProperty(FEATURES_FILL, 'fill-opacity', s.opacity);
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
    if (!map || featuresFlyTick === 0) return;
    fitToFeatureCollection(map, features?.fc);
  }, [map, featuresFlyTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------
  // Elevation profile — sampled from the SELECTED route's coords.
  // ---------------------------------------------------------------
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
      const oriented = orientHighToLow(coords, map);
      const profile = sampleElevationProfile(map, oriented, ELEV_SAMPLES);
      if (!profile) return;
      const complete = profile.samples.every((p) => Number.isFinite(p.elevation));
      setElevationProfile((prev) => {
        if (prev?.complete) return prev;
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
      flightCoordsRef.current = orientHighToLow(raw, map);
      if (phaseRef.current >= 1 || phaseRef.current <= 0) phaseRef.current = 0;
    }
    const coords = flightCoordsRef.current;

    // First frame: snap the camera onto the route start (chase-cam
    // initial pose) + place the marker. Marker updates are DOM-only
    // and always safe; `jumpTo` requires a loaded style, so it stays
    // guarded.
    const startFrame = computeFrame(coords, phaseRef.current);
    if (startFrame) {
      if (map.isStyleLoaded()) {
        try {
          map.jumpTo({
            center:  startFrame.center,
            bearing: startFrame.bearing,
            pitch:   NAV_PITCH,
            zoom:    FLIGHT_ZOOM,
          });
        } catch { /* transient */ }
      }
      ensureMarker(
        map, markerRef, startFrame,
        elevationAtPhase(elevationProfile, phaseRef.current),
      );
    }

    lastFrameRef.current = performance.now();
    const tick = (now) => {
      const dt = now - lastFrameRef.current;
      lastFrameRef.current = now;
      phaseRef.current = Math.min(1, phaseRef.current + dt / flightDurationRef.current);

      const frame = computeFrame(coords, phaseRef.current);
      if (frame) {
        // Chase cam — jumpTo per frame keeps the camera centred on
        // the marker with the marker's heading as the bearing.
        // Google-Maps-turn-by-turn feel. Zoom omitted so the user
        // can pinch to zoom mid-flight without us fighting them.
        if (map.isStyleLoaded()) {
          try {
            map.jumpTo({
              center:  frame.center,
              bearing: frame.bearing,
              pitch:   NAV_PITCH,
            });
          } catch { /* transient — next frame retries */ }
        }
        ensureMarker(
          map, markerRef, frame,
          elevationAtPhase(elevationProfile, phaseRef.current),
        );
      }

      if (phaseRef.current >= 1) {
        stop();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
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

function orientHighToLow(coords, map) {
  if (!coords || coords.length < 2) return coords;
  const first = coords[0];
  const last  = coords[coords.length - 1];
  const fz = first[2];
  const lz = last[2];
  if (Number.isFinite(fz) && Number.isFinite(lz)) {
    return fz >= lz ? coords : coords.slice().reverse();
  }
  try {
    if (map.getTerrain && map.getTerrain()) {
      const fe = map.queryTerrainElevation({ lng: first[0], lat: first[1] }, { exaggerated: false });
      const le = map.queryTerrainElevation({ lng: last[0],  lat: last[1]  }, { exaggerated: false });
      if (Number.isFinite(fe) && Number.isFinite(le)) {
        return fe >= le ? coords : coords.slice().reverse();
      }
    }
  } catch { /* terrain not ready */ }
  return coords;
}

function computeFrame(coords, phase) {
  const center = interpolateAlong(coords, phase);
  if (!center) return null;
  const lookAhead = interpolateAlong(coords, Math.min(1, phase + LOOK_AHEAD_FRAC));
  const behind    = interpolateAlong(coords, Math.max(0, phase - LOOK_AHEAD_FRAC));
  const bearing = pointDelta(lookAhead, center) > 1e-9
    ? computeBearing(center, lookAhead)
    : computeBearing(behind, center);
  return { center, bearing };
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
    // The pulsating dot is rotationally symmetric — no need for
    // rotationAlignment/pitchAlignment tricks.
    const marker = new mapboxgl.Marker({ element: makeMarkerElement() });
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
