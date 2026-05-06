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
import LayerAttributesPanel from '@/components/dashboard/LayerAttributesPanel';
import { useTheme } from '@/hooks/useTheme';
import { useParameter } from '@/contexts/ParameterContext';
import { useAttributeTables } from '@/contexts/AttributeTablesContext';
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
    dayBand:    'rgba(15, 23, 42, 0.04)',
    dayLine:    'rgba(71, 85, 105, 0.45)',
    dayPillBg:  'rgba(15, 23, 42, 0.92)',
    dayPillFg:  '#f8fafc',
  },
  night: {
    text:       '#cbd5e1',
    grid:       'rgba(203, 213, 225, 0.12)',
    axis:       '#475569',
    tooltipBg:  '#1e272e',
    tooltipFg:  '#f1f5f9',
    dayBand:    'rgba(255, 255, 255, 0.035)',
    dayLine:    'rgba(203, 213, 225, 0.4)',
    dayPillBg:  'rgba(241, 245, 249, 0.92)',
    dayPillFg:  '#0f172a',
  },
};

// Chart.js plugin — segregates the chart by calendar day:
//   1. Faint alternating background band so each day reads as its own
//      column.
//   2. Dashed vertical line at every midnight crossing.
//   3. A date pill anchored just inside the new day so the boundary is
//      labeled inline (no need to scan the bottom axis to find where
//      "May 6" begins).
// Configured via `options.plugins.dayMarker` (theme colors + max-pill
// budget so very-long windows don't crowd the top of the chart).
const dayMarkerPlugin = {
  id: 'dayMarker',
  beforeDatasetsDraw(chart, _args, opts) {
    if (!opts?.enabled) return;
    const { ctx, chartArea, scales, data } = chart;
    if (!chartArea || !scales?.x) return;
    const labels = data?.labels || [];
    if (labels.length < 2) return;

    const dayStarts = collectDayStarts(labels);
    if (dayStarts.length < 1) return;

    ctx.save();
    for (let i = 0; i < dayStarts.length; i++) {
      if (i % 2 === 0) continue; // band every other day for the alternation
      const startIdx = dayStarts[i].index;
      const endIdx =
        i + 1 < dayStarts.length ? dayStarts[i + 1].index - 1 : labels.length - 1;
      const xStart = scales.x.getPixelForValue(startIdx);
      const xEnd = scales.x.getPixelForValue(endIdx);
      ctx.fillStyle = opts.band || 'rgba(148,163,184,0.05)';
      ctx.fillRect(
        xStart,
        chartArea.top,
        Math.max(1, xEnd - xStart),
        chartArea.bottom - chartArea.top,
      );
    }
    ctx.restore();
  },
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts?.enabled) return;
    const { ctx, chartArea, scales, data } = chart;
    if (!chartArea || !scales?.x) return;
    const labels = data?.labels || [];
    if (labels.length < 2) return;

    const dayStarts = collectDayStarts(labels);
    // Skip the first one — chart's left edge is the natural start.
    const boundaries = dayStarts.slice(1);
    if (boundaries.length === 0) return;

    // For very wide windows (e.g. 60+ day boundaries) only label every
    // Nth pill to avoid pills overlapping at the top.
    const maxPills = Math.max(2, opts.maxPills || 14);
    const pillStep = Math.max(1, Math.ceil(boundaries.length / maxPills));

    ctx.save();
    for (let i = 0; i < boundaries.length; i++) {
      const { index, date } = boundaries[i];
      const x = scales.x.getPixelForValue(index);
      if (x < chartArea.left - 1 || x > chartArea.right + 1) continue;

      // Dashed vertical line spans the plot
      ctx.strokeStyle = opts.line || 'rgba(148,163,184,0.55)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);

      // Pill with the date — only every pillStep boundary to keep top clear
      if (i % pillStep !== 0) continue;
      const label = date.toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
      });
      ctx.font = '600 10px Inter, system-ui, sans-serif';
      const labelW = ctx.measureText(label).width;
      const padX = 6;
      const pillW = labelW + padX * 2;
      const pillH = 16;
      const pillX = Math.min(x + 4, chartArea.right - pillW - 2);
      const pillY = chartArea.top + 2;
      const r = 8;

      ctx.fillStyle = opts.pillBg || 'rgba(15,23,42,0.92)';
      ctx.beginPath();
      ctx.moveTo(pillX + r, pillY);
      ctx.lineTo(pillX + pillW - r, pillY);
      ctx.quadraticCurveTo(pillX + pillW, pillY, pillX + pillW, pillY + r);
      ctx.lineTo(pillX + pillW, pillY + pillH - r);
      ctx.quadraticCurveTo(
        pillX + pillW,
        pillY + pillH,
        pillX + pillW - r,
        pillY + pillH,
      );
      ctx.lineTo(pillX + r, pillY + pillH);
      ctx.quadraticCurveTo(pillX, pillY + pillH, pillX, pillY + pillH - r);
      ctx.lineTo(pillX, pillY + r);
      ctx.quadraticCurveTo(pillX, pillY, pillX + r, pillY);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = opts.pillFg || '#f8fafc';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, pillX + padX, pillY + pillH / 2);
    }
    ctx.restore();
  },
};

// Walk the timestamp labels and emit one entry per first-point-of-each-day.
function collectDayStarts(labels) {
  const out = [];
  let prevKey = null;
  for (let i = 0; i < labels.length; i++) {
    const iso = labels[i];
    if (!iso) continue;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (key !== prevKey) {
      out.push({ index: i, date: d, key });
      prevKey = key;
    }
  }
  return out;
}

// Tooltip title — full date + time, since the X-axis only shows hour
// labels. A hover should always disambiguate the exact 10-minute reading
// (e.g. "Tue, May 5 · 5:20 PM").
function formatTooltipTitle(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const time = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${date} · ${time}`;
}

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
          boxWidth: 10,
          boxHeight: 10,
          padding: 10,
          color: t.text,
          // Bumped from 10 / regular → 12 / semibold so the axis title
          // ("Air Temperature (°C)" etc.) reads as a heading rather
          // than an afterthought.
          font: { size: 12, weight: '600' },
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
        callbacks: {
          title: (items) =>
            items.length ? formatTooltipTitle(items[0].label) : '',
          ...(unit
            ? {
                label: (ctx) =>
                  `${ctx.dataset.label}: ${ctx.parsed.y} ${unit}`,
              }
            : {}),
        },
      },
      // Day separators (alternating band + dashed line + date pill).
      // Picked up by `dayMarkerPlugin` registered on the chart instance.
      dayMarker: {
        enabled: true,
        band: t.dayBand,
        line: t.dayLine,
        pillBg: t.dayPillBg,
        pillFg: t.dayPillFg,
        maxPills: 14,
      },
    },
    scales: {
      x: {
        grid: { display: false },
        // Hide the per-point tick marks — labels alone (only at hour
        // boundaries via the callback below) communicate the time scale.
        ticks: {
          color: t.text,
          font: { size: 11, weight: '600' },
          callback: xLabelFormatter
            ? function (value, index) {
                const lbl = this.getLabelForValue(value);
                return xLabelFormatter(lbl, index);
              }
            : undefined,
          maxRotation: 0,
          // autoSkip is off so the callback is invoked for every 10-min
          // point; non-hour timestamps return '' and disappear cleanly.
          autoSkip: false,
        },
        border: { color: t.axis },
      },
      y: {
        beginAtZero: false,
        grid: { color: t.grid },
        ticks: { color: t.text, font: { size: 11, weight: '600' } },
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
  // Tab state lives in AttributeTablesContext so the Dashboard can also
  // react — collapsing the map when the user is in attributes mode and
  // restoring it on switch back.
  const { chartTab: tab, setChartTab: setTab } = useAttributeTables();
  const expanded = tab === 'attributes';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className={cn(
        'card-base flex flex-col',
        expanded ? 'flex-1 min-h-0' : 'shrink-0',
      )}
    >
      <Tabs tab={tab} onChange={setTab} />
      {/* In normal mode the body is fixed-height so map layout doesn't
          flicker during sub-tab switches. In attributes mode the body
          fills the rest of the column (the Dashboard collapses the
          map), giving the table room to breathe. */}
      <div
        className={cn(
          'flex flex-col',
          expanded
            ? 'flex-1 min-h-0'
            : 'h-[220px] sm:h-[236px] lg:h-[252px]',
        )}
      >
        {tab === 'attributes' ? (
          <LayerAttributesPanel />
        ) : tab === 'pmd' ? (
          <PmdTrendPanel theme={theme} />
        ) : (
          <LakesPanel theme={theme} />
        )}
      </div>
    </motion.div>
  );
}

function Tabs({ tab, onChange }) {
  const items = [
    { id: 'attributes', label: 'Attributes Table' },
    { id: 'pmd',        label: 'PMD Data Trend' },
    { id: 'lakes',      label: 'Lakes Trend' },
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
  // Three windows over the raw 10-minute readings — no aggregation:
  //   'daily'  → last 1 day
  //   'weekly' → last 7 days
  //   'custom' → last `customDays` days
  const [mode, setMode] = useState('daily');
  const [customDays, setCustomDays] = useState(14);
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const stationId = selectedStation?.stationId;
  const stationName = selectedStation?.stationName;
  const days =
    mode === 'daily'
      ? 1
      : mode === 'weekly'
        ? 7
        : Math.max(1, Math.min(365, Number(customDays) || 1));

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
    url.searchParams.set('days', String(days));
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
  }, [selected, stationId, days]);

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

  // Pick the axis granularity from the actual data span. Single-day
  // windows show hours; anything wider shows calendar days. This is
  // computed off the loaded points (not `days`) so a partial first-day
  // window still picks the right scale.
  const axisScale = useMemo(() => {
    if (points.length < 2) return days <= 1 ? 'hour' : 'day';
    const first = new Date(points[0].ts).getTime();
    const last = new Date(points[points.length - 1].ts).getTime();
    const totalHours = (last - first) / 3_600_000;
    return totalHours <= 30 ? 'hour' : 'day';
  }, [points, days]);

  // Stride: thin the labels so a wide window doesn't try to print 168
  // hour ticks (or 365 day ticks). Targets ~10–12 visible labels.
  const labelStep = useMemo(() => {
    if (points.length < 2) return 1;
    const first = new Date(points[0].ts).getTime();
    const last = new Date(points[points.length - 1].ts).getTime();
    if (axisScale === 'hour') {
      const totalHours = Math.max(1, (last - first) / 3_600_000);
      return Math.max(1, Math.ceil(totalHours / 12));
    }
    const totalDays = Math.max(1, (last - first) / 86_400_000);
    return Math.max(1, Math.ceil(totalDays / 8));
  }, [points, axisScale]);

  const xLabelFormatter = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    if (axisScale === 'hour') {
      // Only hour boundaries — every 10-min point in between returns ''.
      if (d.getMinutes() !== 0) return '';
      // Midnight is owned by the dayMarker plugin (vertical line + date
      // pill at the top of the chart), so we suppress it on the bottom
      // axis to keep the day boundary visually unambiguous.
      if (d.getHours() === 0) return '';
      const absHour = Math.floor(d.getTime() / 3_600_000);
      if (absHour % labelStep !== 0) return '';
      return d.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
    }
    // Day scale — label only midnight points, thinned by labelStep.
    if (d.getMinutes() !== 0 || d.getHours() !== 0) return '';
    const absDay = Math.floor(d.getTime() / 86_400_000);
    if (absDay % labelStep !== 0) return '';
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  };

  // Human-readable date range for the panel header — clarifies which
  // days the curve covers without relying on a single midnight tick.
  const dateRangeLabel = useMemo(() => {
    if (points.length === 0) return null;
    const first = new Date(points[0].ts);
    const last = new Date(points[points.length - 1].ts);
    if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) return null;
    const fmt = (d) =>
      d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return first.toDateString() === last.toDateString()
      ? fmt(first)
      : `${fmt(first)} → ${fmt(last)}`;
  }, [points]);

  // Dot sizing: big at the most-significant boundary for the scale, small
  // at the secondary boundary, and (on day-scale) hidden for 10-minute
  // in-between points so 1000+ dots don't drown the curve.
  const pointRadiusForCtx = (ctx) => {
    const lbl = ctx.chart?.data?.labels?.[ctx.dataIndex];
    if (!lbl) return 0;
    const d = new Date(lbl);
    if (Number.isNaN(d.getTime())) return 0;
    const isHour = d.getMinutes() === 0;
    const isMidnight = isHour && d.getHours() === 0;
    if (axisScale === 'hour') {
      return isHour ? 3.5 : 1.25;
    }
    if (isMidnight) return 4;
    if (isHour) return 1.5;
    return 0;
  };
  const pointHoverRadiusForCtx = (ctx) => {
    const lbl = ctx.chart?.data?.labels?.[ctx.dataIndex];
    if (!lbl) return 4;
    const d = new Date(lbl);
    if (Number.isNaN(d.getTime())) return 4;
    const isHour = d.getMinutes() === 0;
    const isMidnight = isHour && d.getHours() === 0;
    if (axisScale === 'hour') {
      return isHour ? 5.5 : 3;
    }
    if (isMidnight) return 6;
    if (isHour) return 3.5;
    return 2.5;
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
          pointRadius: pointRadiusForCtx,
          pointHoverRadius: pointHoverRadiusForCtx,
          borderWidth: 1.75,
          fill: true,
          tension: 0.3,
          spanGaps: true,
        },
      ],
    }),
    // Scriptable colors / radii close over `selected` + `theme` + `points`
    // via the helpers above; depending on the inputs is sufficient.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, selected, unit, theme],
  );

  const options = useMemo(
    () => buildOptions(theme, { unit, xLabelFormatter }),
    // xLabelFormatter closes over axisScale + labelStep — rebuild when
    // either changes so axis labels follow the active window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme, unit, axisScale, labelStep],
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
        {!empty && dateRangeLabel && (
          <span className="text-[11px] tabular-nums text-day-muted dark:text-night-muted px-1.5 py-0.5 rounded bg-day-bg dark:bg-night-bg border border-day-border dark:border-night-border">
            {dateRangeLabel}
          </span>
        )}
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
          <Line data={data} options={options} plugins={[dayMarkerPlugin]} />
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
  // Local string state lets the user temporarily clear the field while
  // typing without snapping back. We still commit on every valid
  // keystroke so the chart updates live; blur just cleans up an empty
  // / out-of-range draft.
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const tryCommit = (raw) => {
    const n = Math.floor(Number(raw));
    if (Number.isFinite(n) && n >= 1 && n <= 365) onChange(n);
  };

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
