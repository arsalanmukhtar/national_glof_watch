import { motion } from 'framer-motion';
import { useParameter } from '@/contexts/ParameterContext';
import {
  PARAMETER_LEGENDS,
  STALE_COLOR,
  STALE_LABEL,
  legendDisplayName,
} from '@/config/parameterLegends';
import { cn } from '@/utils/cn';

// Bottom-left overlay: per-parameter legend, hidden when no parameter
// is selected. Legend bins are clickable — clicking toggles the matching
// stations on the map (filter is owned by MapPanel via the
// disabledBinColors prop).
export default function MapLegend({ disabledBinColors, onToggleBin }) {
  const { selected } = useParameter();

  if (!selected) return null;
  const legend = PARAMETER_LEGENDS[selected];
  if (!legend) return null;

  const bins = [...legend.bins, { color: STALE_COLOR, label: STALE_LABEL }];

  return (
    <motion.div
      key={selected}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="absolute left-2 bottom-2 z-10 flex flex-col gap-1"
    >
      <LegendCard
        title={`${legendDisplayName(selected)} Legend`}
        bins={bins}
        disabledBinColors={disabledBinColors}
        onToggleBin={onToggleBin}
      />
    </motion.div>
  );
}

function LegendCard({ title, bins, disabledBinColors, onToggleBin }) {
  return (
    <div
      className={cn(
        'rounded-md shadow-md overflow-hidden',
        'bg-white/95 dark:bg-night-surface/95 backdrop-blur-sm',
        'border border-day-border dark:border-night-border',
      )}
    >
      <div className="px-2.5 py-1.5 border-b border-day-border dark:border-night-border">
        <h4 className="text-[12px] font-semibold text-day-text dark:text-night-text">
          {title}
        </h4>
      </div>
      <ul className="px-1 py-1 flex flex-col">
        {bins.map((b) => {
          const off = disabledBinColors?.has?.(b.color);
          return (
            <li key={b.label}>
              <button
                type="button"
                onClick={() => onToggleBin?.(b.color)}
                aria-pressed={!off}
                title={off ? `Show ${b.label}` : `Hide ${b.label}`}
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
                  style={{ backgroundColor: b.color }}
                />
                <span
                  className={cn('leading-none', off && 'line-through')}
                >
                  {b.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
