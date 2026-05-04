import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useParameter } from '@/contexts/ParameterContext';
import { colorFor } from '@/config/parameterColors';
import { timeAgo } from '@/utils/timeAgo';
import { cn } from '@/utils/cn';

// Bottom-right floating attribute card. Visible only when a station is
// selected on the map. Header is always shown; the table body collapses
// via the chevron toggle. The X button clears the selection.
export default function StationDetailPanel() {
  const { selectedStation, setSelectedStation } = useParameter();
  const [open, setOpen] = useState(true);

  if (!selectedStation) return null;

  const {
    stationId,
    stationName,
    element,
    value,
    unit,
    lastUpdate,
    lng,
    lat,
  } = selectedStation;
  const color = colorFor(element);

  const valueText =
    value === null || value === undefined || value === ''
      ? '—'
      : `${value}${unit ? ` ${unit}` : ''}`;

  const coordText =
    Number.isFinite(lat) && Number.isFinite(lng)
      ? `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}`
      : '—';

  return (
    <motion.div
      key={stationId}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'absolute right-2 bottom-9 z-10 w-[260px] rounded-md shadow-md overflow-hidden',
        'bg-white/95 dark:bg-night-surface/95 backdrop-blur-sm',
        'border border-day-border dark:border-night-border',
      )}
    >
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-day-border dark:border-night-border">
        <span
          aria-hidden
          className="h-2 w-2 rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
        <h3 className="text-[12px] font-semibold text-day-text dark:text-night-text truncate">
          {stationName || `Station ${stationId}`}
        </h3>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="ml-auto h-5 w-5 inline-flex items-center justify-center rounded text-day-muted dark:text-night-muted hover:bg-day-bg dark:hover:bg-night-bg"
          aria-label={open ? 'Collapse details' : 'Expand details'}
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} />
          ) : (
            <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
        </button>
        <button
          type="button"
          onClick={() => setSelectedStation(null)}
          className="h-5 w-5 inline-flex items-center justify-center rounded text-day-muted dark:text-night-muted hover:bg-day-bg dark:hover:bg-night-bg"
          aria-label="Close station details"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
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
            <table className="w-full text-[11px]">
              <tbody>
                <Row label="ID" value={stationId} />
                <Row label="Parameter" value={element} />
                <Row label="Value" value={valueText} highlight={color} />
                <Row label="Coordinates" value={coordText} mono />
                <Row label="Last update" value={timeAgo(lastUpdate)} />
              </tbody>
            </table>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Row({ label, value, mono = false, highlight }) {
  return (
    <tr className="border-b border-day-border/60 dark:border-night-border/60 last:border-b-0">
      <td className="px-2.5 py-1 text-day-muted dark:text-night-muted whitespace-nowrap w-[88px]">
        {label}
      </td>
      <td
        className={cn(
          'px-2.5 py-1 text-day-text dark:text-night-text font-medium truncate',
          mono && 'font-mono text-[10.5px]',
        )}
        style={highlight ? { color: highlight } : undefined}
      >
        {value}
      </td>
    </tr>
  );
}
