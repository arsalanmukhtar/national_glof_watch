import { useCallback, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Building2,
  ChevronDown,
  CircleDot,
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
import Toggle from '@/components/ui/Toggle';
import Badge from '@/components/ui/Badge';
import { cn } from '@/utils/cn';
import { DEFAULT_STYLES, useSecondary } from '@/contexts/SecondaryContext';

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

function ControlRow({ label, children }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[11px] uppercase tracking-wide text-day-muted dark:text-night-muted">
        {label}
      </span>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Style editor — geometry-aware
// ---------------------------------------------------------------------------

function PointStyle({ style, onChange }) {
  return (
    <>
      <ControlRow label="Radius">
        <Slider
          value={style.radius}
          onChange={(v) => onChange({ radius: v })}
          min={1}
          max={24}
          step={0.5}
          format={(v) => `${v}px`}
        />
      </ControlRow>
      <ControlRow label="Fill">
        <ColorSwatch
          value={style.fillColor}
          onChange={(v) => onChange({ fillColor: v })}
          ariaLabel="Fill color"
        />
        <Slider
          value={style.fillOpacity}
          onChange={(v) => onChange({ fillOpacity: v })}
          min={0}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      </ControlRow>
      <ControlRow label="Stroke">
        <ColorSwatch
          value={style.strokeColor}
          onChange={(v) => onChange({ strokeColor: v })}
          ariaLabel="Stroke color"
        />
        <Slider
          value={style.strokeWidth}
          onChange={(v) => onChange({ strokeWidth: v })}
          min={0}
          max={6}
          step={0.25}
          format={(v) => `${v}px`}
        />
      </ControlRow>
      <ControlRow label="Stroke α">
        <Slider
          value={style.strokeOpacity}
          onChange={(v) => onChange({ strokeOpacity: v })}
          min={0}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      </ControlRow>
    </>
  );
}

function LineStyle({ style, onChange }) {
  return (
    <>
      <ControlRow label="Color">
        <ColorSwatch
          value={style.color}
          onChange={(v) => onChange({ color: v })}
          ariaLabel="Line color"
        />
        <Slider
          value={style.opacity}
          onChange={(v) => onChange({ opacity: v })}
          min={0}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      </ControlRow>
      <ControlRow label="Width">
        <Slider
          value={style.width}
          onChange={(v) => onChange({ width: v })}
          min={0.25}
          max={10}
          step={0.25}
          format={(v) => `${v}px`}
        />
      </ControlRow>
      <ControlRow label="Style">
        <button
          type="button"
          onClick={() => onChange({ dashed: false })}
          className={cn(
            'flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors',
            !style.dashed
              ? 'bg-[#16a085] text-white border-[#16a085]'
              : 'border-day-border dark:border-night-border text-day-muted dark:text-night-muted hover:bg-day-surface dark:hover:bg-night-border',
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
              : 'border-day-border dark:border-night-border text-day-muted dark:text-night-muted hover:bg-day-surface dark:hover:bg-night-border',
          )}
        >
          <span className="font-mono tracking-tight">- - -</span>
          Dashed
        </button>
      </ControlRow>
    </>
  );
}

function PolygonStyle({ style, onChange }) {
  return (
    <>
      <ControlRow label="Fill">
        <ColorSwatch
          value={style.fillColor}
          onChange={(v) => onChange({ fillColor: v })}
          ariaLabel="Fill color"
        />
        <Slider
          value={style.fillOpacity}
          onChange={(v) => onChange({ fillOpacity: v })}
          min={0}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      </ControlRow>
      <ControlRow label="Stroke">
        <ColorSwatch
          value={style.strokeColor}
          onChange={(v) => onChange({ strokeColor: v })}
          ariaLabel="Stroke color"
        />
        <Slider
          value={style.strokeWidth}
          onChange={(v) => onChange({ strokeWidth: v })}
          min={0}
          max={6}
          step={0.25}
          format={(v) => `${v}px`}
        />
      </ControlRow>
      <ControlRow label="Stroke α">
        <Slider
          value={style.strokeOpacity}
          onChange={(v) => onChange({ strokeOpacity: v })}
          min={0}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      </ControlRow>
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
      <div className="px-2 py-2 mt-1 rounded-md border border-day-border dark:border-night-border bg-day-surface dark:bg-night-surface">
        <div className="flex items-center gap-1.5 mb-2">
          <GeometryIcon geometry={geometry} className="h-3 w-3 text-[#16a085]" />
          <span className="text-[10px] uppercase tracking-wide text-day-muted dark:text-night-muted">
            {geometry} style
          </span>
          <button
            type="button"
            onClick={onReset}
            className="ml-auto inline-flex items-center gap-1 text-[10px] text-day-muted dark:text-night-muted hover:text-[#16a085]"
          >
            <RotateCcw className="h-2.5 w-2.5" />
            Reset
          </button>
        </div>
        <div className="flex flex-col gap-1.5">
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
        <Toggle
          checked={on}
          onChange={() => toggleLayer(id)}
          label={`Toggle ${label}`}
          activeClass="bg-[#16a085]"
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

function UploadZone() {
  const { uploads, addUpload, removeUpload } = useSecondary();
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState(null);

  const handleFiles = useCallback(
    async (files) => {
      setError(null);
      for (const file of files) {
        const ext = file.name.split('.').pop()?.toLowerCase();
        const isGeoJson = ext === 'geojson' || ext === 'json';
        const isZip = ext === 'zip';
        if (!isGeoJson && !isZip) {
          setError(`Unsupported file type: .${ext}`);
          continue;
        }
        try {
          if (isGeoJson) {
            const text = await file.text();
            const parsed = JSON.parse(text);
            addUpload({
              id: `upload:${Date.now()}:${file.name}`,
              label: file.name,
              kind: 'geojson',
              geometry: detectGeometryFromGeoJSON(parsed),
              size: file.size,
              data: parsed,
            });
          } else {
            // Zipped shapefile — parsing requires a shp library; capture
            // the file for now and let the map layer wire it up later.
            addUpload({
              id: `upload:${Date.now()}:${file.name}`,
              label: file.name,
              kind: 'shapefile',
              geometry: 'polygon',
              size: file.size,
              file,
            });
          }
        } catch (err) {
          setError(`Failed to read ${file.name}: ${err.message}`);
        }
      }
    },
    [addUpload],
  );

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          'group flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors',
          dragging
            ? 'border-[#16a085] bg-[#16a085]/5'
            : 'border-day-border dark:border-night-border hover:border-[#16a085] hover:bg-[#16a085]/5',
        )}
      >
        <FileUp className="h-7 w-7 text-day-muted dark:text-night-muted group-hover:text-[#16a085] transition-colors" />
        <div className="text-sm font-medium text-day-text dark:text-night-text">
          Drop file here, or <span className="text-[#16a085] underline-offset-2 group-hover:underline">browse</span>
        </div>
        <div className="text-[11px] text-day-muted dark:text-night-muted">
          .geojson · .json · .zip (shapefile)
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) handleFiles(e.target.files);
            e.target.value = ''; // allow re-uploading same file
          }}
        />
      </button>

      {error && (
        <div className="text-[11px] text-red-600 dark:text-red-300 px-1">
          {error}
        </div>
      )}

      {uploads.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="px-1 text-[11px] uppercase tracking-wide text-day-muted dark:text-night-muted">
            Uploaded ({uploads.length})
          </div>
          {uploads.map((u) => (
            <LayerRow
              key={u.id}
              id={u.id}
              label={u.label}
              geometry={u.geometry || 'polygon'}
              icon={u.kind === 'shapefile' ? FileJson : FileJson}
              isUpload
              onRemove={() => removeUpload(u.id)}
            />
          ))}
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
