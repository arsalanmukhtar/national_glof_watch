import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import shp from 'shpjs';
import {
  AlertTriangle,
  Building2,
  ChevronDown,
  CircleDot,
  FileArchive,
  FileJson,
  FileUp,
  Landmark,
  MapPin,
  Mountain,
  Radio,
  RotateCcw,
  Slash,
  Square,
  Triangle,
  Trash2,
  Waves,
} from 'lucide-react';
import EyeToggle from '@/components/ui/EyeToggle';
import Badge from '@/components/ui/Badge';
import { cn } from '@/utils/cn';
import { DEFAULT_STYLES, useSecondary } from '@/contexts/SecondaryContext';

const MAX_UPLOADS = 5;

// Per-layer icon — purely cosmetic, helps users scan the list.
const LAYER_ICONS = {
  national_boundary:    Landmark,
  provincial_boundary:  Landmark,
  district_boundary:    Landmark,
  akah_infrastructure:  Building2,
  akah_hazard_exposure: Triangle,
  all_stations:         Radio,
  glacial_lakes:        Waves,
  settlements:          MapPin,
};

const ACCEPTED_TYPES = '.geojson,.json,application/geo+json,application/json,.zip,application/zip';

// ---------------------------------------------------------------------------
// Style controls — primitives
// ---------------------------------------------------------------------------

function ColorSwatch({ value, onChange, ariaLabel }) {
  // HTML5 color input wrapped so we can render a tidy rounded swatch.
  return (
    <label
      className="relative inline-flex h-6 w-6 shrink-0 cursor-pointer rounded-md border border-day-border dark:border-night-border overflow-hidden ring-offset-1 ring-offset-day-bg dark:ring-offset-night-bg focus-within:ring-2 focus-within:ring-[#16a085]"
      style={{ backgroundColor: value }}
      aria-label={ariaLabel}
    >
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 h-full w-full opacity-0 cursor-pointer"
        aria-label={ariaLabel}
      />
    </label>
  );
}

function Slider({ value, onChange, min, max, step = 1, format = (v) => v }) {
  return (
    <div className="flex items-center gap-2 flex-1 min-w-0">
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none bg-slate-200 dark:bg-slate-700 accent-[#16a085] cursor-pointer"
      />
      <span className="w-10 text-right tabular-nums text-[11px] text-day-muted dark:text-night-muted">
        {format(value)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Style editor primitives — sectioned, label/control grid
// ---------------------------------------------------------------------------

// Section header inside the style editor. Tiny uppercase label, hairline
// rule on the right keeps the section visually distinct without heavy
// dividers.
function StyleSection({ label, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-day-muted dark:text-night-muted">
          {label}
        </span>
        <span className="flex-1 h-px bg-day-border/60 dark:bg-night-border/60" />
      </div>
      <div className="flex flex-col gap-1.5 pl-0.5">{children}</div>
    </div>
  );
}

// Field row inside a section — fixed-width label, control(s) on the right.
function StyleField({ label, children }) {
  return (
    <div className="grid grid-cols-[60px_1fr] items-center gap-2">
      <span className="text-[11px] text-day-muted dark:text-night-muted capitalize">
        {label}
      </span>
      <div className="flex items-center gap-2 min-w-0">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Geometry-specific style sections
// ---------------------------------------------------------------------------

function PointStyle({ style, onChange }) {
  return (
    <>
      <StyleSection label="Marker">
        <StyleField label="Radius">
          <Slider
            value={style.radius}
            onChange={(v) => onChange({ radius: v })}
            min={1}
            max={24}
            step={0.5}
            format={(v) => `${v}px`}
          />
        </StyleField>
      </StyleSection>
      <StyleSection label="Fill">
        <StyleField label="Color">
          <ColorSwatch
            value={style.fillColor}
            onChange={(v) => onChange({ fillColor: v })}
            ariaLabel="Fill color"
          />
        </StyleField>
        <StyleField label="Opacity">
          <Slider
            value={style.fillOpacity}
            onChange={(v) => onChange({ fillOpacity: v })}
            min={0}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </StyleField>
      </StyleSection>
      <StyleSection label="Stroke">
        <StyleField label="Color">
          <ColorSwatch
            value={style.strokeColor}
            onChange={(v) => onChange({ strokeColor: v })}
            ariaLabel="Stroke color"
          />
        </StyleField>
        <StyleField label="Width">
          <Slider
            value={style.strokeWidth}
            onChange={(v) => onChange({ strokeWidth: v })}
            min={0}
            max={6}
            step={0.25}
            format={(v) => `${v}px`}
          />
        </StyleField>
        <StyleField label="Opacity">
          <Slider
            value={style.strokeOpacity}
            onChange={(v) => onChange({ strokeOpacity: v })}
            min={0}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </StyleField>
      </StyleSection>
    </>
  );
}

function LineStyle({ style, onChange }) {
  return (
    <>
      <StyleSection label="Stroke">
        <StyleField label="Color">
          <ColorSwatch
            value={style.color}
            onChange={(v) => onChange({ color: v })}
            ariaLabel="Line color"
          />
        </StyleField>
        <StyleField label="Width">
          <Slider
            value={style.width}
            onChange={(v) => onChange({ width: v })}
            min={0.25}
            max={10}
            step={0.25}
            format={(v) => `${v}px`}
          />
        </StyleField>
        <StyleField label="Opacity">
          <Slider
            value={style.opacity}
            onChange={(v) => onChange({ opacity: v })}
            min={0}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </StyleField>
      </StyleSection>
      <StyleSection label="Pattern">
        <StyleField label="Style">
          <button
            type="button"
            onClick={() => onChange({ dashed: false })}
            className={cn(
              'flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors',
              !style.dashed
                ? 'bg-[#16a085] text-white border-[#16a085]'
                : 'border-day-border dark:border-night-border text-day-muted dark:text-night-muted hover:bg-day-bg dark:hover:bg-night-border',
            )}
          >
            <Slash className="h-3 w-3" />
            Solid
          </button>
          <button
            type="button"
            onClick={() => onChange({ dashed: true })}
            className={cn(
              'flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors',
              style.dashed
                ? 'bg-[#16a085] text-white border-[#16a085]'
                : 'border-day-border dark:border-night-border text-day-muted dark:text-night-muted hover:bg-day-bg dark:hover:bg-night-border',
            )}
          >
            <span className="font-mono tracking-tight">- - -</span>
            Dashed
          </button>
        </StyleField>
      </StyleSection>
    </>
  );
}

function PolygonStyle({ style, onChange }) {
  return (
    <>
      <StyleSection label="Fill">
        <StyleField label="Color">
          <ColorSwatch
            value={style.fillColor}
            onChange={(v) => onChange({ fillColor: v })}
            ariaLabel="Fill color"
          />
        </StyleField>
        <StyleField label="Opacity">
          <Slider
            value={style.fillOpacity}
            onChange={(v) => onChange({ fillOpacity: v })}
            min={0}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </StyleField>
      </StyleSection>
      <StyleSection label="Stroke">
        <StyleField label="Color">
          <ColorSwatch
            value={style.strokeColor}
            onChange={(v) => onChange({ strokeColor: v })}
            ariaLabel="Stroke color"
          />
        </StyleField>
        <StyleField label="Width">
          <Slider
            value={style.strokeWidth}
            onChange={(v) => onChange({ strokeWidth: v })}
            min={0}
            max={6}
            step={0.25}
            format={(v) => `${v}px`}
          />
        </StyleField>
        <StyleField label="Opacity">
          <Slider
            value={style.strokeOpacity}
            onChange={(v) => onChange({ strokeOpacity: v })}
            min={0}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </StyleField>
      </StyleSection>
    </>
  );
}

function GeometryIcon({ geometry, className }) {
  const Icon =
    geometry === 'point' ? CircleDot
    : geometry === 'line'  ? Slash
    : Square;
  return <Icon className={className} aria-hidden />;
}

function StyleEditor({ geometry, style, onChange, onReset }) {
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      className="overflow-hidden"
    >
      <div className="px-2.5 py-2.5 mt-1 rounded-md border border-day-border dark:border-night-border bg-day-bg/60 dark:bg-night-bg/40">
        <div className="flex items-center gap-1.5 mb-2.5">
          <GeometryIcon geometry={geometry} className="h-3 w-3 text-[#16a085]" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-day-text dark:text-night-text">
            {geometry} style
          </span>
          <button
            type="button"
            onClick={onReset}
            className="ml-auto inline-flex items-center gap-1 text-[10px] text-day-muted dark:text-night-muted hover:text-[#16a085] transition-colors"
          >
            <RotateCcw className="h-2.5 w-2.5" />
            Reset
          </button>
        </div>
        <div className="flex flex-col gap-2.5">
          {geometry === 'point'   && <PointStyle   style={style} onChange={onChange} />}
          {geometry === 'line'    && <LineStyle    style={style} onChange={onChange} />}
          {geometry === 'polygon' && <PolygonStyle style={style} onChange={onChange} />}
        </div>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Layer row — toggle + expandable style controls
// ---------------------------------------------------------------------------

function LayerRow({ id, label, geometry, icon: Icon, isUpload, onRemove }) {
  const {
    visibleLayers,
    toggleLayer,
    styles,
    setLayerStyle,
    resetLayerStyle,
    expandedLayer,
    setExpandedLayer,
  } = useSecondary();

  const on = visibleLayers.has(id);
  const expanded = expandedLayer === id;
  const style = styles[id] ?? { ...DEFAULT_STYLES[geometry] };

  return (
    <div className="rounded-md border border-day-border dark:border-night-border">
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setExpandedLayer(expanded ? null : id)}
          aria-expanded={expanded}
          aria-label={`Style ${label}`}
          className="btn-icon btn-ghost h-6 w-6 shrink-0"
        >
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 transition-transform duration-200',
              expanded && 'rotate-180',
            )}
          />
        </button>
        <Icon className="h-3.5 w-3.5 shrink-0 text-brand-700 dark:text-brand-200" />
        <span className="flex-1 truncate text-[13px] text-day-text dark:text-night-text">
          {label}
        </span>
        {isUpload && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${label}`}
            className="btn-icon btn-ghost h-6 w-6 text-day-muted dark:text-night-muted hover:text-red-600 dark:hover:text-red-300"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
        <EyeToggle
          checked={on}
          onChange={() => toggleLayer(id)}
          label={`Toggle ${label}`}
        />
      </div>
      <AnimatePresence initial={false}>
        {expanded && (
          <div className="px-2 pb-2">
            <StyleEditor
              geometry={geometry}
              style={style}
              onChange={(partial) => setLayerStyle(id, partial)}
              onReset={() => resetLayerStyle(id, geometry)}
            />
          </div>
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
            'text-[11px]',
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
            <span className="text-[11px] leading-snug text-amber-800 dark:text-amber-200">
              {error}
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {uploads.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center px-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-day-muted dark:text-night-muted">
              Uploaded
            </span>
            <span className="ml-auto text-[10px] tabular-nums text-day-muted dark:text-night-muted">
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
                isUpload
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

export default function SecondaryPanel() {
  const { layers, visibleLayers } = useSecondary();
  const visibleCount = useMemo(
    () => layers.reduce((acc, l) => acc + (visibleLayers.has(l.id) ? 1 : 0), 0),
    [layers, visibleLayers],
  );

  return (
    <div className="flex flex-col h-full min-h-0 -mx-1">
      {/* Upper half — secondary layers */}
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex items-center gap-1.5 px-1 mb-1.5">
          <span className="label-base">Secondary Layers</span>
          <Badge tone="brand" className="ml-auto">
            {visibleCount > 0 ? `${visibleCount} / ${layers.length}` : layers.length}
          </Badge>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto pr-1 flex flex-col gap-1">
          {layers.map((l) => (
            <LayerRow
              key={l.id}
              id={l.id}
              label={l.label}
              geometry={l.geometry}
              icon={LAYER_ICONS[l.id] ?? Mountain}
            />
          ))}
        </div>
      </div>

      {/* Divider */}
      <div className="my-3 border-t border-day-border dark:border-night-border" />

      {/* Lower half — upload (intentionally untouched per scope) */}
      <div className="shrink-0 flex flex-col gap-2">
        <div className="flex items-center gap-2 px-1">
          <FileUp className="h-4 w-4 text-brand-700 dark:text-brand-200" />
          <span className="label-base">Upload</span>
        </div>
        <UploadZone />
      </div>
    </div>
  );
}
