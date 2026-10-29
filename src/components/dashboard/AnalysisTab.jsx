import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import {
  ArrowDownRight,
  ArrowUpRight,
  Cloud,
  Download,
  Info,
  Minus,
} from 'lucide-react';
import { useAnalysis } from '@/contexts/AnalysisContext';
import { useTheme } from '@/hooks/useTheme';
import { TOKENS } from '@/components/dashboard/ChartsRow';
import { cn } from '@/utils/cn';

// ---------------------------------------------------------------------------
// AnalysisTab — the 5th tab in ChartsRow.
//
// Renders the results of the most recent Sentinel-2 index analysis:
//   • Scene metadata per period (date, cloud cover, scene id).
//   • Stat table: count, mean, min/max, std, median, p10/p90 for A,
//     B, and delta.
//   • 20-bin histogram (Chart.js Bar) — delta by default, A + B in
//     side-by-side mode when compare is on.
//   • COG download links.
// ---------------------------------------------------------------------------

const INDEX_COLOR = {
  NDVI: '#22c55e', // green-500
  NDWI: '#0ea5e9', // sky-500
  NDBI: '#f97316', // orange-500
  NDSI: '#e879f9', // fuchsia-400
};

export default function AnalysisTab() {
  const { results, status, error, index } = useAnalysis();
  const { theme } = useTheme();
  const t = theme === 'dark' ? TOKENS.night : TOKENS.day;

  const accent = INDEX_COLOR[index] ?? '#84cc16';

  if (status === 'running') {
    return (
      <Empty
        icon={Info}
        title="Running Sentinel-2 analysis…"
        body="Windowed COG reads over the AWS us-west-2 bucket. Typical 5–25 seconds."
      />
    );
  }
  if (status === 'error') {
    return (
      <Empty
        icon={Info}
        title="Analysis failed"
        body={error ?? 'Open the Imagery & Analysis panel to retry.'}
        tone="error"
      />
    );
  }
  if (!results || !results.ok) {
    return (
      <Empty
        icon={Info}
        title="No analysis yet"
        body="Open the Imagery & Analysis panel to draw an AOI, pick date windows, and run an index."
      />
    );
  }

  const { windowA, windowB, delta } = results;

  return (
    <div className="flex-1 min-h-0 overflow-auto p-3 pt-2">
      {/* Header — index + scene metadata */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span
          className="inline-flex h-6 items-center rounded-md px-2 text-[11.5px] font-semibold tabular-nums"
          style={{ backgroundColor: `${accent}22`, color: accent }}
        >
          {results.index}
        </span>
        <SceneChip label="Period A" scene={windowA} />
        {windowB ? <SceneChip label="Period B" scene={windowB} /> : null}
        <div className="ml-auto flex items-center gap-1.5">
          {windowA?.cogUrl ? (
            <DownloadPill href={windowA.cogUrl} label={`${results.index} A`} />
          ) : null}
          {windowB?.cogUrl ? (
            <DownloadPill href={windowB.cogUrl} label={`${results.index} B`} />
          ) : null}
          {delta?.cogUrl ? (
            <DownloadPill href={delta.cogUrl} label="Δ" tone="strong" />
          ) : null}
        </div>
      </div>

      {/* Two-column layout — stats table on the left, histogram on the right */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3">
        <StatsTable
          periodA={windowA?.stats}
          periodB={windowB?.stats}
          delta={delta?.stats}
        />
        <HistogramCard
          accent={accent}
          tokens={t}
          index={results.index}
          periodA={windowA?.stats}
          periodB={windowB?.stats}
          delta={delta?.stats}
        />
      </div>
    </div>
  );
}

function SceneChip({ label, scene }) {
  if (!scene) return null;
  const cloud = scene.cloudCover;
  const date = scene.sceneDate ? scene.sceneDate.slice(0, 10) : '—';
  return (
    <div className="inline-flex items-center gap-1.5 rounded-md border border-day-border dark:border-night-border px-2 py-1 text-[11px]">
      <span className="uppercase text-[10px] tracking-wider text-day-muted dark:text-night-muted">
        {label}
      </span>
      <span className="tabular-nums text-day-text dark:text-night-text">{date}</span>
      {Number.isFinite(cloud) ? (
        <span className="inline-flex items-center gap-0.5 text-[10.5px] text-day-muted dark:text-night-muted">
          <Cloud className="h-3 w-3" />
          {Math.round(cloud)}%
        </span>
      ) : null}
    </div>
  );
}

function DownloadPill({ href, label, tone }) {
  return (
    <a
      href={href}
      download
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10.5px] font-medium border transition-colors',
        tone === 'strong'
          ? 'bg-[#84cc16] border-[#84cc16] text-[#1a2e05] hover:bg-[#65a30d]'
          : 'border-day-border dark:border-night-border text-day-text dark:text-night-text hover:border-[#84cc16]/50',
      )}
    >
      <Download className="h-3 w-3" />
      <span>{label}</span>
    </a>
  );
}

function StatsTable({ periodA, periodB, delta }) {
  // Column keys drive both the header and each row. Kept in order so a
  // reader scanning downward gets central-tendency → spread → tails.
  const rows = [
    { key: 'count',  label: 'Pixels',   fmt: (v) => (v == null ? '—' : v.toLocaleString()) },
    { key: 'mean',   label: 'Mean',     fmt: fmtFloat },
    { key: 'median', label: 'Median',   fmt: fmtFloat },
    { key: 'min',    label: 'Min',      fmt: fmtFloat },
    { key: 'max',    label: 'Max',      fmt: fmtFloat },
    { key: 'std',    label: 'Std dev',  fmt: fmtFloat },
    { key: 'p10',    label: 'p10',      fmt: fmtFloat },
    { key: 'p90',    label: 'p90',      fmt: fmtFloat },
  ];
  const hasB = !!periodB;
  const hasDelta = !!delta;

  return (
    <div className="rounded-md border border-day-border dark:border-night-border overflow-hidden">
      <table className="w-full text-[11.5px]">
        <thead className="bg-day-bg/60 dark:bg-night-bg/60">
          <tr className="text-day-muted dark:text-night-muted">
            <th className="text-left px-2 py-1.5 font-medium">Metric</th>
            <th className="text-right px-2 py-1.5 font-medium tabular-nums">A</th>
            {hasB ? <th className="text-right px-2 py-1.5 font-medium tabular-nums">B</th> : null}
            {hasDelta ? <th className="text-right px-2 py-1.5 font-medium tabular-nums">Δ (B−A)</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const a = periodA?.[row.key];
            const b = periodB?.[row.key];
            const d = delta?.[row.key];
            return (
              <tr key={row.key} className="border-t border-day-border/60 dark:border-night-border/60">
                <td className="px-2 py-1 text-day-text dark:text-night-text">{row.label}</td>
                <td className="px-2 py-1 text-right tabular-nums">{row.fmt(a)}</td>
                {hasB   ? <td className="px-2 py-1 text-right tabular-nums">{row.fmt(b)}</td> : null}
                {hasDelta ? (
                  <td className="px-2 py-1 text-right tabular-nums">
                    <DeltaCell value={d} formatter={row.fmt} />
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DeltaCell({ value, formatter }) {
  if (value == null || !Number.isFinite(value)) return <span>—</span>;
  const positive = value > 0;
  const negative = value < 0;
  const Icon = positive ? ArrowUpRight : negative ? ArrowDownRight : Minus;
  const color = positive
    ? 'text-emerald-500 dark:text-emerald-400'
    : negative
      ? 'text-rose-500 dark:text-rose-400'
      : 'text-day-muted dark:text-night-muted';
  return (
    <span className={cn('inline-flex items-center gap-0.5', color)}>
      <Icon className="h-3 w-3" />
      <span>{formatter(value)}</span>
    </span>
  );
}

function HistogramCard({ accent, tokens, index, periodA, periodB, delta }) {
  // Prefer delta histogram if we have one — that's what tells the LULC
  // change story. Fall back to Period A alone otherwise.
  const primary = delta ?? periodA ?? periodB;
  const chart = useMemo(() => {
    if (!primary?.histogram?.length) return null;
    const labels = primary.histogram.map((h) => h.lo.toFixed(2));
    const isDelta = primary === delta;
    return {
      labels,
      datasets: [
        {
          label: isDelta ? `Δ ${index}` : `${index}`,
          data: primary.histogram.map((h) => h.count),
          backgroundColor: `${accent}bb`,
          borderColor: accent,
          borderWidth: 1,
        },
      ],
    };
  }, [primary, delta, index, accent]);

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: {
          labels: { color: tokens.text, font: { size: 10 } },
          position: 'top',
        },
        tooltip: {
          backgroundColor: tokens.tooltipBg,
          titleColor: tokens.tooltipFg,
          bodyColor: tokens.tooltipFg,
        },
      },
      scales: {
        x: {
          ticks: { color: tokens.text, font: { size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
          grid:  { color: tokens.grid },
          border: { color: tokens.axis },
          title: { display: true, text: `${index} bin (lower edge)`, color: tokens.text, font: { size: 10 } },
        },
        y: {
          ticks: { color: tokens.text, font: { size: 9 } },
          grid:  { color: tokens.grid },
          border: { color: tokens.axis },
          title: { display: true, text: 'Pixel count', color: tokens.text, font: { size: 10 } },
        },
      },
    }),
    [index, tokens],
  );

  return (
    <div className="rounded-md border border-day-border dark:border-night-border p-2 min-h-0 flex flex-col">
      <div className="text-[10.5px] uppercase tracking-wider text-day-muted dark:text-night-muted px-1 pb-1">
        {delta ? `${index} change distribution` : `${index} distribution`}
      </div>
      <div className="flex-1 min-h-[160px]">
        {chart ? (
          <Bar data={chart} options={options} />
        ) : (
          <div className="h-full flex items-center justify-center text-[11px] text-day-muted dark:text-night-muted">
            No histogram data
          </div>
        )}
      </div>
    </div>
  );
}

function Empty({ icon: Icon, title, body, tone }) {
  return (
    <div className="flex-1 min-h-0 flex items-center justify-center p-6">
      <div
        className={cn(
          'flex items-start gap-3 max-w-md rounded-md border px-3 py-2.5',
          tone === 'error'
            ? 'border-red-500/30 bg-red-500/5 text-red-500 dark:text-red-400'
            : 'border-day-border dark:border-night-border text-day-muted dark:text-night-muted',
        )}
      >
        <Icon className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          <div className="font-semibold text-day-text dark:text-night-text">{title}</div>
          <div className="text-[11.5px] leading-tight mt-0.5">{body}</div>
        </div>
      </div>
    </div>
  );
}

function fmtFloat(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 100) return v.toFixed(1);
  if (abs >= 1) return v.toFixed(3);
  return v.toFixed(4);
}
