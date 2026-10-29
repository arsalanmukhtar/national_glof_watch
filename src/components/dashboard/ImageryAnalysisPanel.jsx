import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  Download,
  Eraser,
  ExternalLink,
  Hexagon,
  Loader2,
  MousePointerSquareDashed,
  Pencil,
  Play,
  Sigma,
  Signature,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { useMapView } from '@/contexts/MapContext';
import { useAnalysis } from '@/contexts/AnalysisContext';
import {
  clearDraw,
  drawFreehand,
  drawPolygon,
  drawRectangle,
  showAoiOnMap,
} from '@/utils/mapDraw';
import GeoAnalysisPanel from '@/components/dashboard/GeoAnalysisPanel';
import { cn } from '@/utils/cn';

// ---------------------------------------------------------------------------
// ImageryAnalysisPanel — the unified imagery + geoprocessing surface.
//
// Two modes at the top:
//   • "Sentinel Imagery" — draw an AOI, pick two calendar-month windows,
//     pick an index (NDVI / NDWI / NDBI / NDSI), run against Sentinel-2
//     L2A via Element84 Earth Search STAC + AWS Open Data (no auth).
//     Backend spawns scripts/python/sentinel_analysis.py.
//   • "Local Analysis" — the existing zonal-stats + report workflow from
//     GeoAnalysisPanel, embedded here so the sidebar has one entry
//     point for every analysis operation.
//
// Sentinel state lives in AnalysisContext so ChartsRow's Analysis tab
// can pick up the results without prop-drilling.
// ---------------------------------------------------------------------------

const INDEX_INFO = {
  NDVI: { label: 'NDVI', full: 'Vegetation',    hint: '(B8 − B4) / (B8 + B4)' },
  NDWI: { label: 'NDWI', full: 'Water',         hint: '(B3 − B8) / (B3 + B8)' },
  NDBI: { label: 'NDBI', full: 'Built-up',      hint: '(B11 − B8) / (B11 + B8)' },
  NDSI: { label: 'NDSI', full: 'Snow / ice',    hint: '(B3 − B11) / (B3 + B11)' },
};

const DRAW_TOOLS = [
  { id: 'rectangle', label: 'Rectangle', icon: Square },
  { id: 'polygon',   label: 'Polygon',   icon: Pencil },
  { id: 'freehand',  label: 'Freehand',  icon: Signature },
];

export default function ImageryAnalysisPanel() {
  const [mode, setMode] = useState('sentinel'); // 'sentinel' | 'local'

  return (
    <div className="flex flex-col gap-3">
      <ModeTabs value={mode} onChange={setMode} />
      {mode === 'sentinel' ? <SentinelSection /> : <GeoAnalysisPanel />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ModeTabs({ value, onChange }) {
  const items = [
    { id: 'sentinel', label: 'Sentinel Imagery' },
    { id: 'local',    label: 'Local Analysis' },
  ];
  return (
    <div className="flex items-center gap-1 rounded-md bg-day-bg dark:bg-night-bg p-0.5 border border-day-border dark:border-night-border">
      {items.map((it) => {
        const active = value === it.id;
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onChange(it.id)}
            aria-pressed={active}
            className={cn(
              'flex-1 rounded px-2 py-1.5 text-[11.5px] font-medium transition-colors',
              active
                ? 'bg-[#84cc16] text-[#1a2e05]'
                : 'text-day-muted dark:text-night-muted hover:text-day-text dark:hover:text-night-text',
            )}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

function SentinelSection() {
  const { map } = useMapView();
  const {
    drawnGeometry, setDrawnGeometry, clearGeometry,
    windowA, setWindowA,
    windowB, setWindowB,
    compareEnabled, setCompareEnabled,
    index, setIndex,
    maxCloud, setMaxCloud,
    status, error, results, run, cancel,
  } = useAnalysis();

  const [activeTool, setActiveTool] = useState(null);
  const cancelDrawRef = useRef(null);

  // Wire draw tools to Mapbox. When `activeTool` changes we tear down
  // any in-flight draw session and start a new one; on success we push
  // the completed FC into AnalysisContext, which downstream renders on
  // the map + arms the "Run" button.
  useEffect(() => {
    if (!map) return;
    cancelDrawRef.current?.();
    cancelDrawRef.current = null;

    if (!activeTool) return;

    const onComplete = (fc) => {
      const feature = fc?.features?.[0];
      if (feature?.geometry) {
        setDrawnGeometry(feature);
      }
      setActiveTool(null);
    };
    const onCancel = () => setActiveTool(null);

    if (activeTool === 'rectangle') {
      cancelDrawRef.current = drawRectangle(map, { onComplete });
    } else if (activeTool === 'polygon') {
      cancelDrawRef.current = drawPolygon(map, { onComplete, onCancel });
    } else if (activeTool === 'freehand') {
      cancelDrawRef.current = drawFreehand(map, { onComplete, onCancel });
    }

    return () => {
      cancelDrawRef.current?.();
      cancelDrawRef.current = null;
    };
  }, [activeTool, map, setDrawnGeometry]);

  // Keep the drawn AOI visible on the map even after the draw tool
  // has closed. If drawnGeometry is null (cleared), tear the layers
  // down; otherwise repaint the feature.
  useEffect(() => {
    if (!map) return;
    if (!drawnGeometry) {
      clearDraw(map);
      return;
    }
    showAoiOnMap(map, {
      type: 'FeatureCollection',
      features: [drawnGeometry],
    });
    return () => {
      // Only clear when the panel unmounts — not on every re-render.
    };
  }, [map, drawnGeometry]);

  // Tear down draw layers when the panel unmounts entirely (icon
  // toggled off). Runs once.
  useEffect(() => {
    return () => {
      if (map) clearDraw(map);
    };
  }, [map]);

  const hasGeometry = !!drawnGeometry;
  const running = status === 'running';
  const areaKm2 = useMemo(() => geometryAreaKm2(drawnGeometry), [drawnGeometry]);

  return (
    <div className="flex flex-col gap-3">
      {/* Step 1 — draw AOI */}
      <Section title="Area of Interest" hint="Draw a shape on the map for the Sentinel scene to clip against.">
        <div className="grid grid-cols-3 gap-1">
          {DRAW_TOOLS.map(({ id, label, icon: Icon }) => {
            const active = activeTool === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTool(active ? null : id)}
                aria-pressed={active}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 rounded-md border px-2 py-2 transition-colors',
                  active
                    ? 'bg-[#84cc16]/15 border-[#84cc16] text-[#84cc16]'
                    : 'border-day-border dark:border-night-border text-day-text dark:text-night-text hover:border-[#84cc16]/50',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="text-[10.5px] font-medium">{label}</span>
              </button>
            );
          })}
        </div>
        <div
          className={cn(
            'flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11.5px]',
            hasGeometry
              ? 'border-[#84cc16]/40 bg-[#84cc16]/10 text-[#84cc16]'
              : 'border-day-border dark:border-night-border text-day-muted dark:text-night-muted',
          )}
        >
          <Hexagon className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {hasGeometry
              ? areaKm2 != null
                ? `AOI set (~${formatArea(areaKm2)} km²)`
                : 'AOI set on map'
              : 'No AOI — draw one to arm the analysis'}
          </span>
          {hasGeometry ? (
            <button
              type="button"
              onClick={() => {
                clearGeometry();
                setActiveTool(null);
              }}
              aria-label="Clear AOI"
              className="ml-auto text-[10.5px] uppercase tracking-wider opacity-70 hover:opacity-100"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          ) : (
            <MousePointerSquareDashed className="ml-auto h-3 w-3 opacity-60" />
          )}
        </div>
      </Section>

      {/* Step 2 — date windows */}
      <Section title="Date windows" hint="Two calendar-month windows. Least-cloudy Sentinel-2 scene per window is used.">
        <div className="flex items-center justify-between mb-1">
          <label className="flex items-center gap-1.5 text-[11.5px] text-day-text dark:text-night-text cursor-pointer">
            <input
              type="checkbox"
              checked={compareEnabled}
              onChange={(e) => setCompareEnabled(e.target.checked)}
              className="h-3 w-3 accent-[#84cc16]"
            />
            <span>Compare two periods</span>
          </label>
        </div>
        <MonthInput label="Period A" value={windowA} onChange={setWindowA} />
        {compareEnabled ? (
          <MonthInput label="Period B" value={windowB} onChange={setWindowB} />
        ) : null}
      </Section>

      {/* Step 3 — index */}
      <Section title="Index">
        <div className="grid grid-cols-2 gap-1">
          {Object.entries(INDEX_INFO).map(([id, info]) => {
            const active = index === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setIndex(id)}
                aria-pressed={active}
                className={cn(
                  'flex flex-col items-start gap-0.5 rounded-md border px-2 py-1.5 text-left transition-colors',
                  active
                    ? 'bg-[#84cc16]/10 border-[#84cc16]/50'
                    : 'border-day-border dark:border-night-border hover:border-day-text/40 dark:hover:border-night-text/40',
                )}
              >
                <span className={cn(
                  'text-[12px] font-semibold leading-tight',
                  active ? 'text-[#84cc16]' : 'text-day-text dark:text-night-text',
                )}>
                  {info.label} · {info.full}
                </span>
                <span className="text-[10px] leading-tight text-day-muted dark:text-night-muted">
                  {info.hint}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      {/* Step 4 — cloud cover */}
      <Section title="Max cloud cover" collapsedByDefault>
        <div className="flex items-center gap-2">
          <Cloud className="h-3.5 w-3.5 text-day-muted dark:text-night-muted shrink-0" />
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={maxCloud}
            onChange={(e) => setMaxCloud(Number(e.target.value))}
            className="flex-1 h-1 rounded-full appearance-none bg-day-border dark:bg-night-border accent-[#84cc16] cursor-pointer"
          />
          <span className="tabular-nums text-[11px] w-8 text-right text-day-text dark:text-night-text">
            {maxCloud}%
          </span>
        </div>
      </Section>

      {/* Run */}
      {running ? (
        <button
          type="button"
          onClick={cancel}
          className="btn-base btn-md w-full bg-day-bg dark:bg-night-bg border border-day-border dark:border-night-border text-day-text dark:text-night-text"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Running — click to cancel</span>
        </button>
      ) : (
        <button
          type="button"
          disabled={!hasGeometry}
          onClick={run}
          className={cn(
            'btn-base btn-md w-full',
            'bg-[#84cc16] text-[#1a2e05] hover:bg-[#65a30d]',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <Play className="h-4 w-4" />
          <span>Run analysis</span>
        </button>
      )}

      <StatusBlock status={status} error={error} results={results} />
    </div>
  );
}

function StatusBlock({ status, error, results }) {
  if (status === 'error') {
    return (
      <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-[11.5px] text-red-500 dark:text-red-400">
        <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Analysis failed</div>
          <pre className="text-day-muted dark:text-night-muted whitespace-pre-wrap break-words font-mono text-[10.5px] leading-tight mt-1 max-h-40 overflow-auto">
            {error}
          </pre>
        </div>
      </div>
    );
  }
  if (status === 'success' && results?.ok) {
    return (
      <div className="flex flex-col gap-1.5 rounded-md border border-[#84cc16]/40 bg-[#84cc16]/10 px-2.5 py-2 text-[11.5px]">
        <div className="flex items-center gap-1.5 text-[#84cc16] font-semibold">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span>Analysis complete</span>
          {results.cached ? (
            <span className="ml-auto text-[10px] uppercase tracking-wider opacity-70">Cached</span>
          ) : null}
        </div>
        <p className="text-day-text dark:text-night-text">
          Stats + histograms are ready in the <span className="font-semibold">Analysis</span> tab
          below the map.
        </p>
        {results.windowA?.cogUrl ? (
          <a
            href={results.windowA.cogUrl}
            download
            className="inline-flex items-center gap-1.5 text-[10.5px] text-[#84cc16] hover:underline"
          >
            <Download className="h-3 w-3" />
            <span>Download period A COG</span>
          </a>
        ) : null}
        {results.windowB?.cogUrl ? (
          <a
            href={results.windowB.cogUrl}
            download
            className="inline-flex items-center gap-1.5 text-[10.5px] text-[#84cc16] hover:underline"
          >
            <Download className="h-3 w-3" />
            <span>Download period B COG</span>
          </a>
        ) : null}
        {results.delta?.cogUrl ? (
          <a
            href={results.delta.cogUrl}
            download
            className="inline-flex items-center gap-1.5 text-[10.5px] text-[#84cc16] hover:underline"
          >
            <Download className="h-3 w-3" />
            <span>Download delta COG</span>
          </a>
        ) : null}
      </div>
    );
  }
  return null;
}

function Section({ title, hint, children }) {
  return (
    <section className="rounded-md border border-day-border dark:border-night-border bg-day-bg/40 dark:bg-night-bg/40">
      <header className="px-2.5 pt-2 pb-1">
        <h3 className="text-[11.5px] font-semibold text-day-text dark:text-night-text">
          {title}
        </h3>
        {hint ? (
          <p className="text-[10.5px] text-day-muted dark:text-night-muted leading-tight mt-0.5">
            {hint}
          </p>
        ) : null}
      </header>
      <div className="p-2.5 pt-1.5 flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

function MonthInput({ label, value, onChange }) {
  return (
    <label className="flex items-center gap-2 text-[11px]">
      <span className="w-14 shrink-0 text-day-muted dark:text-night-muted uppercase tracking-wider text-[10px]">
        {label}
      </span>
      <input
        type="month"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'flex-1 px-2 py-1 rounded-md text-[11.5px]',
          'bg-day-bg dark:bg-night-bg',
          'border border-day-border dark:border-night-border',
          'text-day-text dark:text-night-text',
          'focus:outline-none focus:ring-2 focus:ring-[#84cc16]/40',
        )}
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Geometry helpers — a very rough area estimate for the AOI chip. Uses
// the shoelace formula on the polygon's outer ring, converted with a
// per-latitude scale. Off by a few percent vs. proper geodesic area,
// but good enough for the panel's "~ X km²" chip.
// ---------------------------------------------------------------------------

function geometryAreaKm2(feature) {
  const geom = feature?.geometry ?? feature;
  if (!geom) return null;
  const rings = [];
  if (geom.type === 'Polygon') rings.push(geom.coordinates?.[0]);
  else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates ?? []) rings.push(poly?.[0]);
  } else {
    return null;
  }
  let total = 0;
  for (const ring of rings) {
    if (!ring || ring.length < 3) continue;
    // Mean latitude of the ring — good enough for a km-scale AOI.
    let sumLat = 0;
    for (const [, lat] of ring) sumLat += lat;
    const meanLat = sumLat / ring.length;
    const latRad = (meanLat * Math.PI) / 180;
    const mPerDegLng = 111_320 * Math.cos(latRad);
    const mPerDegLat = 110_540;
    let a = 0;
    for (let i = 0, n = ring.length - 1; i < n; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[i + 1];
      a += x1 * y2 - x2 * y1;
    }
    total += Math.abs(a * 0.5 * mPerDegLng * mPerDegLat);
  }
  if (!Number.isFinite(total) || total <= 0) return null;
  return total / 1_000_000;
}

function formatArea(km2) {
  if (km2 < 0.01) return km2.toFixed(4);
  if (km2 < 1) return km2.toFixed(2);
  if (km2 < 100) return km2.toFixed(1);
  return Math.round(km2).toLocaleString();
}
