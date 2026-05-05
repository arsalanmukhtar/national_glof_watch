import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip as ChartTooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import Panel from '@/components/ui/Panel';
import Select from '@/components/ui/Select';
import { useTheme } from '@/hooks/useTheme';
import { useParameter } from '@/contexts/ParameterContext';
import { colorFor } from '@/config/parameterColors';
import {
  PARAMETER_LEGENDS,
  buildLegendGradient,
} from '@/config/parameterLegends';
import { cn } from '@/utils/cn';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  ChartTooltip,
  Legend,
  Filler,
);

const SERIES = {
  area: {
    day:   { line: '#1d4ed8', fill: 'rgba(29, 78, 216, 0.14)' },
    night: { line: '#60a5fa', fill: 'rgba(96, 165, 250, 0.22)' },
  },
  volume: {
    day:   { line: '#0e7490', fill: 'rgba(14, 116, 144, 0.14)' },
    night: { line: '#22d3ee', fill: 'rgba(34, 211, 238, 0.22)' },
  },
};

const TOKENS = {
  day: {
    text:       '#475569',
    grid:       'rgba(148, 163, 184, 0.28)',
    axis:       '#cbd5e1',
    tooltipBg:  '#0f172a',
    tooltipFg:  '#f8fafc',
  },
  night: {
    text:       '#cbd5e1',
    grid:       'rgba(203, 213, 225, 0.12)',
    axis:       '#475569',
    tooltipBg:  '#1e272e',
    tooltipFg:  '#f1f5f9',
  },
};

function buildOptions(theme, { unit = '', xLabelFormatter } = {}) {
  const t = TOKENS[theme];
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        labels: {
          boxWidth: 8,
          boxHeight: 8,
          padding: 8,
          color: t.text,
          font: { size: 10 },
          usePointStyle: true,
        },
      },
      tooltip: {
        backgroundColor: t.tooltipBg,
        titleColor: t.tooltipFg,
        bodyColor: t.tooltipFg,
        borderColor: t.axis,
        borderWidth: 1,
        padding: 8,
        cornerRadius: 6,
        titleFont: { size: 11, weight: '600' },
        bodyFont: { size: 11 },
        callbacks: unit
          ? {
              label: (ctx) =>
                `${ctx.dataset.label}: ${ctx.parsed.y} ${unit}`,
            }
          : undefined,
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          color: t.text,
          font: { size: 10 },
          callback: xLabelFormatter
            ? function (value, index) {
                const lbl = this.getLabelForValue(value);
                return xLabelFormatter(lbl, index);
              }
            : undefined,
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 8,
        },
        border: { color: t.axis },
      },
      y: {
        beginAtZero: false,
        grid: { color: t.grid },
        ticks: { color: t.text, font: { size: 10 } },
        border: { color: t.axis },
      },
    },
  };
}

function buildPlaceholder(label, palette) {
  return {
    labels: [],
    datasets: [
      {
        label,
        data: [],
        borderColor: palette.line,
        backgroundColor: palette.fill,
        pointBackgroundColor: palette.line,
        pointBorderColor: palette.line,
        pointRadius: 3,
        pointHoverRadius: 5,
        borderWidth: 2,
        fill: true,
        tension: 0.35,
      },
    ],
  };
}

export default function ChartsRow() {
  const { theme } = useTheme();
  const [tab, setTab] = useState('pmd'); // 'pmd' | 'lakes'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="card-base flex flex-col shrink-0"
    >
      <Tabs tab={tab} onChange={setTab} />
      {/* Reserve a consistent body height so the card doesn't reflow on
          tab swap. Tracks the larger of the two natural heights (Lakes,
          which has wrapped Panels). */}
      <div className="min-h-[220px] sm:min-h-[236px] lg:min-h-[252px] flex flex-col">
        {tab === 'pmd' ? <PmdTrendPanel theme={theme} /> : <LakesPanel theme={theme} />}
      </div>
    </motion.div>
  );
}

function Tabs({ tab, onChange }) {
  const items = [
    { id: 'pmd',   label: 'PMD Data Trend' },
    { id: 'lakes', label: 'Lakes Trend' },
  ];
  return (
    <div
      role="tablist"
      aria-label="Chart category"
      className="flex items-center gap-1 px-3 pt-2 border-b border-day-border dark:border-night-border"
    >
      {items.map((it) => {
        const active = tab === it.id;
        return (
          <button
            key={it.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.id)}
            className={cn(
              'relative px-3 py-1.5 text-[12px] font-medium transition-colors',
              active
                ? 'text-[#16a085]'
                : 'text-day-muted dark:text-night-muted hover:text-day-text dark:hover:text-night-text',
            )}
          >
            {it.label}
            {active && (
              <motion.span
                layoutId="charts-tab-underline"
                className="absolute left-2 right-2 -bottom-px h-[2px] rounded-full bg-[#16a085]"
                transition={{ duration: 0.2 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

function PmdTrendPanel({ theme }) {
  const { selected, selectedStation } = useParameter();
  // 'daily' = hour bucket / last 24 h
  // 'weekly' = day bucket / last 7 d
  // 'custom' = day bucket / last `customDays` d
  const [mode, setMode] = useState('daily');
  const [customDays, setCustomDays] = useState(14);
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const stationId = selectedStation?.stationId;
  const stationName = selectedStation?.stationName;
  const bucket = mode === 'daily' ? 'hour' : 'day';

  useEffect(() => {
    if (!selected || !stationId) {
      setPoints([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const url = new URL(
      `/api/parameters/${encodeURIComponent(selected)}/stations/${stationId}/trend`,
      window.location.origin,
    );
    url.searchParams.set('bucket', bucket);
    if (mode === 'custom') {
      url.searchParams.set('days', String(Math.max(1, Math.min(365, customDays || 1))));
    }
    fetch(url.toString())
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (cancelled) return;
        setPoints(Array.isArray(data?.points) ? data.points : []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setPoints([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, stationId, bucket, mode, customDays]);

  const unit = PARAMETER_LEGENDS[selected]?.unit ?? '';
  const fallbackLine = selected ? colorFor(selected) : '#16a085';
  const fillAlpha = theme === 'night' ? 0.22 : 0.14;
  const fallbackFill =
    theme === 'night'
      ? hexToRgba(fallbackLine, 0.22)
      : hexToRgba(fallbackLine, 0.14);

  // Scriptable color: returns a vertical CanvasGradient mapped onto the
  // legend bins for this parameter, so the line + fill literally show
  // the color of each value range. Falls back to the solid parameter
  // color before the chart has measured its area.
  const lineGradient = (context) => {
    const { chart } = context;
    const { ctx, chartArea, scales } = chart;
    const g = buildLegendGradient(ctx, chartArea, scales?.y, selected, 1);
    return g ?? fallbackLine;
  };
  const fillGradient = (context) => {
    const { chart } = context;
    const { ctx, chartArea, scales } = chart;
    const g = buildLegendGradient(ctx, chartArea, scales?.y, selected, fillAlpha);
    return g ?? fallbackFill;
  };

  const xLabelFormatter = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    if (bucket === 'hour') {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const data = useMemo(
    () => ({
      labels: points.map((p) => p.ts),
      datasets: [
        {
          label: selected
            ? `${selected}${unit ? ` (${unit})` : ''}`
            : 'No parameter selected',
          data: points.map((p) =>
            p.value == null ? null : Number(p.value.toFixed(3)),
          ),
          borderColor: lineGradient,
          backgroundColor: fillGradient,
          pointBackgroundColor: lineGradient,
          pointBorderColor: lineGradient,
          pointRadius: 3,
          pointHoverRadius: 5,
          borderWidth: 2,
          fill: true,
          tension: 0.35,
          spanGaps: true,
        },
      ],
    }),
    // Scriptable colors close over `selected` + `theme` via the helpers
    // above, so depending on `points` and `selected` is sufficient.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, selected, unit, theme],
  );

  const options = useMemo(
    () => buildOptions(theme, { unit, xLabelFormatter }),
    // xLabelFormatter is intentionally derived from `bucket`, captured here
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme, unit, bucket],
  );

  const empty = !selected || !stationId;
  const noData = !empty && points.length === 0 && !loading;

  return (
    <div className="p-3 flex flex-col gap-2 h-full min-h-0">
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <h3 className="text-sm font-semibold text-day-text dark:text-night-text">
          {empty
            ? 'PMD Parameter Trend'
            : `${stationName || `Station ${stationId}`}${selected ? ` · ${selected}` : ''}`}
        </h3>
        <div className="ml-auto flex items-center gap-2">
          <BucketToggle value={mode} onChange={setMode} disabled={empty} />
          {mode === 'custom' && (
            <CustomDaysInput
              value={customDays}
              onChange={setCustomDays}
              disabled={empty}
            />
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {empty ? (
          <EmptyState>
            Select a parameter and click a station to view its trend.
          </EmptyState>
        ) : noData ? (
          <EmptyState>
            No readings recorded for the{' '}
            {mode === 'daily'
              ? 'last 24 hours'
              : mode === 'weekly'
                ? 'last 7 days'
                : `last ${customDays} day${customDays === 1 ? '' : 's'}`}
            .
          </EmptyState>
        ) : (
          <Line data={data} options={options} />
        )}
        {error && (
          <p className="mt-1 text-[10.5px] text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function BucketToggle({ value, onChange, disabled }) {
  const items = [
    { id: 'daily',  label: 'Daily' },
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
        disabled && 'opacity-50 pointer-events-none',
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
              'relative px-2.5 py-1 text-[11px] font-medium rounded transition-colors',
              active
                ? 'text-white'
                : 'text-day-muted dark:text-night-muted hover:text-day-text dark:hover:text-night-text',
            )}
          >
            {active && (
              <motion.span
                layoutId="bucket-toggle-pill"
                className="absolute inset-0 rounded bg-[#16a085]"
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

function CustomDaysInput({ value, onChange, disabled }) {
  // Local string state lets the user clear the field while typing without
  // immediately snapping back to a valid number; commit on blur / Enter.
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const n = Math.floor(Number(draft));
    if (Number.isFinite(n) && n >= 1 && n <= 365) {
      onChange(n);
    } else {
      setDraft(String(value));
    }
  };

  // Mirror BucketToggle's structure (outer p-0.5 + inner px-2.5 py-1) so
  // the rendered heights line up to the pixel.
  return (
    <label
      className={cn(
        'inline-flex items-center p-0.5 rounded-md',
        'bg-day-bg dark:bg-night-bg',
        'border border-day-border dark:border-night-border',
        disabled && 'opacity-50 pointer-events-none',
      )}
    >
      <span
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium',
          'text-day-muted dark:text-night-muted',
        )}
      >
        <span>Past</span>
        <input
          type="number"
          min={1}
          max={365}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          aria-label="Past N days"
          className={cn(
            'w-9 bg-transparent outline-none text-center',
            'text-day-text dark:text-night-text',
            'focus:ring-1 focus:ring-[#16a085] rounded',
            '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
          )}
        />
        <span>days</span>
      </span>
    </label>
  );
}

function EmptyState({ children }) {
  return (
    <div className="h-full flex items-center justify-center text-center px-3">
      <p className="text-[11.5px] text-day-muted dark:text-night-muted">
        {children}
      </p>
    </div>
  );
}

function LakesPanel({ theme }) {
  const options = useMemo(() => buildOptions(theme), [theme]);
  const lakeAreaData = useMemo(
    () => buildPlaceholder('Lake area (m²)', SERIES.area[theme]),
    [theme],
  );
  const lakeVolumeData = useMemo(
    () => buildPlaceholder('Lake volume (m³)', SERIES.volume[theme]),
    [theme],
  );

  return (
    <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Panel
        title="Lake Area"
        className="!p-3"
        actions={
          <Select aria-label="Lake selector" defaultValue="" className="text-xs py-1">
            <option value="">All lakes</option>
          </Select>
        }
      >
        <div className="h-28 sm:h-32 lg:h-36">
          <Line data={lakeAreaData} options={options} />
        </div>
      </Panel>

      <Panel
        title="Lake Volume"
        className="!p-3"
        actions={
          <Select aria-label="Lake selector" defaultValue="" className="text-xs py-1">
            <option value="">All lakes</option>
          </Select>
        }
      >
        <div className="h-28 sm:h-32 lg:h-36">
          <Line data={lakeVolumeData} options={options} />
        </div>
      </Panel>
    </div>
  );
}

// Hex (#rrggbb) → rgba(r,g,b,a). Used to derive a translucent fill from the
// solid line color so the chart area tint matches the parameter's palette.
function hexToRgba(hex, alpha) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex ?? '');
  if (!m) return `rgba(22, 160, 133, ${alpha})`;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
