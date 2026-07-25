import { useMemo, useRef, useState } from 'react';
import {
  Check,
  FileArchive,
  FileCode2,
  FileJson,
  Focus,
  Gauge,
  Info,
  Pause,
  Pencil,
  Play,
  Plus,
  Route,
  Save,
  Square,
  Trash2,
  Undo2,
  Upload,
  Waves,
  X,
} from 'lucide-react';
import { useFlypath } from '@/contexts/FlypathContext';
import { readSpatialFile } from '@/utils/spatialUpload';
import {
  buildShapefileFiles,
  buildZip,
  toGeoJson,
  toKml,
  triggerDownload,
  safeFileName,
} from '@/utils/layerExport';
import { cn } from '@/utils/cn';

// Lake Flypath config panel.
// ---------------------------------------------------------------------------
// Layout:
//   1. Flypath routes container — list of every uploaded route. The
//      selected one is highlighted and gets its style controls
//      expanded inline. Add / remove / focus / select controls per
//      row; empty state is a drop zone.
//   2. Lakes / features card — a single contextual overlay layer.
//   3. Playback row  — combined Play/Pause (green→amber) + red Stop.
//   4. Speed slider  — flight duration.
//
// Camera pitch/bearing are decided by the map subscriber (fixed
// pitch, camera holds the view of every route so multiple flypaths
// stay visible during the flight — "converging flows" story).

export default function FlypathPanel() {
  const {
    routes,
    selectedRouteId,
    features,
    featuresStyle,
    playState,
    hasRoute,
    addRoute,
    removeRoute,
    selectRoute,
    setRouteStyleFor,
    setFeatures,
    clearFeatures,
    setFeaturesStyle,
    requestFlyToRoutes,
    requestFlyToFeatures,
    start,
    pause,
    resume,
    stop,
    digitizing,
    drawnCoords,
    pendingDrawn,
    startDigitize,
    cancelDigitize,
    finishDigitize,
    undoDrawnVertex,
    clearPendingDrawn,
  } = useFlypath();

  return (
    <div className="flex flex-col gap-3">
      <RoutesContainer
        routes={routes}
        selectedId={selectedRouteId}
        onAdd={(parsed) => {
          addRoute(parsed);
          requestFlyToRoutes();
        }}
        onSelect={selectRoute}
        onRemove={removeRoute}
        onStyleChange={setRouteStyleFor}
        onZoomAll={requestFlyToRoutes}
        onCreate={startDigitize}
        digitizing={digitizing}
      />

      {digitizing ? (
        <DigitizeToolbar
          vertexCount={drawnCoords.length}
          onUndo={undoDrawnVertex}
          onCancel={cancelDigitize}
          onFinish={finishDigitize}
        />
      ) : null}

      {pendingDrawn ? (
        <SaveDrawnPanel
          coords={pendingDrawn.coords}
          onCommit={(payload) => {
            addRoute(payload);
            requestFlyToRoutes();
            clearPendingDrawn();
          }}
          onCancel={clearPendingDrawn}
        />
      ) : null}

      <FeaturesUploadCard
        value={features}
        style={featuresStyle}
        onStyleChange={setFeaturesStyle}
        onFile={(parsed) => {
          setFeatures(parsed);
          requestFlyToFeatures();
        }}
        onZoomTo={requestFlyToFeatures}
        onClear={clearFeatures}
      />

      <div className="h-px w-full bg-day-border dark:bg-night-border my-1" />

      <PlaybackRow
        playState={playState}
        hasRoute={hasRoute}
        onStart={start}
        onPause={pause}
        onResume={resume}
        onStop={stop}
      />
      <SpeedControl />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Routes container — list of every uploaded route + add button.
// ---------------------------------------------------------------------------
function RoutesContainer({ routes, selectedId, onAdd, onSelect, onRemove, onStyleChange, onZoomAll, onCreate, digitizing }) {
  return (
    <div className="rounded-md border border-day-border dark:border-night-border overflow-hidden">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-day-bg dark:bg-night-bg border-b border-day-border dark:border-night-border">
        <Route className="h-3.5 w-3.5 text-brand-700 dark:text-brand-200" />
        <span className="text-[12px] font-semibold text-day-text dark:text-night-text">
          Flypath routes
        </span>
        {routes.length > 1 ? (
          <span className="text-[10px] text-day-muted dark:text-night-muted">
            {routes.length}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          {routes.length > 0 ? (
            <button
              type="button"
              onClick={onZoomAll}
              className={cn(
                'inline-flex items-center justify-center h-8 w-8 rounded-md',
                'text-day-text dark:text-night-text',
                'hover:bg-day-border dark:hover:bg-night-border transition-colors',
              )}
              aria-label="Zoom to all routes"
              title="Zoom to all routes"
            >
              <Focus style={{ width: 18, height: 18 }} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onCreate}
            disabled={digitizing}
            className={cn(
              'inline-flex items-center justify-center h-8 w-8 rounded-md',
              'text-day-text dark:text-night-text',
              'hover:bg-day-border dark:hover:bg-night-border transition-colors',
              digitizing && 'opacity-60 cursor-not-allowed',
            )}
            aria-label="Draw flypath route on map"
            title="Draw a flypath by clicking on the map"
          >
            <Pencil style={{ width: 18, height: 18 }} />
          </button>
          <AddRouteButton onAdd={onAdd} />
        </div>
      </div>

      {routes.length === 0 ? (
        <UploadDropZone
          hint="LineString paths the camera can follow"
          onFile={onAdd}
        />
      ) : (
        <ul className="divide-y divide-day-border dark:divide-night-border">
          {routes.map((r) => (
            <li key={r.id}>
              <RouteRow
                route={r}
                selected={r.id === selectedId}
                onSelect={() => onSelect(r.id)}
                onRemove={() => onRemove(r.id)}
                onStyleChange={(partial) => onStyleChange(r.id, partial)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddRouteButton({ onAdd }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const handle = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const parsed = await readSpatialFile(file);
      if (!parsed.fc.features.length) return;
      onAdd(parsed);
    } catch (err) {
      // Surface via console — the empty drop zone handles error
      // display for the initial state, and add-more errors are rare.
      // eslint-disable-next-line no-console
      console.warn('Route upload failed:', err.message || err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={cn(
          'inline-flex items-center justify-center h-8 w-8 rounded-md',
          'bg-[#84cc16] text-[#1a2e05] hover:bg-[#65a30d] active:bg-[#4d7c0f] transition-colors',
          'shadow-sm',
          busy && 'opacity-60 cursor-wait',
        )}
        aria-label="Upload flypath route file"
        title="Upload a flypath route file"
      >
        <Plus style={{ width: 20, height: 20 }} strokeWidth={2.75} />
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".geojson,.json,.zip,.kml,.kmz,application/json,application/geo+json,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) handle(file);
        }}
        className="hidden"
      />
    </>
  );
}

function RouteRow({ route, selected, onSelect, onRemove, onStyleChange }) {
  const KindIcon = route.kind === 'shapefile' ? FileArchive
                 : route.kind === 'kmz'       ? FileArchive
                 : route.kind === 'kml'       ? FileCode2
                 : FileJson;
  const featCount = route.fc?.features?.length ?? 0;

  return (
    <div
      className={cn(
        'transition-colors',
        selected ? 'bg-[#84cc16]/10' : 'hover:bg-day-bg dark:hover:bg-night-bg',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left"
        aria-pressed={selected}
        title={selected ? 'Selected for animation' : 'Click to select for animation'}
      >
        <span
          className={cn(
            'inline-flex h-4 w-4 items-center justify-center rounded-full shrink-0',
            'ring-1',
            selected
              ? 'ring-[#84cc16] bg-[#84cc16]'
              : 'ring-day-border dark:ring-night-border bg-transparent',
          )}
          aria-hidden
        >
          {selected ? <Check style={{ width: 10, height: 10 }} className="text-[#1a2e05]" /> : null}
        </span>
        <span
          className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
          style={{ backgroundColor: route.style.color }}
          aria-hidden
        />
        <KindIcon className="h-3.5 w-3.5 text-day-muted dark:text-night-muted shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[11.5px] font-medium truncate text-day-text dark:text-night-text">
            {route.name}
          </div>
          <div className="text-[10.5px] text-day-muted dark:text-night-muted">
            {featCount} feature{featCount === 1 ? '' : 's'} · {route.kind}
          </div>
        </div>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onRemove(); }
          }}
          className="btn-icon btn-ghost h-8 w-8 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
          aria-label={`Remove ${route.name}`}
          title="Remove route"
        >
          <Trash2 style={{ width: 18, height: 18 }} />
        </span>
      </button>

      {selected ? (
        <StyleControls style={route.style} onChange={onStyleChange} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Features upload card — single layer, styling always visible when loaded.
// ---------------------------------------------------------------------------
function FeaturesUploadCard({ value, style, onStyleChange, onFile, onZoomTo, onClear }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const handle = async (file) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const parsed = await readSpatialFile(file);
      if (!parsed.fc.features.length) {
        throw new Error('File parsed but contained zero features.');
      }
      onFile(parsed);
    } catch (err) {
      setError(err.message || 'Failed to parse file.');
    } finally {
      setBusy(false);
    }
  };

  const KindIcon = value?.kind === 'shapefile' ? FileArchive
                 : value?.kind === 'kmz'       ? FileArchive
                 : value?.kind === 'kml'       ? FileCode2
                 : FileJson;

  return (
    <div className="rounded-md border border-day-border dark:border-night-border overflow-hidden">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-day-bg dark:bg-night-bg border-b border-day-border dark:border-night-border">
        <Waves className="h-3.5 w-3.5 text-brand-700 dark:text-brand-200" />
        <span className="text-[12px] font-semibold text-day-text dark:text-night-text">
          Lakes / features
        </span>
      </div>

      {value ? (
        <>
          <div className="flex items-center gap-2 px-2.5 py-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
              style={{ backgroundColor: style.color }}
              aria-hidden
            />
            <KindIcon className="h-3.5 w-3.5 text-day-muted dark:text-night-muted shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[11.5px] font-medium truncate text-day-text dark:text-night-text">
                {value.name}
              </div>
              <div className="text-[10.5px] text-day-muted dark:text-night-muted">
                {value.fc.features.length} feature{value.fc.features.length === 1 ? '' : 's'} · {value.kind}
              </div>
            </div>
            <button
              type="button"
              onClick={onZoomTo}
              className="btn-icon btn-ghost h-8 w-8"
              aria-label="Zoom to features"
              title="Zoom to layer"
            >
              <Focus style={{ width: 18, height: 18 }} />
            </button>
            <button
              type="button"
              onClick={onClear}
              className="btn-icon btn-ghost h-8 w-8 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
              aria-label="Remove features"
              title="Remove"
            >
              <Trash2 style={{ width: 18, height: 18 }} />
            </button>
          </div>
          <StyleControls style={style} onChange={onStyleChange} />
        </>
      ) : (
        <UploadDropZone
          hint="Polygons or points visualised along the flypath"
          onFile={async (payload) => onFile(payload)}
          inputRef={inputRef}
          busy={busy}
          error={error}
          dragOver={dragOver}
          setDragOver={setDragOver}
          handle={handle}
        />
      )}

      {error && value == null ? null : (
        error ? (
          <div className="px-2.5 py-1.5 text-[10.5px] text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border-t border-red-200 dark:border-red-900">
            {error}
          </div>
        ) : null
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".geojson,.json,.zip,.kml,.kmz,application/json,application/geo+json,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) handle(file);
        }}
        className="hidden"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared drop zone. Used for the initial routes empty state + the
// features card empty state.
// ---------------------------------------------------------------------------
function UploadDropZone({ hint, onFile, inputRef, busy, error, dragOver, setDragOver, handle }) {
  const localRef = useRef(null);
  const [localBusy, setLocalBusy] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [localDrag, setLocalDrag] = useState(false);

  // If parent didn't wire a ref/handler, run our own upload flow —
  // that's the routes empty state, where the parent just needs the
  // parsed payload passed to `onAdd`.
  const rootRef = inputRef ?? localRef;
  const isBusy = busy ?? localBusy;
  const err = error ?? localError;
  const isDrag = dragOver ?? localDrag;

  const runHandle = async (file) => {
    if (!file) return;
    if (handle) return handle(file);
    setLocalBusy(true);
    setLocalError(null);
    try {
      const parsed = await readSpatialFile(file);
      if (!parsed.fc.features.length) throw new Error('File parsed but contained zero features.');
      await onFile(parsed);
    } catch (e) {
      setLocalError(e.message || 'Failed to parse file.');
    } finally {
      setLocalBusy(false);
    }
  };

  const setDrag = setDragOver ?? setLocalDrag;

  return (
    <>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const file = e.dataTransfer?.files?.[0];
          if (file) runHandle(file);
        }}
        className={cn(
          'flex flex-col items-center justify-center gap-1 px-2 py-3',
          'text-center cursor-pointer transition-colors',
          isDrag ? 'bg-[#84cc16]/10' : 'hover:bg-day-bg dark:hover:bg-night-bg',
        )}
        onClick={() => rootRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') rootRef.current?.click(); }}
      >
        <Upload className="h-4 w-4 text-day-muted dark:text-night-muted" />
        <div className="text-[11px] text-day-text dark:text-night-text">
          {isBusy ? 'Parsing…' : 'Click or drop a file'}
        </div>
        <div className="text-[10px] text-day-muted dark:text-night-muted">{hint}</div>
        <div className="text-[9.5px] text-day-muted dark:text-night-muted mt-0.5">
          .geojson · .json · .zip (shapefile) · .kml · .kmz
        </div>
      </div>
      {err ? (
        <div className="px-2.5 py-1.5 text-[10.5px] text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border-t border-red-200 dark:border-red-900">
          {err}
        </div>
      ) : null}
      {inputRef ? null : (
        <input
          ref={localRef}
          type="file"
          accept=".geojson,.json,.zip,.kml,.kmz,application/json,application/geo+json,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) runHandle(file);
          }}
          className="hidden"
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Style controls — color, outline, width, opacity for one layer.
// ---------------------------------------------------------------------------
function StyleControls({ style, onChange }) {
  return (
    <div className="px-2.5 py-2 border-t border-day-border dark:border-night-border bg-day-bg/60 dark:bg-night-bg/60 flex flex-col gap-1.5">
      <div className="grid grid-cols-2 gap-1.5">
        <SwatchRow label="Color"   value={style.color}        onChange={(color) => onChange({ color })} />
        <SwatchRow label="Outline" value={style.outlineColor} onChange={(outlineColor) => onChange({ outlineColor })} />
      </div>
      <SliderRow
        label="Width" min={0.5} max={8} step={0.5}
        value={style.width}
        onChange={(width) => onChange({ width })}
        display={`${style.width}px`}
      />
      <SliderRow
        label="Opacity" min={0} max={1} step={0.05}
        value={style.opacity}
        onChange={(opacity) => onChange({ opacity })}
        display={`${Math.round(style.opacity * 100)}%`}
      />
    </div>
  );
}

function SwatchRow({ label, value, onChange }) {
  // Pretty swatch tile — the native colour input is hidden inside a
  // styled rounded box. The tile shows the current colour with a
  // subtle diagonal highlight overlay so dark colours still look
  // interactive.
  return (
    <label
      className={cn(
        'flex items-center gap-2 text-[10.5px] uppercase tracking-wide cursor-pointer',
        'text-day-muted dark:text-night-muted',
      )}
    >
      <span
        className={cn(
          'relative inline-flex h-6 w-8 rounded-md overflow-hidden shrink-0',
          'ring-1 ring-day-border dark:ring-night-border shadow-inner',
          'transition-transform hover:scale-105 active:scale-95',
        )}
        style={{ backgroundColor: value }}
        title={value}
      >
        <span
          aria-hidden
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0) 55%)',
          }}
        />
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 opacity-0 cursor-pointer"
          aria-label={label}
        />
      </span>
      <span>{label}</span>
    </label>
  );
}

function SliderRow({ label, min, max, step, value, onChange, display }) {
  return (
    <div className="flex items-center gap-2 text-[10.5px] text-day-muted dark:text-night-muted">
      <span className="uppercase tracking-wide w-14 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-1 accent-[#84cc16]"
      />
      <span className="tabular-nums text-day-text dark:text-night-text w-10 text-right">
        {display}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Playback row — combined Play/Pause + separate Stop.
// ---------------------------------------------------------------------------
function PlaybackRow({ playState, hasRoute, onStart, onPause, onResume, onStop }) {
  const isPlaying = playState === 'playing';
  const isPaused  = playState === 'paused';
  const isStopped = playState === 'stopped';

  const onPrimary = isPlaying ? onPause
                  : isPaused  ? onResume
                              : onStart;
  const PrimaryIcon = isPlaying ? Pause : Play;
  const primaryTone = isPlaying ? 'amber' : 'emerald';
  const primaryLabel = isPlaying ? 'Pause flypath'
                     : isPaused  ? 'Resume flypath'
                                 : 'Start flypath';

  return (
    <div className="grid grid-cols-2 gap-1.5">
      <PlaybackButton
        icon={PrimaryIcon}
        onClick={onPrimary}
        disabled={!hasRoute}
        title={!hasRoute ? 'Upload a flypath route first' : primaryLabel}
        ariaLabel={primaryLabel}
        tone={primaryTone}
      />
      <PlaybackButton
        icon={Square}
        onClick={onStop}
        disabled={isStopped}
        title="Stop and reset flypath"
        ariaLabel="Stop flypath"
        tone="red"
      />
    </div>
  );
}

const TONE_CLASSES = {
  emerald: 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:bg-emerald-600/40',
  amber:   'bg-amber-500  hover:bg-amber-600  active:bg-amber-700  disabled:bg-amber-500/40',
  red:     'bg-red-600    hover:bg-red-700    active:bg-red-800    disabled:bg-red-600/40',
};

function PlaybackButton({ icon: Icon, onClick, disabled, title, ariaLabel, tone }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className={cn(
        'flex items-center justify-center h-9 rounded-md text-white',
        'disabled:cursor-not-allowed transition-colors',
        TONE_CLASSES[tone] ?? TONE_CLASSES.red,
      )}
    >
      <Icon fill="currentColor" style={{ width: 18, height: 18 }} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Digitize toolbar — floats inside the panel while a drawing is
// in progress. Shows vertex count + Undo / Cancel / Finish controls.
// The actual map interactions live in FlypathDigitizer.
// ---------------------------------------------------------------------------
function DigitizeToolbar({ vertexCount, onUndo, onCancel, onFinish }) {
  return (
    <div className="rounded-md border border-red-500/70 bg-red-500/5 dark:bg-red-950/20 px-2.5 py-2 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[11px]">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-70 animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
        </span>
        <span className="font-semibold text-red-700 dark:text-red-300">
          Drawing flypath
        </span>
        <span className="ml-auto text-day-muted dark:text-night-muted tabular-nums">
          {vertexCount} vertex{vertexCount === 1 ? '' : 'es'}
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-[10.5px] text-day-muted dark:text-night-muted">
        <Info className="h-3 w-3 shrink-0" />
        <span className="leading-tight">
          Click to add · click-drag for freehand · Delete to undo · Esc to cancel.
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <button
          type="button"
          onClick={onUndo}
          disabled={vertexCount === 0}
          className={cn(
            'flex items-center justify-center gap-1 h-8 rounded-md text-[11.5px] font-semibold',
            'bg-day-bg dark:bg-night-bg',
            'text-day-text dark:text-night-text',
            'border border-day-border dark:border-night-border',
            'hover:bg-day-border dark:hover:bg-night-border',
            'disabled:opacity-40 disabled:cursor-not-allowed transition-colors',
          )}
        >
          <Undo2 style={{ width: 14, height: 14 }} />
          Undo
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={cn(
            'flex items-center justify-center gap-1 h-8 rounded-md text-[11.5px] font-semibold text-white',
            'bg-red-600 hover:bg-red-700 active:bg-red-800 transition-colors',
          )}
        >
          <X style={{ width: 14, height: 14 }} />
          Cancel
        </button>
        <button
          type="button"
          onClick={onFinish}
          disabled={vertexCount < 2}
          className={cn(
            'flex items-center justify-center gap-1 h-8 rounded-md text-[11.5px] font-semibold text-white',
            'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800',
            'disabled:opacity-40 disabled:cursor-not-allowed transition-colors',
          )}
          title={vertexCount < 2 ? 'Need at least two vertices to finish' : 'Finish drawing'}
        >
          <Check style={{ width: 14, height: 14 }} />
          Finish
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Save panel — appears after Finish. Lets the operator name the route,
// optionally download it in a format (GeoJSON / KML / KMZ / Shapefile),
// and always adds it to the routes list on commit. Skip = add without
// downloading. EPSG:4326 is the fixed CRS since the map is in that CRS
// and re-projection isn't necessary for a hand-drawn flypath.
// ---------------------------------------------------------------------------
function SaveDrawnPanel({ coords, onCommit, onCancel }) {
  const defaultName = useMemo(() => {
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '-');
    return `Drawn flypath ${stamp}`;
  }, []);
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(null);

  const fc = useMemo(() => ({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { name },
      geometry: { type: 'LineString', coordinates: coords },
    }],
  }), [coords, name]);

  const commitAs = async (kind) => {
    setBusy(kind);
    try {
      if (kind !== 'none') await downloadAs(kind, fc, name);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('Flypath export failed:', err?.message || err);
    } finally {
      setBusy(null);
      onCommit({
        fc: {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: { name },
            geometry: { type: 'LineString', coordinates: coords },
          }],
        },
        kind: kind === 'none' ? 'geojson' : kind === 'kmz' ? 'kmz' : kind,
        name: `${name}.${extFor(kind)}`,
      });
    }
  };

  return (
    <div className="rounded-md border border-emerald-500/70 bg-emerald-500/5 dark:bg-emerald-950/20 px-2.5 py-2 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[11px]">
        <Save className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-300" />
        <span className="font-semibold text-emerald-700 dark:text-emerald-300">
          Save drawn flypath
        </span>
        <span className="ml-auto text-day-muted dark:text-night-muted tabular-nums">
          {coords.length} vertices
        </span>
      </div>
      <label className="flex flex-col gap-1 text-[10.5px] text-day-muted dark:text-night-muted uppercase tracking-wide">
        Name
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input-base h-8 text-[12px] normal-case tracking-normal"
        />
      </label>
      <div className="text-[10px] text-day-muted dark:text-night-muted">
        Export format (EPSG:4326):
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <FormatButton label="GeoJSON"   onClick={() => commitAs('geojson')} busy={busy === 'geojson'} />
        <FormatButton label="KML"       onClick={() => commitAs('kml')}     busy={busy === 'kml'} />
        <FormatButton label="KMZ"       onClick={() => commitAs('kmz')}     busy={busy === 'kmz'} />
        <FormatButton label="Shapefile" onClick={() => commitAs('shp')}     busy={busy === 'shp'} />
      </div>
      <div className="grid grid-cols-2 gap-1.5 mt-1">
        <button
          type="button"
          onClick={onCancel}
          className={cn(
            'inline-flex items-center justify-center gap-1 h-8 rounded-md text-[11.5px] font-semibold',
            'bg-day-bg dark:bg-night-bg text-day-text dark:text-night-text',
            'border border-day-border dark:border-night-border',
            'hover:bg-day-border dark:hover:bg-night-border transition-colors',
          )}
        >
          Discard
        </button>
        <button
          type="button"
          onClick={() => commitAs('none')}
          disabled={busy != null}
          className={cn(
            'inline-flex items-center justify-center gap-1 h-8 rounded-md text-[11.5px] font-semibold',
            'bg-[#84cc16] text-[#1a2e05] hover:bg-[#65a30d] transition-colors',
            'disabled:opacity-60 disabled:cursor-not-allowed',
          )}
        >
          Just use it
        </button>
      </div>
    </div>
  );
}

function FormatButton({ label, onClick, busy }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        'inline-flex items-center justify-center h-8 rounded-md text-[11.5px] font-semibold',
        'bg-day-bg dark:bg-night-bg text-day-text dark:text-night-text',
        'border border-day-border dark:border-night-border',
        'hover:bg-day-border dark:hover:bg-night-border transition-colors',
        busy && 'opacity-60 cursor-wait',
      )}
    >
      {busy ? 'Saving…' : label}
    </button>
  );
}

function extFor(kind) {
  if (kind === 'kml')     return 'kml';
  if (kind === 'kmz')     return 'kmz';
  if (kind === 'shp')     return 'zip';
  return 'geojson';
}

// Download the drawn LineString in the requested format. All exports
// pin CRS to EPSG:4326 (WGS 84) — the map is already in that CRS and
// no user has asked for anything else.
//
// Save target: on Chromium browsers we open the File System Access
// picker so the operator can choose the directory + tweak the
// filename. On Safari/Firefox (no `showSaveFilePicker`) we fall back
// to the classic `<a download>` trigger — file lands in the browser's
// default download folder.
async function downloadAs(kind, fc, baseName) {
  const safe = safeFileName(baseName);
  const payload = buildPayload(kind, fc, safe);
  if (!payload) return;
  await saveWithPicker(payload);
}

function buildPayload(kind, fc, safe) {
  if (kind === 'geojson') {
    return {
      filename: `${safe}.geojson`,
      data:     toGeoJson(fc, 'EPSG:4326'),
      mime:     'application/geo+json',
      ext:      'geojson',
      label:    'GeoJSON',
    };
  }
  if (kind === 'kml') {
    return {
      filename: `${safe}.kml`,
      data:     toKml(fc, ['name'], safe),
      mime:     'application/vnd.google-earth.kml+xml',
      ext:      'kml',
      label:    'KML',
    };
  }
  if (kind === 'kmz') {
    // KMZ = zipped KML. Google Earth expects the KML at `doc.kml`.
    const text = toKml(fc, ['name'], safe);
    return {
      filename: `${safe}.kmz`,
      data:     buildZip([{ name: 'doc.kml', data: new TextEncoder().encode(text) }]),
      mime:     'application/vnd.google-earth.kmz',
      ext:      'kmz',
      label:    'KMZ',
    };
  }
  if (kind === 'shp') {
    const files = buildShapefileFiles(fc, ['name'], 'EPSG:4326', safe);
    return {
      filename: `${safe}.zip`,
      data:     buildZip(files),
      mime:     'application/zip',
      ext:      'zip',
      label:    'Shapefile (zipped)',
    };
  }
  return null;
}

async function saveWithPicker({ filename, data, mime, ext, label }) {
  // Chromium-family only. Silently fall back on browsers without it.
  if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: label, accept: { [mime]: [`.${ext}`] } }],
      });
      const writable = await handle.createWritable();
      // Wrap string payloads in a Blob so the writable gets a
      // typed body; Uint8Array can be written directly.
      const body = data instanceof Uint8Array
        ? data
        : new Blob([data], { type: mime });
      await writable.write(body);
      await writable.close();
      return;
    } catch (err) {
      // User cancelled the picker — treat as a silent no-op (they
      // didn't want to save). Any other error falls through to the
      // classic download so we don't lose their data.
      if (err?.name === 'AbortError') return;
      // eslint-disable-next-line no-console
      console.warn('[flypath export] picker failed, falling back:', err);
    }
  }
  // Fallback for browsers without File System Access API.
  triggerDownload(filename, data, ext);
}

// ---------------------------------------------------------------------------
// Speed control — duration slider from 5 s to 180 s.
// ---------------------------------------------------------------------------
function SpeedControl() {
  const { flightDuration, setFlightDuration } = useFlypath();
  const seconds = flightDuration / 1000;
  return (
    <div className="flex items-center gap-2 text-[10.5px] text-day-muted dark:text-night-muted">
      <Gauge className="h-3.5 w-3.5 text-brand-700 dark:text-brand-200 shrink-0" />
      <span className="uppercase tracking-wide w-12 shrink-0">Speed</span>
      <input
        type="range"
        min={5}
        max={180}
        step={1}
        value={seconds}
        onChange={(e) => setFlightDuration(Number(e.target.value) * 1000)}
        className="flex-1 h-1 accent-[#84cc16]"
        aria-label="Flight duration"
      />
      <span className="tabular-nums text-day-text dark:text-night-text w-12 text-right">
        {seconds < 60 ? `${seconds}s` : `${(seconds / 60).toFixed(1)}m`}
      </span>
    </div>
  );
}
