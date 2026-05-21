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
  const { selected } = useParameter();

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
        <div className="px-2.5 py-1.5 border-b border-day-border dark:border-night-border">
          <h4 className="text-[12px] font-semibold text-day-text dark:text-night-text">
            Alert State
          </h4>
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
      </div>
    </motion.div>
  );
}
