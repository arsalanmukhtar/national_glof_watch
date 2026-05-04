import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  CloudRain,
  Gauge,
  RefreshCw,
  Thermometer,
  Waves,
} from 'lucide-react';
import { useParameter } from '@/contexts/ParameterContext';
import { timeAgo } from '@/utils/timeAgo';
import { cn } from '@/utils/cn';

// IDs match the PMD `element=` query param exactly (including the
// "Istantaneous" misspelling that the upstream endpoint preserves).
const PARAMETERS = [
  {
    id: 'Air Temperature',
    label: 'Air Temperature',
    icon: Thermometer,
    on:  'bg-orange-500 text-white border-orange-500 shadow-sm',
    off: 'bg-orange-500/10 text-orange-700 border-orange-500/40 hover:bg-orange-500/15 dark:text-orange-300 dark:bg-orange-500/15 dark:border-orange-500/50 dark:hover:bg-orange-500/25',
  },
  {
    id: 'Total Rain',
    label: 'Total Rain',
    icon: CloudRain,
    on:  'bg-blue-500 text-white border-blue-500 shadow-sm',
    off: 'bg-blue-500/10 text-blue-700 border-blue-500/40 hover:bg-blue-500/15 dark:text-blue-300 dark:bg-blue-500/15 dark:border-blue-500/50 dark:hover:bg-blue-500/25',
  },
  {
    id: 'Water Level',
    label: 'Water Level',
    icon: Waves,
    on:  'bg-cyan-500 text-white border-cyan-500 shadow-sm',
    off: 'bg-cyan-500/10 text-cyan-700 border-cyan-500/40 hover:bg-cyan-500/15 dark:text-cyan-300 dark:bg-cyan-500/15 dark:border-cyan-500/50 dark:hover:bg-cyan-500/25',
  },
  {
    id: 'Compact GAS State (WPs)',
    label: 'GAS State',
    icon: Gauge,
    on:  'bg-violet-500 text-white border-violet-500 shadow-sm',
    off: 'bg-violet-500/10 text-violet-700 border-violet-500/40 hover:bg-violet-500/15 dark:text-violet-300 dark:bg-violet-500/15 dark:border-violet-500/50 dark:hover:bg-violet-500/25',
  },
  {
    id: 'Istantaneous Flow',
    label: 'Instantaneous Flow',
    icon: Activity,
    on:  'bg-emerald-500 text-white border-emerald-500 shadow-sm',
    off: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/40 hover:bg-emerald-500/15 dark:text-emerald-300 dark:bg-emerald-500/15 dark:border-emerald-500/50 dark:hover:bg-emerald-500/25',
  },
];

function useTick(intervalMs = 30_000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
}

export default function ParametersPanel() {
  const { selected, select, statuses, refresh, refreshAll, busy } = useParameter();
  useTick(); // re-render every 30s so the time-ago label stays fresh

  const targetElement = selected;
  const targetStatus = targetElement ? statuses[targetElement] : null;

  // When nothing is selected, surface the freshest fetched_at across all elements.
  const overallLastFetched = (() => {
    let latest = null;
    for (const v of Object.values(statuses)) {
      if (!v?.lastFetchedAt) continue;
      if (!latest || new Date(v.lastFetchedAt) > new Date(latest)) {
        latest = v.lastFetchedAt;
      }
    }
    return latest;
  })();

  const displayLastFetched = targetElement
    ? targetStatus?.lastFetchedAt
    : overallLastFetched;

  const handleRefresh = () => {
    if (busy) return;
    if (targetElement) refresh(targetElement);
    else refreshAll();
  };

  const isBusy =
    (targetElement && busy === targetElement) || (!targetElement && busy === 'ALL');

  return (
    <div className="flex flex-col gap-1.5">
      {PARAMETERS.map(({ id, label, icon: Icon, on, off }) => {
        const active = selected === id;
        return (
          <motion.button
            key={id}
            type="button"
            whileTap={{ scale: 0.98 }}
            onClick={() => select(id)}
            aria-pressed={active}
            className={cn(
              'group flex items-center gap-3 px-3 py-2.5 rounded-md border text-left text-sm font-medium transition-colors',
              active ? on : off,
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{label}</span>
            {active && (
              <span
                aria-hidden
                className="ml-auto h-2.5 w-2.5 rounded-full bg-white shadow-sm ring-1 ring-white/40"
              />
            )}
          </motion.button>
        );
      })}

      <div className="mt-2 pt-3 border-t border-day-border dark:border-night-border flex flex-col gap-1.5">
        <motion.button
          type="button"
          whileTap={{ scale: 0.98 }}
          onClick={handleRefresh}
          disabled={isBusy}
          className={cn(
            'btn-base btn-md w-full',
            'bg-[#16a085] text-white hover:bg-[#138b72]',
            'disabled:cursor-wait',
          )}
        >
          <RefreshCw
            className={cn('h-4 w-4', isBusy && 'animate-spin')}
            aria-hidden
          />
          <span>
            {isBusy
              ? 'Refreshing…'
              : targetElement
                ? 'Refresh data'
                : 'Refresh all'}
          </span>
        </motion.button>
        <span className="text-[11px] text-day-muted dark:text-night-muted text-center">
          Last updated {timeAgo(displayLastFetched)}
          {targetElement && targetStatus?.stationCount
            ? ` · ${targetStatus.stationCount} stations`
            : ''}
        </span>
      </div>
    </div>
  );
}
