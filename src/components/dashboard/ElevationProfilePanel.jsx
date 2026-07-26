import { useEffect, useMemo, useRef, useState } from 'react';
import { Line } from 'react-chartjs-2';
import { Mountain } from 'lucide-react';
import { useFlypath } from '@/contexts/FlypathContext';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/utils/cn';

// ElevationProfilePanel — chart body for the Elevation Profile tab in
// ChartsRow. Reads the sampled elevation array + shared animation
// phaseRef from FlypathContext. During playback runs its own rAF loop
// (not driven by React state churn) so the phase marker glides at 60
// fps without re-rendering the whole tab body.
//
// Theming:
//   • Dark theme  → bright lime line + semi-transparent lime fill
//                   against the dark canvas.
//   • Light theme → deep slate line + a softer slate fill against
//                   the light card background.
// Both palettes keep the phase marker very high-contrast so the
// operator can always track where the flight currently is on the
// profile.

// Dark palette — pushed hard for visibility. Bright cyan line (#22d3ee)
// against a dense fill gradient (60% → 6% alpha) reads unmistakably
// against the panel's near-black canvas.
const DARK = {
  line:       '#22d3ee',             // cyan-400 — bright, doesn't clash with lime brand
  lineWidth:  2.75,
  fillTop:    'rgba(34, 211, 238, 0.55)',
  fillBot:    'rgba(34, 211, 238, 0.06)',
  marker:     '#facc15',             // amber-400
  markerRing: '#0b1220',
  markerText: '#0b1220',             // label text sitting inside the amber chip
  axis:       '#cbd5e1',
  grid:       'rgba(148, 163, 184, 0.20)',
  guide:      'rgba(250, 204, 21, 0.75)',
};

const LIGHT = {
  line:       '#1e293b',             // slate-800
  lineWidth:  2.25,
  fillTop:    'rgba(30, 41, 59, 0.35)',
  fillBot:    'rgba(30, 41, 59, 0.02)',
  marker:     '#dc2626',             // red-600
  markerRing: '#ffffff',
  markerText: '#ffffff',             // white on red-600 chip
  axis:       '#475569',
  grid:       'rgba(100, 116, 139, 0.20)',
  guide:      'rgba(220, 38, 38, 0.55)',
};

export default function ElevationProfilePanel() {
  // ThemeContext exposes `isDark` directly (theme value is 'day' /
  // 'night', not 'light' / 'dark' — using the boolean avoids the
  // string-value drift bug where we ended up rendering the light
  // palette on the dark canvas).
  const { isDark } = useTheme();
  const palette = isDark ? DARK : LIGHT;

  const { elevationProfile, playState, phaseRef, hasRoute } = useFlypath();

  // Chart instance ref — we drive the phase marker imperatively via
  // `chart.update('none')` from a rAF loop instead of setState. Memoised
  // data + options never change during a flight, so a React re-render
  // wouldn't repaint the canvas anyway (Chart.js short-circuits when
  // nothing changed). Reading phaseRef.current live and repainting each
  // frame via update('none') is the standard Chart.js pattern for
  // real-time overlays.
  const chartRef = useRef(null);
  // Mirror phase into a ref the plugin closure reads on every draw.
  const livePhaseRef = useRef(0);
  useEffect(() => {
    if (!phaseRef) return undefined;
    if (playState === 'playing') {
      let raf = 0;
      const tick = () => {
        livePhaseRef.current = phaseRef.current;
        chartRef.current?.update('none');
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }
    // Non-playing: snapshot once so the marker parks at paused / 0.
    livePhaseRef.current = phaseRef.current;
    chartRef.current?.update('none');
    return undefined;
  }, [playState, phaseRef]);

  // Chart data — memoized on samples + palette so we're not rebuilding
  // arrays on every rAF tick.
  const chartData = useMemo(() => {
    const samples = elevationProfile?.samples ?? [];
    return {
      labels: samples.map((s) => s.distance / 1000),  // km on the X axis
      datasets: [
        {
          label: 'Elevation',
          data: samples.map((s) => (s.elevation == null ? null : s.elevation)),
          borderColor: palette.line,
          borderWidth: palette.lineWidth,
          fill: true,
          backgroundColor: (ctx) => {
            // Vertical gradient — strong at the top of the curve,
            // near-transparent at the bottom. Uses the palette's
            // two-stop values so dark + light both read cleanly.
            const { chart } = ctx;
            const { ctx: c, chartArea } = chart;
            if (!chartArea) return palette.fillTop;
            const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            g.addColorStop(0, palette.fillTop);
            g.addColorStop(1, palette.fillBot);
            return g;
          },
          pointRadius: 0,
          pointHoverRadius: 0,
          tension: 0.28,
          spanGaps: true,
        },
      ],
    };
  }, [elevationProfile, palette]);

  // Chart options — memoized on palette.
  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,   // we drive updates ourselves; no tweening
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: {
        type: 'linear',
        title: { display: true, text: 'Distance (km)', color: palette.axis, font: { size: 10 } },
        ticks: { color: palette.axis, font: { size: 10 }, maxTicksLimit: 8 },
        grid:  { color: palette.grid, drawBorder: false },
      },
      y: {
        title: { display: true, text: 'Elevation (m)', color: palette.axis, font: { size: 10 } },
        ticks: { color: palette.axis, font: { size: 10 } },
        grid:  { color: palette.grid, drawBorder: false },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: isDark ? '#020617' : '#0f172a',
        titleColor: '#f8fafc',
        bodyColor: '#e2e8f0',
        borderColor: palette.line,
        borderWidth: 1,
        padding: 8,
        displayColors: false,
        callbacks: {
          title: (items) => `${items[0].parsed.x.toFixed(2)} km`,
          label: (item) => `Elevation: ${Math.round(item.parsed.y)} m`,
        },
      },
    },
  }), [palette, isDark]);

  // Custom plugin drawing the phase marker (vertical guide + a big
  // filled circle at the current elevation). The plugin reads
  // livePhaseRef.current on every draw — the rAF loop above calls
  // chart.update('none') per frame, which triggers this callback
  // without a React re-render.
  const phaseMarkerPlugin = useMemo(() => ({
    id: 'flypath-phase-marker',
    afterDatasetsDraw(chart) {
      const samples = elevationProfile?.samples;
      if (!samples || samples.length < 2) return;
      const totalKm = samples[samples.length - 1].distance / 1000;
      if (totalKm <= 0) return;
      const phaseNow = livePhaseRef.current;
      const targetKm = Math.max(0, Math.min(totalKm, phaseNow * totalKm));
      const elev = interpolateElevation(samples, phaseNow);
      if (elev == null) return;

      const { ctx, chartArea, scales } = chart;
      const x = scales.x.getPixelForValue(targetKm);
      const y = scales.y.getPixelForValue(elev);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      ctx.save();
      // Vertical guide dropping from the top down to the marker.
      ctx.strokeStyle = palette.guide;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      // Outer glow.
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fillStyle = palette.marker + '33'; // ~20% alpha
      ctx.fill();
      // Filled marker.
      ctx.beginPath();
      ctx.arc(x, y, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = palette.marker;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = palette.markerRing;
      ctx.stroke();

      // Live elevation label. Sits above the marker by default;
      // flips below if the marker is near the top of the chart area
      // to keep the label visible. Rounded chip with a soft shadow
      // + palette-matched border so it reads on both light and
      // dark canvases.
      const label = `${Math.round(elev)} m`;
      ctx.font = '600 11px system-ui, -apple-system, sans-serif';
      const metrics   = ctx.measureText(label);
      const padX      = 6;
      const padY      = 3;
      const labelW    = metrics.width + padX * 2;
      const labelH    = 18;
      const gap       = 12;
      const flipBelow = (y - gap - labelH) < chartArea.top + 2;
      const rectX     = Math.max(
        chartArea.left + 2,
        Math.min(chartArea.right - labelW - 2, x - labelW / 2),
      );
      const rectY     = flipBelow ? (y + gap) : (y - gap - labelH);
      // Chip background.
      ctx.beginPath();
      const r = 4;
      ctx.moveTo(rectX + r, rectY);
      ctx.lineTo(rectX + labelW - r, rectY);
      ctx.quadraticCurveTo(rectX + labelW, rectY, rectX + labelW, rectY + r);
      ctx.lineTo(rectX + labelW, rectY + labelH - r);
      ctx.quadraticCurveTo(rectX + labelW, rectY + labelH, rectX + labelW - r, rectY + labelH);
      ctx.lineTo(rectX + r, rectY + labelH);
      ctx.quadraticCurveTo(rectX, rectY + labelH, rectX, rectY + labelH - r);
      ctx.lineTo(rectX, rectY + r);
      ctx.quadraticCurveTo(rectX, rectY, rectX + r, rectY);
      ctx.closePath();
      ctx.fillStyle = palette.marker;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = palette.markerRing;
      ctx.stroke();
      ctx.fillStyle = palette.markerText;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(label, rectX + padX, rectY + labelH / 2 + padY - 3);
      ctx.restore();
    },
  }), [elevationProfile, palette]);

  // ---------------------------------------------------------------
  // Empty / loading states
  // ---------------------------------------------------------------
  if (!hasRoute) {
    return <EmptyState message="Upload a flypath route to see its elevation profile." />;
  }
  if (!elevationProfile || elevationProfile.samples.length === 0) {
    return <EmptyState message="Sampling terrain elevation along the route…" spinner />;
  }
  const anyValid = elevationProfile.samples.some((s) => Number.isFinite(s.elevation));
  if (!anyValid) {
    return (
      <EmptyState
        message="Waiting for terrain tiles to load near the route. Try zooming to the route."
      />
    );
  }

  // ---------------------------------------------------------------
  // Chart body
  // ---------------------------------------------------------------
  const stats = summarize(elevationProfile.samples);
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-3 px-3 pt-2 pb-1 text-[11px]">
        <div className="flex items-center gap-1.5 text-day-text dark:text-night-text font-semibold">
          <Mountain className="h-3.5 w-3.5 text-brand-700 dark:text-brand-200" />
          Elevation Profile
        </div>
        <StatChip label="High"   tone="high"   value={`${Math.round(stats.max)} m`} />
        <StatChip label="Low"    tone="low"    value={`${Math.round(stats.min)} m`} />
        <StatChip label="Drop"   tone="drop"   value={`${Math.round(stats.drop)} m`} />
        <StatChip label="Length" tone="length" value={`${(elevationProfile.totalDistance / 1000).toFixed(2)} km`} />
        {!elevationProfile.complete ? (
          <span className="text-day-muted dark:text-night-muted italic">refining…</span>
        ) : null}
      </div>
      <div className="flex-1 min-h-0 px-2 pb-2">
        <Line
          ref={chartRef}
          data={chartData}
          options={chartOptions}
          plugins={[phaseMarkerPlugin]}
        />
      </div>
    </div>
  );
}

// Sober tonal palette for the four stat chips — each metric gets its
// own hue so the eye can scan HIGH / LOW / DROP / LENGTH at a glance
// without the row reading like a wall of muted text.
//   high   → amber  (summit / peak)
//   low    → sky    (valley / water)
//   drop   → rose   (dramatic descent)
//   length → violet (distance / measurement)
// Backgrounds sit at ~10 % alpha in both themes so they read as chips
// without competing with the chart underneath.
const CHIP_TONES = {
  high: {
    wrap:  'bg-amber-500/10 dark:bg-amber-400/10 ring-amber-500/25 dark:ring-amber-400/25',
    label: 'text-amber-700 dark:text-amber-300',
    value: 'text-amber-900 dark:text-amber-100',
  },
  low: {
    wrap:  'bg-sky-500/10 dark:bg-sky-400/10 ring-sky-500/25 dark:ring-sky-400/25',
    label: 'text-sky-700 dark:text-sky-300',
    value: 'text-sky-900 dark:text-sky-100',
  },
  drop: {
    wrap:  'bg-rose-500/10 dark:bg-rose-400/10 ring-rose-500/25 dark:ring-rose-400/25',
    label: 'text-rose-700 dark:text-rose-300',
    value: 'text-rose-900 dark:text-rose-100',
  },
  length: {
    wrap:  'bg-violet-500/10 dark:bg-violet-400/10 ring-violet-500/25 dark:ring-violet-400/25',
    label: 'text-violet-700 dark:text-violet-300',
    value: 'text-violet-900 dark:text-violet-100',
  },
};

function StatChip({ label, value, tone }) {
  const t = CHIP_TONES[tone] ?? CHIP_TONES.length;
  return (
    <span
      className={cn(
        'inline-flex items-baseline gap-1 text-[10.5px]',
        'px-1.5 py-0.5 rounded ring-1',
        t.wrap,
      )}
    >
      <span className={cn('uppercase tracking-wide', t.label)}>{label}</span>
      <span className={cn('tabular-nums font-semibold', t.value)}>{value}</span>
    </span>
  );
}

function EmptyState({ message, spinner }) {
  return (
    <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
      {spinner ? (
        <div className="h-5 w-5 rounded-full border-2 border-day-border dark:border-night-border border-t-[#84cc16] animate-spin" />
      ) : (
        <Mountain className="h-6 w-6 text-day-muted dark:text-night-muted" />
      )}
      <div className="text-[11.5px] text-day-muted dark:text-night-muted max-w-xs">
        {message}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Interpolate elevation at fractional phase (0..1). Skips over any null
// samples caused by unloaded terrain tiles.
function interpolateElevation(samples, phase) {
  if (!samples || samples.length === 0) return null;
  const idx = Math.max(0, Math.min(samples.length - 1, phase * (samples.length - 1)));
  const lo = Math.floor(idx);
  const hi = Math.min(samples.length - 1, lo + 1);
  const t  = idx - lo;
  const a  = samples[lo].elevation;
  const b  = samples[hi].elevation;
  if (a == null && b == null) return null;
  if (a == null) return b;
  if (b == null) return a;
  return a + (b - a) * t;
}

function summarize(samples) {
  let min =  Infinity;
  let max = -Infinity;
  for (const s of samples) {
    if (s.elevation == null) continue;
    if (s.elevation < min) min = s.elevation;
    if (s.elevation > max) max = s.elevation;
  }
  if (!Number.isFinite(min)) { min = 0; max = 0; }
  return { min, max, drop: max - min };
}
