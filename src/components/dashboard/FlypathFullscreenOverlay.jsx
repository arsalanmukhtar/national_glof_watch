import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { TbHelicopter } from 'react-icons/tb';
import { X } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import FlypathPanel from '@/components/dashboard/FlypathPanel';
import { cn } from '@/utils/cn';

// FlypathFullscreenOverlay — a floating, collapsible "mini sidebar"
// that appears only when the map is in fullscreen mode. The regular
// sidebars live outside the map wrapper (which is what the browser
// makes fullscreen), so they vanish when the user hits the fullscreen
// button. This overlay is mounted *inside* the wrapper, travels with
// the fullscreen switch, and gives the operator continued access to
// the Lake Flypath panel.
//
// Layout tuned to sit under the BasemapSwitcher on the left edge:
//   • bar column: same 24 px button + 2 px pad + rounded box as the
//     basemap toggler, positioned at top:36 (below basemap toggle)
//     and stretched to the bottom of the viewport (`bottom-2`) so
//     the bar reads as a proper vertical rail rather than a lonely
//     button.
//   • expanded panel: 320 px wide, capped at viewport minus a
//     gutter, scrolls internally.

export default function FlypathFullscreenOverlay() {
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
        // Sits directly under the BasemapSwitcher (which is at
        // top-2 left-2, ~30 px tall). top-12 leaves a comfortable
        // ~16 px breathing gap so the two chips don't touch.
        'absolute top-12 left-2 z-10',
        'flex items-start gap-2 pointer-events-none',
      )}
    >
      {/* Compact rail — hugs the icon only (no full-height flex),
          matching the BasemapSwitcher's chip size. */}
      <div
        className={cn(
          'flex flex-col items-center gap-0.5 p-0.5 rounded-md shadow-sm pointer-events-auto',
          'bg-white/95 dark:bg-night-surface/95 backdrop-blur-sm',
          'border border-day-border dark:border-night-border',
        )}
      >
        <Tooltip label={expanded ? 'Collapse' : 'Lake Flypath'} side="right">
          <motion.button
            type="button"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setExpanded((v) => !v)}
            aria-pressed={expanded}
            aria-label={expanded ? 'Collapse flypath panel' : 'Open flypath panel'}
            className={cn(
              'inline-flex items-center justify-center h-6 w-6 rounded transition-colors',
              expanded
                ? 'bg-[#84cc16] text-[#1a2e05]'
                : 'text-day-text dark:text-night-text hover:bg-day-bg dark:hover:bg-night-bg',
            )}
          >
            <TbHelicopter style={{ width: 12, height: 12 }} />
          </motion.button>
        </Tooltip>
      </div>

      {/* Slide-out panel. Vertically top-aligned with the rail so
          the header sits right at the top of the flypath icon;
          scrolls internally if content is taller than the viewport. */}
      <AnimatePresence>
        {expanded ? (
          <motion.div
            key="flypath-overlay-panel"
            initial={{ opacity: 0, x: -8, scale: 0.98 }}
            animate={{ opacity: 1, x: 0,  scale: 1 }}
            exit={{ opacity: 0, x: -8, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className={cn(
              'w-[320px] max-h-full overflow-y-auto pointer-events-auto',
              'bg-white/95 dark:bg-night-surface/95 backdrop-blur',
              'border border-day-border dark:border-night-border rounded-md shadow-xl',
            )}
          >
            <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-day-border dark:border-night-border">
              <div className="flex items-center gap-1.5">
                <TbHelicopter className="h-3.5 w-3.5 text-brand-700 dark:text-brand-200" />
                <span className="text-[13px] font-semibold text-day-text dark:text-night-text">
                  Lake Flypath
                </span>
              </div>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="btn-icon btn-ghost h-7 w-7"
                aria-label="Close panel"
                title="Close"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="p-2.5">
              <FlypathPanel />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
