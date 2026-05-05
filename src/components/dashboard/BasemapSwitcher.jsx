import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Contrast,
  Layers,
  Map,
  Moon,
  Mountain,
  Satellite,
  Sun,
} from 'lucide-react';
import { cn } from '@/utils/cn';

const OPTIONS = [
  { id: 'satellite', label: 'Satellite', icon: Satellite },
  { id: 'streets',   label: 'Streets',   icon: Map },
  { id: 'outdoors',  label: 'Outdoors',  icon: Mountain },
  { id: 'light',     label: 'Light',     icon: Sun },
  { id: 'dark',      label: 'Dark',      icon: Moon },
];

// Collapsible basemap chooser. Layout when expanded:
//   [ Layers ] [ Satellite | Streets | Outdoors | Light | Dark ]
//   [ Contrast ] [ ─────────── opacity slider ─────────── 100% ]
// The left column stacks the two button-sized icons; the right column
// stacks the chips row and the slider row, animating open/closed.
export default function BasemapSwitcher({
  current,
  onChange,
  opacity,
  onOpacityChange,
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.15 }}
      className={cn(
        'absolute top-2 left-2 z-10 flex items-start gap-0.5 p-0.5 rounded-md shadow-sm',
        'bg-white/95 dark:bg-night-surface/95 backdrop-blur-sm',
        'border border-day-border dark:border-night-border',
      )}
    >
      {/* Left column: Layers toggle + (when expanded) Contrast marker */}
      <div className="flex flex-col gap-0.5 shrink-0">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          aria-label="Basemap"
          title="Basemap"
          className={cn(
            'inline-flex items-center justify-center h-6 w-6 rounded transition-colors',
            expanded
              ? 'bg-[#16a085] text-white'
              : 'text-day-text dark:text-night-text hover:bg-day-bg dark:hover:bg-night-bg',
          )}
        >
          <Layers className="h-3 w-3" strokeWidth={2} />
        </button>

        <AnimatePresence initial={false}>
          {expanded && (
            <motion.button
              key="opacity-icon"
              type="button"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.18 }}
              onClick={() => onOpacityChange?.(1)}
              aria-label="Reset basemap opacity"
              title="Reset basemap opacity"
              className={cn(
                'inline-flex items-center justify-center h-6 w-6 rounded transition-colors',
                'text-day-text dark:text-night-text hover:bg-day-bg dark:hover:bg-night-bg',
              )}
            >
              <Contrast className="h-3 w-3" strokeWidth={2} />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Right column: chips row + slider row. Both animate open together. */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="basemap-body"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 'auto', opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="flex flex-col gap-0.5 overflow-hidden"
          >
            <div
              role="radiogroup"
              aria-label="Basemap"
              className="flex items-center gap-0.5"
            >
              {OPTIONS.map(({ id, label, icon: Icon }) => {
                const on = current === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    title={label}
                    onClick={() => onChange(id)}
                    className={cn(
                      'inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-medium transition-colors whitespace-nowrap',
                      on
                        ? 'bg-[#16a085] text-white'
                        : 'text-day-text dark:text-night-text hover:bg-day-bg dark:hover:bg-night-bg',
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2 h-6 px-1.5 text-day-muted dark:text-night-muted">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={opacity ?? 1}
                onChange={(e) => onOpacityChange?.(Number(e.target.value))}
                aria-label="Basemap opacity"
                title={`Basemap opacity: ${Math.round((opacity ?? 1) * 100)}%`}
                className="range-base flex-1"
              />
              <span className="text-[10px] font-medium tabular-nums w-7 text-right shrink-0">
                {Math.round((opacity ?? 1) * 100)}%
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
