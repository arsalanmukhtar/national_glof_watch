import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Listbox, Transition } from '@headlessui/react';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  FileDown,
  Hexagon,
  Layers as LayersIcon,
  Loader2,
  MousePointerSquareDashed,
  Pencil,
  Play,
  Sigma,
  Square,
  Target,
  Trash2,
} from 'lucide-react';
import { useMapView } from '@/contexts/MapContext';
import { useRasters } from '@/contexts/RasterContext';
import {
  parseRegionLayerId,
  useRegionLayers,
} from '@/contexts/RegionLayersContext';
import { useSecondary } from '@/contexts/SecondaryContext';
import {
  fetchGeoJson,
  regionLayerUrl,
  secondaryLayerUrl,
} from '@/config/layerSources';
import {
  bboxOfFeatureCollection,
  formatIntegerWithCommas,
  formatStatNumber,
  selectFeaturesByMask,
  zonalStatistics,
} from '@/utils/geoAnalysis';
import {
  clearDraw,
  drawPolygon,
  drawRectangle,
  showAoiOnMap,
  watchAoiClicks,
} from '@/utils/mapDraw';
import { generateGeoAnalysisReport } from '@/utils/pdfReport';
import { cn } from '@/utils/cn';

// ---------------------------------------------------------------------------
// Operation catalogue. Only "zonal" is implemented in this iteration;
// the rest render as muted entries inside the operation dropdown so the
// toolbox already advertises the upcoming surface area without breaking
// the active workflow.
// ---------------------------------------------------------------------------
const OPS = [
  {
    id: 'zonal',
    label: 'Zonal Statistics',
    sub: 'Raster ∩ Polygon',
    icon: Sigma,
    enabled: true,
    description:
      'Summarise raster pixel values that fall inside a polygon mask — total, mean, distribution.',
  },
  {
    id: 'intersect',
    label: 'Intersection',
    sub: 'Vector ∩ Vector',
    icon: Hexagon,
    enabled: false,
    description: 'Geometric intersection of two vector layers. Coming soon.',
  },
  {
    id: 'buffer',
    label: 'Buffer',
    sub: 'Distance ring',
    icon: Target,
    enabled: false,
    description: 'Expand vector features by a distance. Coming soon.',
  },
  {
    id: 'rasterAlgebra',
    label: 'Raster Algebra',
    sub: 'Raster × Raster',
    icon: LayersIcon,
    enabled: false,
    description: 'Per-pixel math between two aligned rasters. Coming soon.',
  },
];

const AOI_MODES = [
  { id: 'layer', label: 'Whole layer', icon: LayersIcon, hint: 'Use every feature of the chosen polygon layer.' },
  { id: 'rect',  label: 'Rectangle',   icon: Square,    hint: 'Drag a rectangle on the map to select features from the layer.' },
  { id: 'poly',  label: 'Polygon',     icon: Pencil,    hint: 'Click vertices to lasso-select features from the layer. Double-click to finish.' },
];

function regionPretty(id) {
  return id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Operation dropdown — replaces the multi-card rail from the modal so
// the narrow sidebar (~290 px content) never has to fight wrapping
// labels. Only the active operation occupies space when collapsed.
// ---------------------------------------------------------------------------

function OperationListbox({ value, onChange }) {
  const current = OPS.find((o) => o.id === value) || OPS[0];
  const Icon = current.icon;
  return (
    <Listbox
      value={value}
      onChange={(id) => {
        const op = OPS.find((o) => o.id === id);
        if (op?.enabled) onChange(id);
      }}
    >
      <div className="relative">
        <Listbox.Button
          className={cn(
            'w-full flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-[12px]',
            'border-day-border dark:border-night-border bg-white dark:bg-night-surface',
            'hover:border-[#84cc16]/60 focus:outline-none focus:ring-2 focus:ring-[#84cc16]/40 transition-colors',
          )}
        >
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[#84cc16] text-[#1a2e05]">
            <Icon className="h-3.5 w-3.5" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-day-text dark:text-night-text truncate">
              {current.label}
            </div>
            <div className="text-[10.5px] text-day-muted dark:text-night-muted truncate">
              {current.sub}
            </div>
          </div>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-day-muted dark:text-night-muted" />
        </Listbox.Button>
        <Transition
          as={Fragment}
          enter="transition ease-out duration-100"
          enterFrom="opacity-0 scale-95"
          enterTo="opacity-100 scale-100"
          leave="transition ease-in duration-75"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <Listbox.Options
            className={cn(
              'absolute z-30 mt-1 w-full rounded-md py-1',
              'bg-white dark:bg-night-surface',
              'border border-day-border dark:border-night-border shadow-lg max-h-72 overflow-y-auto',
            )}
          >
            {OPS.map((o) => {
              const OptIcon = o.icon;
              return (
                <Listbox.Option
                  key={o.id}
                  value={o.id}
                  disabled={!o.enabled}
                  className={({ active }) =>
                    cn(
                      'flex items-start gap-2 px-2.5 py-1.5 cursor-pointer',
                      active && o.enabled ? 'bg-[#84cc16]/10' : '',
                      !o.enabled && 'opacity-50 cursor-not-allowed',
                    )
                  }
                >
                  {({ selected }) => (
                    <>
                      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-day-bg dark:bg-night-bg text-day-muted dark:text-night-muted mt-0.5">
                        <OptIcon className="h-3 w-3" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] text-day-text dark:text-night-text">
                          {o.label}
                          {!o.enabled ? (
                            <span className="text-day-muted dark:text-night-muted"> · soon</span>
                          ) : null}
                        </div>
                        <div className="text-[10px] text-day-muted dark:text-night-muted truncate">
                          {o.sub}
                        </div>
                      </div>
                      {selected ? (
                        <Check className="h-3 w-3 text-[#84cc16] mt-1" />
                      ) : null}
                    </>
                  )}
                </Listbox.Option>
              );
            })}
          </Listbox.Options>
        </Transition>
      </div>
    </Listbox>
  );
}

// ---------------------------------------------------------------------------
// Step shell + tight UI primitives sized for the 320 px sidebar.
// ---------------------------------------------------------------------------

function Step({ index, title, hint, done, children }) {
  return (
    <section className="rounded-md border border-day-border dark:border-night-border bg-day-bg/40 dark:bg-night-bg/40">
      <header className="flex items-start gap-2 px-2.5 py-2 border-b border-day-border/60 dark:border-night-border/60">
        <span
          className={cn(
            'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold mt-0.5',
            done
              ? 'bg-[#84cc16] text-[#1a2e05]'
              : 'bg-day-bg dark:bg-night-bg text-day-muted dark:text-night-muted border border-day-border dark:border-night-border',
          )}
        >
          {done ? <CheckCircle2 className="h-3 w-3" /> : index}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-[12px] font-semibold text-day-text dark:text-night-text">
            {title}
          </h3>
          {hint ? (
            <p className="text-[10.5px] text-day-muted dark:text-night-muted leading-tight">
              {hint}
            </p>
          ) : null}
        </div>
      </header>
      <div className="p-2.5 flex flex-col gap-2">{children}</div>
    </section>
  );
}

function LayerCard({ active, onClick, icon: Icon, title, subtitle }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-md border px-2.5 py-1.5 transition-all',
        'flex items-center gap-2',
        active
          ? 'border-[#84cc16] bg-[#84cc16]/10'
          : 'border-day-border dark:border-night-border bg-white dark:bg-night-surface hover:border-[#84cc16]/50',
      )}
    >
      <span
        className={cn(
          'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded',
          active
            ? 'bg-[#84cc16] text-[#1a2e05]'
            : 'bg-day-bg dark:bg-night-bg text-day-muted dark:text-night-muted',
        )}
      >
        <Icon className="h-3 w-3" />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium truncate text-day-text dark:text-night-text">
          {title}
        </div>
        {subtitle ? (
          <div className="text-[10px] text-day-muted dark:text-night-muted truncate">
            {subtitle}
          </div>
        ) : null}
      </div>
    </button>
  );
}

function Pill({ active, onClick, icon: Icon, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex flex-1 items-center justify-center gap-1 rounded border px-1.5 py-1.5 text-[11px] transition-colors',
        active
          ? 'border-[#84cc16] bg-[#84cc16] text-[#1a2e05]'
          : 'border-day-border dark:border-night-border bg-white dark:bg-night-surface text-day-text dark:text-night-text hover:border-[#84cc16]/60',
      )}
    >
      <Icon className="h-3 w-3" />
      <span className="truncate">{label}</span>
    </button>
  );
}

function StatChip({ label, value, hint, big }) {
  return (
    <div className="rounded-md border border-day-border dark:border-night-border bg-white dark:bg-night-surface px-2 py-1.5">
      <div className="text-[9.5px] font-semibold uppercase tracking-wider text-day-muted dark:text-night-muted">
        {label}
      </div>
      <div
        className={cn(
          'mt-0.5 font-semibold tabular-nums text-day-text dark:text-night-text truncate',
          big ? 'text-[14px]' : 'text-[12px]',
        )}
      >
        {value}
      </div>
      {hint ? (
        <div className="text-[9.5px] text-day-muted dark:text-night-muted mt-0.5 truncate">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Polygon-source picker — collates polygon-capable layers from every
// loaded source (regions, secondary catalog, uploads, DB layers).
// ---------------------------------------------------------------------------

function usePolygonLayerOptions() {
  const { visibleLayers: regionVisible } = useRegionLayers();
  const {
    layers: secondaryLayers,
    visibleLayers: secondaryVisible,
    uploads,
    dbLayers,
  } = useSecondary();

  return useMemo(() => {
    const list = [];

    for (const id of regionVisible) {
      const { regionId, layerKey } = parseRegionLayerId(id);
      const url = regionLayerUrl(regionId, layerKey);
      if (!url) continue;
      list.push({
        id,
        kind: 'region',
        label: `${regionPretty(regionId)} · ${layerKey}`,
        source: `region:${regionId}:${layerKey}`,
        url,
      });
    }

    for (const l of secondaryLayers) {
      if (l.geometry !== 'polygon') continue;
      if (!secondaryVisible.has(l.id)) continue;
      const url = secondaryLayerUrl(l.id);
      if (!url) continue;
      list.push({
        id: l.id,
        kind: 'secondary',
        label: l.label,
        source: `secondary:${l.id}`,
        url,
      });
    }

    for (const u of uploads) {
      if ((u.geometry || 'polygon') !== 'polygon') continue;
      if (!secondaryVisible.has(u.id)) continue;
      list.push({
        id: u.id,
        kind: 'upload',
        label: u.label,
        source: `upload:${u.id}`,
        data: u.data,
      });
    }

    for (const l of dbLayers) {
      if ((l.geometry || 'polygon') !== 'polygon') continue;
      if (!secondaryVisible.has(l.id)) continue;
      list.push({
        id: l.id,
        kind: 'db',
        label: l.label || l.table,
        source: `db:${l.id}`,
        data: l.data,
      });
    }

    return list;
  }, [regionVisible, secondaryLayers, secondaryVisible, uploads, dbLayers]);
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export default function GeoAnalysisPanel() {
  const { map } = useMapView();
  const { groups: rasterGroups, getGroupDecoded } = useRasters();

  const [opId, setOpId] = useState('zonal');
  const [rasterGroupId, setRasterGroupId] = useState(null);
  const [maskOpt, setMaskOpt] = useState(null);
  const [aoiMode, setAoiMode] = useState('layer');
  const [drawnAoi, setDrawnAoi] = useState(null);
  const [maskData, setMaskData] = useState(null);
  const [maskLoading, setMaskLoading] = useState(false);
  const [maskError, setMaskError] = useState(null);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [runError, setRunError] = useState(null);
  const [exporting, setExporting] = useState(false);
  // Armed-for-deletion state — set by clicking the drawn AOI on the
  // map. Pressing Delete/Backspace while armed clears the polygon.
  const [armed, setArmed] = useState(false);

  const cancelDrawRef = useRef(null);
  const polyLayerOptions = usePolygonLayerOptions();
  const visibleRasterGroups = useMemo(
    () => rasterGroups.filter((g) => g.visible),
    [rasterGroups],
  );

  // Auto-select sensible defaults on first mount — the user almost
  // always wants the one visible raster + one visible polygon layer.
  useEffect(() => {
    if (!rasterGroupId && visibleRasterGroups.length) {
      setRasterGroupId(visibleRasterGroups[0].id);
    }
    if (!maskOpt && polyLayerOptions.length) {
      setMaskOpt(polyLayerOptions[0]);
    }
  }, [visibleRasterGroups, polyLayerOptions, rasterGroupId, maskOpt]);

  // Cleanup on unmount — cancel any active draw mode and strip the
  // dashed AOI overlay from the map so closing the toolbox returns
  // the map to a clean state.
  useEffect(() => {
    return () => {
      if (cancelDrawRef.current) {
        cancelDrawRef.current();
        cancelDrawRef.current = null;
      }
      if (map) clearDraw(map);
    };
  }, [map]);

  // Reset results whenever the source selection changes — stale numbers
  // surviving a layer swap is the kind of bug that erodes trust quickly.
  useEffect(() => {
    setResult(null);
    setRunError(null);
  }, [rasterGroupId, maskOpt, aoiMode, drawnAoi]);

  // Fetch the mask GeoJSON whenever the user picks a polygon layer.
  // The full layer is needed in every AOI mode — `layer` uses every
  // feature, `rect`/`poly` use it as the pool that the drawn lasso
  // filters against.
  useEffect(() => {
    if (!maskOpt) {
      setMaskData(null);
      return;
    }
    if (maskOpt.data) {
      setMaskData(maskOpt.data);
      return;
    }
    if (!maskOpt.url) return;
    let cancelled = false;
    setMaskLoading(true);
    setMaskError(null);
    fetchGeoJson(maskOpt.url)
      .then((d) => {
        if (!cancelled) setMaskData(d);
      })
      .catch((err) => {
        if (!cancelled) setMaskError(err.message || 'Failed to load layer');
      })
      .finally(() => {
        if (!cancelled) setMaskLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [maskOpt]);

  // Switching the polygon layer invalidates the current lasso
  // selection. Clear it AND — when the user is in a draw mode — restart
  // the draw so the crosshair stays armed without forcing them back to
  // the Rectangle / Polygon pill.
  useEffect(() => {
    setDrawnAoi(null);
    setArmed(false);
    if (map) clearDraw(map);
    if (cancelDrawRef.current) {
      cancelDrawRef.current();
      cancelDrawRef.current = null;
    }
    if (aoiMode === 'rect') startRectDraw();
    else if (aoiMode === 'poly') startPolyDraw();
    // Deps intentionally limited to `maskOpt` — the mode-change path
    // already handles draw restarts when the user flips the pill, and
    // including `map` / `aoiMode` / the start fns would re-fire this
    // when those settle on mount and stomp the user's draw.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maskOpt]);

  // The drawn shape (rect/poly) is a *selection lasso* — we intersect
  // it against the polygon layer's features and use the matching subset
  // as the AOI. The lasso itself is discarded after selection so the
  // user sees only the selected features highlighted on the map.
  const finishLassoSelection = (lassoFC) => {
    cancelDrawRef.current = null;
    if (!maskData) {
      // No layer loaded yet — fall back to the lasso itself so the
      // user still gets a usable AOI rather than nothing.
      setDrawnAoi(lassoFC);
      return;
    }
    const selected = selectFeaturesByMask(maskData, lassoFC);
    setDrawnAoi(selected);
  };

  const startRectDraw = () => {
    if (!map) return;
    if (cancelDrawRef.current) cancelDrawRef.current();
    cancelDrawRef.current = drawRectangle(map, {
      onComplete: (fc) => finishLassoSelection(fc),
    });
  };

  const startPolyDraw = () => {
    if (!map) return;
    if (cancelDrawRef.current) cancelDrawRef.current();
    cancelDrawRef.current = drawPolygon(map, {
      onComplete: (fc) => finishLassoSelection(fc),
      onCancel: () => {
        cancelDrawRef.current = null;
      },
    });
  };

  const handleAoiModeChange = (mode) => {
    setAoiMode(mode);
    setArmed(false);
    if (cancelDrawRef.current) {
      cancelDrawRef.current();
      cancelDrawRef.current = null;
    }
    if (mode === 'layer') {
      setDrawnAoi(null);
      if (map) clearDraw(map);
    } else if (mode === 'rect') {
      setDrawnAoi(null);
      startRectDraw();
    } else if (mode === 'poly') {
      setDrawnAoi(null);
      startPolyDraw();
    }
  };

  // Clear the drawn AOI — used by the Trash button and by the keyboard
  // Delete shortcut once a polygon has been clicked-to-arm.
  const clearAoi = () => {
    if (cancelDrawRef.current) {
      cancelDrawRef.current();
      cancelDrawRef.current = null;
    }
    setDrawnAoi(null);
    setArmed(false);
    setResult(null);
    if (map) clearDraw(map);
  };

  // Click-on-AOI → arm; click outside → disarm. Only meaningful once a
  // drawn polygon exists and the user isn't mid-draw.
  useEffect(() => {
    if (!map || !drawnAoi) {
      setArmed(false);
      return;
    }
    const unwatch = watchAoiClicks(map, {
      onSelect: () => setArmed(true),
      onDeselect: () => setArmed(false),
    });
    return unwatch;
  }, [map, drawnAoi]);

  // Repaint the AOI in red when armed so the visual matches the
  // about-to-be-deleted state on the map.
  useEffect(() => {
    if (!map || !drawnAoi) return;
    showAoiOnMap(map, drawnAoi, { armed });
  }, [map, drawnAoi, armed]);

  // Delete / Backspace clears an armed AOI. Scoped to keydown so it
  // doesn't fight typing inside an input — ignore the event when the
  // target is a form control.
  useEffect(() => {
    if (!armed) return;
    const onKey = (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const t = e.target;
      const tag = (t?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || t?.isContentEditable) return;
      e.preventDefault();
      clearAoi();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // clearAoi is stable enough for this short-lived listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed]);

  const effectiveMask = useMemo(() => {
    if (aoiMode === 'rect' || aoiMode === 'poly') return drawnAoi;
    return maskData;
  }, [aoiMode, drawnAoi, maskData]);

  const rasterGroup = rasterGroups.find((g) => g.id === rasterGroupId) || null;
  const rasterDecoded = rasterGroup ? getGroupDecoded(rasterGroup.id) : null;
  // An empty selection (lasso missed every feature) yields a non-null
  // FC with `features: []` — block Run in that case so we never call
  // zonalStatistics with an empty mask.
  const canRun = !!(rasterDecoded?.band && effectiveMask?.features?.length);

  const handleRun = async () => {
    if (!canRun) return;
    setRunning(true);
    setRunError(null);
    setResult(null);
    try {
      // Yield once so the spinner paints before the synchronous compute
      // blocks the main thread for sizable rasters.
      await new Promise((r) => setTimeout(r, 0));
      const stats = zonalStatistics(rasterDecoded, effectiveMask);
      setResult(stats);
    } catch (err) {
      setRunError(err.message || 'Analysis failed.');
    } finally {
      setRunning(false);
    }
  };

  const maskOptLabel = () => {
    if (aoiMode === 'rect') return 'Drawn rectangle';
    if (aoiMode === 'poly') return 'Drawn polygon';
    return maskOpt?.label || 'Unknown';
  };
  const maskSourceLabel = () => {
    if (aoiMode === 'rect') return 'On-map rectangle';
    if (aoiMode === 'poly') return 'On-map polygon';
    return maskOpt?.source || '';
  };

  const handleExport = async () => {
    if (!result || !rasterGroup) return;
    setExporting(true);
    try {
      // Capture the map canvas. preserveDrawingBuffer is enabled on the
      // Map constructor; without that flag the WebGL buffer is cleared
      // after every composite and toDataURL returns a blank PNG.
      //
      // We still force a fresh paint (triggerRepaint + await a real
      // render event, with a small fallback timeout) so the yellow
      // selection overlay we just pushed onto the map is visible in
      // the captured frame.
      let mapImageDataUrl = null;
      if (map) {
        if (effectiveMask) showAoiOnMap(map, effectiveMask);
        await new Promise((resolve) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            map.off('render', finish);
            resolve();
          };
          map.on('render', finish);
          map.triggerRepaint?.();
          setTimeout(finish, 600);
        });
        try {
          mapImageDataUrl = map.getCanvas().toDataURL('image/png');
        } catch {
          mapImageDataUrl = null;
        }
      }

      const activeLayer = rasterGroup.layers[rasterGroup.activeIndex] || rasterGroup.layers[0];
      const dataStats = rasterGroup.dataStats || {};
      const style = rasterGroup.style || {};
      // Pixel size (X / Y) — derived from the decoded raster bounds.
      // Mirrored for the PDF report as the raster's most useful "scale"
      // identifier. Approximate metres are computed at the raster's
      // centre latitude (cosine correction), good enough for human
      // interpretation; precise distances depend on row latitude.
      const pixelSize = (() => {
        const b = rasterDecoded?.bounds;
        const w = rasterDecoded?.width;
        const h = rasterDecoded?.height;
        if (!b || b.length < 4 || !w || !h) return null;
        const [tl, , br] = b;
        if (!Array.isArray(tl) || !Array.isArray(br)) return null;
        const [west, north] = tl;
        const [east, south] = br;
        if (![west, north, east, south].every(Number.isFinite)) return null;
        const dx = Math.abs(east - west) / w;
        const dy = Math.abs(north - south) / h;
        const centerLat = (north + south) / 2;
        const mLat = 111320;
        const mLon = mLat * Math.cos((centerLat * Math.PI) / 180);
        const xM = dx * mLon;
        const yM = dy * mLat;
        const fmtDeg = (v) => {
          const s = v.toFixed(6);
          return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
        };
        const fmtM = (v) =>
          v >= 1000 ? `${(v / 1000).toFixed(2)} km` : `${v.toFixed(0)} m`;
        return `X ${fmtDeg(dx)}° (~${fmtM(xM)})   |   Y ${fmtDeg(dy)}° (~${fmtM(yM)})`;
      })();
      // Heuristic: population rasters (GHSL-derived files we ship use
      // names like `global_pop_2025_*.tif`) carry persons-per-cell.
      // Fall back to a generic explanation otherwise — the user can
      // override per-raster by editing this string later.
      const isPopRaster = /pop|ghsl|population/i.test(rasterGroup.name || '');
      const valueInterpretation = isPopRaster
        ? 'Each pixel stores the estimated number of people living inside its grid cell ' +
          '(GHSL R2025A convention: persons per ~1 km² cell). Sum gives the total population ' +
          'inside the selected AOI; Mean is the per-cell average. Zero pixels are valid (uninhabited) ' +
          'and should not be excluded from the Sum.'
        : null;
      generateGeoAnalysisReport({
        operation: 'Zonal Statistics',
        rasterLayer: {
          name: activeLayer?.name,
          label: rasterGroup.name,
          dataMin: dataStats.dataMin,
          dataMax: dataStats.dataMax,
          unit: style.unit,
          cellSize: pixelSize,
          // Symbology fields for the PDF Legend / Raster details sections.
          colormap: style.colormap,
          colormapReversed: !!style.colormapReversed,
          mode: style.mode,
          classes: style.classes,
          autoStretch: style.autoStretch,
          styleMin: style.min,
          styleMax: style.max,
          valueInterpretation,
          aggregateLabel: 'Sum within AOI',
        },
        maskLayer: {
          name: maskOptLabel(),
          label: maskOptLabel(),
          source: maskSourceLabel(),
          featureCount: effectiveMask?.features?.length ?? 0,
        },
        stats: result,
        mapImageDataUrl,
        valueUnitLabel: rasterGroup.style?.unit || '',
        notes:
          'Generated by the National GLOF Monitoring dashboard. ' +
          'Pixel values inside the AOI are summed bit-exactly from the source raster; ' +
          'no resampling or projection is applied. CRS: EPSG:4326.',
        filename: `geo-analysis_${slug(rasterGroup.name)}_${slug(maskOptLabel())}_${ts()}.pdf`,
      });
    } finally {
      setExporting(false);
    }
  };

  const aoiSummary = useMemo(() => {
    const fc = effectiveMask;
    if (!fc) return null;
    const features = fc.features || [];
    const bbox = bboxOfFeatureCollection(fc);
    return { featureCount: features.length, bbox };
  }, [effectiveMask]);

  const isSelectionMode = aoiMode === 'rect' || aoiMode === 'poly';
  const layerTotal = maskData?.features?.length ?? null;

  const activeOp = OPS.find((o) => o.id === opId);

  return (
    <div className="flex flex-col gap-3">
      {/* Operation selector — dropdown so labels never wrap in the
          narrow sidebar. */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-semibold uppercase tracking-[0.1em] text-day-muted dark:text-night-muted">
          Operation
        </label>
        <OperationListbox value={opId} onChange={setOpId} />
        {activeOp?.description ? (
          <p className="text-[10.5px] text-day-muted dark:text-night-muted leading-tight">
            {activeOp.description}
          </p>
        ) : null}
      </div>

      {/* Step 1: Source raster */}
      <Step
        index={1}
        title="Source raster"
        hint="Pick a visible raster layer."
        done={!!rasterGroup}
      >
        {visibleRasterGroups.length === 0 ? (
          <div className="text-[11px] text-day-muted dark:text-night-muted bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded px-2 py-1.5">
            No visible raster layers. Open the Raster Layers panel and
            toggle one on first.
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto pr-0.5">
            {visibleRasterGroups.map((g) => (
              <LayerCard
                key={g.id}
                active={g.id === rasterGroupId}
                onClick={() => setRasterGroupId(g.id)}
                icon={LayersIcon}
                title={g.name}
                subtitle={g.layers[0]?.name}
              />
            ))}
          </div>
        )}
      </Step>

      {/* Step 2: AOI */}
      <Step
        index={2}
        title="Area of interest"
        hint="Pick a polygon layer, then optionally narrow it down by drawing a selection lasso."
        done={!!effectiveMask}
      >
        {/* Polygon-layer picker — required in every mode. */}
        {polyLayerOptions.length === 0 ? (
          <div className="text-[11px] text-day-muted dark:text-night-muted bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded px-2 py-1.5">
            No visible polygon layers. Turn one on in the layer panel.
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 max-h-32 overflow-y-auto pr-0.5">
            {polyLayerOptions.map((l) => (
              <LayerCard
                key={l.source}
                active={maskOpt?.source === l.source}
                onClick={() => setMaskOpt(l)}
                icon={Hexagon}
                title={l.label}
                subtitle={l.kind}
              />
            ))}
          </div>
        )}

        {/* Selection mode pills — apply to the chosen layer above. */}
        <div className="flex gap-1 pt-1">
          {AOI_MODES.map((m) => (
            <Pill
              key={m.id}
              active={aoiMode === m.id}
              onClick={() => handleAoiModeChange(m.id)}
              icon={m.icon}
              label={m.label}
            />
          ))}
        </div>
        <p className="text-[10.5px] text-day-muted dark:text-night-muted leading-tight">
          {AOI_MODES.find((m) => m.id === aoiMode)?.hint}
        </p>

        {(aoiMode === 'rect' || aoiMode === 'poly') && !drawnAoi ? (
          <div className="flex items-start gap-1.5 text-[11px] text-[#84cc16]">
            <MousePointerSquareDashed className="h-3 w-3 shrink-0 mt-0.5" />
            <span>
              {aoiMode === 'rect'
                ? 'Click and drag on the map to select features inside a rectangle.'
                : 'Click on the map to add vertices. Double-click to finish, right-click or Esc to cancel.'}
            </span>
          </div>
        ) : null}

        {maskLoading ? (
          <div className="inline-flex items-center gap-1.5 text-[11px] text-day-muted dark:text-night-muted">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading layer…
          </div>
        ) : null}
        {maskError ? (
          <div className="inline-flex items-start gap-1.5 text-[11px] text-red-600 dark:text-red-400">
            <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" /> {maskError}
          </div>
        ) : null}

        {aoiSummary ? (
          <div
            className={cn(
              'rounded border px-2 py-1 text-[10.5px] tabular-nums',
              armed
                ? 'border-red-500/60 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
                : aoiSummary.featureCount === 0
                  ? 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300'
                  : 'border-day-border dark:border-night-border bg-white dark:bg-night-surface text-day-muted dark:text-night-muted',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate">
                {isSelectionMode ? (
                  <>
                    <span
                      className={cn(
                        'font-semibold',
                        armed
                          ? 'text-red-800 dark:text-red-200'
                          : aoiSummary.featureCount === 0
                            ? 'text-amber-800 dark:text-amber-300'
                            : 'text-day-text dark:text-night-text',
                      )}
                    >
                      {aoiSummary.featureCount}
                    </span>
                    {' of '}
                    {layerTotal ?? '—'}
                    {' selected'}
                  </>
                ) : (
                  <>
                    {aoiSummary.featureCount} feature{aoiSummary.featureCount === 1 ? '' : 's'}
                    {' · all'}
                  </>
                )}
              </span>
              {isSelectionMode && drawnAoi ? (
                <button
                  type="button"
                  onClick={clearAoi}
                  title="Clear selection"
                  aria-label="Clear selection"
                  className={cn(
                    'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors',
                    armed
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'text-day-muted dark:text-night-muted hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400',
                  )}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              ) : null}
            </div>
            {armed ? (
              <div className="mt-0.5 text-[10px] text-red-700 dark:text-red-300">
                Selection armed — press Delete to clear, or click outside to cancel.
              </div>
            ) : isSelectionMode && aoiSummary.featureCount === 0 ? (
              <div className="mt-0.5 text-[10px]">
                Lasso missed every feature. Draw again to retry.
              </div>
            ) : isSelectionMode && drawnAoi ? (
              <div className="mt-0.5 text-[10px] text-day-muted dark:text-night-muted">
                Click a selected feature on the map to arm, then press Delete to clear.
              </div>
            ) : null}
          </div>
        ) : null}
      </Step>

      {/* Step 3: Results */}
      <Step
        index={3}
        title="Results"
        hint="Statistics inside the AOI mask."
        done={!!result}
      >
        {runError ? (
          <div className="inline-flex items-start gap-1.5 text-[11px] text-red-600 dark:text-red-400">
            <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
            <span>{runError}</span>
          </div>
        ) : null}

        {!result && !runError ? (
          <div className="text-[11px] text-day-muted dark:text-night-muted">
            Run the analysis to see the headline numbers and the full
            distribution here.
          </div>
        ) : null}

        {result ? (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-2"
          >
            <div className="grid grid-cols-2 gap-1.5">
              <StatChip
                big
                label="Sum"
                value={formatIntegerWithCommas(result.sum)}
                hint="Σ values"
              />
              <StatChip
                big
                label="Pixels"
                value={formatIntegerWithCommas(result.count)}
                hint={`${result.coveragePct.toFixed(1)}% of bbox`}
              />
              <StatChip
                label="Mean"
                value={formatStatNumber(result.mean, 2)}
              />
              <StatChip
                label="Median"
                value={formatStatNumber(result.median, 2)}
              />
            </div>

            <div className="rounded border border-day-border dark:border-night-border bg-white dark:bg-night-surface overflow-hidden">
              <div className="grid grid-cols-[1fr_auto] divide-y divide-day-border dark:divide-night-border text-[11px]">
                {[
                  ['Min', formatStatNumber(result.min, 4)],
                  ['Max', formatStatNumber(result.max, 4)],
                  ['Std dev', formatStatNumber(result.std, 4)],
                  ['p10', formatStatNumber(result.p10, 4)],
                  ['p25', formatStatNumber(result.p25, 4)],
                  ['p75', formatStatNumber(result.p75, 4)],
                  ['p90', formatStatNumber(result.p90, 4)],
                ].map(([k, v]) => (
                  <div key={k} className="contents">
                    <div className="px-2 py-1 text-day-muted dark:text-night-muted">{k}</div>
                    <div className="px-2 py-1 text-right tabular-nums text-day-text dark:text-night-text">
                      {v}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        ) : null}
      </Step>

      {/* Sticky action bar — pinned to the bottom of the panel's scroll
          area so Run / Export stay one click away regardless of how
          much intermediate content the user has scrolled past. */}
      <div className="sticky -bottom-2 -mx-2.5 -mb-2 px-2.5 pt-2 pb-4 bg-day-surface dark:bg-night-surface border-t border-day-border dark:border-night-border shadow-[0_-6px_10px_-6px_rgba(0,0,0,0.12)] dark:shadow-[0_-6px_10px_-6px_rgba(0,0,0,0.45)]">
        <div className="text-[10.5px] text-day-muted dark:text-night-muted leading-tight mb-1.5 truncate">
          {result
            ? `Done · ${formatIntegerWithCommas(result.count)} pixels · ${result.elapsedMs} ms`
            : canRun
              ? 'Ready to run.'
              : 'Pick a raster + AOI to enable.'}
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={handleExport}
            disabled={!result || exporting}
            className={cn(
              'flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[11.5px] font-medium transition-colors',
              result
                ? 'border-day-border dark:border-night-border bg-white dark:bg-night-surface text-day-text dark:text-night-text hover:border-[#84cc16]/60'
                : 'border-day-border dark:border-night-border bg-day-bg/40 dark:bg-night-bg/40 text-day-muted dark:text-night-muted cursor-not-allowed',
            )}
          >
            <FileDown className="h-3 w-3" />
            {exporting ? 'Building…' : 'Export PDF'}
          </button>
          <button
            type="button"
            onClick={handleRun}
            disabled={!canRun || running}
            className={cn(
              'flex-1 inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] font-medium transition-colors',
              canRun && !running
                ? 'bg-[#84cc16] text-[#1a2e05] hover:bg-[#65a30d]'
                : 'bg-day-bg dark:bg-night-bg text-day-muted dark:text-night-muted cursor-not-allowed',
            )}
          >
            {running ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            {running ? 'Running…' : 'Run'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Filename helpers
function slug(s) {
  return String(s || 'layer')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}
function ts() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
