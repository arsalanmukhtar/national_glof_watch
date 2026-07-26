import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Mountain, X } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import ElevationProfilePanel from '@/components/dashboard/ElevationProfilePanel';
import { cn } from '@/utils/cn';

// ElevationFullscreenOverlay — floating Elevation Profile tab that
// appears only in fullscreen mode. The Elevation Profile lives in
// ChartsRow normally, which sits outside the map wrapper and thus
// disappears when the map goes fullscreen. This overlay is mounted
// *inside* the wrapper so it travels along with the fullscreen
// switch, mirroring FlypathFullscreenOverlay for the config panel.
//
// Layout:
//   • Toggle chip at bottom-centre — matches BasemapSwitcher /
//     FlypathFullscreenOverlay chip size + styling for consistency.
//   • Expanded: a floating card above the chip with the full
//     ElevationProfilePanel inside (fixed height so the chart's
//     internal flex layout has bounds to work against).

export default function ElevationFullscreenOverlay() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const onChange = () => {
      const fs = !!document.fullscreenElement;
      setIsFullscreen(fs);
      if (!fs) setExpanded(false);
    };
    onChange();
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  if (!isFullscreen) return null;

  return (
    <div
      className={cn(
        'absolute bottom-2 left-1/2 -translate-x-1/2 z-10',
        'flex flex-col items-center gap-2 pointer-events-none',
      )}
    >
      {/* Expanded profile panel — sits above the toggle. Bounded
          height so the panel's internal Chart.js canvas has a
          concrete parent to fill. */}
      <AnimatePresence>
        {expanded ? (
          <motion.div
            key="elevation-overlay-panel"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className={cn(
              'w-[min(760px,92vw)] h-[240px] pointer-events-auto',
              'bg-white/95 dark:bg-night-surface/95 backdrop-blur',
              'border border-day-border dark:border-night-border rounded-md shadow-xl',
              'overflow-hidden flex flex-col',
            )}
          >
            <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-day-border dark:border-night-border shrink-0">
              <div className="flex items-center gap-1.5">
                <Mountain className="h-3.5 w-3.5 text-brand-700 dark:text-brand-200" />
                <span className="text-[13px] font-semibold text-day-text dark:text-night-text">
                  Elevation Profile
                </span>
              </div>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="btn-icon btn-ghost h-7 w-7"
                aria-label="Close elevation profile"
                title="Close"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <ElevationProfilePanel />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Toggle chip — same size + styling as the flypath overlay
          and BasemapSwitcher chips. */}
      <div
        className={cn(
          'inline-flex items-center justify-center p-0.5 rounded-md shadow-sm pointer-events-auto',
          'bg-white/95 dark:bg-night-surface/95 backdrop-blur-sm',
          'border border-day-border dark:border-night-border',
        )}
      >
        <Tooltip
          label={expanded ? 'Hide elevation profile' : 'Show elevation profile'}
          side="top"
          triggerClassName="inline-flex leading-none"
        >
          <motion.button
            type="button"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setExpanded((v) => !v)}
            aria-pressed={expanded}
            aria-label={expanded ? 'Hide elevation profile' : 'Show elevation profile'}
            className={cn(
              'inline-flex items-center justify-center h-6 w-6 rounded transition-colors',
              expanded
                ? 'bg-[#84cc16] text-[#1a2e05]'
                : 'text-day-text dark:text-night-text hover:bg-day-bg dark:hover:bg-night-bg',
            )}
          >
            <Mountain style={{ width: 12, height: 12 }} />
          </motion.button>
        </Tooltip>
      </div>
    </div>
  );
}