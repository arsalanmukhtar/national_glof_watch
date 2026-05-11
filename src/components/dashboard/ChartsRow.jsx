import { useEffect, useMemo, useRef, useState } from 'react';
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
import { Bar, Line } from 'react-chartjs-2';
import LayerAttributesPanel from '@/components/dashboard/LayerAttributesPanel';
import FeatureDetailsPanel from '@/components/dashboard/FeatureDetailsPanel';
import {
  lakeAreaData,
  chartYears as lakeChartYears,
} from '@/config/lakeAreaVolume';
import { useTheme } from '@/hooks/useTheme';
import { useParameter } from '@/contexts/ParameterContext';
import { useAttributeTables } from '@/contexts/AttributeTablesContext';
import { useCsvDatasets } from '@/contexts/CsvDatasetsContext';
import { applyFilters } from '@/utils/csvParser';
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
      ctx.font = '600 11px Inter, system-ui, sans-serif';
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

// ---------------------------------------------------------------------------
// extremeMarkerPlugin — paints a pulsing ring on the dataset's extreme
// low and high values so they jump out of the curve regardless of zoom
// level or window size. Two distinct accents:
//   • low  — red     #dc2626 (alarm)
//   • high — emerald #10b981 (positive-extreme; distinct from the line)
//
// The pulse animation is driven by a per-chart `requestAnimationFrame`
// loop. Critical: the loop only starts AFTER the chart's built-in line
// animation finishes — see `animation.onComplete` in `buildOptions`. If
// we started it earlier the dots would render on top of a half-drawn
// curve right after a feature click, which looked wrong. On every
// `chart.update()` (e.g. new feature → new dataset) the `beforeUpdate`
// hook tears the loop down so the dots disappear, and they only return
// once the new line animation completes.
//
// Configured via `options.plugins.extremeMarker`:
//   { enabled, lowColor, highColor, periodMs, baseRadius, growRadius, dotRadius }
// ---------------------------------------------------------------------------
const extremeMarkerPlugin = {
  id: 'extremeMarker',
  beforeUpdate(chart, _args, opts) {
    if (!opts?.enabled) return;
    // New data is about to render: hide the markers and stop the pulse
    // until the upcoming line animation completes (re-armed by the
    // chart's `animation.onComplete`).
    chart._extremeReady = false;
    if (chart._extremeRaf) {
      cancelAnimationFrame(chart._extremeRaf);
      chart._extremeRaf = null;
    }
  },
  afterDestroy(chart) {
    if (chart._extremeRaf) {
      cancelAnimationFrame(chart._extremeRaf);
      chart._extremeRaf = null;
    }
  },
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts?.enabled || !chart._extremeReady) return;
    const { ctx, chartArea, scales, data } = chart;
    if (!chartArea || !scales?.x || !scales?.y) return;
    const indices = getExtremeIndices(chart);
    if (!indices) return;
    const { minIdx, maxIdx } = indices;
    const values = data.datasets[0].data;

    const periodMs = opts.periodMs ?? 1500;
    const baseR = opts.baseRadius ?? 6;
    const growR = opts.growRadius ?? 12;
    const dotR = opts.dotRadius ?? 3.5;
    const start = chart._extremeStart ?? performance.now();
    // Phase loops 0 → 1 over `periodMs`; reset back to 0 = ring restarts.
    const phase = ((performance.now() - start) % periodMs) / periodMs;
    const ringR = baseR + growR * phase;
    const ringAlpha = 0.75 * (1 - phase);

    const drawMarker = (idx, color) => {
      const v = values[idx];
      const x = scales.x.getPixelForValue(idx);
      const y = scales.y.getPixelForValue(v);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      // Clip to the plotting area so a ring at the data-edge doesn't
      // bleed into the legend / axis labels.
      ctx.save();
      ctx.beginPath();
      ctx.rect(
        chartArea.left,
        chartArea.top,
        chartArea.right - chartArea.left,
        chartArea.bottom - chartArea.top,
      );
      ctx.clip();

      // Expanding ring (radar-style pulse).
      ctx.beginPath();
      ctx.arc(x, y, ringR, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.globalAlpha = ringAlpha;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Solid dot in the centre — opaque so the marker is still
      // findable when the ring has fully faded mid-cycle.
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(x, y, dotR, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      // Hairline so the dot reads against any line / fill colour
      // underneath it.
      ctx.beginPath();
      ctx.arc(x, y, dotR, 0, Math.PI * 2);
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 0.75;
      ctx.stroke();

      ctx.restore();
    };

    drawMarker(minIdx, opts.lowColor ?? '#dc2626');
    drawMarker(maxIdx, opts.highColor ?? '#10b981');
  },
};

// Cached min/max indices for the chart's first dataset. Both the
// pulsing-ring plugin and the tooltip helpers below need this; computing
// it once per dataset reference keeps the tooltip path cheap on hover.
function getExtremeIndices(chart) {
  const values = chart?.data?.datasets?.[0]?.data;
  if (!Array.isArray(values) || values.length === 0) return null;
  const cache = chart._extremeCache;
  if (cache && cache.values === values) return cache.indices;
  let minIdx = -1;
  let maxIdx = -1;
  let minVal = Infinity;
  let maxVal = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null || !Number.isFinite(v)) continue;
    if (v < minVal) { minVal = v; minIdx = i; }
    if (v > maxVal) { maxVal = v; maxIdx = i; }
  }
  const indices = minIdx < 0 || maxIdx < 0 ? null : { minIdx, maxIdx };
  chart._extremeCache = { values, indices };
  return indices;
}

// Tooltip-side helpers — used by both PmdTrendPanel and LakesPanel so
// hovering an extreme point gives a clearly distinctive tooltip:
//   • a tag line above the date — "↓ Lowest" / "↑ Highest"
//   • coloured value text matching the marker
//   • coloured tooltip border matching the marker
const EXTREME_LOW_HEX = '#dc2626';
const EXTREME_HIGH_HEX = '#10b981';
const EXTREME_LOW_TEXT = '#fca5a5';   // softer red on dark tooltip bg
const EXTREME_HIGH_TEXT = '#6ee7b7';  // softer emerald on dark tooltip bg

function extremeKindForItem(item) {
  if (!item || !item.chart) return null;
  const ix = getExtremeIndices(item.chart);
  if (!ix) return null;
  if (item.dataIndex === ix.minIdx) return 'low';
  if (item.dataIndex === ix.maxIdx) return 'high';
  return null;
}

function extremeKindForCtx(ctx) {
  const item = ctx?.tooltip?.dataPoints?.[0];
  return item ? extremeKindForItem(item) : null;
}

function extremeTooltipBorderColor(ctx, fallback) {
  const kind = extremeKindForCtx(ctx);
  if (kind === 'low') return EXTREME_LOW_HEX;
  if (kind === 'high') return EXTREME_HIGH_HEX;
  return fallback;
}

function extremeTooltipBorderWidth(ctx) {
  return extremeKindForCtx(ctx) ? 1.5 : 1;
}

function extremeTooltipTitleTag(item) {
  const kind = extremeKindForItem(item);
  if (kind === 'low') return '↓ Lowest';
  if (kind === 'high') return '↑ Highest';
  return null;
}

function extremeTooltipLabelColor(item, fallback) {
  const kind = extremeKindForItem(item);
  if (kind === 'low') return EXTREME_LOW_TEXT;
  if (kind === 'high') return EXTREME_HIGH_TEXT;
  return fallback;
}

// Chart.js `animation.onComplete` handler shared by every chart that
// uses extremeMarkerPlugin. Marks the chart "ready" (so the plugin's
// `afterDatasetsDraw` will start painting markers) and arms the pulse
// RAF loop. The early return prevents the pulse phase from being reset
// on incidental animation events (hover, resize) — only the first
// completion after a `beforeUpdate` re-arm restarts the timer.
function extremeMarkerOnComplete() {
  const chart = this;
  if (!chart || chart.destroyed) return;
  if (chart._extremeReady) return;
  chart._extremeReady = true;
  chart._extremeStart = performance.now();
  if (chart._extremeRaf) return;
  const tick = () => {
    if (!chart.canvas || chart.destroyed) return;
    chart.draw();
    chart._extremeRaf = requestAnimationFrame(tick);
  };
  chart._extremeRaf = requestAnimationFrame(tick);
}

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
    animation: {
      // Gate the extremeMarkerPlugin's pulse on the chart's intro
      // animation. The plugin clears `_extremeReady` in `beforeUpdate`;
      // here we set it back to true once Chart.js says all animations
      // have finished, then kick off the per-frame redraw loop that
      // drives the pulsing ring. Without this, the dots flash on top
      // of an only-half-drawn curve right after a feature click.
      onComplete: extremeMarkerOnComplete,
    },
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
          font: { size: 13, weight: '600' },
          usePointStyle: true,
        },
      },
      tooltip: {
        backgroundColor: t.tooltipBg,
        titleColor: t.tooltipFg,
        bodyColor: t.tooltipFg,
        // Border + width are scriptable so the tooltip flips to the
        // marker colour (red for low, emerald for high) when hovering
        // an extreme point — same visual cue as the pulsing ring.
        borderColor: (ctx) => extremeTooltipBorderColor(ctx, t.axis),
        borderWidth: (ctx) => extremeTooltipBorderWidth(ctx),
        padding: 8,
        cornerRadius: 6,
        titleFont: { size: 11, weight: '600' },
        bodyFont: { size: 11 },
        callbacks: {
          title: (items) => {
            if (!items.length) return '';
            const item = items[0];
            const base = formatTooltipTitle(item.label);
            const tag = extremeTooltipTitleTag(item);
            // Returning an array makes Chart.js render two title lines
            // (tag above the date) — keeps the badge visually obvious
            // without crowding the body.
            return tag ? [tag, base] : base;
          },
          labelTextColor: (item) =>
            extremeTooltipLabelColor(item, t.tooltipFg),
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
      // Extreme-low / extreme-high pulsing markers — picked up by
      // `extremeMarkerPlugin`. Red for the low, emerald for the high
      // so the two flags are clearly distinguishable across whatever
      // gradient the line itself is using.
      extremeMarker: {
        enabled: true,
        lowColor: '#dc2626',
        highColor: '#10b981',
        periodMs: 1500,
      },
    },
    scales: {
      x: {
        grid: { display: false },
        // Hide the per-point tick marks — labels alone (only at hour
        // boundaries via the callback below) communicate the time scale.
        ticks: {
          color: t.text,
          font: { size: 12, weight: '600' },
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
        ticks: { color: t.text, font: { size: 12, weight: '600' } },
        border: { color: t.axis },
      },
    },
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
        ) : tab === 'lakes' ? (
          <LakesPanel theme={theme} />
        ) : tab === 'lakesArea' ? (
          <LakesAreaPanel theme={theme} />
        ) : (
          <FeatureDetailsPanel />
        )}
      </div>
    </motion.div>
  );
}

function Tabs({ tab, onChange }) {
  const items = [
    { id: 'attributes', label: 'Attributes Table' },
    { id: 'pmd',        label: 'PMD Data Trend' },
    { id: 'lakes',      label: 'CSV Trend' },
    { id: 'feature',    label: 'Feature Details' },
    { id: 'lakesArea',  label: 'Lakes Area' },
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
              'relative px-3 py-1.5 text-[13px] font-medium transition-colors',
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
  // Cap at the 30-day ceiling enforced below so the default doesn't
  // sit above the input's max — also matches what the user sees as
  // "Past N days" in the UI.
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
        : Math.max(1, Math.min(30, Number(customDays) || 1));

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
          <span className="text-[12px] tabular-nums text-day-muted dark:text-night-muted px-1.5 py-0.5 rounded bg-day-bg dark:bg-night-bg border border-day-border dark:border-night-border">
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
          <Line
            data={data}
            options={options}
            plugins={[dayMarkerPlugin, extremeMarkerPlugin]}
          />
        )}
        {error && (
          <p className="mt-1 text-[11.5px] text-red-600 dark:text-red-400">
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
              'relative px-2.5 py-1 text-[12px] font-medium rounded transition-colors',
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

  // Custom window is capped at 30 days — matches the input's max + the
  // PmdTrendPanel's `Math.min(30, …)` clamp. Anything bigger gets
  // rejected at commit so a stale draft doesn't fire a 90-day fetch.
  const tryCommit = (raw) => {
    const n = Math.floor(Number(raw));
    if (Number.isFinite(n) && n >= 1 && n <= 30) onChange(n);
  };

  const commit = () => {
    const n = Math.floor(Number(draft));
    if (Number.isFinite(n) && n >= 1 && n <= 30) {
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
          'inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium',
          'text-day-muted dark:text-night-muted',
        )}
      >
        <span>Past</span>
        <input
          type="number"
          min={1}
          max={30}
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
      <p className="text-[12.5px] text-day-muted dark:text-night-muted">
        {children}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lakes Trend tab — bound to the active CSV dataset from
// `CsvDatasetsContext`. Renders a single line chart whose X / Y come
// straight off `dataset.chartConfig`. Filters from the side panel are
// applied here too so the chart and the panel preview always match.
// ---------------------------------------------------------------------------

function LakesPanel({ theme }) {
  const { activeDataset } = useCsvDatasets();
  const t = TOKENS[theme];

  const { labels, values, xLabel, yLabel } = useMemo(() => {
    if (!activeDataset)
      return { labels: [], values: [], xLabel: '', yLabel: '' };
    const { chartConfig, rows, filters } = activeDataset;
    const xLabel = chartConfig?.x ?? '';
    const yLabel = chartConfig?.y ?? '';
    if (!xLabel || !yLabel) {
      return { labels: [], values: [], xLabel, yLabel };
    }
    const filtered = applyFilters(rows, filters);
    const out = { labels: [], values: [] };
    for (const row of filtered) {
      const yRaw = row[yLabel];
      const y =
        typeof yRaw === 'number' ? yRaw : Number(yRaw);
      if (!Number.isFinite(y)) continue;
      const xRaw = row[xLabel];
      out.labels.push(xRaw == null ? '' : String(xRaw));
      out.values.push(y);
    }
    return { ...out, xLabel, yLabel };
  }, [activeDataset]);

  const data = useMemo(
    () => ({
      labels,
      datasets: [
        {
          label: yLabel || 'Series',
          data: values,
          borderColor: '#16a085',
          backgroundColor:
            theme === 'night'
              ? 'rgba(22, 160, 133, 0.22)'
              : 'rgba(22, 160, 133, 0.14)',
          pointBackgroundColor: '#16a085',
          pointBorderColor: '#16a085',
          pointRadius: values.length > 200 ? 0 : 3,
          pointHoverRadius: 5,
          borderWidth: 1.75,
          fill: true,
          tension: 0.3,
          spanGaps: true,
        },
      ],
    }),
    [labels, values, yLabel, theme],
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: {
        // Same gating as PmdTrendPanel — wait for the line animation
        // to finish before showing extreme markers.
        onComplete: extremeMarkerOnComplete,
      },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            boxWidth: 10,
            boxHeight: 10,
            padding: 10,
            color: t.text,
            font: { size: 13, weight: '600' },
            usePointStyle: true,
          },
        },
        tooltip: {
          backgroundColor: t.tooltipBg,
          titleColor: t.tooltipFg,
          bodyColor: t.tooltipFg,
          // Same extreme-aware tooltip as PmdTrendPanel — border flips
          // to the marker colour and the title gains a "↓ Lowest" /
          // "↑ Highest" tag line on the relevant data point.
          borderColor: (ctx) => extremeTooltipBorderColor(ctx, t.axis),
          borderWidth: (ctx) => extremeTooltipBorderWidth(ctx),
          padding: 8,
          cornerRadius: 6,
          titleFont: { size: 11, weight: '600' },
          bodyFont: { size: 11 },
          callbacks: {
            title: (items) => {
              if (!items.length) return '';
              const item = items[0];
              const tag = extremeTooltipTitleTag(item);
              return tag ? [tag, String(item.label ?? '')] : String(item.label ?? '');
            },
            labelTextColor: (item) =>
              extremeTooltipLabelColor(item, t.tooltipFg),
          },
        },
        // Day separator plugin is intentionally disabled here — X-axis
        // categories on a generic CSV aren't necessarily ISO timestamps.
        dayMarker: { enabled: false },
        // Same red/emerald extreme markers as the PMD trend so the user
        // gets a consistent visual cue across both chart families.
        extremeMarker: {
          enabled: true,
          lowColor: '#dc2626',
          highColor: '#10b981',
          periodMs: 1500,
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: t.text,
            font: { size: 12, weight: '600' },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 12,
          },
          title: xLabel
            ? {
                display: true,
                text: xLabel,
                color: t.text,
                font: { size: 12, weight: '600' },
              }
            : undefined,
          border: { color: t.axis },
        },
        y: {
          beginAtZero: false,
          grid: { color: t.grid },
          ticks: { color: t.text, font: { size: 12, weight: '600' } },
          title: yLabel
            ? {
                display: true,
                text: yLabel,
                color: t.text,
                font: { size: 12, weight: '600' },
              }
            : undefined,
          border: { color: t.axis },
        },
      },
    }),
    [t, xLabel, yLabel],
  );

  if (!activeDataset) {
    return (
      <div className="p-3 h-full">
        <EmptyState>
          Add a CSV from the side panel to plot it here.
        </EmptyState>
      </div>
    );
  }
  if (!xLabel || !yLabel) {
    return (
      <div className="p-3 h-full">
        <EmptyState>
          Pick an X and Y column in the CSV panel to render the chart.
        </EmptyState>
      </div>
    );
  }
  if (values.length === 0) {
    return (
      <div className="p-3 h-full">
        <EmptyState>
          No numeric values found in <strong>{yLabel}</strong> after
          filtering.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="p-3 flex flex-col gap-2 h-full min-h-0">
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <h3 className="text-sm font-semibold text-day-text dark:text-night-text truncate">
          {activeDataset.name}
        </h3>
        <span className="text-[12px] tabular-nums text-day-muted dark:text-night-muted px-1.5 py-0.5 rounded bg-day-bg dark:bg-night-bg border border-day-border dark:border-night-border">
          {values.length.toLocaleString()} pts
        </span>
        <span className="text-[12px] text-day-muted dark:text-night-muted">
          {xLabel} → {yLabel}
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <Line
          data={data}
          options={options}
          plugins={[extremeMarkerPlugin]}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lakes Area tab — paired view of every glacial lake's area + volume over
// 2020 → 2025. The dataset ships statically as `@/config/lakeAreaVolume`
// because it's the consolidated published reference set; refreshing it
// is a code change, not user input.
//
// Left chart  : multi-line area trend (m²)
// Right chart : grouped bar volume comparison (m³)
//
// Colours are assigned per lake from a curated 12-step palette so a lake
// reads as the same colour in both charts — click a legend chip in
// either chart and the corresponding line / bar set hides on that chart.
// ---------------------------------------------------------------------------

// Curated 12-step palette. Each tone is distinguishable from the next,
// has decent contrast on both light and dark surface backgrounds, and
// avoids two adjacent entries reading as "the same colour" on a small
// chart canvas — important here because the legend is dense.
const LAKE_COLORS = [
  '#2563eb', // blue-600
  '#dc2626', // red-600
  '#16a34a', // green-600
  '#ea580c', // orange-600
  '#7c3aed', // violet-600
  '#0891b2', // cyan-600
  '#db2777', // pink-600
  '#65a30d', // lime-600
  '#c026d3', // fuchsia-600
  '#d97706', // amber-600
  '#0ea5e9', // sky-500
  '#4f46e5', // indigo-600
];

// Compact y-axis formatter — values run from ~10³ (m²) up to ~10⁷ (m³)
// so abbreviating keeps the axis readable on a small chart.
function fmtCompact(n) {
  if (n == null || !Number.isFinite(Number(n))) return '';
  const v = Number(n);
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`;
  return String(v);
}

function LakesAreaPanel({ theme }) {
  const t = TOKENS[theme];

  // One DOM-node ref per chart for the external HTML tooltip. Canvas
  // tooltips get clipped by the canvas bounds, so 12 lakes' worth of
  // rows overflow the bottom of a small chart. Rendering the tooltip
  // as an absolutely-positioned div inside the chart frame lifts that
  // restriction — and lets us flow the body into multiple columns.
  const areaTooltipRef = useRef(null);
  const volumeTooltipRef = useRef(null);

  // One dataset per lake, paired across both charts so the legend chips
  // line up and clicking either chart's legend toggles the same lake.
  const areaData = useMemo(
    () => ({
      labels: lakeChartYears,
      datasets: lakeAreaData.map((lake, i) => {
        const c = LAKE_COLORS[i % LAKE_COLORS.length];
        return {
          label: lake.name,
          data: lake.area,
          borderColor: c,
          backgroundColor: c,
          pointBackgroundColor: c,
          pointBorderColor: c,
          pointRadius: 3,
          pointHoverRadius: 5,
          borderWidth: 1.75,
          tension: 0.3,
          fill: false,
          spanGaps: true,
          // Stash for tooltip / legend metadata
          _district: lake.district,
        };
      }),
    }),
    [],
  );

  const volumeData = useMemo(
    () => ({
      labels: lakeChartYears,
      datasets: lakeAreaData.map((lake, i) => {
        const c = LAKE_COLORS[i % LAKE_COLORS.length];
        return {
          label: lake.name,
          data: lake.volume,
          backgroundColor: c,
          borderColor: c,
          borderWidth: 0,
          borderRadius: 2,
          // Rounded bars look better at the small heights we have here
          // and the borderRadius keeps the bar tops from merging into
          // the next-year group when the values are close.
          _district: lake.district,
        };
      }),
    }),
    [],
  );

  const areaOptions = useMemo(
    () =>
      buildLakesAreaOptions(t, {
        yTitle: 'Area (m²)',
        unit: 'm²',
        getTooltipEl: () => areaTooltipRef.current,
      }),
    [t],
  );
  const volumeOptions = useMemo(
    () =>
      buildLakesAreaOptions(t, {
        yTitle: 'Volume (m³)',
        unit: 'm³',
        getTooltipEl: () => volumeTooltipRef.current,
      }),
    [t],
  );

  return (
    <div className="p-3 flex flex-col gap-2 h-full min-h-0">
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <h3 className="text-sm font-semibold text-day-text dark:text-night-text">
          Glacial Lake Trends
        </h3>
        <span className="text-[12px] tabular-nums text-day-muted dark:text-night-muted px-1.5 py-0.5 rounded bg-day-bg dark:bg-night-bg border border-day-border dark:border-night-border">
          {lakeChartYears[0]} → {lakeChartYears[lakeChartYears.length - 1]}
        </span>
        <span className="text-[12px] tabular-nums text-day-muted dark:text-night-muted px-1.5 py-0.5 rounded bg-day-bg dark:bg-night-bg border border-day-border dark:border-night-border">
          {lakeAreaData.length} lakes
        </span>
      </div>
      {/* Side-by-side at lg; stacked on narrow viewports so the bars
          don't collapse into illegible slivers. */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-3">
        <LakesAreaChartFrame title="Area" tooltipRef={areaTooltipRef}>
          <Line data={areaData} options={areaOptions} />
        </LakesAreaChartFrame>
        <LakesAreaChartFrame title="Volume" tooltipRef={volumeTooltipRef}>
          <Bar data={volumeData} options={volumeOptions} />
        </LakesAreaChartFrame>
      </div>
    </div>
  );
}

function LakesAreaChartFrame({ title, tooltipRef, children }) {
  return (
    <div className="flex flex-col min-h-0 gap-1">
      <span className="text-[11px] uppercase font-semibold tracking-[0.08em] text-day-muted dark:text-night-muted px-0.5">
        {title}
      </span>
      {/* `relative` is the positioning context for the external HTML
          tooltip below. The chart canvas fills the frame; the tooltip
          floats over it as an absolutely-positioned div that the
          tooltip handler updates in place. */}
      <div className="flex-1 min-h-0 relative">
        {children}
        <div
          ref={tooltipRef}
          className={cn(
            'pointer-events-none absolute top-0 left-0 z-10 opacity-0',
            'rounded-md px-2.5 py-2 shadow-lg',
            'bg-[#0f172a]/95 dark:bg-[#1e272e]/95 text-[#f8fafc]',
            'border border-day-border/30 dark:border-night-border/30',
            'transition-opacity duration-100',
          )}
          style={{ willChange: 'transform, opacity' }}
          aria-hidden
        />
      </div>
    </div>
  );
}

// Shared option builder for the Lakes Area tab — themed tokens come in
// once so both charts get identical typography / grid / tooltip styling.
// `getTooltipEl` returns the absolutely-positioned div the external
// tooltip handler renders into, captured via closure from the React ref.
function buildLakesAreaOptions(t, { yTitle, unit, getTooltipEl }) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    // `nearest` + `intersect: false` means the cursor only ever picks
    // a single dataset — the one closest to the pointer — instead of
    // grouping every series at the hovered x. The tooltip then becomes
    // a focused, single-value card for that exact lake / year point or
    // bar, which reads more cleanly than a 12-row index dump.
    interaction: { mode: 'nearest', intersect: false, axis: 'xy' },
    plugins: {
      legend: {
        position: 'bottom',
        align: 'center',
        labels: {
          boxWidth: 8,
          boxHeight: 8,
          padding: 6,
          color: t.text,
          font: { size: 10, weight: '600' },
          usePointStyle: true,
        },
      },
      // Canvas tooltip is off — the external handler below paints a
      // professionally-styled HTML card so we can render multi-line
      // detail (district + lake + value + year-over-year change) and
      // position it without being clipped by the canvas bounds.
      tooltip: {
        enabled: false,
        mode: 'nearest',
        intersect: false,
        external: (context) =>
          renderLakesAreaTooltip(context, getTooltipEl, { unit }),
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: t.text, font: { size: 11, weight: '600' } },
        border: { color: t.axis },
      },
      y: {
        beginAtZero: true,
        grid: { color: t.grid },
        ticks: {
          color: t.text,
          font: { size: 10, weight: '600' },
          callback: (v) => fmtCompact(v),
        },
        title: {
          display: true,
          text: yTitle,
          color: t.text,
          font: { size: 11, weight: '600' },
        },
        border: { color: t.axis },
      },
    },
  };
}

// External HTML tooltip handler. Renders a single-point detail card —
// the user hovers a specific line vertex or bar and the tooltip shows
// that lake's value for that year, plus the year-over-year delta when
// a previous reading exists. Floats above the canvas inside the same
// `relative` wrapper and is auto-flipped horizontally + clamped
// vertically so it never escapes the chart frame's bounds.
function renderLakesAreaTooltip(context, getTooltipEl, { unit }) {
  const el = getTooltipEl?.();
  if (!el) return;
  const { chart, tooltip } = context;

  // Hide path: opacity 0 (kept positioned so the fade-out reads
  // naturally; the next hover overwrites the transform anyway).
  if (!tooltip || tooltip.opacity === 0 || !tooltip.dataPoints?.length) {
    el.style.opacity = '0';
    return;
  }

  // With `interaction.mode: 'nearest'` the first dataPoint IS the
  // single closest item to the cursor — that's the lake we paint.
  const dp = tooltip.dataPoints[0];
  const ds = chart.data?.datasets?.[dp.datasetIndex];
  const labels = chart.data?.labels || [];
  const color = dp.dataset?.borderColor || dp.dataset?.backgroundColor || '#16a085';
  const district = ds?._district ?? '';
  const lake = ds?.label ?? '';
  const year = String(labels[dp.dataIndex] ?? '');
  const value = dp.parsed?.y;

  // Year-over-year delta — only render when a previous year exists
  // AND both values are finite. Computed off the live dataset rather
  // than the formatted tooltip body so we have the raw numbers.
  let deltaHtml = '';
  const dataArr = ds?.data || [];
  const prev = dp.dataIndex > 0 ? dataArr[dp.dataIndex - 1] : null;
  if (
    prev != null &&
    Number.isFinite(Number(prev)) &&
    Number.isFinite(Number(value)) &&
    Number(prev) !== 0
  ) {
    const pct = ((Number(value) - Number(prev)) / Number(prev)) * 100;
    const up = pct >= 0;
    const arrow = up ? '▲' : '▼';
    // Emerald for growth, red for shrink — keeps the cue colour-blind
    // friendly by also flipping the arrow direction.
    const tint = up ? '#10b981' : '#ef4444';
    deltaHtml =
      `<div style="display:flex;align-items:center;gap:4px;font-size:10.5px;color:${tint};font-weight:600;">` +
        `<span>${arrow}</span>` +
        `<span style="font-variant-numeric:tabular-nums;">${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%</span>` +
        `<span style="opacity:0.7;color:#94a3b8;font-weight:500;">vs ${escapeHtml(String(labels[dp.dataIndex - 1] ?? ''))}</span>` +
      `</div>`;
  }

  const valueStr =
    value == null || !Number.isFinite(value)
      ? '—'
      : `${value.toLocaleString()} ${unit}`;

  // Card layout:
  //   ┌──────────────────────────────┐
  //   │ ● DISTRICT                    │
  //   │   Lake Name                   │
  //   ├──────────────────────────────┤
  //   │ Year   2024                   │
  //   │ {unit} 824,500 m²             │
  //   │ ▲ +1.2% vs 2023               │
  //   └──────────────────────────────┘
  el.innerHTML =
    `<div style="display:flex;align-items:center;gap:8px;min-width:0;">` +
      `<span style="display:inline-block;width:9px;height:9px;border-radius:9999px;background:${color};flex-shrink:0;box-shadow:0 0 0 2px rgba(255,255,255,0.06);"></span>` +
      `<div style="display:flex;flex-direction:column;min-width:0;">` +
        (district
          ? `<span style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.7;">${escapeHtml(district)}</span>`
          : '') +
        `<span style="font-size:13px;font-weight:600;line-height:1.2;white-space:nowrap;">${escapeHtml(lake)}</span>` +
      `</div>` +
    `</div>` +
    `<div style="margin:6px 0;height:1px;background:rgba(255,255,255,0.12);"></div>` +
    `<div style="display:grid;grid-template-columns:auto 1fr;column-gap:10px;row-gap:2px;font-size:11.5px;">` +
      `<span style="opacity:0.7;">Year</span>` +
      `<span style="font-variant-numeric:tabular-nums;font-weight:600;text-align:right;">${escapeHtml(year)}</span>` +
      `<span style="opacity:0.7;">${escapeHtml(unit === 'm²' ? 'Area' : 'Volume')}</span>` +
      `<span style="font-variant-numeric:tabular-nums;font-weight:600;text-align:right;white-space:nowrap;">${escapeHtml(valueStr)}</span>` +
    `</div>` +
    (deltaHtml ? `<div style="margin-top:4px;">${deltaHtml}</div>` : '');

  // Positioning — caret coords from Chart.js are relative to the
  // canvas, which fills the parent .relative wrapper. Flip horizontally
  // when the tooltip would overflow on the right; clamp vertically so
  // the card never escapes the frame on either axis.
  const canvas = chart.canvas;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;

  let x = tooltip.caretX + 14;
  if (x + w > cw) x = tooltip.caretX - w - 14;
  if (x < 0) x = Math.max(0, cw - w);

  let y = tooltip.caretY - h / 2;
  if (y + h > ch) y = ch - h;
  if (y < 0) y = 0;

  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.opacity = '1';
}

// Minimal HTML escape — we only feed it strings out of our static data
// and Chart.js metadata, but escaping defends against any future feed
// that might carry punctuation Chart.js's `formattedValue` doesn't sanitise.
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
