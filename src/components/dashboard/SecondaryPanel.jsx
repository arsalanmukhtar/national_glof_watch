import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import shp from 'shpjs';
import {
  AlertTriangle,
  Building2,
  FileArchive,
  FileJson,
  FileUp,
  Landmark,
  MapPin,
  Mountain,
  Radio,
  Server,
  Shrink,
  Triangle,
  Trash2,
  Waves,
} from 'lucide-react';
import EyeToggle from '@/components/ui/EyeToggle';
import Badge from '@/components/ui/Badge';
import ConnectDatabaseModal from '@/components/dashboard/ConnectDatabaseModal';
import { cn } from '@/utils/cn';
import { useSecondary } from '@/contexts/SecondaryContext';
import { useMapView } from '@/contexts/MapContext';

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
// Layer row — toggle + zoom + (uploads only) trash. Per-layer style editing
// lives in the right-sidebar Palette panel; that's why there's no chevron
// expand here anymore.
// ---------------------------------------------------------------------------

function LayerRow({ id, label, icon: Icon, isUpload, uploadData, onRemove }) {
  const { visibleLayers, toggleLayer } = useSecondary();
  const { zoomToSecondaryLayer, zoomToGeoJson } = useMapView();

  const on = visibleLayers.has(id);

  const handleZoom = () => {
    if (isUpload) zoomToGeoJson(uploadData);
    else zoomToSecondaryLayer(id);
  };

  // Toggling visibility also frames the layer — same UX as the region
  // accordion so users always end up looking at what they just changed.
  const handleToggle = () => {
    toggleLayer(id);
    handleZoom();
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
        <span className="flex-1 truncate text-[13px] text-day-text dark:text-night-text">
          {label}
        </span>
        {isUpload && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${label}`}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-red-500 dark:text-red-400 hover:bg-red-500/15 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
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
                icon={u.kind === 'shapefile' ? FileArchive : FileJson}
                isUpload
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
  const { layers, visibleLayers } = useSecondary();
  const visibleCount = useMemo(
    () => layers.reduce((acc, l) => acc + (visibleLayers.has(l.id) ? 1 : 0), 0),
    [layers, visibleLayers],
  );
  const [dbModalOpen, setDbModalOpen] = useState(false);

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
              icon={LAYER_ICONS[l.id] ?? Mountain}
            />
          ))}
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
          <span className="text-[10px] uppercase tracking-[0.08em] text-day-muted dark:text-night-muted shrink-0">
            or
          </span>
          <button
            type="button"
            onClick={() => setDbModalOpen(true)}
            className={cn(
              'group inline-flex flex-1 items-center justify-center gap-1.5',
              'rounded-md border border-[#16a085]/40 hover:border-[#16a085]',
              'px-2.5 py-1 text-[11px] font-medium',
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
    </div>
  );
}
