import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  Calendar,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FilePlus2,
  FolderOpen,
  Grid3x3,
  Layers,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Shrink,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { formatBytes, useRasters } from '@/contexts/RasterContext';
import { useMapView } from '@/contexts/MapContext';
import {
  boundsToBbox,
  colormapCssGradient,
  COLORMAPS,
  fetchRasterBounds,
} from '@/utils/rasterRender';
import TruncateLabel from '@/components/ui/TruncateLabel';
import { cn } from '@/utils/cn';

// ---------------------------------------------------------------------------
// Raster Layers panel — Phase 1 (discovery + grouping).
//
// Lists `.tif` / `.tiff` files surfaced by the backend (`/api/rasters`),
// lets the user add a single raster or a multi-frame temporal series,
// and tracks frame visibility / active frame in `RasterContext`. Map
// rendering, symbology controls and the in-map temporal slider land in
// Phase 2 — the data shape here is already what they'll consume.
// ---------------------------------------------------------------------------

export default function RasterLayersPanel() {
  const {
    available,
    catalogStatus,
    refresh,
    uploadFile,
    deleteFile,
    groups,
    addGroup,
    removeGroup,
    toggleVisible,
    setActiveFrame,
    setLayerBounds,
    usedNames,
  } = useRasters();
  const { zoomToBbox } = useMapView();

  const [intakeOpen, setIntakeOpen] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      {/* Add-raster primary action */}
      <button
        type="button"
        onClick={() => setIntakeOpen((v) => !v)}
        aria-expanded={intakeOpen}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-md px-3 py-2',
          'text-[12px] font-semibold transition-colors',
          intakeOpen
            ? 'bg-[#138b72] text-white'
            : 'bg-[#16a085] text-white hover:bg-[#138b72]',
        )}
      >
        <FilePlus2 className="h-4 w-4" />
        <span>{intakeOpen ? 'Cancel' : 'Add raster(s)'}</span>
      </button>

      <AnimatePresence initial={false}>
        {intakeOpen ? (
          <motion.div
            key="intake"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <RasterIntake
              available={available}
              catalogStatus={catalogStatus}
              usedNames={usedNames}
              refresh={refresh}
              uploadFile={uploadFile}
              deleteFile={deleteFile}
              onAdd={(spec) => {
                const id = addGroup(spec);
                if (id) setIntakeOpen(false);
              }}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <Section title="Loaded rasters" count={groups.length}>
        {groups.length === 0 ? (
          <EmptyHint>
            Add a raster to see it here. Phase 2 lights up symbology and the
            in-map temporal slider.
          </EmptyHint>
        ) : (
          <div className="flex flex-col gap-1">
            {groups.map((g) => (
              <GroupRow
                key={g.id}
                group={g}
                onRemove={() => removeGroup(g.id)}
                onToggleVisible={() => toggleVisible(g.id)}
                onSetFrame={(idx) => setActiveFrame(g.id, idx)}
                onZoom={async () => {
                  const layer = g.layers[g.activeIndex] ?? g.layers[0];
                  if (!layer) return;
                  // Cached path — instant fly-to.
                  const cached = boundsToBbox(layer.bounds);
                  if (cached) {
                    zoomToBbox(cached);
                    return;
                  }
                  // Cold path — fast bounds-only fetch (no pixel decode).
                  try {
                    const bounds = await fetchRasterBounds(layer.name);
                    setLayerBounds(g.id, layer.name, bounds);
                    const bbox = boundsToBbox(bounds);
                    if (bbox) zoomToBbox(bbox);
                  } catch (err) {
                    console.warn(
                      `Zoom-to-extent failed for "${layer.name}": ${err.message}`,
                    );
                  }
                }}
              />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Intake — mode picker (single | temporal) + file list with multi-select.
// Files already attached to an existing group are dimmed but still
// pickable (a user might legitimately want the same frame in two groups).
// ---------------------------------------------------------------------------

function RasterIntake({
  available,
  catalogStatus,
  usedNames,
  refresh,
  uploadFile,
  deleteFile,
  onAdd,
}) {
  const [mode, setMode] = useState('single');
  const [selected, setSelected] = useState(() => new Set());
  const [groupName, setGroupName] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState(null);

  // Whenever the catalog refreshes, drop any selections whose filename
  // is no longer available — otherwise the panel could submit stale
  // names that the backend will 404.
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      const known = new Set(available.map((f) => f.name));
      for (const n of next) if (!known.has(n)) next.delete(n);
      return next.size === prev.size ? prev : next;
    });
  }, [available]);

  // Plain checkbox toggle — selection is independent of mode. Submit-time
  // logic decides what to do with N>1 files in single mode (creates one
  // single-raster group per file).
  const toggle = (name) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return available;
    const q = search.toLowerCase();
    return available.filter((f) => f.name.toLowerCase().includes(q));
  }, [available, search]);

  const submit = () => {
    setError(null);
    const fileNames = [...selected];
    if (fileNames.length === 0) {
      setError('Pick at least one raster.');
      return;
    }
    if (mode === 'single') {
      // N selected files in single mode = N independent single-raster
      // groups. The user gets one group per file so they can be styled
      // / toggled independently.
      for (const fn of fileNames) {
        onAdd({ kind: 'single', fileNames: [fn], name: null });
      }
    } else {
      onAdd({
        kind: 'temporal',
        fileNames,
        name: groupName.trim() || null,
      });
    }
    setSelected(new Set());
    setGroupName('');
  };

  return (
    <div className="flex flex-col gap-2">
      <ModePicker mode={mode} onChange={setMode} />

      <UploadZone
        uploadFile={uploadFile}
        onComplete={async (uploadedNames) => {
          // Refresh the catalog so the new rows appear, then auto-select
          // them so the user can hit "Add" without re-clicking each one.
          await refresh();
          setSelected((prev) => {
            const next = new Set(prev);
            for (const n of uploadedNames) next.add(n);
            return next;
          });
        }}
      />

      <div className="flex items-center gap-1.5">
        <SearchInput value={search} onChange={setSearch} />
        <button
          type="button"
          onClick={refresh}
          disabled={catalogStatus.loading}
          aria-label="Refresh raster catalog"
          title="Refresh"
          className={cn(
            'inline-flex h-7 w-7 items-center justify-center rounded-md',
            'border border-day-border dark:border-night-border',
            'text-day-muted dark:text-night-muted',
            'hover:text-[#16a085] hover:border-[#16a085]/60 transition-colors',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {catalogStatus.loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      <FileList
        files={filtered}
        catalogStatus={catalogStatus}
        usedNames={usedNames}
        selected={selected}
        onToggle={toggle}
        onDelete={async (name) => {
          // Optimistically drop from the selection set; deleteFile also
          // prunes any group still pointing at the file.
          setSelected((prev) => {
            if (!prev.has(name)) return prev;
            const next = new Set(prev);
            next.delete(name);
            return next;
          });
          try {
            await deleteFile(name);
            await refresh();
          } catch (err) {
            setError(err.message || 'Delete failed');
          }
        }}
      />

      <input
        type="text"
        value={groupName}
        onChange={(e) => setGroupName(e.target.value)}
        placeholder={
          mode === 'temporal' ? 'Series name (optional)' : 'Layer name (optional)'
        }
        className={cn(
          'w-full rounded-md border px-2 py-1.5 text-[11px]',
          'bg-day-bg dark:bg-night-bg',
          'border-day-border dark:border-night-border',
          'text-day-text dark:text-night-text placeholder:text-day-muted dark:placeholder:text-night-muted',
          'focus:outline-none focus:ring-2 focus:ring-[#16a085]/40',
        )}
      />

      <button
        type="button"
        onClick={submit}
        disabled={selected.size === 0}
        className={cn(
          'btn-base btn-sm w-full',
          'bg-[#16a085] text-white hover:bg-[#138b72]',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <Layers className="h-3.5 w-3.5" />
        <span>
          {mode === 'temporal'
            ? `Add series · ${selected.size} frame${selected.size === 1 ? '' : 's'}`
            : `Add ${selected.size || ''} raster${selected.size === 1 ? '' : 's'}`.trim()}
        </span>
      </button>

      {error ? (
        <div className="inline-flex items-start gap-1.5 text-[10.5px] text-red-600 dark:text-red-400">
          <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upload zone — click anywhere or drag-drop one or more `.tif` files.
// Streams each file via XHR so the progress bar reflects actual bytes
// sent (fetch's body progress isn't surfaced by any current browser).
// On completion the catalog is refreshed and the freshly uploaded
// filenames bubble back to the parent so they auto-populate the
// selection set.
// ---------------------------------------------------------------------------

function UploadZone({ uploadFile, onComplete }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  // { current, total, fileName, sent, size } while a batch is in flight.
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);

  const accept = async (fileList) => {
    if (!fileList?.length) return;
    const tifs = [...fileList].filter((f) => /\.tiff?$/i.test(f.name));
    const skipped = fileList.length - tifs.length;
    if (tifs.length === 0) {
      setError('Only .tif / .tiff files are supported.');
      return;
    }
    setError(skipped > 0 ? `Skipped ${skipped} non-TIFF file(s).` : null);
    const uploaded = [];
    for (let i = 0; i < tifs.length; i++) {
      const file = tifs[i];
      try {
        setProgress({
          current: i + 1,
          total: tifs.length,
          fileName: file.name,
          sent: 0,
          size: file.size,
        });
        const result = await uploadFile(file, {
          onProgress: (sent, size) =>
            setProgress((p) => (p ? { ...p, sent, size } : p)),
        });
        uploaded.push(result.name);
      } catch (err) {
        setError(`${file.name}: ${err.message || 'upload failed'}`);
        setProgress(null);
        if (uploaded.length) onComplete?.(uploaded);
        return;
      }
    }
    setProgress(null);
    onComplete?.(uploaded);
  };

  const busy = progress != null;
  const pct =
    progress && progress.size
      ? Math.min(100, Math.round((progress.sent / progress.size) * 100))
      : 0;

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (busy) return;
          accept(e.dataTransfer.files);
        }}
        className={cn(
          'w-full flex flex-col items-center justify-center gap-1',
          'rounded-md border-2 border-dashed px-3 py-3 text-center cursor-pointer',
          'transition-colors focus:outline-none focus:ring-2 focus:ring-[#16a085]/40',
          'disabled:cursor-not-allowed disabled:opacity-80',
          dragOver
            ? 'border-[#16a085] bg-[#16a085]/5'
            : 'border-day-border dark:border-night-border hover:border-[#16a085]/60 hover:bg-[#16a085]/5',
        )}
      >
        <Upload className="h-4 w-4 text-day-muted dark:text-night-muted" />
        <span className="text-[11px] text-day-text dark:text-night-text">
          Drop .tif files or{' '}
          <span className="font-semibold text-[#16a085]">
            {busy ? 'uploading…' : 'click to browse'}
          </span>
        </span>
        {!busy ? (
          <span className="text-[9.5px] text-day-muted dark:text-night-muted">
            Files land in <code className="text-[9px]">data/rasters/</code>
          </span>
        ) : (
          <span className="text-[9.5px] tabular-nums text-day-muted dark:text-night-muted truncate max-w-full">
            {progress.current}/{progress.total} · {progress.fileName} · {pct}%
          </span>
        )}
      </button>
      {busy ? (
        <div className="h-1 w-full rounded-full bg-day-bg dark:bg-night-bg overflow-hidden">
          <div
            className="h-full bg-[#16a085] transition-[width] duration-150"
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
      {error ? (
        <div className="inline-flex items-start gap-1.5 text-[10.5px] text-red-600 dark:text-red-400">
          <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept=".tif,.tiff,image/tiff"
        multiple
        className="hidden"
        onChange={(e) => {
          accept(e.target.files);
          // Reset so re-uploading the same file fires onChange again.
          e.target.value = '';
        }}
      />
    </div>
  );
}

function ModePicker({ mode, onChange }) {
  const items = [
    { id: 'single', label: 'Single', hint: 'One raster', Icon: Grid3x3 },
    {
      id: 'temporal',
      label: 'Temporal',
      hint: 'Sequenced frames',
      Icon: Calendar,
    },
  ];
  return (
    <div role="radiogroup" aria-label="Raster mode" className="grid grid-cols-2 gap-1">
      {items.map(({ id, label, hint, Icon }) => {
        const on = mode === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(id)}
            className={cn(
              'flex flex-col items-start gap-0.5 rounded-md border px-2 py-1.5 text-left transition-colors',
              on
                ? 'bg-[#16a085]/10 border-[#16a085]/50 text-[#16a085]'
                : 'border-day-border dark:border-night-border text-day-muted dark:text-night-muted hover:border-day-text/40 dark:hover:border-night-text/40',
            )}
          >
            <span className="inline-flex items-center gap-1.5">
              <Icon className="h-3.5 w-3.5" />
              <span className="text-[11px] font-semibold leading-none">
                {label}
              </span>
            </span>
            <span className="text-[9.5px] leading-tight opacity-80">{hint}</span>
          </button>
        );
      })}
    </div>
  );
}

function SearchInput({ value, onChange }) {
  return (
    <div className="relative flex-1 min-w-0">
      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-day-muted dark:text-night-muted pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Filter files…"
        className={cn(
          'w-full pl-7 pr-2 py-1 rounded-md text-[11px]',
          'bg-day-bg dark:bg-night-bg',
          'border border-day-border dark:border-night-border',
          'text-day-text dark:text-night-text placeholder:text-day-muted dark:placeholder:text-night-muted',
          'focus:outline-none focus:ring-2 focus:ring-[#16a085]/40',
        )}
      />
    </div>
  );
}

function FileList({ files, catalogStatus, usedNames, selected, onToggle, onDelete }) {
  if (catalogStatus.loading && files.length === 0) {
    return (
      <div className="rounded-md border border-day-border dark:border-night-border bg-day-bg/50 dark:bg-night-bg/50 px-2 py-4 text-center text-[11px] text-day-muted dark:text-night-muted inline-flex items-center justify-center gap-1.5">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Reading catalog…
      </div>
    );
  }
  if (catalogStatus.error) {
    return (
      <div className="rounded-md border border-red-300 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 px-2 py-2 text-[10.5px] text-red-700 dark:text-red-300">
        {catalogStatus.error}
      </div>
    );
  }
  if (files.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-day-border dark:border-night-border px-2 py-4 text-center">
        <FolderOpen className="h-4 w-4 mx-auto mb-1 text-day-muted dark:text-night-muted" />
        <p className="text-[10.5px] text-day-muted dark:text-night-muted">
          Catalog is empty.
        </p>
        <p className="text-[10px] text-day-muted dark:text-night-muted mt-1">
          Upload above, or drop GeoTIFFs into{' '}
          <code className="text-[9.5px]">data/rasters/</code> on the
          server.
        </p>
      </div>
    );
  }
  return (
    <div className="max-h-56 overflow-y-auto rounded-md border border-day-border dark:border-night-border bg-day-bg/40 dark:bg-night-bg/40">
      <ul className="divide-y divide-day-border/60 dark:divide-night-border/60">
        {files.map((f) => {
          const checked = selected.has(f.name);
          const used = usedNames.has(f.name);
          return (
            <li key={f.name} className="flex items-stretch">
              <button
                type="button"
                onClick={() => onToggle(f.name)}
                className={cn(
                  'flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 text-left transition-colors',
                  checked
                    ? 'bg-[#16a085]/15'
                    : 'hover:bg-day-bg dark:hover:bg-night-bg',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'inline-flex h-3.5 w-3.5 items-center justify-center rounded border shrink-0',
                    checked
                      ? 'bg-[#16a085] border-[#16a085]'
                      : 'border-day-border dark:border-night-border',
                  )}
                >
                  {checked ? (
                    <span className="inline-block h-1.5 w-1.5 bg-white rounded-sm" />
                  ) : null}
                </span>
                <span className="flex-1 min-w-0">
                  <TruncateLabel
                    text={f.name}
                    className="text-[11px] text-day-text dark:text-night-text"
                  />
                  <span className="block text-[9.5px] text-day-muted dark:text-night-muted">
                    {f.parsedDate ? `${f.parsedDate} · ` : ''}
                    {formatBytes(f.size)}
                    {used ? ' · in another group' : ''}
                  </span>
                </span>
              </button>
              {onDelete ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(f.name);
                  }}
                  aria-label={`Delete ${f.name}`}
                  title="Delete from server"
                  className="inline-flex w-6 shrink-0 items-center justify-center text-day-muted dark:text-night-muted hover:text-red-500 hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loaded-group row. Single rasters render as a single line; temporal
// series collapse to a header row + expandable frame list with the
// active frame highlighted.
// ---------------------------------------------------------------------------

// Base per-frame interval for the temporal play loop at 1× speed. The
// speed button cycles through SPEED_PRESETS to divide this. 1.2 s feels
// like meaningful animation; 4× makes long series scrub quickly.
const FRAME_INTERVAL_MS = 1200;
const SPEED_PRESETS = [0.5, 1, 2, 4];

function GroupRow({ group, onRemove, onToggleVisible, onSetFrame, onZoom }) {
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const isTemporal = group.kind === 'temporal';
  const activeLayer = group.layers[group.activeIndex] ?? null;

  // Live mirror so the play loop's setInterval can advance without
  // restarting on every frame change.
  const idxRef = useRef(group.activeIndex);
  idxRef.current = group.activeIndex;

  // Auto-stop playing whenever the group becomes ineligible — hidden
  // (renderer won't decode), single-frame, or no longer temporal.
  useEffect(() => {
    if (!isTemporal || !group.visible || group.layers.length <= 1) {
      setPlaying(false);
    }
  }, [isTemporal, group.visible, group.layers.length]);

  useEffect(() => {
    if (!playing || !isTemporal || group.layers.length <= 1) return undefined;
    const total = group.layers.length;
    // Speed change reschedules the interval — that's why `speed` is in
    // the dep array. Watching the group's identity bits keeps the
    // interval steady across frame ticks.
    const id = setInterval(() => {
      onSetFrame((idxRef.current + 1) % total);
    }, FRAME_INTERVAL_MS / speed);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, isTemporal, group.layers.length, speed]);

  const cycleSpeed = () => {
    const i = SPEED_PRESETS.indexOf(speed);
    setSpeed(SPEED_PRESETS[(i + 1) % SPEED_PRESETS.length] ?? 1);
  };

  return (
    <div
      className={cn(
        'rounded-md border transition-colors',
        group.visible
          ? 'border-[#16a085]/40 bg-[#16a085]/10'
          : 'border-day-border dark:border-night-border',
      )}
    >
      <div className="flex items-center gap-1 px-2 py-1.5">
        {isTemporal ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Collapse frames' : 'Expand frames'}
            className="inline-flex h-5 w-5 items-center justify-center rounded text-day-muted dark:text-night-muted hover:text-day-text dark:hover:text-night-text"
          >
            {open ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
        ) : null}

        <span
          className={cn(
            'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded',
            isTemporal
              ? 'bg-[#16a085]/15 text-[#16a085]'
              : 'bg-brand-700/10 text-brand-700 dark:text-brand-200',
          )}
        >
          {isTemporal ? (
            <Calendar className="h-3 w-3" />
          ) : (
            <Grid3x3 className="h-3 w-3" />
          )}
        </span>

        <div className="flex-1 min-w-0">
          <TruncateLabel
            text={group.name}
            className="text-[12px] text-day-text dark:text-night-text"
          />
          <div className="text-[9.5px] text-day-muted dark:text-night-muted truncate">
            {isTemporal
              ? `${group.layers.length} frames · ${formatBytes(
                  group.layers.reduce((acc, l) => acc + (l.size || 0), 0),
                )}${
                  activeLayer?.parsedDate
                    ? ` · current: ${activeLayer.parsedDate}`
                    : ''
                }`
              : `${formatBytes(group.layers[0]?.size ?? 0)}${
                  group.layers[0]?.parsedDate
                    ? ` · ${group.layers[0].parsedDate}`
                    : ''
                }`}
          </div>
        </div>

        <button
          type="button"
          onClick={onZoom}
          aria-label={`Zoom to ${group.name}`}
          title={`Zoom to ${group.name}`}
          className="inline-flex h-6 w-6 items-center justify-center rounded text-day-muted dark:text-night-muted hover:text-[#16a085] hover:bg-[#16a085]/10 transition-colors"
        >
          <Shrink className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onToggleVisible}
          aria-pressed={group.visible}
          aria-label={group.visible ? 'Hide on map' : 'Show on map'}
          className={cn(
            'inline-flex h-6 w-6 items-center justify-center rounded',
            group.visible
              ? 'text-[#16a085]'
              : 'text-day-muted dark:text-night-muted hover:text-day-text dark:hover:text-night-text',
          )}
        >
          {group.visible ? (
            <Eye className="h-3.5 w-3.5" />
          ) : (
            <EyeOff className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${group.name}`}
          className="inline-flex h-6 w-6 items-center justify-center rounded text-red-500 hover:bg-red-500/10"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {isTemporal && open ? (
        <div className="border-t border-day-border/60 dark:border-night-border/60 px-2 py-1">
          <ul className="flex flex-col gap-0.5">
            {group.layers.map((l, i) => {
              const active = i === group.activeIndex;
              return (
                <li key={l.name}>
                  <button
                    type="button"
                    onClick={() => onSetFrame(i)}
                    className={cn(
                      'w-full flex items-center gap-2 rounded px-1.5 py-1 text-left transition-colors',
                      active
                        ? 'bg-[#16a085]/15 text-[#16a085]'
                        : 'text-day-muted dark:text-night-muted hover:text-day-text dark:hover:text-night-text hover:bg-day-bg dark:hover:bg-night-bg',
                    )}
                  >
                    <span className="text-[9.5px] tabular-nums w-5 shrink-0 text-right">
                      {i + 1}
                    </span>
                    <span className="flex-1 min-w-0">
                      <TruncateLabel
                        text={l.parsedDate ?? l.name}
                        className="text-[11px]"
                      />
                    </span>
                    {l.parsedDate && l.parsedDate !== l.name ? (
                      <span className="hidden sm:block max-w-[40%] min-w-0 shrink-0 opacity-70">
                        <TruncateLabel
                          text={l.name}
                          className="text-[9.5px]"
                        />
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {/* Colormap legend — mirrors the vector LayerLegend pattern: only
          drops when the group is visible, so the panel stays compact
          until the user actually wants to read the ramp. */}
      <AnimatePresence initial={false}>
        {group.visible ? (
          <motion.div
            key="raster-legend"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden border-t border-[#16a085]/25 dark:border-[#16a085]/30"
          >
            <RasterLegend
              group={group}
              playing={playing}
              onTogglePlay={() => setPlaying((p) => !p)}
              onSetFrame={onSetFrame}
              speed={speed}
              onCycleSpeed={cycleSpeed}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline legend — colormap gradient + min/max labels. For single
// rasters it's a static read-out. For temporal groups the gradient bar
// becomes the temporal slider (draggable thumb + play button), and the
// min/max row picks up an active-frame label in the middle. The min /
// max numbers update naturally as the user scrubs because the renderer
// pushes fresh dataStats per frame.
// ---------------------------------------------------------------------------

function RasterLegend({
  group,
  playing,
  onTogglePlay,
  onSetFrame,
  speed,
  onCycleSpeed,
}) {
  const style = group.style ?? {};
  const colormapId = style.colormap || 'viridis';
  const colormapLabel = COLORMAPS[colormapId]?.label ?? colormapId;
  const auto = style.autoStretch !== false;
  const dataMin = group.dataStats?.dataMin;
  const dataMax = group.dataStats?.dataMax;
  const lowVal = auto
    ? dataMin
    : Number.isFinite(style.min)
      ? style.min
      : dataMin;
  const highVal = auto
    ? dataMax
    : Number.isFinite(style.max)
      ? style.max
      : dataMax;

  const isTemporal = group.kind === 'temporal' && group.layers.length > 1;
  const idx = group.activeIndex;
  const total = group.layers.length;
  const activeLayer = group.layers[idx];
  const frameLabel = activeLayer?.parsedDate || activeLayer?.name || '';
  const gradient = colormapCssGradient(colormapId);

  return (
    <div className="px-2 py-1.5 flex flex-col gap-1">
      <div className="flex items-center justify-between text-[9.5px]">
        <span className="text-day-muted dark:text-night-muted">
          {colormapLabel}
        </span>
        <span className="text-day-muted/80 dark:text-night-muted/80 tabular-nums">
          opacity {Math.round((style.opacity ?? 1) * 100)}%
        </span>
      </div>

      {isTemporal ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={playing ? 'Pause' : 'Play'}
            title={playing ? 'Pause' : 'Play'}
            className={cn(
              'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors',
              'bg-[#16a085] text-white hover:bg-[#138b72]',
            )}
          >
            {playing ? (
              <Pause className="h-2.5 w-2.5" />
            ) : (
              <Play className="h-2.5 w-2.5" />
            )}
          </button>
          <LegendSlider
            gradient={gradient}
            total={total}
            idx={idx}
            onChange={onSetFrame}
          />
          <button
            type="button"
            onClick={onCycleSpeed}
            aria-label={`Playback speed ${formatSpeed(speed)}, click to change`}
            title={`Playback speed: ${formatSpeed(speed)}`}
            className={cn(
              'inline-flex h-5 min-w-[26px] px-1 shrink-0 items-center justify-center rounded',
              'text-[10px] font-semibold tabular-nums leading-none transition-colors',
              'border border-day-border dark:border-night-border',
              'text-day-muted dark:text-night-muted',
              'hover:text-[#16a085] hover:border-[#16a085]/60 hover:bg-[#16a085]/10',
            )}
          >
            {formatSpeed(speed)}
          </button>
        </div>
      ) : (
        <div
          className="h-2 rounded-sm"
          style={{ backgroundImage: gradient }}
          aria-hidden
        />
      )}

      <div className="flex items-center justify-between gap-2 text-[10px] tabular-nums text-day-text dark:text-night-text">
        <span>{niceLegendNumber(lowVal)}</span>
        {isTemporal ? (
          <span
            className="flex-1 min-w-0 text-center text-day-muted dark:text-night-muted truncate"
            title={activeLayer?.name}
          >
            {idx + 1}/{total}
            {frameLabel ? ` · ${frameLabel}` : ''}
          </span>
        ) : null}
        <span>{niceLegendNumber(highVal)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact draggable track. The colormap gradient is the visual track,
// a small white dot marks the active frame. Click anywhere to seek;
// drag the thumb (or anywhere on the track) to scrub. Keyboard arrows
// step one frame.
// ---------------------------------------------------------------------------

function LegendSlider({ gradient, total, idx, onChange }) {
  const trackRef = useRef(null);
  const dragRef = useRef(false);

  const updateFromX = (clientX) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const next = Math.round(t * (total - 1));
    if (next !== idx) onChange(next);
  };

  const handlePointerDown = (e) => {
    e.preventDefault();
    e.target.setPointerCapture?.(e.pointerId);
    dragRef.current = true;
    updateFromX(e.clientX);
  };
  const handlePointerMove = (e) => {
    if (!dragRef.current) return;
    updateFromX(e.clientX);
  };
  const handlePointerUp = (e) => {
    dragRef.current = false;
    e.target.releasePointerCapture?.(e.pointerId);
  };
  const handleKey = (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      onChange(Math.max(0, idx - 1));
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      onChange(Math.min(total - 1, idx + 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onChange(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      onChange(total - 1);
    }
  };

  const pct = total > 1 ? (idx / (total - 1)) * 100 : 0;
  // Interior tick marks only — frames 1 .. N-2. Ticks at 0 and N-1
  // would coincide with the bar's edges and read as out-of-place
  // colored slivers rather than discrete-frame markers.
  const showTicks = total > 2 && total <= 24;

  return (
    <div
      role="slider"
      aria-label="Temporal frame"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={idx + 1}
      tabIndex={0}
      onKeyDown={handleKey}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      ref={trackRef}
      className="relative flex-1 h-3 flex items-center cursor-pointer touch-none select-none focus:outline-none focus:ring-2 focus:ring-[#16a085]/40 rounded"
    >
      {/* Border dropped intentionally — it stacked on top of the gradient
          and produced visible edge slivers when combined with the
          rounded corners + dark theme. The thumb gives all the framing
          the track needs. */}
      <div
        className="absolute inset-x-0 h-2 rounded-sm"
        style={{ backgroundImage: gradient }}
      />
      {showTicks
        ? Array.from({ length: total - 2 }).map((_, k) => {
            const i = k + 1; // skip the first and last (edges)
            return (
              <span
                key={i}
                aria-hidden
                className="absolute h-2 w-px bg-black/25 dark:bg-white/30"
                style={{ left: `${(i / (total - 1)) * 100}%` }}
              />
            );
          })
        : null}
      <span
        aria-hidden
        className="absolute h-3 w-3 rounded-full bg-white shadow border-2 border-[#16a085] -translate-x-1/2 pointer-events-none"
        style={{ left: `${pct}%` }}
      />
    </div>
  );
}

// "0.5×" / "1×" / "2×" / "4×" — keeps the button text visually
// compact across speeds while preserving readability.
function formatSpeed(speed) {
  if (Number.isInteger(speed)) return `${speed}×`;
  return `${speed}×`;
}

function niceLegendNumber(n) {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs === 0) return '0';
  if (abs >= 100) return Math.round(n).toString();
  if (abs >= 1) return Number(n.toFixed(2)).toString();
  return Number(n.toPrecision(3)).toString();
}

// ---------------------------------------------------------------------------
// Section / EmptyHint helpers — same shape as CsvDataPanel for visual
// consistency across sidebar panels.
// ---------------------------------------------------------------------------

function Section({ title, count, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 mt-1">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-day-muted dark:text-night-muted">
          {title}
        </span>
        {typeof count === 'number' ? (
          <span className="ml-auto text-[10px] tabular-nums text-day-muted dark:text-night-muted">
            {count}
          </span>
        ) : null}
        <span className="flex-1 h-px bg-day-border/60 dark:bg-night-border/60" />
      </div>
      {children}
    </div>
  );
}

function EmptyHint({ children }) {
  return (
    <p className="text-[10.5px] text-day-muted dark:text-night-muted text-center px-2 py-3 rounded-md border border-dashed border-day-border dark:border-night-border">
      {children}
    </p>
  );
}
