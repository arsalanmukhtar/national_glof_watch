import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Globe2,
  LocateFixed,
  Maximize2,
  Minimize2,
  Minus,
  Navigation2,
  Plus,
  Square,
} from 'lucide-react';
import { cn } from '@/utils/cn';

// Custom vertical control stack — replaces the default Mapbox
// NavigationControl / GeolocateControl / FullscreenControl trio with
// one cohesive minimal design and adds a Mercator/Globe projection toggle.
export default function MapControls({ map, fullscreenTarget }) {
  const [bearing, setBearing] = useState(0);
  const [projection, setProjection] = useState('mercator');
  const [isFullscreen, setIsFullscreen] = useState(false);

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

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1 }}
      className={cn(
        'absolute top-2 right-2 z-10 flex flex-col rounded-md overflow-hidden shadow-sm',
        'bg-white/95 dark:bg-night-surface/95 backdrop-blur-sm',
        'border border-day-border dark:border-night-border',
        'divide-y divide-day-border dark:divide-night-border',
      )}
    >
      <CtrlButton onClick={zoomIn} label="Zoom in">
        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
      </CtrlButton>
      <CtrlButton onClick={zoomOut} label="Zoom out">
        <Minus className="h-3.5 w-3.5" strokeWidth={2} />
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
          ? 'bg-brand-700 text-white dark:bg-[#16a085]'
          : 'text-day-text dark:text-night-text hover:bg-day-bg dark:hover:bg-night-bg',
      )}
    >
      {children}
    </button>
  );
}
