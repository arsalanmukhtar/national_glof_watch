import { Fragment, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Listbox, Transition } from '@headlessui/react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useParameter } from '@/contexts/ParameterContext';
import {
  colorForReading,
  formatValue,
  PARAMETER_LEGENDS,
} from '@/config/parameterLegends';
import { timeAgo } from '@/utils/timeAgo';
import { cn } from '@/utils/cn';

const ELEMENT_OPTIONS = [
  { id: 'Air Temperature',          label: 'Air Temperature' },
  { id: 'Total Rain',               label: 'Total Rain' },
  { id: 'Water Level',              label: 'Water Level' },
  { id: 'Compact GAS State (WPs)',  label: 'GAS State' },
  { id: 'Istantaneous Flow',        label: 'Instantaneous Flow' },
];

// Bottom-right attribute table. Header is always visible (with parameter
// dropdown + collapse toggle); body collapses via the chevron. Row click
// flies the map to the station and highlights it.
export default function StationsTable() {
  const {
    selected,
    setSelected,
    stations,
    selectedStation,
    setSelectedStation,
  } = useParameter();
  const [open, setOpen] = useState(true);
  // { column: 'station' | 'value' | 'updated', direction: 'asc' | 'desc' }
  const [sort, setSort] = useState({ column: 'value', direction: 'asc' });

  const toggleSort = (column) => {
    setSort((prev) =>
      prev.column === column
        ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { column, direction: 'asc' },
    );
  };

  // Auto-scroll to a station that was just clicked on the map.
  useEffect(() => {
    if (!selectedStation || !open) return;
    const row = document.getElementById(`station-row-${selectedStation.stationId}`);
    row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedStation, open]);

  const handleRowClick = (feature) => {
    const props = feature.properties ?? {};
    // Toggle: click the same row twice → clear the selection.
    if (selectedStation?.stationId === props.stationId) {
      setSelectedStation(null);
      return;
    }
    setSelectedStation({
      ...props,
      lng: feature.geometry?.coordinates?.[0],
      lat: feature.geometry?.coordinates?.[1],
    });
  };

  // Sort by the active column. Bad/missing values always sink so live
  // stations stay near the top regardless of direction.
  const sortedStations = useMemo(() => {
    const dir = sort.direction === 'asc' ? 1 : -1;
    const cmp = (a, b) => {
      if (sort.column === 'station') {
        const an = (a.properties?.stationName ?? '').toString();
        const bn = (b.properties?.stationName ?? '').toString();
        return an.localeCompare(bn) * dir;
      }
      if (sort.column === 'updated') {
        const at = parseTs(a.properties?.lastUpdate);
        const bt = parseTs(b.properties?.lastUpdate);
        const aBad = at == null;
        const bBad = bt == null;
        if (aBad && bBad) return 0;
        if (aBad) return 1;
        if (bBad) return -1;
        return (at - bt) * dir;
      }
      // value (default)
      const av = Number(a.properties?.value);
      const bv = Number(b.properties?.value);
      const aBad = !Number.isFinite(av);
      const bBad = !Number.isFinite(bv);
      if (aBad && bBad) return 0;
      if (aBad) return 1;
      if (bBad) return -1;
      return (av - bv) * dir;
    };
    return [...stations].sort(cmp);
  }, [stations, sort]);

  const unitForSelected = PARAMETER_LEGENDS[selected]?.unit ?? '';
  const selectedLabel =
    ELEMENT_OPTIONS.find((o) => o.id === selected)?.label ?? null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'absolute right-2 bottom-2 z-10 w-[340px] rounded-md shadow-md overflow-hidden',
        'bg-white/95 dark:bg-night-surface/95 backdrop-blur-sm',
        'border border-day-border dark:border-night-border',
      )}
    >
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-day-border dark:border-night-border">
        <h3 className="text-[12px] font-semibold text-day-text dark:text-night-text">
          Stations
        </h3>
        <Listbox value={selected ?? ''} onChange={(v) => setSelected(v || null)}>
          <div className="relative ml-auto">
            <Listbox.Button
              className={cn(
                'flex items-center gap-1.5 text-[11px] rounded px-2 py-1 cursor-pointer min-w-[120px]',
                'bg-day-bg dark:bg-night-bg text-day-text dark:text-night-text',
                'border border-day-border dark:border-night-border',
                'hover:bg-white dark:hover:bg-night-surface transition-colors',
                'focus:outline-none focus:ring-1 focus:ring-[#16a085]',
              )}
              aria-label="Select parameter"
            >
              <span className="truncate">
                {selectedLabel ?? (
                  <span className="text-day-muted dark:text-night-muted">
                    Select parameter…
                  </span>
                )}
              </span>
              <ChevronDown
                className="ml-auto h-3 w-3 shrink-0 text-day-muted dark:text-night-muted"
                strokeWidth={1.75}
                aria-hidden
              />
            </Listbox.Button>
            <Transition
              as={Fragment}
              enter="transition ease-out duration-150"
              enterFrom="opacity-0 translate-y-1"
              enterTo="opacity-100 translate-y-0"
              leave="transition ease-in duration-100"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <Listbox.Options
                className={cn(
                  'absolute right-0 mt-1 w-[160px] rounded-md py-1 z-20',
                  'bg-white dark:bg-night-surface',
                  'border border-day-border dark:border-night-border',
                  'shadow-lg focus:outline-none text-[11px]',
                )}
              >
                {ELEMENT_OPTIONS.map((o) => (
                  <Listbox.Option
                    key={o.id}
                    value={o.id}
                    className={({ active }) =>
                      cn(
                        'flex items-center gap-2 px-2.5 py-1 cursor-pointer select-none',
                        active
                          ? 'bg-brand-100 text-brand-900 dark:bg-[#16a085]/20 dark:text-night-text'
                          : 'text-day-text dark:text-night-text',
                      )
                    }
                  >
                    {({ selected: isSelected }) => (
                      <>
                        <span
                          className={cn(
                            'h-3 w-3 inline-flex items-center justify-center shrink-0',
                            isSelected
                              ? 'text-[#16a085]'
                              : 'opacity-0',
                          )}
                          aria-hidden
                        >
                          <Check className="h-3 w-3" strokeWidth={2.5} />
                        </span>
                        <span
                          className={cn(
                            'truncate',
                            isSelected && 'font-medium',
                          )}
                        >
                          {o.label}
                        </span>
                      </>
                    )}
                  </Listbox.Option>
                ))}
              </Listbox.Options>
            </Transition>
          </div>
        </Listbox>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="h-5 w-5 inline-flex items-center justify-center rounded text-day-muted dark:text-night-muted hover:bg-day-bg dark:hover:bg-night-bg"
          aria-label={open ? 'Collapse table' : 'Expand table'}
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} />
          ) : (
            <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            {!selected ? (
              <p className="px-3 py-4 text-[11px] text-center text-day-muted dark:text-night-muted">
                Select a parameter to view stations.
              </p>
            ) : stations.length === 0 ? (
              <p className="px-3 py-4 text-[11px] text-center text-day-muted dark:text-night-muted">
                No stations available.
              </p>
            ) : (
              <div className="max-h-[200px] overflow-y-auto">
                <table className="w-full text-[11px] table-fixed">
                  <thead className="sticky top-0 bg-day-bg/95 dark:bg-night-bg/95 backdrop-blur-sm border-b border-day-border dark:border-night-border">
                    <tr className="text-day-muted dark:text-night-muted">
                      <SortableTh
                        column="station"
                        sort={sort}
                        onToggle={toggleSort}
                        className="w-[50%]"
                      >
                        Station
                      </SortableTh>
                      <SortableTh
                        column="value"
                        sort={sort}
                        onToggle={toggleSort}
                      >
                        Value{unitForSelected ? ` (${unitForSelected})` : ''}
                      </SortableTh>
                      <SortableTh
                        column="updated"
                        sort={sort}
                        onToggle={toggleSort}
                        className="w-[88px]"
                      >
                        Updated
                      </SortableTh>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedStations.map((f) => {
                      const p = f.properties ?? {};
                      const id = p.stationId;
                      const color = colorForReading(selected, p.value, p.lastUpdate);
                      const active = selectedStation?.stationId === id;
                      return (
                        <tr
                          id={`station-row-${id}`}
                          key={id}
                          onClick={() => handleRowClick(f)}
                          className={cn(
                            'cursor-pointer border-b border-day-border/60 dark:border-night-border/60 last:border-b-0',
                            active
                              ? 'bg-brand-100 dark:bg-[#16a085]/20'
                              : 'hover:bg-day-bg dark:hover:bg-night-bg',
                          )}
                        >
                          <td className="px-2.5 py-1 truncate">
                            <span className="inline-flex items-center gap-1.5">
                              <span
                                aria-hidden
                                className="h-2 w-2 rounded-full shrink-0 border border-slate-900/40 dark:border-white/30"
                                style={{ backgroundColor: color }}
                              />
                              <span className="truncate text-day-text dark:text-night-text">
                                {p.stationName || `#${id}`}
                              </span>
                            </span>
                          </td>
                          <td className="px-2.5 py-1 text-day-text dark:text-night-text font-medium truncate">
                            {formatValue(selected, p.value, p.unit)}
                          </td>
                          <td className="px-2.5 py-1 text-day-muted dark:text-night-muted truncate">
                            {timeAgo(p.lastUpdate)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function SortableTh({ column, sort, onToggle, className, children }) {
  const active = sort.column === column;
  const Icon = !active ? ArrowUpDown : sort.direction === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={
        active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'
      }
      className={cn('text-left font-medium px-2.5 py-1', className)}
    >
      <button
        type="button"
        onClick={() => onToggle(column)}
        className={cn(
          'inline-flex items-center gap-1 hover:text-day-text dark:hover:text-night-text transition-colors',
          active && 'text-[#16a085]',
        )}
      >
        <span className="truncate">{children}</span>
        <Icon
          className={cn('h-3 w-3 shrink-0', !active && 'opacity-50')}
          strokeWidth={2}
        />
      </button>
    </th>
  );
}

function parseTs(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}
