import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import shp from 'shpjs';
import {
  AlertTriangle,
  Building2,
  Database,
  Droplets,
  FileArchive,
  FileJson,
  FileUp,
  Landmark,
  Map as MapIcon,
  MapPin,
  Mountain,
  Radio,
  RadioTower,
  Server,
  Shrink,
  Table2,
  TableProperties,
  Triangle,
  Trash2,
  Waves,
} from 'lucide-react';
import EyeToggle from '@/components/ui/EyeToggle';
import Badge from '@/components/ui/Badge';
import ConnectDatabaseModal from '@/components/dashboard/ConnectDatabaseModal';
import BrowseDatabaseModal from '@/components/dashboard/BrowseDatabaseModal';
import Tooltip from '@/components/ui/Tooltip';
import TruncateLabel from '@/components/ui/TruncateLabel';
import { cn } from '@/utils/cn';
import { useSecondary } from '@/contexts/SecondaryContext';
import { useMapView } from '@/contexts/MapContext';
import { useAttributeTables } from '@/contexts/AttributeTablesContext';
import { effectiveStyle } from '@/utils/layerStyle';
import { resolveMarkerIcon } from '@/config/markerIcons';
import {
  equalIntervalBreaks,
  rampById,
  sampleRampColors,
} from '@/utils/stylePalettes';

const MAX_UPLOADS = 5;

// Per-layer icon — purely cosmetic, helps users scan the list.
const LAYER_ICONS = {
  national_boundary:    Landmark,
  provincial_boundary:  Landmark,
  glof_districts:       MapIcon,
  glof_basins:          Droplets,
  glof_lakes:           Waves,
  glof_valley:          Mountain,
  akah_infrastructure:  Building2,
  akah_hazard_exposure: Triangle,
  all_stations:         Radio,
  glacial_lakes:        Waves,
  settlements:          MapPin,
  cell_towers:          RadioTower,
};

const ACCEPTED_TYPES = '.geojson,.json,application/geo+json,application/json,.zip,application/zip';

// ---------------------------------------------------------------------------
// Layer legend — QGIS-style summary that auto-renders below a toggled-on
// row, reflecting whatever symbology the right-sidebar Palette panel is
// currently applying. Reads `style.type` to switch between simple swatch /
// categories list / color- or size-range gradient / heatmap density.
// ---------------------------------------------------------------------------

// CSS facsimile of the on-map marker, sized for the sidebar legend.
// Mirrors the colour rules from `src/utils/markerImage.js`:
//   • shape 'circle' / 'square' — bg fill + stroke + icon on top.
//     When bg === fillColor (i.e. user didn't pick a distinct bg)
//     the icon auto-contrasts to black or white so it stays legible.
//   • shape 'none' — bare icon coloured with fillColor.
//
// Three icon kinds share the slot:
//   • lucide — stroked icon component painted with iconColor.
//   • emoji  — rendered as a text glyph; ignores iconColor (the emoji
//              font carries its own colours).
//   • custom — user-uploaded SVG/PNG embedded as <img> with object-fit
//              contain, so non-square uploads still fit the chip.
function MarkerSwatch({ style, marker }) {
  const resolved = resolveMarkerIcon(marker.icon);
  const fill = style.fillColor || '#16a085';
  const stroke = style.strokeColor || '#0f7560';
  const bg = marker.backgroundColor || fill;
  const sameBg = bg.replace(/^#/, '').toLowerCase() === fill.replace(/^#/, '').toLowerCase();
  const iconColor = sameBg ? autoContrast(bg) : fill;
  const noShape = marker.shape === 'none' || !marker.shape;

  // Pick the right inner-icon node for the chosen kind. Sizes differ
  // slightly between the no-shape branch (bare icon, larger) and the
  // shape branch (icon nested inside the bg, smaller).
  const renderIcon = (sizeClass, color, weight) => {
    if (resolved?.kind === 'lucide' && resolved.Component) {
      const Icon = resolved.Component;
      return (
        <Icon
          className={sizeClass}
          style={{ color }}
          strokeWidth={weight}
        />
      );
    }
    if (resolved?.kind === 'emoji') {
      return (
        <span
          className={cn(sizeClass, 'leading-none inline-flex items-center justify-center')}
          aria-hidden
        >
          {resolved.char}
        </span>
      );
    }
    if (resolved?.kind === 'custom') {
      return (
        <img
          src={resolved.dataUrl}
          alt=""
          aria-hidden
          className={cn(sizeClass, 'object-contain')}
        />
      );
    }
    return null;
  };

  if (noShape) {
    const inner = renderIcon('h-3.5 w-3.5', fill, 2.25);
    if (inner) return inner;
    return (
      <span
        className="inline-block h-3 w-3 rounded-full border"
        style={{ backgroundColor: fill, borderColor: stroke }}
      />
    );
  }
  // Two stacked layers — bg shape via the outer span's own background,
  // icon via an absolute child that's flex-centred against the same
  // bounds. Keeps the icon's centre independent of any baseline drift
  // the inline `<img>` / emoji glyph would otherwise inherit.
  const isCircle = marker.shape === 'circle';
  return (
    <span
      className={cn(
        'relative inline-block h-4 w-4 shrink-0 align-middle overflow-hidden',
        isCircle ? 'rounded-full' : 'rounded-[3px]',
      )}
      style={{
        background: bg,
        border: `1px solid ${stroke}`,
      }}
    >
      <span className="absolute inset-0 flex items-center justify-center">
        {renderIcon('h-2.5 w-2.5', iconColor, 2.5)}
      </span>
    </span>
  );
}

// YIQ luminance threshold — same heuristic as utils/markerImage.js.
function autoContrast(hex) {
  if (!hex) return '#ffffff';
  const s = hex.replace(/^#/, '');
  const v = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16);
  if (Number.isNaN(v)) return '#ffffff';
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  return (r * 299 + g * 587 + b * 114) / 1000 >= 128 ? '#000000' : '#ffffff';
}

function SimpleSwatch({ style, geometry }) {
  if (geometry === 'point') {
    const marker = style.marker || {};
    const useMarker =
      (marker.shape && marker.shape !== 'none') || !!marker.icon;
    if (useMarker) {
      return <MarkerSwatch style={style} marker={marker} />;
    }
    return (
      <span
        className="inline-block h-3 w-3 rounded-full border"
        style={{
          backgroundColor: style.fillColor,
          borderColor: style.strokeColor,
        }}
      />
    );
  }
  if (geometry === 'line') {
    return (
      <span
        className="inline-block h-[3px] w-5 rounded-sm"
        style={{ backgroundColor: style.color }}
      />
    );
  }
  // polygon
  return (
    <span
      className="inline-block h-3 w-5 rounded-sm border"
      style={{
        backgroundColor: style.fillColor,
        borderColor: style.strokeColor,
      }}
    />
  );
}

function GradientBar({ stops, label, minLabel, maxLabel }) {
  return (
    <div className="flex flex-col gap-0.5">
      {label && (
        <span className="text-[11px] text-day-muted dark:text-night-muted">
          {label}
        </span>
      )}
      <div
        className="h-2 rounded-sm"
        style={{ background: `linear-gradient(to right, ${stops.join(', ')})` }}
      />
      <div className="flex items-center justify-between text-[10px] tabular-nums text-day-muted dark:text-night-muted">
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  );
}

function fmtNum(n) {
  if (n == null || !Number.isFinite(Number(n))) return '';
  const v = Number(n);
  if (Math.abs(v) >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (Math.abs(v) >= 1)    return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function LayerLegend({ id, geometry }) {
  const { styles } = useSecondary();
  const style = effectiveStyle(id, geometry, styles[id]);

  if (style.type === 'categories' && (style.categories?.length ?? 0) > 0) {
    return (
      <div className="flex flex-col gap-1 px-2.5 py-1.5">
        <span className="text-[11px] text-day-muted dark:text-night-muted">
          {style.colorBy}
        </span>
        {style.categories.slice(0, 8).map((c, i) => (
          <div key={`${c.value}:${i}`} className="flex items-center gap-1.5 min-w-0">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm border border-black/10 dark:border-white/10"
              style={{ backgroundColor: c.color }}
            />
            <span className="text-[12px] truncate text-day-text dark:text-night-text">
              {String(c.value)}
            </span>
          </div>
        ))}
        {style.categories.length > 8 && (
          <span className="text-[11px] italic text-day-muted dark:text-night-muted">
            …{style.categories.length - 8} more
          </span>
        )}
        {style.showOther && (
          <div className="flex items-center gap-1.5 min-w-0 mt-0.5 pt-1 border-t border-day-border/50 dark:border-night-border/50">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm border border-black/10 dark:border-white/10"
              style={{ backgroundColor: style.otherColor }}
            />
            <span className="text-[12px] italic text-day-muted dark:text-night-muted">
              Other
            </span>
          </div>
        )}
      </div>
    );
  }

  if (style.type === 'colorRange' && style.rangeBy) {
    const ramp = rampById(style.rampId);
    const stops = style.rampReversed ? [...ramp.stops].reverse() : ramp.stops;

    // Classified — render one row per class with its bucket range, the
    // same way QGIS's Graduated symbology preview reads.
    if (
      style.classMode === 'classified' &&
      style.rangeMin != null &&
      style.rangeMax != null
    ) {
      const n = Math.max(2, Math.min(10, Math.floor(style.classCount) || 5));
      const breaks = equalIntervalBreaks(style.rangeMin, style.rangeMax, n);
      const colors = sampleRampColors(stops, n);
      const lower = [style.rangeMin, ...breaks];
      const upper = [...breaks, style.rangeMax];
      return (
        <div className="px-2.5 py-1.5 flex flex-col gap-1">
          <span className="text-[11px] text-day-muted dark:text-night-muted">
            {style.rangeBy}
          </span>
          {colors.map((c, i) => (
            <div key={`${c}:${i}`} className="flex items-center gap-1.5 min-w-0">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm border border-black/10 dark:border-white/10"
                style={{ backgroundColor: c }}
              />
              <span className="text-[12px] tabular-nums text-day-text dark:text-night-text">
                {fmtNum(lower[i])} – {fmtNum(upper[i])}
              </span>
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className="px-2.5 py-1.5">
        <GradientBar
          stops={stops}
          label={style.rangeBy}
          minLabel={fmtNum(style.rangeMin)}
          maxLabel={fmtNum(style.rangeMax)}
        />
      </div>
    );
  }

  if (style.type === 'sizeRange' && style.sizeBy) {
    const cap = (n) => Math.max(2, Math.min(18, Number(n) || 0));
    return (
      <div className="px-2.5 py-1.5 flex flex-col gap-1">
        <span className="text-[11px] text-day-muted dark:text-night-muted">
          {style.sizeBy}
        </span>
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col items-center gap-0.5">
            <span
              className="rounded-full bg-[#16a085]"
              style={{ width: cap(style.sizeMin), height: cap(style.sizeMin) }}
            />
            <span className="text-[10px] tabular-nums text-day-muted dark:text-night-muted">
              {fmtNum(style.rangeMin)}
            </span>
          </div>
          <div className="flex-1 h-px bg-day-border dark:bg-night-border" />
          <div className="flex flex-col items-center gap-0.5">
            <span
              className="rounded-full bg-[#16a085]"
              style={{ width: cap(style.sizeMax), height: cap(style.sizeMax) }}
            />
            <span className="text-[10px] tabular-nums text-day-muted dark:text-night-muted">
              {fmtNum(style.rangeMax)}
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (style.type === 'heatmap') {
    const ramp = rampById(style.rampId);
    const stops = style.rampReversed ? [...ramp.stops].reverse() : ramp.stops;
    return (
      <div className="px-2.5 py-1.5">
        <GradientBar stops={stops} label="Density" minLabel="low" maxLabel="high" />
      </div>
    );
  }

  // Simple — single swatch + geometry hint.
  return (
    <div className="px-2.5 py-1.5 flex items-center gap-2">
      <SimpleSwatch style={style} geometry={geometry} />
      <span className="text-[11px] capitalize text-day-muted dark:text-night-muted">
        {geometry}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layer row — toggle + zoom + (uploads only) trash. Per-layer style editing
// lives in the right-sidebar Palette panel. The row auto-expands to show a
// QGIS-style legend below itself when the layer is toggled on.
// ---------------------------------------------------------------------------

function LayerRow({
  id,
  label,
  geometry,
  icon: Icon,
  // kind: 'secondary' (catalog) | 'upload' (user file) | 'database' (loaded
  // via Browse Database). Drives which extra controls are rendered:
  //   • trash:           upload + database
  //   • attribute table: secondary + database  (uploads have their own
  //                      attribute table panel in the right sidebar, so
  //                      we don't double up here)
  kind = 'secondary',
  uploadData,
  onRemove,
}) {
  const { visibleLayers, toggleLayer } = useSecondary();
  const { zoomToSecondaryLayer, zoomToGeoJson } = useMapView();
  const { toggleTable, closeTable, isOpen } = useAttributeTables();

  const on = visibleLayers.has(id);
  const isInMemory = kind === 'upload' || kind === 'database';
  const canRemove = kind === 'upload' || kind === 'database';
  const canTable = kind === 'secondary' || kind === 'database';

  const handleZoom = () => {
    if (isInMemory) zoomToGeoJson(uploadData);
    else zoomToSecondaryLayer(id);
  };

  // Toggling visibility also frames the layer — same UX as the region
  // accordion so users always end up looking at what they just changed.
  const handleToggle = () => {
    toggleLayer(id);
    handleZoom();
  };

  const tableId =
    kind === 'database' ? `db:${id}` : `secondary:${id}`;
  const tableOpen = isOpen(tableId);
  const handleTableToggle = () => {
    if (kind === 'secondary') {
      toggleTable({ id: tableId, kind: 'secondary', layerId: id, label });
    } else if (kind === 'database') {
      toggleTable({
        id: tableId,
        kind: 'database',
        layerId: id,
        data: uploadData,
        label,
      });
    }
  };

  return (
    <div
      className={cn(
        'rounded-md border transition-colors',
        on
          ? 'border-[#16a085]/40 bg-[#16a085]/15 dark:bg-[#16a085]/25'
          : 'border-day-border dark:border-night-border',
      )}
    >
      <div className="flex items-center gap-1 px-2 py-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0 text-brand-700 dark:text-brand-200" />
        <span className="flex-1 min-w-0">
          <TruncateLabel
            text={label}
            className="text-[14px] text-day-text dark:text-night-text"
          />
        </span>
        {canRemove && (
          <button
            type="button"
            onClick={() => {
              // Auto-close the attribute table sub-tab so the chart
              // panel doesn't end up holding a stale spec for a layer
              // the user just deleted.
              if (canTable) closeTable(tableId);
              onRemove?.();
            }}
            aria-label={`Remove ${label}`}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-red-500 dark:text-red-400 hover:bg-red-500/15 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
        {canTable && (
          <button
            type="button"
            onClick={handleTableToggle}
            aria-pressed={tableOpen}
            aria-label={
              tableOpen ? `Close ${label} attributes` : `Open ${label} attributes`
            }
            title={
              tableOpen ? `Close ${label} attributes` : `Open ${label} attributes`
            }
            className={cn(
              'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors',
              tableOpen
                ? 'bg-[#16a085]/15 text-[#16a085]'
                : 'text-day-muted dark:text-night-muted hover:text-[#16a085] hover:bg-[#16a085]/10',
            )}
          >
            <TableProperties className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
        <button
          type="button"
          onClick={handleZoom}
          title={`Zoom to ${label}`}
          aria-label={`Zoom to ${label}`}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-day-muted dark:text-night-muted hover:text-[#16a085] hover:bg-[#16a085]/10 transition-colors"
        >
          <Shrink className="h-3.5 w-3.5" aria-hidden />
        </button>
        <EyeToggle
          checked={on}
          onChange={handleToggle}
          label={`Toggle ${label}`}
        />
      </div>
      <AnimatePresence initial={false}>
        {on && geometry && (
          <motion.div
            key="legend"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden border-t border-[#16a085]/25 dark:border-[#16a085]/30"
          >
            <LayerLegend id={id} geometry={geometry} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upload zone — drag/drop + file picker
// ---------------------------------------------------------------------------

function detectGeometryFromGeoJSON(parsed) {
  const features = Array.isArray(parsed?.features)
    ? parsed.features
    : parsed?.type === 'Feature'
      ? [parsed]
      : [];
  for (const f of features) {
    const t = f?.geometry?.type;
    if (!t) continue;
    if (t.includes('Point')) return 'point';
    if (t.includes('LineString')) return 'line';
    if (t.includes('Polygon')) return 'polygon';
  }
  return 'polygon';
}

// shp() can return a single FeatureCollection or an array of them (one per
// .shp inside the zip). Flatten everything into a single FeatureCollection
// so the rest of the app — including the attribute table — treats it like
// any other GeoJSON upload.
function normalizeShpResult(result) {
  if (Array.isArray(result)) {
    return {
      type: 'FeatureCollection',
      features: result.flatMap((fc) =>
        Array.isArray(fc?.features) ? fc.features : [],
      ),
    };
  }
  if (result?.type === 'FeatureCollection') return result;
  if (result?.type === 'Feature') {
    return { type: 'FeatureCollection', features: [result] };
  }
  return { type: 'FeatureCollection', features: [] };
}

function UploadZone() {
  const { uploads, addUpload, removeUpload } = useSecondary();
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Auto-clear error after a few seconds so it doesn't linger forever.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error]);

  const slotsLeft = Math.max(0, MAX_UPLOADS - uploads.length);

  const handleFiles = useCallback(
    async (filesIn) => {
      setError(null);
      // Cap how many we accept this batch — also enforces the rule
      // when several files are dropped at once.
      const filesArr = Array.from(filesIn);
      if (uploads.length >= MAX_UPLOADS) {
        setError(
          `Upload limit reached (${MAX_UPLOADS} files). Remove an existing file to add another.`,
        );
        return;
      }
      const acceptable = filesArr.slice(0, slotsLeft);
      const overflowed = filesArr.length - acceptable.length;

      setBusy(true);
      try {
        for (const file of acceptable) {
          const ext = file.name.split('.').pop()?.toLowerCase();
          const isGeoJson = ext === 'geojson' || ext === 'json';
          const isZip = ext === 'zip';
          if (!isGeoJson && !isZip) {
            setError(`Unsupported file type: .${ext}`);
            continue;
          }
          try {
            let parsed;
            if (isGeoJson) {
              const text = await file.text();
              parsed = JSON.parse(text);
            } else {
              const buffer = await file.arrayBuffer();
              const result = await shp(buffer);
              parsed = normalizeShpResult(result);
            }
            addUpload({
              id: `upload:${Date.now()}:${Math.random().toString(36).slice(2, 7)}:${file.name}`,
              label: file.name,
              kind: isZip ? 'shapefile' : 'geojson',
              geometry: detectGeometryFromGeoJSON(parsed),
              size: file.size,
              data: parsed,
            });
          } catch (err) {
            setError(`Failed to read ${file.name}: ${err.message ?? err}`);
          }
        }
        if (overflowed > 0) {
          setError(
            `Maximum ${MAX_UPLOADS} files allowed. ${overflowed} additional file${overflowed === 1 ? ' was' : 's were'} skipped.`,
          );
        }
      } finally {
        setBusy(false);
      }
    },
    [addUpload, uploads.length, slotsLeft],
  );

  const limitReached = uploads.length >= MAX_UPLOADS;

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={limitReached || busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          if (limitReached) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (limitReached) {
            setError(
              `Upload limit reached (${MAX_UPLOADS} files). Remove an existing file to add another.`,
            );
            return;
          }
          if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          'group flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors',
          limitReached
            ? 'border-red-500/80 bg-red-500/10 dark:bg-red-500/15 cursor-not-allowed'
            : dragging
              ? 'border-[#16a085] bg-[#16a085]/5'
              : 'border-day-border dark:border-night-border hover:border-[#16a085] hover:bg-[#16a085]/5',
        )}
      >
        <FileUp
          className={cn(
            'h-7 w-7 transition-colors',
            limitReached
              ? 'text-red-600 dark:text-red-400'
              : 'text-day-muted dark:text-night-muted group-hover:text-[#16a085]',
            busy && 'animate-pulse',
          )}
        />
        <div
          className={cn(
            'text-sm font-medium',
            limitReached
              ? 'text-red-700 dark:text-red-300'
              : 'text-day-text dark:text-night-text',
          )}
        >
          {limitReached
            ? 'Upload limit reached'
            : busy
              ? 'Reading file…'
              : (
                <>
                  Drop file here, or{' '}
                  <span className="text-[#16a085] underline-offset-2 group-hover:underline">
                    browse
                  </span>
                </>
              )}
        </div>
        <div
          className={cn(
            'text-[12px]',
            limitReached
              ? 'text-red-600/80 dark:text-red-400/80'
              : 'text-day-muted dark:text-night-muted',
          )}
        >
          {limitReached
            ? `Remove a file below to add another (${MAX_UPLOADS} max)`
            : '.geojson · .json · .zip (shapefile)'}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES}
          multiple
          disabled={limitReached || busy}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) handleFiles(e.target.files);
            e.target.value = ''; // allow re-uploading same file
          }}
        />
      </button>

      <AnimatePresence initial={false}>
        {error ? (
          <motion.div
            key="err"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            role="alert"
            className="flex items-start gap-2 rounded-md border border-amber-400/60 bg-amber-50 dark:bg-amber-900/20 px-2.5 py-1.5"
          >
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" />
            <span className="text-[12px] leading-snug text-amber-800 dark:text-amber-200">
              {error}
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {uploads.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center px-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-day-muted dark:text-night-muted">
              Uploaded
            </span>
            <span className="ml-auto text-[11px] tabular-nums text-day-muted dark:text-night-muted">
              {uploads.length} / {MAX_UPLOADS}
            </span>
          </div>
          {/* Vertical stack — same LayerRow that the canonical secondary
              layers use, so style controls + toggle behave consistently. */}
          <div className="flex flex-col gap-1.5">
            {uploads.map((u) => (
              <LayerRow
                key={u.id}
                id={u.id}
                label={u.label}
                geometry={u.geometry || 'polygon'}
                icon={u.kind === 'shapefile' ? FileArchive : FileJson}
                kind="upload"
                uploadData={u.data}
                onRemove={() => removeUpload(u.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export default function SecondaryPanel({ compact = false }) {
  const { layers, visibleLayers, dbLayers, removeDbLayer } = useSecondary();
  const visibleCount = useMemo(
    () => layers.reduce((acc, l) => acc + (visibleLayers.has(l.id) ? 1 : 0), 0),
    [layers, visibleLayers],
  );
  const [dbModalOpen, setDbModalOpen] = useState(false);
  const [browseDbOpen, setBrowseDbOpen] = useState(false);

  // In compact (mobile drawer) mode the panel sits inside an outer
  // overflow-y-auto, so the inner scroll + h-full constraints are
  // dropped — everything stacks at natural height and the drawer
  // scrolls as one. Inner section title is also dropped because the
  // mobile section header above already labels it.
  return (
    <div className={cn('flex flex-col -mx-1', !compact && 'h-full min-h-0')}>
      {/* Upper half — secondary layers */}
      <div className={cn('flex flex-col', !compact && 'flex-1 min-h-0')}>
        {!compact && (
          <div className="flex items-center gap-1.5 px-1 mb-1.5">
            <span className="label-base">Secondary Layers</span>
            <Badge tone="brand" className="ml-auto">
              {visibleCount > 0 ? `${visibleCount} / ${layers.length}` : layers.length}
            </Badge>
            <Tooltip label="Browse database tables" side="bottom" align="end">
              <button
                type="button"
                onClick={() => setBrowseDbOpen(true)}
                aria-label="Browse database tables"
                className={cn(
                  'inline-flex h-6 w-6 items-center justify-center rounded-md',
                  'text-[#16a085]',
                  'hover:bg-[#16a085] hover:text-white',
                  'transition-colors',
                )}
              >
                <Database className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          </div>
        )}

        <div
          className={cn(
            'pr-1 flex flex-col gap-1',
            !compact && 'flex-1 min-h-0 overflow-y-auto',
          )}
        >
          {layers.map((l) => (
            <LayerRow
              key={l.id}
              id={l.id}
              label={l.label}
              geometry={l.geometry}
              icon={LAYER_ICONS[l.id] ?? Mountain}
            />
          ))}

          {dbLayers.length > 0 && (
            <>
              <div className="flex items-center gap-1.5 px-1 mt-2 mb-1">
                <Database className="h-3 w-3 text-[#16a085]" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-day-muted dark:text-night-muted">
                  From Database
                </span>
                <span className="ml-auto text-[11px] tabular-nums text-day-muted dark:text-night-muted">
                  {dbLayers.length}
                </span>
              </div>
              {dbLayers.map((l) => (
                <LayerRow
                  key={l.id}
                  id={l.id}
                  label={l.label}
                  geometry={l.geometry}
                  icon={Table2}
                  kind="database"
                  uploadData={l.data}
                  onRemove={() => removeDbLayer(l.id)}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="my-3 border-t border-day-border dark:border-night-border" />

      {/* Lower half — file upload + remote DB import. The DB shortcut
          sits inline with the section heading so the two ingestion
          paths read as peers rather than one being primary. The
          button stretches to fill the right side so the row reads as
          [Upload | OR | Connect to database] with no dead space. */}
      <div className="shrink-0 flex flex-col gap-2">
        <div className="flex items-center gap-2 px-1">
          <FileUp className="h-4 w-4 text-brand-700 dark:text-brand-200 shrink-0" />
          <span className="label-base shrink-0">Upload</span>
          <span className="text-[11px] uppercase tracking-[0.08em] text-day-muted dark:text-night-muted shrink-0">
            or
          </span>
          <button
            type="button"
            onClick={() => setDbModalOpen(true)}
            className={cn(
              'group inline-flex flex-1 items-center justify-center gap-1.5',
              'rounded-md border border-[#16a085]/40 hover:border-[#16a085]',
              'px-2.5 py-1 text-[12px] font-medium',
              'text-[#16a085] hover:bg-[#16a085]/10 transition-colors',
            )}
          >
            <Server className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Connect to database</span>
          </button>
        </div>
        <UploadZone />
      </div>

      <ConnectDatabaseModal
        open={dbModalOpen}
        onClose={() => setDbModalOpen(false)}
      />
      <BrowseDatabaseModal
        open={browseDbOpen}
        onClose={() => setBrowseDbOpen(false)}
      />
    </div>
  );
}
