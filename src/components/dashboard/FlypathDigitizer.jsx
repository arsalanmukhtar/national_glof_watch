import { useEffect, useRef } from 'react';
import { useFlypath } from '@/contexts/FlypathContext';

// FlypathDigitizer — invisible component. Owns the map interactions
// used to hand-draw a flypath, plus the two-layer preview (red line
// + cyan vertex dots) that Mapbox renders while digitizing.
//
// Interaction model (only active while context.digitizing === true):
//   • single left-click       → add one vertex at the click point
//   • left-click and drag     → freehand: add a vertex on every
//                               mousemove that has travelled at least
//                               FREEHAND_MIN_PX from the last vertex
//                               (throttles the vertex count on fast
//                               drags — a smooth curve, not a firehose)
//   • Delete / Backspace key  → remove the last vertex (undo)
//   • Escape key              → cancel the drawing entirely
//
// Map affordances during digitize:
//   • scroll-zoom, box-zoom, keyboard nav, double-click zoom       ↑ ON
//   • drag-pan                                                      ↓ OFF
//     (needed so left-drag can be captured for freehand; user can
//      still zoom, and pan by exiting digitize or with the map
//      keyboard shortcuts)
//
// Preview style:
//   • Red solid line   (#ef4444) width 3
//   • Cyan vertex dots (#67e8f9) radius 5 with a dark stroke
// The in-progress preview lives in its own source (flypath-drawing-src)
// so it never touches the drawn routes' data-driven paint.

const DRAW_LINE_SRC     = 'flypath-drawing-line-src';
const DRAW_VERTS_SRC    = 'flypath-drawing-verts-src';
const DRAW_LINE_LAYER   = 'flypath-drawing-line';
const DRAW_VERTS_LAYER  = 'flypath-drawing-verts';

const DRAW_LINE_COLOR   = '#ef4444';   // red-500 — vivid in-progress cue
const DRAW_VERT_COLOR   = '#67e8f9';   // cyan-300 — light cyan per spec
const DRAW_VERT_STROKE  = '#0f172a';

const FREEHAND_MIN_PX   = 8;   // pixels between successive freehand vertices

export default function FlypathDigitizer({ map }) {
  const {
    digitizing,
    drawnCoords,
    addDrawnVertex,
    undoDrawnVertex,
    cancelDigitize,
  } = useFlypath();

  // Ref mirrors so map event handlers (which are registered once per
  // digitize session) always read the freshest values.
  const digitizingRef  = useRef(digitizing);
  digitizingRef.current = digitizing;

  // ---------------------------------------------------------------
  // Preview source + layers — mounted lifecycle. Kept as empty
  // sources when idle so basemap swaps don't need special handling;
  // they just refill from the current drawnCoords on the next effect.
  // ---------------------------------------------------------------
  useEffect(() => {
    if (!map) return undefined;
    let pending = false;

    const ensure = () => {
      try {
        if (!map.getSource(DRAW_LINE_SRC)) {
          map.addSource(DRAW_LINE_SRC, { type: 'geojson', data: emptyLine() });
        }
        if (!map.getSource(DRAW_VERTS_SRC)) {
          map.addSource(DRAW_VERTS_SRC, { type: 'geojson', data: emptyFC() });
        }
        if (!map.getLayer(DRAW_LINE_LAYER)) {
          map.addLayer({
            id: DRAW_LINE_LAYER,
            type: 'line',
            source: DRAW_LINE_SRC,
            paint: {
              'line-color': DRAW_LINE_COLOR,
              'line-width': 3,
              'line-opacity': 0.95,
            },
            layout: { 'line-cap': 'round', 'line-join': 'round' },
          });
        }
        if (!map.getLayer(DRAW_VERTS_LAYER)) {
          map.addLayer({
            id: DRAW_VERTS_LAYER,
            type: 'circle',
            source: DRAW_VERTS_SRC,
            paint: {
              'circle-radius': 5,
              'circle-color': DRAW_VERT_COLOR,
              'circle-stroke-color': DRAW_VERT_STROKE,
              'circle-stroke-width': 1.5,
            },
          });
        }
        pending = false;
      } catch {
        pending = true;
      }
    };
    const onIdle = () => { if (pending) ensure(); };

    ensure();
    map.on('load', ensure);
    map.on('style.load', ensure);
    map.on('idle', onIdle);
    return () => {
      map.off('load', ensure);
      map.off('style.load', ensure);
      map.off('idle', onIdle);
    };
  }, [map]);

  // ---------------------------------------------------------------
  // Push drawnCoords into the preview sources.
  // ---------------------------------------------------------------
  useEffect(() => {
    if (!map) return;
    try {
      const lineData = drawnCoords.length >= 2
        ? {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: drawnCoords },
            properties: {},
          }
        : emptyLine();
      map.getSource(DRAW_LINE_SRC)?.setData(lineData);
      map.getSource(DRAW_VERTS_SRC)?.setData({
        type: 'FeatureCollection',
        features: drawnCoords.map((c) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: c },
          properties: {},
        })),
      });
    } catch { /* transient */ }
  }, [map, drawnCoords]);

  // ---------------------------------------------------------------
  // Map interaction lifecycle — attach on enter, tear down on exit.
  // ---------------------------------------------------------------
  useEffect(() => {
    if (!map || !digitizing) return undefined;

    // Disable drag-pan so left-drag is ours (freehand). Everything
    // else (scroll zoom, keyboard nav, box zoom, double-tap zoom)
    // stays on so the operator can still position the map with them.
    const wasDragPanEnabled = map.dragPan?.isEnabled?.();
    map.dragPan?.disable?.();
    // Flip the cursor to a crosshair so the mode is unmistakable.
    const canvas = map.getCanvasContainer?.();
    const prevCursor = canvas ? canvas.style.cursor : '';
    if (canvas) canvas.style.cursor = 'crosshair';

    let dragging = false;
    let moved = false;
    let lastPixel = null;   // { x, y } — for FREEHAND_MIN_PX throttle

    const addVertexFromEvent = (e) => {
      const { lng, lat } = e.lngLat;
      addDrawnVertex([lng, lat]);
    };

    const onMouseDown = (e) => {
      // Only left button; leave right / middle for future pan.
      if (e.originalEvent?.button !== 0) return;
      dragging = true;
      moved = false;
      lastPixel = { x: e.point.x, y: e.point.y };
      // First vertex on click-down so the line renders immediately —
      // if it turns into a drag, freehand keeps adding.
      addVertexFromEvent(e);
    };
    const onMouseMove = (e) => {
      if (!dragging) return;
      const dx = e.point.x - (lastPixel?.x ?? e.point.x);
      const dy = e.point.y - (lastPixel?.y ?? e.point.y);
      if (Math.hypot(dx, dy) < FREEHAND_MIN_PX) return;
      moved = true;
      lastPixel = { x: e.point.x, y: e.point.y };
      addVertexFromEvent(e);
    };
    const onMouseUp = () => {
      dragging = false;
      moved = false;
      lastPixel = null;
    };

    const onKeyDown = (e) => {
      if (!digitizingRef.current) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        undoDrawnVertex();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelDigitize();
      }
    };

    map.on('mousedown', onMouseDown);
    map.on('mousemove', onMouseMove);
    map.on('mouseup',   onMouseUp);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      map.off('mousedown', onMouseDown);
      map.off('mousemove', onMouseMove);
      map.off('mouseup',   onMouseUp);
      window.removeEventListener('keydown', onKeyDown);
      if (wasDragPanEnabled) map.dragPan?.enable?.();
      if (canvas) canvas.style.cursor = prevCursor;
    };
  }, [map, digitizing, addDrawnVertex, undoDrawnVertex, cancelDigitize]);

  return null;
}

function emptyLine() {
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [] },
    properties: {},
  };
}
function emptyFC() {
  return { type: 'FeatureCollection', features: [] };
}
