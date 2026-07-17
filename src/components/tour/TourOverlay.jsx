import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useTour } from '@/contexts/TourContext';
import { cn } from '@/utils/cn';

// Full-viewport tour overlay. Renders three layers:
//   1. A dimmed SVG backdrop with a rounded-rect "hole" cut out at
//      the current step's target rect (or nothing cut out for
//      centred steps).
//   2. A brand-accent border painted around that same rect so the
//      spotlight reads as a highlight, not just a hole.
//   3. A floating tooltip near the target with the step's title +
//      body + Prev / Next / Skip controls + a progress dotstrip.
//
// Positioning re-runs on scroll and resize so the spotlight tracks
// the target if the underlying UI shifts.

const TOOLTIP_W = 340;
const TOOLTIP_GAP = 14;     // gap between spotlight edge and tooltip
const EDGE_MARGIN = 12;     // keep-inside-viewport margin
const SPOT_PAD_DEFAULT = 8;
const SPOT_RADIUS = 8;

export default function TourOverlay() {
  const { activeTour, currentStep, stepIndex, totalSteps, next, prev, stop } = useTour();

  // Rect of the current step's target element, in viewport (client)
  // coords. `null` means we're on a centred step OR the target isn't
  // in the DOM yet (which we treat as centred so the tour doesn't
  // stall).
  const [rect, setRect] = useState(null);
  const rafRef = useRef(null);

  // Recomputes the target rect. Uses rAF so a burst of scroll +
  // resize events collapses to one measurement per frame.
  const measure = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (!currentStep) return;
      if (!currentStep.target) {
        setRect(null);
        return;
      }
      const el = document.querySelector(currentStep.target);
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setRect({
        x: r.left,
        y: r.top,
        w: r.width,
        h: r.height,
      });
    });
  }, [currentStep]);

  // Run measure on step change + any layout event. Also runs a couple
  // of delayed passes because some targets (panels that open on step
  // enter) don't have their final rect until the panel animation
  // finishes.
  useLayoutEffect(() => {
    if (!currentStep) return undefined;
    // Optional pre-step side effect (open a panel, etc.).
    if (typeof currentStep.onEnter === 'function') {
      try { currentStep.onEnter(); } catch { /* ignore */ }
    }
    // Give the DOM one paint to react to onEnter, then measure.
    measure();
    const t1 = setTimeout(measure, 60);
    const t2 = setTimeout(measure, 260);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [currentStep, measure]);

  useEffect(() => {
    if (!activeTour) return undefined;
    const on = () => measure();
    window.addEventListener('scroll', on, true);
    window.addEventListener('resize', on);
    return () => {
      window.removeEventListener('scroll', on, true);
      window.removeEventListener('resize', on);
    };
  }, [activeTour, measure]);

  // Scroll the target into view once per step. `scrollIntoView` uses
  // 'nearest' so a partly-visible target doesn't reposition itself
  // unnecessarily.
  useEffect(() => {
    if (!currentStep?.target) return;
    const el = document.querySelector(currentStep.target);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [currentStep]);

  // Padded spotlight rect (rect + step-supplied padding, defaulting
  // to SPOT_PAD_DEFAULT). Undefined when centred.
  const spot = useMemo(() => {
    if (!rect) return null;
    const p = currentStep?.padding ?? SPOT_PAD_DEFAULT;
    return {
      x: rect.x - p,
      y: rect.y - p,
      w: rect.w + p * 2,
      h: rect.h + p * 2,
    };
  }, [rect, currentStep]);

  // Tooltip anchor position, in viewport coords. Chooses a side
  // based on the step's preferred side, then flips if there's no
  // room. Centred steps skip the maths entirely.
  const tooltipPos = useMemo(() => {
    if (typeof window === 'undefined') return { x: 0, y: 0, side: 'center' };
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (!spot || currentStep?.side === 'center') {
      // Centred modal-style step.
      return {
        x: (vw - TOOLTIP_W) / 2,
        y: Math.max(EDGE_MARGIN, vh / 2 - 120),
        side: 'center',
      };
    }

    const requested = currentStep?.side ?? 'bottom';
    const tryOrder = ({
      top:    ['top', 'bottom', 'right', 'left'],
      bottom: ['bottom', 'top', 'right', 'left'],
      left:   ['left', 'right', 'top', 'bottom'],
      right:  ['right', 'left', 'top', 'bottom'],
    })[requested] ?? ['bottom', 'top', 'right', 'left'];

    // Estimated tooltip height for room-check; the actual height is
    // measured later for fine-tuning, but this initial estimate is
    // enough for side-selection.
    const estH = 180;

    for (const side of tryOrder) {
      let x, y;
      if (side === 'bottom') {
        x = spot.x + spot.w / 2 - TOOLTIP_W / 2;
        y = spot.y + spot.h + TOOLTIP_GAP;
        if (y + estH <= vh - EDGE_MARGIN) return { x: clampX(x, vw), y, side };
      } else if (side === 'top') {
        x = spot.x + spot.w / 2 - TOOLTIP_W / 2;
        y = spot.y - TOOLTIP_GAP - estH;
        if (y >= EDGE_MARGIN) return { x: clampX(x, vw), y, side };
      } else if (side === 'right') {
        x = spot.x + spot.w + TOOLTIP_GAP;
        y = spot.y + spot.h / 2 - estH / 2;
        if (x + TOOLTIP_W <= vw - EDGE_MARGIN) return { x, y: clampY(y, vh, estH), side };
      } else if (side === 'left') {
        x = spot.x - TOOLTIP_GAP - TOOLTIP_W;
        y = spot.y + spot.h / 2 - estH / 2;
        if (x >= EDGE_MARGIN) return { x, y: clampY(y, vh, estH), side };
      }
    }

    // Fallback: dead-centre if literally no side fits.
    return {
      x: (vw - TOOLTIP_W) / 2,
      y: (vh - estH) / 2,
      side: 'center',
    };
  }, [spot, currentStep]);

  if (!activeTour || !currentStep) return null;

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;

  const content = (
    <AnimatePresence>
      <motion.div
        key="tour-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-[9990] pointer-events-none"
        aria-live="polite"
      >
        {/* Backdrop + spotlight cutout. SVG mask keeps the transparent
            hole crisp at any DPR + resizes cleanly. `pointer-events`
            re-enabled so clicks on the dim area stop propagating to
            the app underneath (prevents accidental interactions
            during the tour), but the spotlight hole passes through. */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-auto"
          width={vw}
          height={vh}
          onClick={(e) => e.stopPropagation()}
          aria-hidden
        >
          <defs>
            <mask id="tour-mask">
              <rect x="0" y="0" width={vw} height={vh} fill="white" />
              {spot ? (
                <rect
                  x={spot.x}
                  y={spot.y}
                  width={spot.w}
                  height={spot.h}
                  rx={SPOT_RADIUS}
                  ry={SPOT_RADIUS}
                  fill="black"
                />
              ) : null}
            </mask>
          </defs>
          <rect
            x="0"
            y="0"
            width={vw}
            height={vh}
            fill="rgba(2, 6, 23, 0.68)"
            mask="url(#tour-mask)"
          />
          {spot ? (
            <rect
              x={spot.x - 1}
              y={spot.y - 1}
              width={spot.w + 2}
              height={spot.h + 2}
              rx={SPOT_RADIUS + 1}
              ry={SPOT_RADIUS + 1}
              fill="none"
              stroke="#84cc16"
              strokeWidth="2"
              opacity="0.95"
              style={{ filter: 'drop-shadow(0 0 12px rgba(132,204,22,0.55))' }}
            />
          ) : null}
        </svg>

        {/* Tooltip card */}
        <motion.div
          key={`step-${activeTour.id}-${stepIndex}`}
          initial={{ opacity: 0, scale: 0.98, y: 6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          role="dialog"
          aria-labelledby="tour-step-title"
          className={cn(
            'absolute pointer-events-auto rounded-lg shadow-2xl',
            'bg-white dark:bg-night-surface',
            'border border-day-border dark:border-night-border',
          )}
          style={{
            width: TOOLTIP_W,
            left: tooltipPos.x,
            top: tooltipPos.y,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-day-border dark:border-night-border">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#84cc16]">
              {activeTour.name}
            </span>
            <span className="text-[10px] text-day-muted dark:text-night-muted tabular-nums">
              · {stepIndex + 1} / {totalSteps}
            </span>
            <button
              type="button"
              onClick={() => stop('skipped')}
              aria-label="Close tour"
              className="ml-auto inline-flex items-center justify-center h-6 w-6 rounded-md text-day-muted dark:text-night-muted hover:bg-day-bg dark:hover:bg-night-bg"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Body */}
          <div className="px-4 py-3">
            <h3
              id="tour-step-title"
              className="text-[14px] font-semibold text-day-text dark:text-night-text mb-1.5"
            >
              {currentStep.title}
            </h3>
            <p className="text-[12.5px] leading-relaxed text-day-text dark:text-night-text">
              {currentStep.body}
            </p>
          </div>

          {/* Progress dot strip */}
          <div className="flex items-center gap-1 px-4 pb-2">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  'h-1 rounded-full transition-all',
                  i === stepIndex
                    ? 'w-5 bg-[#84cc16]'
                    : i < stepIndex
                      ? 'w-1.5 bg-[#84cc16]/60'
                      : 'w-1.5 bg-day-border dark:bg-night-border',
                )}
              />
            ))}
          </div>

          {/* Footer buttons */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-t border-day-border dark:border-night-border">
            <button
              type="button"
              onClick={() => stop('skipped')}
              className="text-[11.5px] font-medium text-day-muted dark:text-night-muted hover:text-day-text dark:hover:text-night-text"
            >
              Skip tour
            </button>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={prev}
                disabled={stepIndex === 0}
                aria-label="Previous step"
                className={cn(
                  'inline-flex items-center justify-center h-7 w-7 rounded-md border',
                  'border-day-border dark:border-night-border',
                  stepIndex === 0
                    ? 'opacity-40 cursor-not-allowed'
                    : 'hover:bg-day-bg dark:hover:bg-night-bg text-day-text dark:text-night-text',
                )}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={next}
                className={cn(
                  'inline-flex items-center gap-1 px-3 h-7 rounded-md text-[11.5px] font-semibold',
                  'bg-[#84cc16] text-[#1a2e05] hover:bg-[#65a30d]',
                )}
              >
                {stepIndex === totalSteps - 1 ? 'Done' : 'Next'}
                {stepIndex === totalSteps - 1 ? null : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}

function clampX(x, vw) {
  return Math.max(EDGE_MARGIN, Math.min(x, vw - TOOLTIP_W - EDGE_MARGIN));
}
function clampY(y, vh, estH) {
  return Math.max(EDGE_MARGIN, Math.min(y, vh - estH - EDGE_MARGIN));
}
