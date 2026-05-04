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
import { PARAMETER_LEGENDS } from '@/config/parameterLegends';
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
      {tab === 'pmd' ? <PmdTrendPanel theme={theme} /> : <LakesPanel theme={theme} />}
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
                ? 'text-brand-700 dark:text-[#16a085]'
                : 'text-day-muted dark:text-night-muted hover:text-day-text dark:hover:text-night-text',
            )}
          >
            {it.label}
            {active && (
              <motion.span
                layoutId="charts-tab-underline"
                className="absolute left-2 right-2 -bottom-px h-[2px] rounded-full bg-brand-700 dark:bg-[#16a085]"
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
  const [bucket, setBucket] = useState('hour'); // 'hour' (daily) | 'day' (weekly)
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const stationId = selectedStation?.stationId;
  const stationName = selectedStation?.stationName;

  useEffect(() => {
    if (!selected || !stationId) {
      setPoints([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(
      `/api/parameters/${encodeURIComponent(selected)}/stations/${stationId}/trend?bucket=${bucket}`,
    )
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
  }, [selected, stationId, bucket]);

  const unit = PARAMETER_LEGENDS[selected]?.unit ?? '';
  const lineColor = selected ? colorFor(selected) : '#16a085';
  const fill =
    theme === 'night'
      ? hexToRgba(lineColor, 0.22)
      : hexToRgba(lineColor, 0.14);

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
          borderColor: lineColor,
          backgroundColor: fill,
          pointBackgroundColor: lineColor,
          pointBorderColor: lineColor,
          pointRadius: 3,
          pointHoverRadius: 5,
          borderWidth: 2,
          fill: true,
          tension: 0.35,
          spanGaps: true,
        },
      ],
    }),
    [points, selected, unit, lineColor, fill],
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
    <div className="p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-day-text dark:text-night-text">
          {empty
            ? 'PMD Parameter Trend'
            : `${stationName || `Station ${stationId}`}${selected ? ` · ${selected}` : ''}`}
        </h3>
        <div className="ml-auto">
          <BucketToggle value={bucket} onChange={setBucket} disabled={empty} />
        </div>
      </div>

      <div className="h-28 sm:h-32 lg:h-36">
        {empty ? (
          <EmptyState>
            Select a parameter and click a station to view its trend.
          </EmptyState>
        ) : noData ? (
          <EmptyState>
            No readings recorded for the {bucket === 'hour' ? 'last 24 hours' : 'last 7 days'}.
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
    { id: 'hour', label: 'Daily' },
    { id: 'day',  label: 'Weekly' },
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
                className="absolute inset-0 rounded bg-brand-700 dark:bg-[#16a085]"
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
