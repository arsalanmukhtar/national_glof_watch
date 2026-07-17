import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { layoutById, useMonitoring } from '@/contexts/MonitoringContext';
import MonitoringMap from './MonitoringMap';
import { cn } from '@/utils/cn';

// The monitoring grid — takes the whole middle column when Monitoring
// is active. Renders one MonitoringMap per cell described by the
// selected layout, wired to the shared view state so every map moves
// as one. Fullscreen mounts the same DOM into a native browser
// fullscreen so the operator can drop into a monitoring wall on a big
// screen without any extra chrome.
export default function MonitoringGrid({ className }) {
  const { layoutId, fullscreen, setFullscreen } = useMonitoring();
  const layout = layoutById(layoutId);
  const wrapperRef = useRef(null);

  // Bind our fullscreen boolean to the actual browser fullscreen API so
  // pressing Esc / the browser's own fullscreen exit stays in sync with
  // the config panel's toggle. Both directions covered: state → API and
  // API → state.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return undefined;
    if (fullscreen && document.fullscreenElement !== el) {
      el.requestFullscreen?.().catch(() => {
        // Silently drop the flag if the browser refuses (older Safari
        // in an iframe, etc.). Better to keep the app usable than to
        // strand the config panel in a "fullscreen" state that never
        // took effect.
        setFullscreen(false);
      });
    } else if (!fullscreen && document.fullscreenElement === el) {
      document.exitFullscreen?.().catch(() => {});
    }
    const onFsChange = () => {
      const inside = document.fullscreenElement === el;
      if (!inside && fullscreen) setFullscreen(false);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
    };
  }, [fullscreen, setFullscreen]);

  return (
    <motion.div
      ref={wrapperRef}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      data-tour-id="monitoring-grid"
      className={cn(
        'card-base p-2 flex-1 min-h-0 min-w-0',
        fullscreen && 'bg-day-bg dark:bg-night-bg',
        className,
      )}
    >
      <div
        className="w-full h-full grid gap-2"
        style={layout.template}
      >
        {layout.areas.map((area) => (
          <div
            key={area}
            style={{ gridArea: area }}
            className="min-h-0 min-w-0"
          >
            <MonitoringMap cellKey={area} />
          </div>
        ))}
      </div>
    </motion.div>
  );
}
