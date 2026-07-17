import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Sparkles } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import { useTour } from '@/contexts/TourContext';
import { cn } from '@/utils/cn';

// Titlebar button that opens a small picker of available tours. Sits
// beside the Documentation link. Clicking it either:
//   • opens the picker (default) — pick a tour to start
//   • immediately resumes / restarts the currently-active tour if one
//     is already open (mostly a keyboard-driven fallback)
export default function TourLauncher() {
  const {
    activeTour,
    start,
    stop,
    tours,
    hasSeen,
    firstVisitPrompt,
    acceptFirstVisit,
    skipFirstVisit,
  } = useTour();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // Close the picker on outside click.
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Close the picker when a tour starts.
  useEffect(() => {
    if (activeTour) setOpen(false);
  }, [activeTour]);

  const handleClick = () => {
    if (activeTour) {
      // A tour is already running — the click acts as a dismiss so
      // the button doubles as an escape hatch.
      stop('skipped');
      return;
    }
    setOpen((v) => !v);
  };

  return (
    <div ref={wrapRef} className="relative">
      {/* Hidden SVG defs — the linearGradient below is referenced by
          the icon's `stroke` via CSS (`stroke: url(#tour-icon-gradient)`).
          Each stop carries its own SMIL <animate>, staggered so the
          two ends of the gradient cycle through the palette out of
          phase. Result: the Sparkles icon strokes shift through
          lime → cyan → violet → pink → amber → lime continuously,
          with no wrapping background. Rendered once per launcher
          instance; hidden via `w-0 h-0` because SVG needs to be in
          the DOM (not just declared) for external references to
          resolve. */}
      <svg
        aria-hidden
        width="0"
        height="0"
        className="absolute overflow-hidden"
        style={{ position: 'absolute', width: 0, height: 0 }}
      >
        <defs>
          {/* gradientUnits="userSpaceOnUse" with coords in lucide's
              own 0-24 viewport space. Without this the gradient
              defaults to objectBoundingBox, which collapses to zero
              on the four short line paths (M20 3v4, M22 5h-4, M4
              17v2, M5 18H3) and they render invisibly — leaving only
              the main star. userSpaceOnUse makes every path sample
              the same shared gradient regardless of its own bbox
              width/height, so the small sparkles come back. */}
          <linearGradient
            id="tour-icon-gradient"
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1="0"
            x2="24"
            y2="24"
          >
            <stop offset="0" stopColor="#84cc16">
              <animate
                attributeName="stop-color"
                values="#84cc16;#22d3ee;#c084fc;#f472b6;#fbbf24;#84cc16"
                dur="6s"
                repeatCount="indefinite"
              />
            </stop>
            <stop offset="1" stopColor="#f472b6">
              <animate
                attributeName="stop-color"
                values="#f472b6;#fbbf24;#84cc16;#22d3ee;#c084fc;#f472b6"
                dur="6s"
                repeatCount="indefinite"
              />
            </stop>
          </linearGradient>
        </defs>
      </svg>

      <Tooltip
        label={activeTour ? 'Close tour' : 'Take a tour'}
        side="bottom"
        align="end"
      >
        <motion.button
          type="button"
          data-tour-id="tour-launcher"
          onClick={handleClick}
          whileHover={{ scale: 1.08, rotate: 8 }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 380, damping: 18 }}
          aria-label={activeTour ? 'Close tour' : 'Take a tour'}
          aria-expanded={open}
          className="btn-icon hover:bg-white/10 relative"
        >
          <Sparkles
            className={cn(
              'h-5 w-5 relative',
              activeTour ? 'tour-launcher-icon-active' : 'tour-launcher-icon-idle',
            )}
          />
        </motion.button>
      </Tooltip>

      {/* First-visit popover — appears once, under the button, on the
          very first load. "Yes" kicks off a chain that walks the user
          through every tour in order; "Skip" dismisses permanently
          and hands full control back to the launcher menu. */}
      <AnimatePresence>
        {firstVisitPrompt && !activeTour ? (
          <motion.div
            key="tour-first-visit"
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            role="dialog"
            aria-label="Start the guided tour"
            className={cn(
              'absolute right-0 top-full mt-2 z-[9996] w-[260px] rounded-lg shadow-xl',
              'bg-white dark:bg-night-surface',
              'border border-day-border dark:border-night-border',
              'overflow-hidden',
            )}
          >
            <div className="px-3 py-2 border-b border-day-border dark:border-night-border bg-emerald-950">
              <div className="flex items-center gap-2 text-white">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">
                  Welcome
                </span>
              </div>
            </div>
            <div className="p-3">
              <p className="text-[12.5px] font-semibold text-day-text dark:text-night-text">
                Start the Guided Tour?
              </p>
              <p className="text-[11px] text-day-muted dark:text-night-muted mt-1 leading-snug">
                We&rsquo;ll walk you through every panel of the dashboard, one tour after another.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={acceptFirstVisit}
                  className={cn(
                    'flex-1 rounded-md px-3 py-1.5 text-[12px] font-semibold',
                    'bg-[#84cc16] text-[#1a2e05] hover:bg-[#65a30d]',
                    'transition-colors',
                  )}
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={skipFirstVisit}
                  className={cn(
                    'flex-1 rounded-md px-3 py-1.5 text-[12px] font-semibold',
                    'bg-day-bg dark:bg-night-bg',
                    'text-day-text dark:text-night-text',
                    'hover:bg-day-border dark:hover:bg-night-border',
                    'border border-day-border dark:border-night-border',
                    'transition-colors',
                  )}
                >
                  Skip
                </button>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {open ? (
          <motion.div
            key="tour-picker"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            role="menu"
            aria-label="Available tours"
            className={cn(
              'absolute right-0 top-full mt-2 z-[9995] w-[300px] rounded-lg shadow-xl',
              'bg-white dark:bg-night-surface',
              'border border-day-border dark:border-night-border',
              'overflow-hidden',
            )}
          >
            <div className="px-3 py-2 border-b border-day-border dark:border-night-border bg-emerald-950">
              <div className="flex items-center gap-2 text-white">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">
                  Guided tours
                </span>
              </div>
              <p className="text-[10.5px] text-white/70 mt-0.5">
                Overlays walk you through the app one panel at a time.
              </p>
            </div>
            <ul className="p-1.5">
              {tours.map((t) => {
                const seen = hasSeen(t.id);
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => start(t.id)}
                      className={cn(
                        'w-full text-left rounded-md px-2.5 py-2',
                        'hover:bg-day-bg dark:hover:bg-night-bg',
                        'transition-colors',
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12.5px] font-semibold text-day-text dark:text-night-text">
                          {t.name}
                        </span>
                        {seen ? (
                          <span
                            className="inline-flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#84cc16]"
                            title="You've completed this tour"
                          >
                            <Check className="h-2.5 w-2.5" />
                            Seen
                          </span>
                        ) : null}
                        <span className="ml-auto text-[10px] text-day-muted dark:text-night-muted">
                          {t.steps.length} steps
                        </span>
                      </div>
                      <p className="text-[11px] text-day-muted dark:text-night-muted mt-0.5 leading-snug">
                        {t.description}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
