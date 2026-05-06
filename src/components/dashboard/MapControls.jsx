import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown,
  ChevronUp,
  Expand,
  Globe2,
  LocateFixed,
  Maximize2,
  Minimize2,
  Minus,
  Navigation2,
  Plus,
  Square,
  SwitchCamera,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { useMapView } from '@/contexts/MapContext';

// Camera animation tuning for the rotate-around-point feature. Defaults
// are conservative for mountain terrain — the orbit pitch and base zoom
// are then narrowed live based on terrain relief sampled around the
// picked point, so a tall foreground peak flattens the camera (more
// top-down) while flat terrain keeps the dramatic angle.
const ORBIT_BASE_ZOOM = 11.5;       // pulled back for rough terrain
const ORBIT_MIN_ZOOM  = 10.5;       // floor when relief is very high
const ORBIT_MAX_ZOOM  = 12.5;       // ceiling when relief is mild
const ORBIT_MAX_PITCH = 55;         // dramatic but never near-horizon
const ORBIT_MIN_PITCH = 28;         // top-down enough to see past peaks
const ORBIT_RING_RADIUS_M = 2500;   // sample radius for initial relief
const ORBIT_FOREGROUND_M  = 1500;   // distance camera-ward of target
const ORBIT_RELIEF_FULL_M = 800;    // relief that fully flattens pitch
const ORBIT_DEG_PER_SEC   = 6;      // orbit speed (60s per revolution)
const ORBIT_PITCH_SMOOTH  = 0.18;   // LPF coefficient on per-frame pitch

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Move a (lng, lat) by `distanceM` along compass `bearingDeg`. Standard
// great-circle math — accurate enough at the few-km scale we sample.
function offsetLngLat(lng, lat, bearingDeg, distanceM) {
  const R = 6378137;
  const ang = distanceM / R;
  const brng = (bearingDeg * Math.PI) / 180;
  const phi1 = (lat * Math.PI) / 180;
  const lam1 = (lng * Math.PI) / 180;
  const phi2 = Math.asin(
    Math.sin(phi1) * Math.cos(ang) +
      Math.cos(phi1) * Math.sin(ang) * Math.cos(brng),
  );
  const lam2 =
    lam1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(ang) * Math.cos(phi1),
      Math.cos(ang) - Math.sin(phi1) * Math.sin(phi2),
    );
  return [(lam2 * 180) / Math.PI, (phi2 * 180) / Math.PI];
}

// Custom vertical control stack — replaces the default Mapbox
// NavigationControl / GeolocateControl / FullscreenControl trio with
// one cohesive minimal design and adds a Mercator/Globe projection toggle.
export default function MapControls({ map, fullscreenTarget }) {
  const [bearing, setBearing] = useState(0);
  const [projection, setProjection] = useState('mercator');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [pickMode, setPickMode] = useState(false);
  const [rotating, setRotating] = useState(false);
  const frameRef = useRef(null);
  const { resetView } = useMapView();

  useEffect(() => {
    if (!map) return;
    const onRotate = () => setBearing(map.getBearing());
    map.on('rotate', onRotate);
    setBearing(map.getBearing());
    setProjection(map.getProjection()?.name ?? 'mercator');
    return () => {
      map.off('rotate', onRotate);
    };
  }, [map]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Stop the orbit animation. Optional reset eases the pitch back to flat
  // so the next interaction starts from a normal top-down view.
  const stopRotation = (resetCamera = true) => {
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    setRotating(false);
    if (resetCamera && map) {
      map.easeTo({ bearing: 0, pitch: 0, duration: 600 });
    }
  };

  // Fly to the picked point and start a per-frame orbit. The camera
  // pitch is driven by `queryTerrainElevation` — when the foreground
  // (between camera and target) holds a peak, pitch flattens toward
  // top-down so the picked feature stays visible instead of being
  // occluded by the mountain.
  const startRotation = (lngLat) => {
    if (!map) return;
    const target = [lngLat.lng, lngLat.lat];
    const targetElev = map.queryTerrainElevation?.(target) ?? 0;

    // Sample 8 ring points to estimate local relief. queryTerrainElevation
    // returns null while terrain tiles for the point haven't loaded yet —
    // null entries are skipped so a half-loaded view still picks something
    // sensible.
    let maxRelief = 0;
    for (let b = 0; b < 360; b += 45) {
      const p = offsetLngLat(target[0], target[1], b, ORBIT_RING_RADIUS_M);
      const e = map.queryTerrainElevation?.(p);
      if (e != null) maxRelief = Math.max(maxRelief, e - targetElev);
    }
    const reliefFrac = clamp(maxRelief / 1500, 0, 1); // 0 = flat, 1 = very rough

    const initialZoom = clamp(
      ORBIT_BASE_ZOOM - reliefFrac,
      ORBIT_MIN_ZOOM,
      ORBIT_MAX_ZOOM,
    );
    const initialPitch = clamp(
      ORBIT_MAX_PITCH - reliefFrac * (ORBIT_MAX_PITCH - ORBIT_MIN_PITCH) * 0.4,
      ORBIT_MIN_PITCH + 5,
      ORBIT_MAX_PITCH,
    );

    map.flyTo({
      center: target,
      zoom: initialZoom,
      pitch: initialPitch,
      bearing: 0,
      duration: 1600,
      essential: true,
    });
    setRotating(true);

    let smoothedPitch = initialPitch;
    const startTime = performance.now();
    const tick = (timestamp) => {
      const elapsed = timestamp - startTime;
      const bearing = ((elapsed / 1000) * ORBIT_DEG_PER_SEC) % 360;

      // Camera sits opposite the bearing direction; "foreground" is the
      // ground between camera and target. Sample its elevation — if the
      // peak ahead of us is taller than the target by enough, flatten
      // pitch so the camera looks past it.
      const cameraSide = (bearing + 180) % 360;
      const fg = offsetLngLat(target[0], target[1], cameraSide, ORBIT_FOREGROUND_M);
      const fgElev = map.queryTerrainElevation?.(fg);
      let targetPitch = initialPitch;
      if (fgElev != null) {
        const reliefAhead = Math.max(0, fgElev - targetElev);
        const flatten = clamp(reliefAhead / ORBIT_RELIEF_FULL_M, 0, 1);
        targetPitch =
          ORBIT_MAX_PITCH - flatten * (ORBIT_MAX_PITCH - ORBIT_MIN_PITCH);
      }
      // Low-pass filter so pitch glides instead of jumping when the
      // bearing sweeps past a sharp ridgeline.
      smoothedPitch =
        smoothedPitch * (1 - ORBIT_PITCH_SMOOTH) + targetPitch * ORBIT_PITCH_SMOOTH;

      map.jumpTo({ center: target, bearing, pitch: smoothedPitch });
      frameRef.current = requestAnimationFrame(tick);
    };
    // Kick off after the flyTo settles so the rotation rides on top of
    // the terrain-pitched view rather than fighting the in-flight ease.
    setTimeout(() => {
      if (rotatingRef.current) {
        frameRef.current = requestAnimationFrame(tick);
      }
    }, 1700);
  };

  // Mirror state into a ref so the deferred rotation start can short-
  // circuit if the user already canceled.
  const rotatingRef = useRef(false);
  useEffect(() => { rotatingRef.current = rotating; }, [rotating]);

  // Cancel orbit if the user grabs the map themselves.
  useEffect(() => {
    if (!rotating || !map) return;
    const stop = () => stopRotation(false);
    map.on('dragstart', stop);
    return () => {
      map.off('dragstart', stop);
    };
  }, [rotating, map]);

  // Pick mode → next click on the canvas seeds the rotation. Captured at
  // the DOM level so the click doesn't double-fire as a station pick.
  useEffect(() => {
    if (!map || !pickMode) return;
    const canvas = map.getCanvas();
    const prevCursor = canvas.style.cursor;
    canvas.style.cursor = 'crosshair';

    const onCanvasClick = (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const lngLat = map.unproject([x, y]);
      setPickMode(false);
      canvas.style.cursor = prevCursor;
      startRotation(lngLat);
    };
    const onKeyDown = (ev) => {
      if (ev.key === 'Escape') {
        setPickMode(false);
        canvas.style.cursor = prevCursor;
      }
    };

    canvas.addEventListener('click', onCanvasClick, { capture: true, once: true });
    window.addEventListener('keydown', onKeyDown);
    return () => {
      canvas.removeEventListener('click', onCanvasClick, { capture: true });
      window.removeEventListener('keydown', onKeyDown);
      canvas.style.cursor = prevCursor;
    };
  }, [pickMode, map]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop any pending RAF when the component unmounts.
  useEffect(() => {
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  if (!map) return null;

  const zoomIn = () => map.zoomIn();
  const zoomOut = () => map.zoomOut();
  const resetBearing = () => map.easeTo({ bearing: 0, pitch: 0, duration: 400 });
  const locate = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        map.flyTo({
          center: [pos.coords.longitude, pos.coords.latitude],
          zoom: 12,
          essential: true,
        }),
      () => {},
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };
  const toggleProjection = () => {
    const next = projection === 'globe' ? 'mercator' : 'globe';
    map.setProjection(next);
    setProjection(next);
  };
  const toggleFullscreen = () => {
    const target = fullscreenTarget ?? map.getContainer();
    if (!document.fullscreenElement) target?.requestFullscreen?.();
    else document.exitFullscreen?.();
  };

  // Three states for the orbit button:
  //   idle     → click to enter pick mode
  //   pickMode → click anywhere on the map to seed the orbit
  //   rotating → click to stop and reset the camera
  const toggleOrbit = () => {
    if (rotating) {
      stopRotation(true);
      return;
    }
    if (pickMode) {
      setPickMode(false);
      return;
    }
    setPickMode(true);
  };

  const orbitLabel = rotating
    ? 'Stop camera rotation'
    : pickMode
      ? 'Click a point on the map…'
      : 'Rotate camera around point';

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1 }}
      className={cn(
        'absolute top-2 right-2 z-10 flex flex-col rounded-md overflow-hidden shadow-sm',
        'bg-white/95 dark:bg-night-surface/95 backdrop-blur-sm',
        'border border-day-border dark:border-night-border',
      )}
    >
      <CtrlButton
        onClick={() => setCollapsed((c) => !c)}
        label={collapsed ? 'Show controls' : 'Hide controls'}
      >
        {collapsed ? (
          <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
        ) : (
          <ChevronUp className="h-3.5 w-3.5" strokeWidth={2} />
        )}
      </CtrlButton>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="ctrl-stack"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className={cn(
              'flex flex-col overflow-hidden',
              'border-t border-day-border dark:border-night-border',
              'divide-y divide-day-border dark:divide-night-border',
            )}
          >
            <CtrlButton onClick={zoomIn} label="Zoom in">
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            </CtrlButton>
            <CtrlButton onClick={zoomOut} label="Zoom out">
              <Minus className="h-3.5 w-3.5" strokeWidth={2} />
            </CtrlButton>
            <CtrlButton onClick={resetView} label="Zoom to full extent">
              <Expand className="h-3.5 w-3.5" strokeWidth={1.75} />
            </CtrlButton>
            <CtrlButton onClick={resetBearing} label="Reset bearing">
              <Navigation2
                className="h-3.5 w-3.5"
                strokeWidth={1.75}
                style={{ transform: `rotate(${-bearing}deg)` }}
              />
            </CtrlButton>
            <CtrlButton onClick={locate} label="My location">
              <LocateFixed className="h-3.5 w-3.5" strokeWidth={1.75} />
            </CtrlButton>
            <CtrlButton
              onClick={toggleOrbit}
              active={pickMode || rotating}
              label={orbitLabel}
            >
              <SwitchCamera className="h-3.5 w-3.5" strokeWidth={1.75} />
            </CtrlButton>
            <CtrlButton
              onClick={toggleProjection}
              active={projection === 'globe'}
              label={projection === 'globe' ? 'Switch to Mercator' : 'Switch to Globe'}
            >
              {projection === 'globe' ? (
                <Globe2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              ) : (
                <Square className="h-3.5 w-3.5" strokeWidth={1.75} />
              )}
            </CtrlButton>
            <CtrlButton
              onClick={toggleFullscreen}
              label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? (
                <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              )}
            </CtrlButton>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function CtrlButton({ children, onClick, label, active = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'h-7 w-7 inline-flex items-center justify-center transition-colors',
        active
          ? 'bg-[#16a085] text-white'
          : 'text-day-text dark:text-night-text hover:bg-day-bg dark:hover:bg-night-bg',
      )}
    >
      {children}
    </button>
  );
}
