import { useEffect, useRef } from 'react';
import { mapboxgl } from '@/config/mapbox';
import { useFlypath } from '@/contexts/FlypathContext';

// FlypathOriginSelector — mostly-invisible component that owns the
// "Select origin on map" interaction. Only active while
// context.selectingOrigin === true.
//
// Interaction:
//   • Two pulsating green candidate markers appear on the SELECTED
//     route's first + last vertex — visual hint of where the origin
//     can be dropped.
//   • A translucent green "buffer" circle follows the mouse cursor
//     (radius BUFFER_RADIUS_PX). Positioned via a DOM overlay with
//     transform: translate — no per-frame React re-render.
//   • Left-click:
//       – if the click is within BUFFER_RADIUS_PX of an endpoint,
//         that endpoint becomes the origin (context.setRouteOrigin);
//       – otherwise the click is ignored (mode stays active so the
//         operator can try again).
//   • Escape cancels the mode without changing the origin.
//
// Rendered inside the map wrapper (see MapPanel) so both the buffer
// overlay and the candidate markers stay pinned to the map when the
// user toggles fullscreen.

const BUFFER_RADIUS_PX = 45;

// Palette — deep-green outline + light-green fill matches the ask
// (prominent green, subtle 25 %-ish opacity fill).
const BUFFER_FILL   = 'rgba(34, 197, 94, 0.25)'; // green-500 @ 25%
const BUFFER_BORDER = '#14532d';                 // green-900
const CANDIDATE     = '#22c55e';                 // green-500

export default function FlypathOriginSelector({ map }) {
  const {
    selectingOrigin,
    selectedRoute,
    setRouteOrigin,
    cancelSelectOrigin,
  } = useFlypath();

  const bufferRef       = useRef(null);
  const firstMarkerRef  = useRef(null);
  const lastMarkerRef   = useRef(null);

  useEffect(() => {
    if (!map || !selectingOrigin) return undefined;

    const coords = extractFirstLineString(selectedRoute?.fc);
    if (!coords || coords.length < 2) return undefined;

    // Highlight both endpoints with pulsating green dots so the
    // operator sees exactly which two points the click will snap to.
    firstMarkerRef.current = new mapboxgl.Marker({
      element: makeCandidateElement('START'),
      occludedOpacity: 1,
    }).setLngLat(coords[0]).addTo(map);
    lastMarkerRef.current = new mapboxgl.Marker({
      element: makeCandidateElement('START'),
      occludedOpacity: 1,
    }).setLngLat(coords[coords.length - 1]).addTo(map);

    const canvas = map.getCanvasContainer?.();
    const prevCursor = canvas ? canvas.style.cursor : '';
    if (canvas) canvas.style.cursor = 'crosshair';

    // Position the buffer overlay purely via style.transform on every
    // mousemove — bypasses React reconciliation so the follow feels
    // pointer-locked, not lag-behind.
    const positionBuffer = (x, y, visible) => {
      const el = bufferRef.current;
      if (!el) return;
      el.style.transform =
        `translate(${x - BUFFER_RADIUS_PX}px, ${y - BUFFER_RADIUS_PX}px)`;
      el.style.opacity = visible ? '1' : '0';
    };

    const onMouseMove = (e) => positionBuffer(e.point.x, e.point.y, true);
    const onMouseOut  = () => positionBuffer(0, 0, false);

    const onClick = (e) => {
      const firstPx = map.project(coords[0]);
      const lastPx  = map.project(coords[coords.length - 1]);
      const clickPx = e.point;
      const dFirst = Math.hypot(firstPx.x - clickPx.x, firstPx.y - clickPx.y);
      const dLast  = Math.hypot(lastPx.x  - clickPx.x, lastPx.y  - clickPx.y);
      const firstIn = dFirst <= BUFFER_RADIUS_PX;
      const lastIn  = dLast  <= BUFFER_RADIUS_PX;
      if (!firstIn && !lastIn) {
        // Click missed both endpoints — leave the mode active so the
        // operator can pan and try again. A brief buffer flash gives
        // visual feedback that the click was registered but rejected.
        flashBuffer(bufferRef.current, '#ef4444');
        return;
      }
      // If both are inside, snap to the closer one — happens when
      // route endpoints are very close together on screen (tightly
      // zoomed out).
      const which = firstIn && (!lastIn || dFirst <= dLast) ? 'first' : 'last';
      setRouteOrigin(selectedRoute.id, which);
    };

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelSelectOrigin();
      }
    };

    map.on('mousemove', onMouseMove);
    map.on('mouseout',  onMouseOut);
    map.on('click',     onClick);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      map.off('mousemove', onMouseMove);
      map.off('mouseout',  onMouseOut);
      map.off('click',     onClick);
      window.removeEventListener('keydown', onKeyDown);
      if (canvas) canvas.style.cursor = prevCursor;
      firstMarkerRef.current?.remove(); firstMarkerRef.current = null;
      lastMarkerRef.current?.remove();  lastMarkerRef.current  = null;
    };
  }, [map, selectingOrigin, selectedRoute, setRouteOrigin, cancelSelectOrigin]);

  if (!selectingOrigin) return null;
  return (
    <div
      ref={bufferRef}
      aria-hidden
      className="absolute top-0 left-0 pointer-events-none rounded-full"
      style={{
        width: BUFFER_RADIUS_PX * 2,
        height: BUFFER_RADIUS_PX * 2,
        backgroundColor: BUFFER_FILL,
        border: `2px solid ${BUFFER_BORDER}`,
        boxShadow:
          `0 0 0 1px rgba(255, 255, 255, 0.6),` +
          ` 0 0 14px rgba(34, 197, 94, 0.55)`,
        opacity: 0,
        willChange: 'transform',
        transition: 'opacity 0.15s ease-out, background-color 0.2s ease-out',
        // z above stations + basemap, below the modal / geocoder chrome
        zIndex: 15,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// Pulsating green dot with a small "START" label above so the
// operator knows both markers are candidates for the origin.
function makeCandidateElement(label) {
  const el = document.createElement('div');
  el.style.cssText =
    'position:relative;width:28px;height:28px;pointer-events:none;';

  const ring = document.createElement('div');
  ring.style.cssText =
    'position:absolute;top:50%;left:50%;' +
    'transform:translate(-50%,-50%);' +
    'width:28px;height:28px;border-radius:50%;' +
    `background:${CANDIDATE};` +
    'border:3px solid #052e16;' +
    `box-shadow:0 0 0 2px rgba(255,255,255,0.9), 0 0 14px ${CANDIDATE};`;
  ring.animate(
    [
      { transform: 'translate(-50%,-50%) scale(1)' },
      { transform: 'translate(-50%,-50%) scale(1.18)' },
      { transform: 'translate(-50%,-50%) scale(1)' },
    ],
    { duration: 1200, iterations: Infinity, easing: 'ease-in-out' },
  );
  el.appendChild(ring);

  const chip = document.createElement('div');
  chip.textContent = label;
  chip.style.cssText =
    'position:absolute;left:50%;bottom:calc(50% + 20px);' +
    'transform:translateX(-50%);' +
    'padding:2px 6px;border-radius:4px;' +
    `background:${CANDIDATE};color:#052e16;` +
    'font:700 10px/1 system-ui,-apple-system,sans-serif;' +
    'letter-spacing:0.06em;white-space:nowrap;' +
    'box-shadow:0 1px 3px rgba(0,0,0,0.4);';
  el.appendChild(chip);

  return el;
}

// Brief tinted flash on the buffer to signal "click was received but
// missed both endpoints". Restores after 200 ms without needing a
// second listener.
function flashBuffer(el, color) {
  if (!el) return;
  el.style.backgroundColor = `${color}55`; // 33 % alpha hex
  el.style.borderColor     = color;
  setTimeout(() => {
    if (!el) return;
    el.style.backgroundColor = BUFFER_FILL;
    el.style.borderColor     = BUFFER_BORDER;
  }, 200);
}