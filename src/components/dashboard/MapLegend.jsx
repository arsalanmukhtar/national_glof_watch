import { motion } from 'framer-motion';
import { useParameter } from '@/contexts/ParameterContext';
import { LEGEND_STATES } from '@/config/alertStates';
import { cn } from '@/utils/cn';

// Bottom-left overlay: the categorical alert-state legend, shown whenever
// a parameter is selected. Every station is classified against its own
// thresholds, so the legend has no numeric ranges — just the six states.
// Rows are clickable to hide/show that state on the map (filter owned by
// MapPanel via the disabledStates prop).
export default function MapLegend({ disabledStates, onToggleState }) {
  const { selected, earlyWarning, setEarlyWarning } = useParameter();

  if (!selected) return null;

  return (
    <motion.div
      key={selected}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="absolute left-2 bottom-2 z-10 flex flex-col gap-1"
    >
      <div
        className={cn(
          'min-w-[160px] rounded-md shadow-md overflow-hidden',
          'bg-white/95 dark:bg-night-surface/95 backdrop-blur-sm',
          'border border-day-border dark:border-night-border',
        )}
      >
        <div className="px-2.5 py-1.5 border-b border-day-border dark:border-night-border flex items-center gap-2 h-8">
          <h4 className="text-[12px] font-semibold leading-none text-day-text dark:text-night-text inline-flex items-center h-5">
            Alert State
          </h4>
          {earlyWarning ? (
            <span
              className={cn(
                'ml-auto inline-flex items-center justify-center',
                'h-5 px-1.5 rounded',
                'text-[9.5px] font-semibold uppercase tracking-wide leading-none',
                'text-[#dc2626] dark:text-[#f87171]',
                'border border-[#fca5a5]/70 dark:border-[#f87171]/40',
                'shadow-[0_0_6px_rgba(239,68,68,0.18)] dark:shadow-[0_0_6px_rgba(248,113,113,0.22)]',
              )}
              title="NDMA Early-Warning classification active"
            >
              EW
            </span>
          ) : null}
        </div>

        {/* PMD ↔ NDMA classification toggle. Sliding pill built with
            Framer motion.layoutId so the active fill animates between
            the two options. Flipping this reloads /latest with (or
            without) ?earlyFactor= so map, table, and threshold card
            all switch together. */}
        <div className="px-2 py-1.5 border-b border-day-border dark:border-night-border">
          <div className="relative flex rounded-md bg-day-bg dark:bg-night-bg p-0.5">
            {[
              { id: 'pmd',  label: 'PMD',  title: 'Show PMD official classification' },
              { id: 'ndma', label: 'NDMA', title: 'Show NDMA early-warning classification (10% ahead of PMD)' },
            ].map((opt) => {
              const active =
                (opt.id === 'ndma' && earlyWarning) ||
                (opt.id === 'pmd' && !earlyWarning);
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setEarlyWarning(opt.id === 'ndma')}
                  aria-pressed={active}
                  title={opt.title}
                  className={cn(
                    'relative flex-1 h-6 inline-flex items-center justify-center text-[10.5px] font-semibold tracking-wide rounded-[5px] transition-colors',
                    active
                      ? 'text-[#1a2e05]'
                      : 'text-day-muted dark:text-night-muted hover:text-day-text dark:hover:text-night-text',
                  )}
                >
                  {active ? (
                    <motion.span
                      layoutId="legend-mode-pill"
                      className="absolute inset-0 rounded-[5px] bg-[#84cc16]"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    />
                  ) : null}
                  <span className="relative z-[1]">{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>
        <ul className="px-1 py-1 flex flex-col">
          {LEGEND_STATES.map((s) => {
            const off = disabledStates?.has?.(s.id);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onToggleState?.(s.id)}
                  aria-pressed={!off}
                  title={off ? `Show ${s.label}` : `Hide ${s.label}`}
                  className={cn(
                    'w-full flex items-center gap-2 px-1.5 py-1 rounded text-[12px] transition-colors',
                    'text-day-text dark:text-night-text',
                    'hover:bg-day-bg dark:hover:bg-night-bg',
                    off && 'opacity-40',
                  )}
                >
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 rounded-full shrink-0 border border-slate-900/40 dark:border-white/30"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className={cn('leading-none', off && 'line-through')}>
                    {s.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {/* Warning Post indicator — non-clickable row that documents the
            concentric-ring styling applied to WP_* stations on the map.
            Rendered below an <hr> so the reader sees it as a separate
            symbology note rather than a seventh alert state. */}
        <hr className="border-t border-day-border dark:border-night-border mx-2 my-0.5" />
        <div className="px-1 py-1">
          <div
            className="w-full flex items-center gap-2 px-1.5 py-1 text-[12px] text-day-text dark:text-night-text"
            title="Water-Point stations render with three concentric rings on the map."
          >
            <WarningPostGlyph />
            <span className="leading-none">Warning Post</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// Miniature version of the map's WP marker — three concentric black
// rings around a small dot. Rendered as an SVG so it stays crisp at any
// zoom / DPI. Kept purely visual (no clicks, no colour toggle) since it
// documents symbology rather than a filterable state.
function WarningPostGlyph() {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 14 14"
      className="shrink-0"
    >
      <circle cx="7" cy="7" r="6"   fill="none" stroke="currentColor" strokeWidth="0.75" opacity="0.85" />
      <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="0.75" opacity="0.85" />
      <circle cx="7" cy="7" r="3"   fill="none" stroke="currentColor" strokeWidth="0.75" opacity="0.85" />
      <circle cx="7" cy="7" r="1.4" fill="currentColor" />
    </svg>
  );
}
