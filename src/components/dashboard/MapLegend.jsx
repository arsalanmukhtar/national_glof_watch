import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useParameter } from '@/contexts/ParameterContext';
import {
  PARAMETER_LEGENDS,
  STALE_COLOR,
  STALE_LABEL,
  isStale,
  legendDisplayName,
} from '@/config/parameterLegends';
import { cn } from '@/utils/cn';

// Bottom-left overlay: a small Stations stats card stacked above the
// per-parameter legend. Both are hidden when no parameter is selected.
// Legend bins are clickable — clicking toggles the matching stations on
// the map (filter is owned by MapPanel via the disabledBinColors prop).
export default function MapLegend({ disabledBinColors, onToggleBin }) {
  const { selected, stations } = useParameter();

  const stats = useMemo(() => {
    let inactive = 0;
    for (const f of stations) {
      const v = f.properties?.value;
      const lu = f.properties?.lastUpdate;
      const bad =
        v == null || v === '' || !Number.isFinite(Number(v)) || isStale(lu);
      if (bad) inactive += 1;
    }
    return {
      total: stations.length,
      active: stations.length - inactive,
      inactive,
    };
  }, [stations]);

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
      <StatsCard stats={stats} />
      <LegendCard
        title={`${legendDisplayName(selected)} Legend`}
        bins={bins}
        disabledBinColors={disabledBinColors}
        onToggleBin={onToggleBin}
      />
    </motion.div>
  );
}

function StatsCard({ stats }) {
  return (
    <div
      className={cn(
        'rounded-md shadow-md overflow-hidden',
        'bg-white/95 dark:bg-night-surface/95 backdrop-blur-sm',
        'border border-day-border dark:border-night-border',
      )}
    >
      <div className="px-2.5 py-1 border-b border-day-border dark:border-night-border">
        <h4 className="text-[11px] font-semibold text-day-text dark:text-night-text">
          Stations
        </h4>
      </div>
      <div className="grid grid-cols-3 divide-x divide-day-border dark:divide-night-border">
        <StatCol label="Total"    value={stats.total} />
        <StatCol label="Active"   value={stats.active}   tone="active" />
        <StatCol label="Inactive" value={stats.inactive} tone="inactive" />
      </div>
    </div>
  );
}

function StatCol({ label, value, tone }) {
  return (
    <div className="px-2.5 py-1 text-center">
      <div
        className={cn(
          'text-[13px] font-semibold tabular-nums leading-tight',
          tone === 'active'
            ? 'text-emerald-600 dark:text-emerald-400'
            : tone === 'inactive'
              ? 'text-slate-500 dark:text-slate-400'
              : 'text-day-text dark:text-night-text',
        )}
      >
        {value}
      </div>
      <div className="text-[9.5px] uppercase tracking-wider text-day-muted dark:text-night-muted">
        {label}
      </div>
    </div>
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
        <h4 className="text-[11px] font-semibold text-day-text dark:text-night-text">
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
                  'w-full flex items-center gap-2 px-1.5 py-1 rounded text-[11px] transition-colors',
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
