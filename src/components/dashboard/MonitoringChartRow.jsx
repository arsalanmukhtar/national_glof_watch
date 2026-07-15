import { useEffect, useMemo, useRef, useState } from 'react';
import { Line } from 'react-chartjs-2';
import { Loader2 } from 'lucide-react';
import {
  brandGradient,
  buildOptions,
  dayMarkerPlugin,
  extremeMarkerPlugin,
  hexToRgba,
} from '@/components/dashboard/ChartsRow';
import { colorFor } from '@/config/parameterColors';
import { buildLegendGradient } from '@/config/parameterLegends';
import { useMonitoring } from '@/contexts/MonitoringContext';
import { useParameter } from '@/contexts/ParameterContext';
import { useTheme } from '@/hooks/useTheme';
import ParameterSelect from '@/components/ui/ParameterSelect';
import { cn } from '@/utils/cn';

// One row inside MonitoringChartsModal. Mirrors PmdTrendPanel's chart
// styling exactly (same plugins, same gradients, same axis rules) but
// with a self-contained header:
//   • cell letter badge (matches the grid's letter accent)
//   • parameter name (read from context; not editable here — the
//     operator picks parameters in the config panel)
//   • station picker — required to render a trend; defaults to the
//     first station in alphabetical order so the row paints something
//     the moment the modal opens.
//
// The time window (days) is passed in as a prop from the modal so
// every row in the grid shares the same span.
export default function MonitoringChartRow({ cellKey, days }) {
  const {
    cellParameters,
    selectedStations,
    setSelectedStation,
    registerChartApi,
  } = useMonitoring();
  const { elements } = useParameter();
  const { theme } = useTheme();

  // Ref onto the underlying Chart.js instance so the report generator
  // can grab the currently-rendered chart as a PNG. react-chartjs-2's
  // ref hands back the Chart.js instance which exposes toBase64Image().
  const chartRef = useRef(null);

  const elementName = cellParameters[cellKey] ?? '';
  const unit = elements.find((e) => e.name === elementName)?.unit ?? '';
  const accent = elementName ? colorFor(elementName) : '#94a3b8';

  // Roster of stations that carry this element — loaded off /latest so
  // the picker only offers stations that actually report the parameter.
  const [roster, setRoster] = useState([]);
  const [rosterLoading, setRosterLoading] = useState(false);

  useEffect(() => {
    if (!elementName) {
      setRoster([]);
      return undefined;
    }
    const ctrl = new AbortController();
    setRosterLoading(true);
    fetch(`/api/parameters/${encodeURIComponent(elementName)}/latest`, {
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        const list = (data?.features ?? [])
          .map((f) => f.properties)
          .filter((p) => p?.stationId != null)
          .map((p) => ({
            stationId: Number(p.stationId),
            stationName: p.stationName ?? `Station ${p.stationId}`,
          }))
          .sort((a, b) => a.stationName.localeCompare(b.stationName));
        setRoster(list);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          console.warn('[monitoring chart row] roster fetch failed:', err);
        }
      })
      .finally(() => setRosterLoading(false));
    return () => ctrl.abort();
  }, [elementName]);

  // Which station to plot. Priority:
  //   1. Whatever the operator clicked on the map (or picked here in
  //      the row's dropdown — same context field).
  //   2. First station alphabetically as a sensible auto-pick, so the
  //      chart isn't blank the moment the panel opens.
  // The auto-pick is NOT written back to context — writing would make
  // the map ripple appear on a station the operator didn't actually
  // choose, which would be misleading.
  const selected = selectedStations[cellKey];
  const stationId = selected?.stationId ?? roster[0]?.stationId ?? null;
  const stationName = selected?.stationName ?? roster[0]?.stationName ?? '';
  const isSelected = Boolean(selected);

  // Trend fetch — one series per (parameter, station, days) triple.
  // Deps intentionally granular so a station swap doesn't refetch the
  // roster, and a `days` change re-fetches only the trend.
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!elementName || !stationId) {
      setPoints([]);
      return undefined;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    const url = new URL(
      `/api/parameters/${encodeURIComponent(elementName)}/stations/${stationId}/trend`,
      window.location.origin,
    );
    url.searchParams.set('days', String(days));
    fetch(url.toString(), { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => setPoints(Array.isArray(data?.points) ? data.points : []))
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setError(err.message);
        setPoints([]);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [elementName, stationId, days]);

  // Axis / label / point-radius helpers — copied nearly verbatim from
  // PmdTrendPanel so the two chart surfaces read identically. Kept
  // inline (not extracted) because they close over `points` + `days`
  // and share nothing else with the rest of the modal.
  const axisScale = useMemo(() => {
    if (points.length < 2) return days <= 1 ? 'hour' : 'day';
    const first = new Date(points[0].ts).getTime();
    const last = new Date(points[points.length - 1].ts).getTime();
    const totalHours = (last - first) / 3_600_000;
    return totalHours <= 30 ? 'hour' : 'day';
  }, [points, days]);

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
      if (d.getMinutes() !== 0) return '';
      if (d.getHours() === 0) return '';
      const absHour = Math.floor(d.getTime() / 3_600_000);
      if (absHour % labelStep !== 0) return '';
      return d.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
    }
    if (d.getMinutes() !== 0 || d.getHours() !== 0) return '';
    const absDay = Math.floor(d.getTime() / 86_400_000);
    if (absDay % labelStep !== 0) return '';
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  };

  const pointRadiusForCtx = (ctx) => {
    const lbl = ctx.chart?.data?.labels?.[ctx.dataIndex];
    if (!lbl) return 0;
    const d = new Date(lbl);
    if (Number.isNaN(d.getTime())) return 0;
    const isHour = d.getMinutes() === 0;
    const isMidnight = isHour && d.getHours() === 0;
    if (axisScale === 'hour') return isHour ? 3.5 : 1.25;
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
    if (axisScale === 'hour') return isHour ? 5.5 : 3;
    if (isMidnight) return 6;
    if (isHour) return 3.5;
    return 2.5;
  };

  const fallbackLine = accent;
  const fillAlpha = theme === 'night' ? 0.22 : 0.14;
  const fallbackFill = hexToRgba(fallbackLine, fillAlpha);

  const lineGradient = (context) => {
    const { chart } = context;
    const { ctx, chartArea, scales } = chart;
    const g = buildLegendGradient(ctx, chartArea, scales?.y, elementName, 1);
    return g ?? brandGradient(ctx, chartArea, 1) ?? fallbackLine;
  };
  const fillGradient = (context) => {
    const { chart } = context;
    const { ctx, chartArea, scales } = chart;
    const g = buildLegendGradient(ctx, chartArea, scales?.y, elementName, fillAlpha);
    return g ?? brandGradient(ctx, chartArea, fillAlpha) ?? fallbackFill;
  };

  const dateRangeLabel = useMemo(() => {
    if (points.length === 0) return null;
    const first = new Date(points[0].ts);
    const last = new Date(points[points.length - 1].ts);
    if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) return null;
    const fmtShort = (d) =>
      d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const fmtFull = (d) =>
      d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    if (first.toDateString() === last.toDateString()) return fmtFull(first);
    if (first.getFullYear() !== last.getFullYear()) {
      return `${fmtFull(first)} → ${fmtFull(last)}`;
    }
    return `${fmtShort(first)} → ${fmtFull(last)}`;
  }, [points]);

  const data = useMemo(
    () => ({
      labels: points.map((p) => p.ts),
      datasets: [
        {
          label: elementName
            ? `${elementName}${unit ? ` (${unit})` : ''}`
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, elementName, unit, theme],
  );

  const options = useMemo(() => {
    const base = buildOptions(theme, { unit, xLabelFormatter });
    // Compact overrides for the panel: the row header already carries
    // the parameter name (in accent colour) and the extreme markers +
    // day pills work fine without a Chart.js legend, so hiding the
    // legend recovers ~30 px of vertical space per row — critical
    // when four rows have to fit without scrolling.
    return {
      ...base,
      plugins: {
        ...base.plugins,
        legend: { ...base.plugins.legend, display: false },
        // Trim the day-marker pills too so a compact row doesn't have
        // a giant pill floating over half the plot.
        dayMarker: { ...base.plugins.dayMarker, maxPills: 6 },
      },
      // Reduce axis-label footprint so the plot area stays legible on
      // a small canvas without truncating tick labels.
      scales: {
        ...base.scales,
        x: {
          ...base.scales.x,
          ticks: { ...base.scales.x.ticks, font: { size: 10, weight: '600' } },
        },
        y: {
          ...base.scales.y,
          ticks: { ...base.scales.y.ticks, font: { size: 10, weight: '600' } },
        },
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, unit, axisScale, labelStep]);

  const empty = !elementName;
  const noStation = !empty && !stationId && !rosterLoading;
  const noData = !empty && stationId != null && points.length === 0 && !loading;

  // Register this cell's chart API. Kept in a ref-based effect so
  // successive parameter / station changes don't spawn duplicate
  // registrations. `getData` returns a plain snapshot object the
  // PDF pipeline can persist without holding React state hostage.
  useEffect(() => {
    const api = {
      snapshot: () => {
        const chart = chartRef.current;
        if (!chart || typeof chart.toBase64Image !== 'function') return null;
        try {
          return chart.toBase64Image('image/png', 1);
        } catch (err) {
          console.warn('[monitoring chart] snapshot failed:', err);
          return null;
        }
      },
      getData: () => ({
        elementName,
        unit,
        stationId,
        stationName,
        points,
        days,
        isAutoPick: !isSelected,
        dateRangeLabel,
      }),
    };
    return registerChartApi(cellKey, api);
  }, [
    cellKey,
    registerChartApi,
    elementName,
    unit,
    stationId,
    stationName,
    points,
    days,
    isSelected,
    dateRangeLabel,
  ]);

  const handleStationChange = (name) => {
    if (!name) {
      // Empty pick = "clear selection". Pass null and let the context
      // clear the entry so the ripple + chart both fall back to auto.
      setSelectedStation(cellKey, null);
      return;
    }
    const found = roster.find((r) => r.stationName === name);
    if (!found) return;
    // Writing to context does double duty: the map re-runs its ripple
    // filter effect (yellow halo lands on this station), and the row
    // re-renders with `selected` populated so the chart follows.
    setSelectedStation(cellKey, found);
  };

  const stationOptions = useMemo(
    () =>
      roster.map((s) => ({
        name: s.stationName,
      })),
    [roster],
  );

  // No parameter yet → collapse the row into a single centered
  // stacked block (badge + heading + prompt). Rendering the normal
  // header on top pushes the empty message off-center; the
  // full-row-centered version reads as "this cell is idle" at a
  // glance instead of feeling like a broken layout.
  if (empty) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-2 rounded-md border border-day-border dark:border-night-border p-3 bg-white dark:bg-night-surface text-center">
        <span
          className="inline-flex items-center justify-center h-7 w-7 rounded-md text-[11px] font-bold uppercase text-white shadow-sm"
          style={{ backgroundColor: accent }}
          title={`Cell ${cellKey.toUpperCase()}`}
        >
          {cellKey.toUpperCase()}
        </span>
        <p className="text-[12px] font-semibold text-day-text dark:text-night-text">
          No parameter selected
        </p>
        <p className="text-[11.5px] text-day-muted dark:text-night-muted max-w-[280px]">
          Pick a parameter for cell {cellKey.toUpperCase()} in the config panel above.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-1.5 rounded-md border border-day-border dark:border-night-border p-2 bg-white dark:bg-night-surface">
      {/* Row header — hard split between a left group (badge + label,
          truncates) and a right group (date + AUTO + station picker).
          Uses `justify-between` on the outer flex so the two groups
          hug their respective edges regardless of what changes width
          inside them; the station picker's right edge stays flush
          with the row's inner right edge across all rows. */}
      <div className="flex items-center justify-between gap-1.5 w-full">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span
            className="inline-flex items-center justify-center h-5 w-5 shrink-0 rounded text-[9px] font-bold uppercase text-white shadow-sm"
            style={{ backgroundColor: accent }}
            title={`Cell ${cellKey.toUpperCase()}`}
          >
            {cellKey.toUpperCase()}
          </span>
          <span
            className="min-w-0 text-[11px] font-semibold truncate"
            style={{ color: elementName ? accent : undefined }}
            title={elementName || 'No parameter'}
          >
            {elementName || 'No parameter selected'}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {dateRangeLabel && !empty && stationId ? (
            <span
              className="text-[9px] tabular-nums text-day-muted dark:text-night-muted px-1 py-0.5 rounded bg-day-bg dark:bg-night-bg border border-day-border dark:border-night-border leading-none"
              title={dateRangeLabel}
            >
              {dateRangeLabel}
            </span>
          ) : null}
          {!isSelected && stationId ? (
            <span
              className="text-[8.5px] font-semibold uppercase tracking-wide px-1 py-0.5 rounded text-[#a16207] dark:text-[#facc15] border border-[#fde68a]/70 dark:border-[#facc15]/40 leading-none"
              title="Auto-picked station — click a dot on the map to pin a different one"
            >
              Auto
            </span>
          ) : null}
          {!empty && roster.length > 0 ? (
            <div className="w-[130px] shrink-0">
              <ParameterSelect
                value={stationName}
                onChange={handleStationChange}
                elements={stationOptions}
                placeholder="Pick station…"
                size="sm"
                accentColorFor={() => accent}
              />
            </div>
          ) : null}
        </div>
      </div>

      {/* Chart canvas — fills remaining row height so N rows split the
          panel body equally. Chart.js's `maintainAspectRatio: false`
          (set in buildOptions) lets the canvas track any container
          height, and `Line` reads its parent's rect for the redraw.
          The `empty` branch is handled by the short-circuit above; only
          the roster / station / data branches are reachable here. */}
      <div className="flex-1 min-h-0">
        {rosterLoading && roster.length === 0 ? (
          <LoaderState>Loading stations…</LoaderState>
        ) : noStation ? (
          <EmptyState>
            No stations report <strong>{elementName}</strong> right now.
          </EmptyState>
        ) : noData ? (
          <EmptyState>
            No readings for <strong>{stationName}</strong> in the selected window.
          </EmptyState>
        ) : loading && points.length === 0 ? (
          <LoaderState>Loading trend…</LoaderState>
        ) : (
          <Line
            ref={chartRef}
            data={data}
            options={options}
            plugins={[dayMarkerPlugin, extremeMarkerPlugin]}
          />
        )}
      </div>
      {error ? (
        <p className="text-[11.5px] text-red-600 dark:text-red-400">{error}</p>
      ) : null}
    </div>
  );
}

function EmptyState({ children }) {
  return (
    <div className={cn('h-full flex items-center justify-center text-center px-3')}>
      <p className="text-[12.5px] text-day-muted dark:text-night-muted">
        {children}
      </p>
    </div>
  );
}

function LoaderState({ children }) {
  return (
    <div className="h-full flex items-center justify-center gap-1.5 text-[12.5px] text-day-muted dark:text-night-muted">
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      <span>{children}</span>
    </div>
  );
}
