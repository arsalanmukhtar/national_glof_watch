import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Search, TableProperties } from 'lucide-react';
import { useParameter } from '@/contexts/ParameterContext';
import { useAttributeTables } from '@/contexts/AttributeTablesContext';
import { colorFor, withAlpha, textOn } from '@/config/parameterColors';
import { timeAgo } from '@/utils/timeAgo';
import { cn } from '@/utils/cn';

function useTick(intervalMs = 30_000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
}

export default function ParametersPanel() {
  const { selected, select, elements, statuses, refresh, refreshAll, busy } =
    useParameter();
  const { toggleTable, isOpen } = useAttributeTables();
  useTick(); // re-render every 30s so the time-ago label stays fresh

  const [query, setQuery] = useState('');

  // The catalog is large (20-40+ elements) — filter inline; no debounce
  // needed at this size.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return elements;
    return elements.filter((e) => e.name.toLowerCase().includes(q));
  }, [elements, query]);

  const targetElement = selected;
  const targetStatus = targetElement ? statuses[targetElement] : null;

  // When nothing is selected, surface the freshest fetched_at across all elements.
  const overallLastFetched = useMemo(() => {
    let latest = null;
    for (const v of Object.values(statuses)) {
      if (!v?.lastFetchedAt) continue;
      if (!latest || new Date(v.lastFetchedAt) > new Date(latest)) {
        latest = v.lastFetchedAt;
      }
    }
    return latest;
  }, [statuses]);

  const displayLastFetched = targetElement
    ? targetStatus?.lastFetchedAt
    : overallLastFetched;

  const handleRefresh = () => {
    if (busy) return;
    if (targetElement) refresh(targetElement);
    else refreshAll();
  };

  const isBusy =
    (targetElement && busy === targetElement) ||
    (!targetElement && busy === 'ALL');

  return (
    <div className="flex flex-col gap-2">
      {/* Search */}
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-day-muted dark:text-night-muted"
          aria-hidden
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search elements…"
          className="input-base input-search py-1.5 text-[13px]"
        />
      </div>

      {/* Element list — owns its own bounded scroll (the sidebar section
          does not scroll). */}
      <div className="flex flex-col gap-1 max-h-[280px] overflow-y-auto pr-0.5">
        {elements.length === 0 && (
          <p className="px-1 py-3 text-center text-[12px] text-day-muted dark:text-night-muted">
            Loading elements…
          </p>
        )}
        {elements.length > 0 && filtered.length === 0 && (
          <p className="px-1 py-3 text-center text-[12px] text-day-muted dark:text-night-muted">
            No elements match “{query}”
          </p>
        )}
        {filtered.map(({ name, stationCount }) => {
          const active = selected === name;
          const tableId = `param:${name}`;
          const tableOpen = isOpen(tableId);
          const color = colorFor(name);
          const textColor = textOn(color);
          return (
            <motion.div
              key={name}
              initial={false}
              animate={{
                backgroundColor: active ? color : withAlpha(color, 0.12),
                borderColor: active ? color : withAlpha(color, 0.4),
              }}
              whileHover={
                active ? undefined : { backgroundColor: withAlpha(color, 0.24) }
              }
              transition={{ duration: 0.15 }}
              className={cn(
                'group flex shrink-0 items-stretch rounded-md border text-[13px] font-medium overflow-hidden',
                'text-day-text dark:text-night-text',
              )}
              style={active ? { color: textColor } : undefined}
            >
              <motion.button
                type="button"
                whileTap={{ scale: 0.98 }}
                onClick={() => select(name)}
                aria-pressed={active}
                className="flex-1 inline-flex items-center gap-2 px-2.5 py-1.5 text-left min-w-0"
              >
                <span className="flex-1 truncate">{name}</span>
                {active && (
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full bg-white shadow-sm ring-1 ring-white/40"
                  />
                )}
                <span
                  className={cn(
                    'shrink-0 rounded px-1.5 py-0.5 text-[10px] tabular-nums font-semibold',
                    !active &&
                      'bg-day-bg text-day-muted dark:bg-night-bg dark:text-night-muted',
                  )}
                  style={
                    active
                      ? { backgroundColor: 'rgba(0,0,0,0.18)', color: textColor }
                      : undefined
                  }
                  title={`${stationCount} station${stationCount === 1 ? '' : 's'}`}
                >
                  {stationCount}
                </span>
              </motion.button>
              <motion.button
                type="button"
                whileTap={{ scale: 0.92 }}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleTable({
                    id: tableId,
                    kind: 'parameter',
                    element: name,
                    label: name,
                  });
                }}
                aria-pressed={tableOpen}
                aria-label={
                  tableOpen
                    ? `Close ${name} attributes`
                    : `Open ${name} attributes`
                }
                title={
                  tableOpen
                    ? `Close ${name} attributes`
                    : `Open ${name} attributes`
                }
                className={cn(
                  'inline-flex shrink-0 items-center justify-center px-2 border-l transition-colors',
                  active
                    ? tableOpen
                      ? 'bg-black/20'
                      : 'hover:bg-black/10'
                    : cn(
                        'border-day-border dark:border-night-border',
                        tableOpen
                          ? 'bg-[#84cc16]/25 text-[#3f6212] dark:text-[#a3e635]'
                          : 'text-day-muted dark:text-night-muted hover:bg-day-bg dark:hover:bg-night-bg',
                      ),
                )}
                style={
                  active
                    ? { borderColor: 'rgba(0,0,0,0.2)', color: textColor }
                    : undefined
                }
              >
                <TableProperties className="h-3.5 w-3.5" />
              </motion.button>
            </motion.div>
          );
        })}
      </div>

      <div className="mt-0.5 pt-2 border-t border-day-border dark:border-night-border flex flex-col gap-1">
        <motion.button
          type="button"
          whileTap={{ scale: 0.98 }}
          onClick={handleRefresh}
          disabled={isBusy}
          className={cn(
            'btn-base btn-sm w-full',
            'bg-[#84cc16] text-[#1a2e05] hover:bg-[#65a30d]',
            'disabled:cursor-wait',
          )}
        >
          <RefreshCw
            className={cn('h-3.5 w-3.5', isBusy && 'animate-spin')}
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
