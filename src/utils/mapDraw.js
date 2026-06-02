// ---------------------------------------------------------------------------
// Lightweight Mapbox draw tools — rectangle + polygon — without pulling
// in mapbox-gl-draw.
//
// Each helper returns a `cancel()` function the caller can invoke to
// tear the listeners and the temporary source/layer down (e.g. on
// modal close, mode switch). On successful completion the helper
// resolves with a GeoJSON FeatureCollection that callers feed straight
// into zonalStatistics.
//
// Visual style follows the dashboard accent — lime fill + outline so
// the AOI is unambiguous against the basemap.
// ---------------------------------------------------------------------------

import { ringToFeatureCollection } from './geoAnalysis';

const DRAW_SOURCE = 'geo-analysis-draw';
const DRAW_FILL = 'geo-analysis-draw-fill';
const DRAW_OUTLINE = 'geo-analysis-draw-outline';
const DRAW_VERTICES = 'geo-analysis-draw-vertices';
// Selected / drawn polygon highlight — rich pure yellow with a deep
// yellow-800 outline so the selection reads loud against the purple
// population raster without competing with the lime UI accent or the
// green station dots.
const ACCENT = '#facc15';        // yellow-400 — rich pure yellow fill
const ACCENT_DARK = '#854d0e';   // yellow-800 outline
const VERTEX_FILL = '#fde047';   // yellow-300 — slightly lighter so vertex dots pop against the fill
const DANGER = '#dc2626';
const DRAW_CURSOR_CLASS = 'geo-draw-active';

function setCrosshair(map, on) {
  const c = map.getCanvasContainer?.();
  if (!c) return;
  c.classList.toggle(DRAW_CURSOR_CLASS, !!on);
}

function ensureDrawLayers(map) {
  if (!map.getSource(DRAW_SOURCE)) {
    map.addSource(DRAW_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }
  if (!map.getLayer(DRAW_FILL)) {
    map.addLayer({
      id: DRAW_FILL,
      type: 'fill',
      source: DRAW_SOURCE,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: {
        // Armed-for-deletion features paint a redder fill so the user
        // gets unambiguous visual feedback before pressing Delete.
        'fill-color': [
          'case',
          ['boolean', ['feature-state', 'armed'], false], DANGER,
          ['boolean', ['get', 'armed'], false], DANGER,
          ACCENT,
        ],
        'fill-opacity': [
          'case',
          ['boolean', ['get', 'armed'], false], 0.40,
          0.32,
        ],
      },
    });
  }
  if (!map.getLayer(DRAW_OUTLINE)) {
    map.addLayer({
      id: DRAW_OUTLINE,
      type: 'line',
      source: DRAW_SOURCE,
      paint: {
        'line-color': [
          'case',
          ['boolean', ['get', 'armed'], false], DANGER,
          ACCENT_DARK,
        ],
        'line-width': 2,
      },
    });
  }
  if (!map.getLayer(DRAW_VERTICES)) {
    map.addLayer({
      id: DRAW_VERTICES,
      type: 'circle',
      source: DRAW_SOURCE,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 4.5,
        'circle-color': VERTEX_FILL,
        'circle-stroke-color': ACCENT_DARK,
        'circle-stroke-width': 1.5,
      },
    });
  }
}

// Insert intermediate vertices along every edge so the geometry stays
// visually straight even when Mapbox's 3D Terrain layer is on. Without
// this, a rectangle with just 4 corners drapes over the elevation mesh
// between corners and appears wavy. ~0.004 deg ~= 400 m at Pakistan's
// latitudes — fine enough that terrain draping is invisible while not
// inflating the geometry into the tens-of-thousands of vertices.
const DENSIFY_MAX_SEG_DEG = 0.004;

function densifyRing(ring) {
  if (!ring || ring.length < 2) return ring;
  const out = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    out.push([x1, y1]);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist / DENSIFY_MAX_SEG_DEG));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      out.push([x1 + dx * t, y1 + dy * t]);
    }
  }
  out.push(ring[ring.length - 1]);
  return out;
}

function densifyFeature(f) {
  const g = f?.geometry;
  if (!g) return f;
  if (g.type === 'Polygon') {
    return { ...f, geometry: { ...g, coordinates: g.coordinates.map(densifyRing) } };
  }
  if (g.type === 'MultiPolygon') {
    return { ...f, geometry: { ...g, coordinates: g.coordinates.map((p) => p.map(densifyRing)) } };
  }
  if (g.type === 'LineString') {
    return { ...f, geometry: { ...g, coordinates: densifyRing(g.coordinates) } };
  }
  if (g.type === 'MultiLineString') {
    return { ...f, geometry: { ...g, coordinates: g.coordinates.map(densifyRing) } };
  }
  // Points and unknown types pass through untouched.
  return f;
}

function setDrawData(map, features) {
  const src = map.getSource(DRAW_SOURCE);
  if (!src) return;
  src.setData({
    type: 'FeatureCollection',
    features: (features || []).map(densifyFeature),
  });
}

export function clearDraw(map) {
  if (!map) return;
  if (map.getLayer(DRAW_FILL)) map.removeLayer(DRAW_FILL);
  if (map.getLayer(DRAW_OUTLINE)) map.removeLayer(DRAW_OUTLINE);
  if (map.getLayer(DRAW_VERTICES)) map.removeLayer(DRAW_VERTICES);
  if (map.getSource(DRAW_SOURCE)) map.removeSource(DRAW_SOURCE);
  setCrosshair(map, false);
}

// Show a previously-completed AOI on the map (used to re-render the
// boundary after the modal collapses, before the screenshot for PDF).
// `armed` paints the polygon in danger-red to confirm it's about to be
// deleted (no geometry/state mutation outside the source data).
export function showAoiOnMap(map, featureCollection, { armed = false } = {}) {
  if (!map || !featureCollection) return;
  ensureDrawLayers(map);
  const features = (featureCollection.features ?? []).map((f) => ({
    ...f,
    properties: { ...(f.properties || {}), armed },
  }));
  setDrawData(map, features);
}

// Watch for clicks on the drawn AOI fill — used by the panel to "arm"
// a completed polygon for keyboard-delete. Returns a cleanup function.
// `onSelect()` fires when the user clicks inside the AOI; `onDeselect()`
// fires when they click outside it.
export function watchAoiClicks(map, { onSelect, onDeselect } = {}) {
  if (!map) return () => {};
  const fillId = DRAW_FILL;
  const onMapClick = (e) => {
    if (!map.getLayer(fillId)) return;
    const hits = map.queryRenderedFeatures(e.point, { layers: [fillId] });
    if (hits.length > 0) onSelect?.();
    else onDeselect?.();
  };
  map.on('click', onMapClick);
  return () => map.off('click', onMapClick);
}

// Rectangle draw — click-drag from one corner to the opposite one. The
// caller's onComplete receives the final FeatureCollection. Promise
// alternative is exposed for await-style usage.
export function drawRectangle(map, { onComplete } = {}) {
  if (!map) return () => {};
  ensureDrawLayers(map);
  setDrawData(map, []);
  setCrosshair(map, true);
  map.dragPan.disable();
  map.boxZoom.disable();
  map.doubleClickZoom.disable();

  let start = null;
  let active = true;

  const rectFC = (a, b) => {
    const minX = Math.min(a.lng, b.lng);
    const maxX = Math.max(a.lng, b.lng);
    const minY = Math.min(a.lat, b.lat);
    const maxY = Math.max(a.lat, b.lat);
    return ringToFeatureCollection([
      [minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY],
    ]);
  };

  const onDown = (e) => {
    if (!active) return;
    start = e.lngLat;
    e.preventDefault();
  };
  const onMove = (e) => {
    if (!active || !start) return;
    const fc = rectFC(start, e.lngLat);
    if (fc) setDrawData(map, fc.features);
  };
  const onUp = (e) => {
    if (!active || !start) return;
    const fc = rectFC(start, e.lngLat);
    if (fc) {
      setDrawData(map, fc.features);
      onComplete?.(fc);
    }
    cancel();
  };

  const cancel = () => {
    if (!active) return;
    active = false;
    map.off('mousedown', onDown);
    map.off('mousemove', onMove);
    map.off('mouseup', onUp);
    setCrosshair(map, false);
    map.dragPan.enable();
    map.boxZoom.enable();
    map.doubleClickZoom.enable();
  };

  map.on('mousedown', onDown);
  map.on('mousemove', onMove);
  map.on('mouseup', onUp);
  return cancel;
}

// Polygon draw — click to add vertices, double-click (or Enter) to
// finalise. Right-click or Escape cancels.
export function drawPolygon(map, { onComplete, onCancel } = {}) {
  if (!map) return () => {};
  ensureDrawLayers(map);
  setDrawData(map, []);
  setCrosshair(map, true);
  map.doubleClickZoom.disable();

  const verts = []; // array of [lng, lat]
  let hoverPoint = null;
  let active = true;

  const refresh = () => {
    const features = [];
    if (verts.length >= 1) {
      // Vertex dots for visual feedback.
      for (const [lng, lat] of verts) {
        features.push({
          type: 'Feature',
          properties: { vertex: true },
          geometry: { type: 'Point', coordinates: [lng, lat] },
        });
      }
      // Working polyline / polygon ghost
      const path = [...verts];
      if (hoverPoint && verts.length >= 1) path.push(hoverPoint);
      if (path.length >= 2) {
        const closed = verts.length >= 3 ? [...path, verts[0]] : path;
        features.push({
          type: 'Feature',
          properties: { working: true },
          geometry:
            verts.length >= 3
              ? { type: 'Polygon', coordinates: [closed] }
              : { type: 'LineString', coordinates: path },
        });
      }
    }
    setDrawData(map, features);
  };

  const onClick = (e) => {
    if (!active) return;
    verts.push([e.lngLat.lng, e.lngLat.lat]);
    refresh();
  };
  const onMove = (e) => {
    if (!active) return;
    hoverPoint = [e.lngLat.lng, e.lngLat.lat];
    refresh();
  };
  const onDblClick = (e) => {
    if (!active) return;
    e.preventDefault();
    finish();
  };
  const onContextMenu = (e) => {
    if (!active) return;
    e.preventDefault();
    cancel();
  };
  const onKey = (e) => {
    if (e.key === 'Enter') finish();
    else if (e.key === 'Escape') cancel();
  };

  const finish = () => {
    if (!active) return;
    if (verts.length < 3) {
      cancel();
      onCancel?.();
      return;
    }
    const fc = ringToFeatureCollection(verts);
    cleanup();
    if (fc) {
      setDrawData(map, fc.features);
      onComplete?.(fc);
    }
  };

  const cancel = () => {
    if (!active) return;
    cleanup();
    setDrawData(map, []);
    onCancel?.();
  };

  const cleanup = () => {
    if (!active) return;
    active = false;
    map.off('click', onClick);
    map.off('mousemove', onMove);
    map.off('dblclick', onDblClick);
    map.off('contextmenu', onContextMenu);
    document.removeEventListener('keydown', onKey);
    setCrosshair(map, false);
    map.doubleClickZoom.enable();
  };

  map.on('click', onClick);
  map.on('mousemove', onMove);
  map.on('dblclick', onDblClick);
  map.on('contextmenu', onContextMenu);
  document.addEventListener('keydown', onKey);

  return cancel;
}
