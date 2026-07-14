import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { BarChart3 } from 'lucide-react';
import { layoutById, useMonitoring } from '@/contexts/MonitoringContext';
import MonitoringChartRow from './MonitoringChartRow';
import { cn } from '@/utils/cn';

// Charts panel — always visible whenever the Monitoring surface is
// active. Sits as a flex sibling of MonitoringGrid, so the grid
// naturally compacts to make room for it (no overlay, no modal, maps
// stay fully interactive).
//
// One row per cell in the active layout, sharing a single time-window
// toggle at the top so the operator compares the same slice of history
// across every parameter at once.
export default function MonitoringChartsPanel() {
  const { layoutId } = useMonitoring();

  // Trend window — shared across every row so all charts scale to the
  // same X axis. Custom uses an inline number input, matching the main
  // PMD Data Trend tab's contract.
  const [mode, setMode] = useState('daily');
  const [customDays, setCustomDays] = useState(14);
  const days =
    mode === 'daily'
      ? 1
      : mode === 'weekly'
        ? 7
        : Math.max(1, Math.min(60, Number(customDays) || 1));

  const layout = layoutById(layoutId);
  const areas = layout.areas;

  return (
    <motion.aside
      key="monitoring-charts-panel"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
      className="shrink-0 min-h-0 w-[460px]"
      aria-label="Monitoring Charts"
    >
      <div
        className={cn(
          'w-full h-full flex flex-col rounded-md shadow-sm',
          'bg-white dark:bg-night-surface',
          'border border-day-border dark:border-night-border',
        )}
      >
        {/* Header — title + view count. No close chrome: the panel is
            part of the Monitoring surface itself, not a dismissable
            overlay. Turn Monitoring off in the left sidebar to hide
            the whole surface (grid + panel together). */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-day-border dark:border-night-border shrink-0">
          <BarChart3
            className="h-4 w-4 text-[#4d7c0f] dark:text-[#a3e635]"
            aria-hidden
          />
          <h2 className="text-[13px] font-semibold text-day-text dark:text-night-text">
            Charts
          </h2>
          <span className="text-[11px] text-day-muted dark:text-night-muted">
            · {areas.length} view{areas.length === 1 ? '' : 's'}
          </span>
        </div>

        {/* Shared time-window row — its own strip so the header
            doesn't get crowded and the toggle stays visible even on
            a narrow viewport. */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-day-border dark:border-night-border shrink-0">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-day-muted dark:text-night-muted">
            Window
          </span>
          <div className="ml-auto flex items-center gap-2">
            <BucketToggle value={mode} onChange={setMode} />
            {mode === 'custom' ? (
              <CustomDaysInput value={customDays} onChange={setCustomDays} />
            ) : null}
          </div>
        </div>

        {/* Chart rows — every row grows to fill the panel body
            equally (flex-1 min-h-0). No vertical scroll: the ask is
            that four rows all fit at once, so rows compact as the
            layout adds cells. Each MonitoringChartRow's canvas also
            uses flex-1 min-h-0 so it fills whatever fraction its
            row gets. */}
        <div className="flex-1 min-h-0 p-2 flex flex-col gap-2 bg-day-bg dark:bg-night-bg">
          {areas.map((area) => (
            <MonitoringChartRow key={area} cellKey={area} days={days} />
          ))}
        </div>
      </div>
    </motion.aside>
  );
}


// Segmented Daily / Weekly / Custom pill — mirrors ChartsRow's own
// BucketToggle so the two surfaces feel identical.
function BucketToggle({ value, onChange }) {
  const items = [
    { id: 'daily',  label: 'Daily'  },
    { id: 'weekly', label: 'Weekly' },
    { id: 'custom', label: 'Custom' },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Trend window"
      className={cn(
        'inline-flex items-center p-0.5 rounded-md',
        'bg-day-bg dark:bg-night-bg',
        'border border-day-border dark:border-night-border',
      )}
    >
      {items.map((it) => {
        const active = value === it.id;
        return (
          <button
            key={it.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(it.id)}
            className={cn(
              'relative px-2.5 py-1 text-[12px] font-medium rounded transition-colors',
              active
                ? 'text-[#1a2e05]'
                : 'text-day-muted dark:text-night-muted hover:text-day-text dark:hover:text-night-text',
            )}
          >
            {active && (
              <motion.span
                layoutId="monitoring-bucket-pill"
                className="absolute inset-0 rounded bg-[#84cc16]"
                transition={{ duration: 0.18 }}
              />
            )}
            <span className="relative z-10">{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function CustomDaysInput({ value, onChange }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const tryCommit = (raw) => {
    const n = Math.floor(Number(raw));
    if (Number.isFinite(n) && n >= 1 && n <= 60) onChange(n);
  };
  const commit = () => {
    const n = Math.floor(Number(draft));
    if (Number.isFinite(n) && n >= 1 && n <= 60) onChange(n);
    else setDraft(String(value));
  };

  return (
    <label
      className={cn(
        'inline-flex items-center p-0.5 rounded-md',
        'bg-day-bg dark:bg-night-bg',
        'border border-day-border dark:border-night-border',
      )}
    >
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium text-day-muted dark:text-night-muted">
        <span>Past</span>
        <input
          type="number"
          min={1}
          max={60}
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            setDraft(v);
            tryCommit(v);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          aria-label="Past N days"
          className={cn(
            'w-9 bg-transparent outline-none text-center',
            'text-day-text dark:text-night-text',
            'focus:ring-1 focus:ring-[#84cc16] rounded',
            '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
          )}
        />
        <span>days</span>
      </span>
    </label>
  );
}
