import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  ChevronDown,
  Crosshair,
  Eye,
  FileArchive,
  FileCode2,
  FileJson,
  Focus,
  Gauge,
  Info,
  Loader2,
  Palette,
  Pause,
  Pencil,
  Plane,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  Ruler,
  Route,
  Save,
  Square,
  Tag,
  Trash2,
  Type,
  Undo2,
  Upload,
  Video,
  Waves,
  X,
} from 'lucide-react';
import { useFlypath } from '@/contexts/FlypathContext';
import {
  readSpatialFile,
  featureCollectionLengthMeters,
  formatLength,
} from '@/utils/spatialUpload';
import {
  buildShapefileFiles,
  buildZip,
  toGeoJson,
  toKml,
  triggerDownload,
  safeFileName,
} from '@/utils/layerExport';
import {
  LABEL_UNITS,
  appendAttributeToExpression,
  attributesInExpression,
  removeAttributeFromExpression,
  unitById,
} from '@/utils/labelExpression';
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
    awaitingTerrain,
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
    selectingOrigin,
    beginSelectOrigin,
    cancelSelectOrigin,
    setRouteOrigin,
    requestExport,
  } = useFlypath();

  return (
    // Panel splits into a scrollable middle (routes + features +
    // labels) and a sticky bottom (playback). The parent panel
    // wrapper in LeftSidebar was tweaked to hand us the full height
    // without applying its own overflow-y-auto, so the internal
    // scroll region works cleanly.
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3">
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

        {selectingOrigin ? (
          <SelectOriginToolbar onCancel={cancelSelectOrigin} />
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

        {features ? <FeaturesLabelsCard /> : null}
      </div>

      {/* Fixed-bottom playback dock — visually separated with a top
          border. Stays put while the middle scrolls. Compact vertical
          spacing so the mode row + speed + loop all fit without
          pushing the label card off-screen. */}
      <div className="shrink-0 flex flex-col gap-1.5 pt-1.5 mt-1.5 border-t border-day-border dark:border-night-border">
        <PlaybackRow
          playState={playState}
          awaitingTerrain={awaitingTerrain}
          hasRoute={hasRoute}
          onStart={start}
          onPause={pause}
          onResume={resume}
          onStop={stop}
        />
        <ModeRow />
        <SpeedControl />
        <LoopControl />
        <ExportAnimationButton
          hasRoute={hasRoute}
          onExport={requestExport}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export Animation — one-click entry into the FlypathExportRecorder
// flow living inside the map wrapper. Disabled until at least one
// route is loaded; a click bumps `exportTick` and the recorder over
// on the map picks up the request via context.
// ---------------------------------------------------------------------------
function ExportAnimationButton({ hasRoute, onExport }) {
  return (
    <button
      type="button"
      onClick={onExport}
      disabled={!hasRoute}
      title={hasRoute
        ? 'Draw a region and record the flypath as a video'
        : 'Add a flypath route to enable export'}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 h-8 w-full rounded-md',
        'text-[12px] font-semibold transition-colors',
        hasRoute
          ? 'bg-[#84cc16] text-[#1a2e05] hover:bg-[#65a30d]'
          : 'bg-day-bg dark:bg-night-bg text-day-muted dark:text-night-muted border border-day-border dark:border-night-border cursor-not-allowed',
      )}
    >
      <Video style={{ width: 13, height: 13 }} />
      Export animation
    </button>
  );
}

// ---------------------------------------------------------------------------
// Routes container — list of every uploaded route + add button.
// ---------------------------------------------------------------------------
function RoutesContainer({ routes, selectedId, onAdd, onSelect, onRemove, onStyleChange, onCreate, digitizing }) {
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
        <>
          {/* Focused row — the currently-selected route gets the
              full RouteRow with its style + origin controls. */}
          {(() => {
            const selected = routes.find((r) => r.id === selectedId) ?? routes[0];
            if (!selected) return null;
            return (
              <RouteRow
                route={selected}
                selected
                onSelect={() => onSelect(selected.id)}
                onRemove={() => onRemove(selected.id)}
                onStyleChange={(partial) => onStyleChange(selected.id, partial)}
              />
            );
          })()}

          {/* Others — a compact scrollable list beneath. Each row
              is a radio-style selector so one click swaps focus. */}
          {routes.length > 1 ? (
            <OthersList
              others={routes.filter((r) => r.id !== (selectedId ?? routes[0]?.id))}
              onSelect={onSelect}
              onRemove={onRemove}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

// Compact scrollable list of the non-focused routes. Each row is a
// tightly-packed radio + colour dot + name + length + trash chip;
// clicking anywhere on the row promotes that route into the focused
// slot above. Height-capped so a long list stays a small congested
// area rather than pushing the label / playback dock off-screen.
function OthersList({ others, onSelect, onRemove }) {
  return (
    <div className="border-t border-day-border dark:border-night-border">
      <div className="flex items-center justify-between px-2 py-1 bg-day-bg/60 dark:bg-night-bg/60">
        <span className="text-[9.5px] uppercase tracking-wide text-day-muted dark:text-night-muted">
          Other flypaths
        </span>
        <span className="text-[9.5px] text-day-muted dark:text-night-muted tabular-nums">
          {others.length}
        </span>
      </div>
      <ul className="max-h-[132px] overflow-y-auto divide-y divide-day-border/60 dark:divide-night-border/60">
        {others.map((r) => (
          <li key={r.id}>
            <CompactRouteRow
              route={r}
              onSelect={() => onSelect(r.id)}
              onRemove={() => onRemove(r.id)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function CompactRouteRow({ route, onSelect, onRemove }) {
  const featCount = route.fc?.features?.length ?? 0;
  const lengthLabel = useMemo(
    () => formatLength(featureCollectionLengthMeters(route.fc)),
    [route.fc],
  );
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      className={cn(
        'flex items-center gap-1.5 px-2 py-1 cursor-pointer',
        'hover:bg-[#84cc16]/10 transition-colors',
      )}
      title={`Select ${route.name}`}
    >
      {/* Color-filled radio — always shows the route's colour so the
          eye scans by hue. Selection is implied by position (top /
          focused slot), so the compact rows never show a check. */}
      <ColorRadio color={route.style.color} selected={false} small />
      <div className="flex-1 min-w-0">
        <div className="text-[10.5px] font-medium truncate text-day-text dark:text-night-text leading-tight">
          {route.name}
        </div>
        <div className="text-[9px] text-day-muted dark:text-night-muted leading-tight">
          {featCount} feat · {route.kind}
          {lengthLabel ? ` · ${lengthLabel}` : ''}
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className={cn(
          'inline-flex items-center justify-center h-5 w-5 rounded shrink-0',
          'text-red-600 dark:text-red-400',
          'hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors',
        )}
        aria-label={`Remove ${route.name}`}
        title="Remove route"
      >
        <Trash2 style={{ width: 11, height: 11 }} />
      </button>
    </div>
  );
}

// Chrome exits fullscreen the moment a native file picker opens
// (security sandbox — the picker chrome can't paint over a fullscreen
// document). This tiny hook captures whichever element was in
// fullscreen just before the picker click, then re-requests
// fullscreen on it once the change event fires. The change event
// itself counts as a user gesture, so the second requestFullscreen
// is allowed.
function useFullscreenSafeUpload() {
  const capturedRef = useRef(null);
  const rememberFullscreen = () => {
    capturedRef.current = document.fullscreenElement || null;
  };
  const restoreFullscreen = async () => {
    const target = capturedRef.current;
    capturedRef.current = null;
    if (!target) return;
    if (document.fullscreenElement) return;
    if (!target.isConnected) return;
    try { await target.requestFullscreen(); }
    catch { /* gesture window may have expired */ }
  };
  return { rememberFullscreen, restoreFullscreen };
}

function AddRouteButton({ onAdd }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const { rememberFullscreen, restoreFullscreen } = useFullscreenSafeUpload();

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
        onClick={() => { rememberFullscreen(); inputRef.current?.click(); }}
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
        multiple
        accept=".geojson,.json,.zip,.kml,.kmz,application/json,application/geo+json,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz"
        onChange={async (e) => {
          // Multiple-select allowed — process each file in order so
          // the first one lands in the focused slot and the rest
          // pile into the compact list. All go through the same
          // `handle` path so parse errors are surfaced per file.
          const files = Array.from(e.target.files || []);
          e.target.value = '';
          for (const file of files) {
            // eslint-disable-next-line no-await-in-loop
            await handle(file);
          }
          await restoreFullscreen();
        }}
        className="hidden"
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// StylePopover — portal-based popover that hosts the layer style
// controls (COLOR, OUTLINE, WIDTH, OPACITY) with Cancel / Apply
// buttons. Positioned to the right of the anchor row via
// getBoundingClientRect, and re-positions on scroll / resize so it
// stays glued to its row when the panel scrolls.
//
// Draft state lives inside the popover — Apply commits, Cancel /
// click-outside discards. This keeps the panel free of preview
// churn while the operator is fiddling with sliders.
// ---------------------------------------------------------------------------
function StylePopover({ anchorRef, initialStyle, title, onApply, onClose }) {
  const [draft, setDraft] = useState(initialStyle);
  const popoverRef = useRef(null);
  const [pos, setPos] = useState(null);
  // Portal target — in fullscreen only descendants of the fullscreen
  // element paint, so document.body would be invisible. Track the
  // fullscreen state so the portal re-parents when it toggles.
  const [portalTarget, setPortalTarget] = useState(
    () => (typeof document !== 'undefined' && document.fullscreenElement) || (typeof document !== 'undefined' ? document.body : null),
  );
  useEffect(() => {
    const update = () => setPortalTarget(document.fullscreenElement || document.body);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  useLayoutEffect(() => {
    const el = anchorRef.current;
    if (!el) return undefined;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      // 8 px gutter to the right; align top-edge with the row.
      setPos({ top: rect.top, left: rect.right + 8 });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [anchorRef]);

  useEffect(() => {
    const onDown = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)
          && !anchorRef.current?.contains(e.target)) {
        onClose();
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [anchorRef, onClose]);

  if (!pos) return null;

  const patch = (partial) => setDraft((d) => ({ ...d, ...partial }));

  const popover = (
    <div
      ref={popoverRef}
      role="dialog"
      className={cn(
        'fixed z-[60] w-64 rounded-lg overflow-hidden',
        'bg-day-surface dark:bg-night-surface',
        'border border-day-border dark:border-night-border shadow-2xl',
      )}
      style={{ top: pos.top, left: pos.left }}
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-day-border dark:border-night-border bg-day-bg dark:bg-night-bg">
        <Palette className="h-3.5 w-3.5 text-brand-700 dark:text-brand-200 shrink-0" />
        <span className="text-[11px] font-semibold text-day-text dark:text-night-text truncate">
          {title || 'Style'}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="ml-auto btn-icon btn-ghost h-6 w-6"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <div className="px-2 py-2 flex flex-col gap-1.5">
        <div className="grid grid-cols-2 gap-1.5">
          <SwatchRow label="Color"   value={draft.color}
            onChange={(color) => patch({ color })} />
          <SwatchRow label="Outline" value={draft.outlineColor}
            onChange={(outlineColor) => patch({ outlineColor })} />
        </div>
        <SliderRow
          label="Width" min={0.5} max={8} step={0.5}
          value={draft.width}
          onChange={(width) => patch({ width })}
          display={`${draft.width}px`}
        />
        <SliderRow
          label="Opacity" min={0} max={1} step={0.05}
          value={draft.opacity}
          onChange={(opacity) => patch({ opacity })}
          display={`${Math.round(draft.opacity * 100)}%`}
        />
      </div>

      <div className="grid grid-cols-2 gap-1.5 px-2 pb-2 pt-1 border-t border-day-border dark:border-night-border">
        <button
          type="button"
          onClick={onClose}
          className={cn(
            'inline-flex items-center justify-center gap-1 h-7 rounded-md text-[11px] font-semibold',
            'bg-day-bg dark:bg-night-bg',
            'text-day-text dark:text-night-text',
            'border border-day-border dark:border-night-border',
            'hover:bg-day-border dark:hover:bg-night-border transition-colors',
          )}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => { onApply(draft); onClose(); }}
          className={cn(
            'inline-flex items-center justify-center gap-1 h-7 rounded-md text-[11px] font-semibold',
            'bg-[#84cc16] text-[#1a2e05] hover:bg-[#65a30d] transition-colors',
          )}
        >
          <Check style={{ width: 12, height: 12 }} />
          Apply
        </button>
      </div>
    </div>
  );

  if (!portalTarget) return null;
  return createPortal(popover, portalTarget);
}

function RouteRow({ route, selected, onSelect, onRemove, onStyleChange }) {
  const {
    selectingOrigin,
    beginSelectOrigin,
    cancelSelectOrigin,
    setRouteOrigin,
    requestFlyToSelectedRoute,
  } = useFlypath();

  const KindIcon = route.kind === 'shapefile' ? FileArchive
                 : route.kind === 'kmz'       ? FileArchive
                 : route.kind === 'kml'       ? FileCode2
                 : FileJson;
  const featCount = route.fc?.features?.length ?? 0;
  // Total polyline length across every LineString / MultiLineString
  // in the route — memoised on the fc reference so we don't re-walk
  // 10 000-vertex tracks on every render.
  const lengthLabel = useMemo(
    () => formatLength(featureCollectionLengthMeters(route.fc)),
    [route.fc],
  );

  const hasManualOrigin = route.originVertex === 'first' || route.originVertex === 'last';
  const rowRef = useRef(null);
  const paletteRef = useRef(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  return (
    <div
      ref={rowRef}
      className={cn(
        'transition-colors',
        selected ? 'bg-[#84cc16]/10' : 'hover:bg-day-bg dark:hover:bg-night-bg',
      )}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left cursor-pointer"
        aria-pressed={selected}
        title={selected ? 'Selected for animation' : 'Click to select for animation'}
      >
        <ColorRadio color={route.style.color} selected={selected} />
        <KindIcon className="h-3.5 w-3.5 text-day-muted dark:text-night-muted shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[11.5px] font-medium truncate text-day-text dark:text-night-text">
            {route.name}
          </div>
          <div className="text-[10.5px] text-day-muted dark:text-night-muted truncate">
            {featCount} feature{featCount === 1 ? '' : 's'} · {route.kind}
            {lengthLabel ? ` · ${lengthLabel}` : ''}
          </div>
        </div>
        <div className="flex items-center shrink-0 -mr-0.5">
          <RowIconButton
            icon={Focus}
            title="Zoom to this route"
            onClick={requestFlyToSelectedRoute}
          />
          <RowIconButton
            ref={paletteRef}
            icon={Palette}
            title="Edit route style"
            active={paletteOpen}
            onClick={() => setPaletteOpen((v) => !v)}
          />
          <RowIconButton
            icon={Trash2}
            title="Remove route"
            tone="danger"
            onClick={onRemove}
          />
        </div>
      </div>

      {paletteOpen ? (
        <StylePopover
          anchorRef={rowRef}
          initialStyle={route.style}
          title={`${route.name} · Style`}
          onApply={(next) => onStyleChange(next)}
          onClose={() => setPaletteOpen(false)}
        />
      ) : null}

      {selected ? (
        <OriginRow
          active={selectingOrigin}
          hasManualOrigin={hasManualOrigin}
          onActivate={beginSelectOrigin}
          onCancel={cancelSelectOrigin}
          onClear={() => setRouteOrigin(route.id, null)}
        />
      ) : null}
    </div>
  );
}

// Compact icon-only button used across the row action cluster. Same
// silhouette across every row so Focus / Palette / Trash line up
// vertically. Stops event propagation so tapping it doesn't also
// fire the row's select handler. forwardRef because the palette
// variant is used as the anchor for the popover-positioning code.
const RowIconButton = forwardRef(function RowIconButton(
  { icon: Icon, title, onClick, active, tone },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
      aria-label={title}
      title={title}
      className={cn(
        // Tighter — 24 px squares clustered flush together so the
        // cluster reads as one action group instead of stealing
        // space from the route name / feature count above.
        'inline-flex items-center justify-center h-6 w-6 rounded shrink-0 transition-colors',
        tone === 'danger'
          ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40'
          : active
            ? 'bg-[#84cc16] text-[#1a2e05] hover:bg-[#65a30d]'
            : 'text-day-text dark:text-night-text hover:bg-day-border dark:hover:bg-night-border',
      )}
    >
      <Icon style={{ width: 13, height: 13 }} />
    </button>
  );
});

// ColorRadio — filled circle in the route's colour that doubles as
// the "is this the focused route?" indicator. When `selected` is
// true a white check overlays the fill; when false the fill stays
// bare. Replaces the previous separate radio + colour-dot pair.
function ColorRadio({ color, selected, small }) {
  const size = small ? 12 : 16;
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex items-center justify-center rounded-full shrink-0',
        'ring-1 ring-black/25 dark:ring-white/30',
        selected && 'ring-2 ring-[#84cc16]',
      )}
      style={{ width: size, height: size, backgroundColor: color }}
    >
      {selected ? (
        <Check
          style={{
            width: small ? 8 : 10,
            height: small ? 8 : 10,
            color: '#ffffff',
            filter: 'drop-shadow(0 0 1px rgba(0,0,0,0.9))',
          }}
          strokeWidth={3}
        />
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Origin row — sits under the style controls of the selected route.
// Activates the map-side "Select origin" interaction. Doubles as a
// reset ("Clear manual origin") once a manual pick is in place, so
// the operator can hand orientation back to the automatic DEM check.
// ---------------------------------------------------------------------------
function OriginRow({ active, hasManualOrigin, onActivate, onCancel, onClear }) {
  const statusText = active
    ? 'Click a green marker on the map'
    : hasManualOrigin
      ? 'Manually pinned'
      : 'Auto (DEM-based)';
  const statusTone = active
    ? 'text-emerald-700 dark:text-emerald-300 font-medium'
    : hasManualOrigin
      ? 'text-day-text dark:text-night-text font-medium'
      : 'text-day-muted dark:text-night-muted italic';
  return (
    // Same silhouette + padding as the RouteRow above (px-2.5 py-2)
    // so the two sit flush without a subtle offset. `min-h-9` locks
    // the vertical rhythm even when the Reset button is absent, so
    // the row height doesn't shift as the operator toggles states.
    // Layout: [ORIGIN label] [status text] [reset?] [Crosshair action]
    // — no leading icon, and the Crosshair (which used to sit on the
    // left as a decorative marker) is now the primary action button
    // at the right end.
    <div
      className={cn(
        'px-2.5 py-2 min-h-9 border-t border-day-border dark:border-night-border',
        'bg-day-bg/60 dark:bg-night-bg/60',
        'flex items-center gap-2 text-[10.5px] leading-none',
      )}
    >
      <span className="uppercase tracking-wide text-day-muted dark:text-night-muted w-12 shrink-0">
        Origin
      </span>
      <span className={cn('flex-1 min-w-0 truncate', statusTone)}>
        {statusText}
      </span>
      <div className="flex items-center gap-1 shrink-0">
        {hasManualOrigin && !active ? (
          <button
            type="button"
            onClick={onClear}
            aria-label="Reset to automatic DEM-based origin"
            title="Reset to automatic DEM-based origin"
            className={cn(
              'inline-flex items-center justify-center h-6 w-6 rounded',
              'text-day-text dark:text-night-text',
              'hover:bg-day-border dark:hover:bg-night-border transition-colors',
            )}
          >
            <RotateCcw style={{ width: 12, height: 12 }} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={active ? onCancel : onActivate}
          aria-label={active ? 'Cancel origin selection' : 'Pick the origin vertex on the map'}
          title={active ? 'Cancel origin selection' : 'Pick the origin vertex on the map'}
          className={cn(
            'inline-flex items-center justify-center h-6 w-6 rounded transition-colors',
            active
              ? 'bg-red-600 text-white hover:bg-red-700'
              : 'bg-[#84cc16] text-[#1a2e05] hover:bg-[#65a30d]',
          )}
        >
          {active ? (
            <X style={{ width: 13, height: 13 }} strokeWidth={2.5} />
          ) : (
            <Crosshair style={{ width: 13, height: 13 }} strokeWidth={2.25} />
          )}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar shown at the top of the panel while origin-selection mode
// is active. Mirrors DigitizeToolbar's style so the two "you are in
// a modal map interaction" states read the same.
// ---------------------------------------------------------------------------
function SelectOriginToolbar({ onCancel }) {
  return (
    <div className="rounded-md border border-emerald-500/70 bg-emerald-500/5 dark:bg-emerald-950/20 px-2.5 py-2 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[11px]">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-70 animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        <span className="font-semibold text-emerald-700 dark:text-emerald-300">
          Pick the flight origin
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto inline-flex items-center justify-center h-6 px-2 rounded text-[10.5px] font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
        >
          Cancel
        </button>
      </div>
      <div className="flex items-start gap-1.5 text-[10.5px] text-day-muted dark:text-night-muted">
        <Info className="h-3 w-3 shrink-0 mt-[1px]" />
        <span className="leading-tight">
          The two green pulsing markers are the route's endpoints. Move the mouse so one falls inside the green buffer, then click. Esc to cancel.
        </span>
      </div>
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
  const { rememberFullscreen, restoreFullscreen } = useFullscreenSafeUpload();

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
        <FeaturesRow
          value={value}
          style={style}
          KindIcon={KindIcon}
          onZoomTo={onZoomTo}
          onClear={onClear}
          onStyleChange={onStyleChange}
        />
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
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) await handle(file);
          await restoreFullscreen();
        }}
        className="hidden"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// FeaturesLabelsCard — attribute-driven text labels for the uploaded
// features layer. Reads the union of property keys off the FC and
// exposes them as one-click chips that append into an expression
// textarea. The expression uses QGIS-style `||` concatenation
// (attribute names bare, literals quoted). A units dropdown appends
// a unit suffix that uses real superscript unicode (m² / m³ / etc)
// so the map label renders correctly at every zoom.
// ---------------------------------------------------------------------------
// Compact row for the loaded Lakes / features layer. Mirrors the
// RouteRow action-cluster shape: colour dot + kind icon + name + zoom
// + palette + trash. Palette opens the shared StylePopover so the
// style config stays out of the panel body.
function FeaturesRow({ value, style, KindIcon, onZoomTo, onClear, onStyleChange }) {
  const rowRef = useRef(null);
  const paletteRef = useRef(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  return (
    <div ref={rowRef} className="flex items-center gap-2 px-2.5 py-2">
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
        <div className="text-[10.5px] text-day-muted dark:text-night-muted truncate">
          {value.fc.features.length} feature{value.fc.features.length === 1 ? '' : 's'} · {value.kind}
        </div>
      </div>
      <div className="flex items-center shrink-0 -mr-0.5">
        <RowIconButton
          icon={Focus}
          title="Zoom to layer"
          onClick={onZoomTo}
        />
        <RowIconButton
          ref={paletteRef}
          icon={Palette}
          title="Edit layer style"
          active={paletteOpen}
          onClick={() => setPaletteOpen((v) => !v)}
        />
        <RowIconButton
          icon={Trash2}
          title="Remove features"
          tone="danger"
          onClick={onClear}
        />
      </div>
      {paletteOpen ? (
        <StylePopover
          anchorRef={rowRef}
          initialStyle={style}
          title={`${value.name} · Style`}
          onApply={(next) => onStyleChange(next)}
          onClose={() => setPaletteOpen(false)}
        />
      ) : null}
    </div>
  );
}

function FeaturesLabelsCard() {
  const {
    featureAttributes,
    featuresLabelStyle,
    setFeaturesLabelStyle,
  } = useFlypath();

  const hasAttrs = featureAttributes.length > 0;

  return (
    <div className="rounded-md border border-day-border dark:border-night-border overflow-hidden">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-day-bg dark:bg-night-bg border-b border-day-border dark:border-night-border">
        <Tag className="h-3.5 w-3.5 text-brand-700 dark:text-brand-200" />
        <span className="text-[12px] font-semibold text-day-text dark:text-night-text">
          Labels
        </span>
        <span className="ml-auto text-[10px] text-day-muted dark:text-night-muted tabular-nums">
          {featureAttributes.length} attr{featureAttributes.length === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={featuresLabelStyle.enabled}
          onClick={() => setFeaturesLabelStyle({ enabled: !featuresLabelStyle.enabled })}
          title={featuresLabelStyle.enabled ? 'Turn labels off' : 'Turn labels on'}
          className={cn(
            'relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors',
            featuresLabelStyle.enabled ? 'bg-[#84cc16]' : 'bg-day-border dark:bg-night-border',
          )}
        >
          <span
            className={cn(
              'inline-block h-3 w-3 rounded-full bg-white shadow',
              'transition-transform will-change-transform',
              featuresLabelStyle.enabled ? 'translate-x-3.5' : 'translate-x-0.5',
            )}
            style={{ marginTop: 2 }}
            aria-hidden
          />
        </button>
      </div>

      {/* Body — bounded height with internal scroll. The header row
          above stays pinned, and the fields (attrs, expression, unit,
          size, halo, colour swatches) scroll inside this box when
          they don't fit. Previously the whole card grew unbounded and
          the swatch row got clipped behind the fixed playback dock. */}
      <div className="px-2 py-2 flex flex-col gap-2 max-h-[240px] overflow-y-auto">
        {!hasAttrs ? (
          <div className="text-[10.5px] text-day-muted dark:text-night-muted italic px-1 py-2">
            The uploaded layer has no attribute keys — nothing to label with.
          </div>
        ) : (
          <>
            {/* Row 1 — Attribute multi-select with checkbox rows */}
            <InlineFieldRow icon={Tag} label="Attrs">
              <AttributeMultiSelect
                attributes={featureAttributes}
                selected={attributesInExpression(featuresLabelStyle.expression)}
                onToggle={(name, isChecked) => setFeaturesLabelStyle({
                  enabled: true,
                  expression: isChecked
                    ? appendAttributeToExpression(featuresLabelStyle.expression, name)
                    : removeAttributeFromExpression(featuresLabelStyle.expression, name),
                })}
              />
            </InlineFieldRow>

            {/* Row 2 — Free-form expression (advanced) */}
            <LabelExpressionEditor
              expression={featuresLabelStyle.expression}
              onChange={(expression) => setFeaturesLabelStyle({ expression })}
            />

            {/* Row 3 — Unit suffix (inline). Custom-styled native
                select so the trigger matches the AttributeMultiSelect
                trigger silhouette exactly (h-7, 11.5 px text, lime
                hover border). Using the shared Select wrapper baked
                in a taller input-base and clipped the option text. */}
            <InlineFieldRow icon={Ruler} label="Unit">
              <div className="relative w-full">
                <select
                  value={featuresLabelStyle.unit}
                  onChange={(e) => setFeaturesLabelStyle({ unit: e.target.value })}
                  className={cn(
                    'w-full h-7 pl-2 pr-7 rounded-md text-[11.5px] leading-none',
                    'bg-day-bg dark:bg-night-bg text-day-text dark:text-night-text',
                    'border border-day-border dark:border-night-border',
                    'appearance-none cursor-pointer',
                    'hover:border-[#84cc16] transition-colors',
                    'focus:outline-none focus:border-[#84cc16]',
                  )}
                >
                  {LABEL_UNITS.map((u) => (
                    <option key={u.id} value={u.id}>{u.label}</option>
                  ))}
                </select>
                <ChevronDown
                  aria-hidden
                  className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-day-muted dark:text-night-muted"
                />
              </div>
            </InlineFieldRow>

            {/* Row 4 — Size + Halo width (inline sliders) */}
            <InlineSliderRow
              icon={Type} label="Size"
              min={8} max={28} step={1}
              value={featuresLabelStyle.size}
              onChange={(size) => setFeaturesLabelStyle({ size })}
              display={`${featuresLabelStyle.size}px`}
            />
            <InlineSliderRow
              icon={Waves} label="Halo"
              min={0} max={6} step={0.25}
              value={featuresLabelStyle.haloWidth}
              onChange={(haloWidth) => setFeaturesLabelStyle({ haloWidth })}
              display={`${featuresLabelStyle.haloWidth}px`}
            />

            {/* Row 5 — Text + Halo colour swatches */}
            <div className="grid grid-cols-2 gap-1.5">
              <SwatchRow label="Text" value={featuresLabelStyle.color}
                onChange={(color) => setFeaturesLabelStyle({ color })} />
              <SwatchRow label="Halo" value={featuresLabelStyle.haloColor}
                onChange={(haloColor) => setFeaturesLabelStyle({ haloColor })} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Shared inline row: icon + label (fixed width) + content that grows.
// Reused by the Attrs multi-select and Unit dropdown so both rows
// share the same silhouette as SpeedControl / LoopControl at the
// bottom of the panel.
function InlineFieldRow({ icon: Icon, label, children }) {
  return (
    <div className="flex items-center gap-2 min-h-7">
      <Icon className="h-3.5 w-3.5 text-brand-700 dark:text-brand-200 shrink-0" />
      <span className="uppercase tracking-wide text-[10px] text-day-muted dark:text-night-muted w-10 shrink-0">
        {label}
      </span>
      <div className="flex-1 min-w-0">
        {children}
      </div>
    </div>
  );
}

// Slider variant of InlineFieldRow — matches SpeedControl exactly so
// the visual language is consistent top-to-bottom.
function InlineSliderRow({ icon: Icon, label, min, max, step, value, onChange, display }) {
  return (
    <div className="flex items-center gap-2 min-h-7 text-[10.5px]">
      <Icon className="h-3.5 w-3.5 text-brand-700 dark:text-brand-200 shrink-0" />
      <span className="uppercase tracking-wide text-day-muted dark:text-night-muted w-10 shrink-0">
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-1 accent-[#84cc16] min-w-0"
      />
      <span className="tabular-nums text-day-text dark:text-night-text w-10 text-right shrink-0">
        {display}
      </span>
    </div>
  );
}

// Multi-line textarea that accepts a QGIS/ArcGIS-style expression.
// Bare identifiers = attribute names. Quoted strings = literals.
// `||` concatenates. Ticking / unticking in the attribute dropdown
// above regenerates this string via appendAttributeToExpression /
// removeAttributeFromExpression, so the two stay in sync.
function LabelExpressionEditor({ expression, onChange }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-day-muted dark:text-night-muted px-0.5">
        <Type className="h-3 w-3" />
        Expression
      </div>
      <textarea
        rows={2}
        spellCheck={false}
        value={expression}
        onChange={(e) => onChange(e.target.value)}
        placeholder={"name || ' - ' || area"}
        className={cn(
          'input-base font-mono text-[11px] tracking-normal normal-case',
          'py-1.5 leading-snug resize-y min-h-[38px]',
        )}
      />
      <div className="text-[9.5px] text-day-muted dark:text-night-muted px-0.5 leading-tight">
        <code className="font-mono">||</code> joins · quote literals
        <span className="whitespace-nowrap"> (<code className="font-mono">'text'</code>)</span>
        · numbers round to 2 decimals.
      </div>
    </div>
  );
}

// Compact multi-select dropdown. Trigger button shows the number of
// checked attributes (or the single name when only one is selected);
// popup panel below lists every attribute with a checkbox row.
// Click-outside + Escape close the popup — same UX as a native
// <select multiple> but themed to match the rest of the panel.
function AttributeMultiSelect({ attributes, selected, onToggle }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onMouseDown = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const selectedList = attributes.filter((a) => selected.has(a));
  const count = selectedList.length;
  const label = count === 0 ? 'Choose attributes'
              : count === 1 ? selectedList[0]
              : `${count} selected`;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'w-full flex items-center h-7 px-2 rounded-md text-[11.5px]',
          'bg-day-bg dark:bg-night-bg text-day-text dark:text-night-text',
          'border border-day-border dark:border-night-border',
          'hover:border-[#84cc16] transition-colors',
        )}
      >
        <span className={cn('flex-1 text-left truncate', count === 0 && 'text-day-muted dark:text-night-muted')}>
          {label}
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div
          className={cn(
            'absolute z-30 top-full mt-1 left-0 right-0',
            'bg-day-surface dark:bg-night-surface',
            'border border-day-border dark:border-night-border',
            'rounded-md shadow-xl max-h-56 overflow-y-auto',
          )}
        >
          {attributes.map((attr) => {
            const isChecked = selected.has(attr);
            return (
              <label
                key={attr}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 cursor-pointer text-[11.5px]',
                  'hover:bg-day-bg dark:hover:bg-night-bg',
                  isChecked && 'bg-[#84cc16]/10',
                )}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={isChecked}
                  onChange={() => onToggle(attr, !isChecked)}
                />
                <span
                  aria-hidden
                  className={cn(
                    'inline-flex h-3.5 w-3.5 items-center justify-center rounded shrink-0 border',
                    isChecked
                      ? 'bg-[#84cc16] border-[#84cc16]'
                      : 'bg-day-bg dark:bg-night-bg border-day-border dark:border-night-border',
                  )}
                >
                  {isChecked ? <Check className="h-2.5 w-2.5 text-[#1a2e05]" strokeWidth={3} /> : null}
                </span>
                <span className="text-day-text dark:text-night-text truncate">{attr}</span>
              </label>
            );
          })}
        </div>
      ) : null}
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
  const { rememberFullscreen, restoreFullscreen } = useFullscreenSafeUpload();

  // If parent didn't wire a ref/handler, run our own upload flow —
  // that's the routes empty state, where the parent just needs the
  // parsed payload passed to `onAdd`.
  const rootRef = inputRef ?? localRef;
  const isBusy = busy ?? localBusy;
  const err = error ?? localError;
  const isDrag = dragOver ?? localDrag;

  const runHandle = async (file) => {
    if (!file) return;
    if (handle) { await handle(file); return; }
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
  const openPicker = () => { rememberFullscreen(); rootRef.current?.click(); };

  return (
    <>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setDrag(false);
          const files = Array.from(e.dataTransfer?.files || []);
          for (const file of files) {
            // eslint-disable-next-line no-await-in-loop
            await runHandle(file);
          }
        }}
        className={cn(
          'flex flex-col items-center justify-center gap-1 px-2 py-3',
          'text-center cursor-pointer transition-colors',
          isDrag ? 'bg-[#84cc16]/10' : 'hover:bg-day-bg dark:hover:bg-night-bg',
        )}
        onClick={openPicker}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openPicker(); }}
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
          multiple
          accept=".geojson,.json,.zip,.kml,.kmz,application/json,application/geo+json,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz"
          onChange={async (e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = '';
            for (const file of files) {
              // eslint-disable-next-line no-await-in-loop
              await runHandle(file);
            }
            await restoreFullscreen();
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
  // Old row-first layout, tightened up:
  //   Row 1  — Color swatch + Outline swatch side-by-side.
  //   Row 2  — Width slider (own row, full width).
  //   Row 3  — Opacity slider (own row, full width).
  // Swatches stay at 20 px (same small size as before).
  return (
    <div className="px-2 py-1.5 border-t border-day-border dark:border-night-border bg-day-bg/60 dark:bg-night-bg/60 flex flex-col gap-1.5">
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
  // Small square swatch (h-5 w-5) + label to its right. Same size as
  // the vertical-stack version, but laid out horizontally so two
  // pickers share a single row.
  return (
    <label
      className={cn(
        'flex items-center gap-1.5 cursor-pointer',
        'text-[10px] uppercase tracking-wide text-day-muted dark:text-night-muted',
      )}
      title={value}
    >
      <span
        className={cn(
          'relative inline-flex h-5 w-5 rounded overflow-hidden shrink-0',
          'ring-1 ring-day-border dark:ring-night-border shadow-inner',
          'transition-transform hover:scale-110 active:scale-95',
        )}
        style={{ backgroundColor: value }}
      >
        <span
          aria-hidden
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 55%)',
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
    <div className="flex items-center gap-1.5 text-[10px] text-day-muted dark:text-night-muted">
      <span className="uppercase tracking-wide w-12 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-1 accent-[#84cc16] min-w-0"
      />
      <span className="tabular-nums text-day-text dark:text-night-text w-9 text-right shrink-0">
        {display}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Playback row — combined Play/Pause + separate Stop.
// ---------------------------------------------------------------------------
function PlaybackRow({ playState, awaitingTerrain, hasRoute, onStart, onPause, onResume, onStop }) {
  const isPlaying = playState === 'playing';
  const isPaused  = playState === 'paused';
  const isStopped = playState === 'stopped';
  // Awaiting-terrain state — playState is already 'playing' (the
  // click was accepted) but the RAF hasn't begun because the map is
  // still streaming DEM / basemap tiles. Swap the Play button into
  // a spinner so the operator sees the click landed.
  const waiting = isPlaying && awaitingTerrain;

  const onPrimary = waiting   ? onPause
                  : isPlaying ? onPause
                  : isPaused  ? onResume
                              : onStart;
  const PrimaryIcon = waiting   ? Loader2
                    : isPlaying ? Pause
                                : Play;
  const primaryTone = waiting   ? 'amber'
                    : isPlaying ? 'amber'
                                : 'emerald';
  const primaryLabel = waiting   ? 'Preparing terrain…'
                     : isPlaying ? 'Pause flypath'
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
        spinning={waiting}
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

function PlaybackButton({ icon: Icon, onClick, disabled, title, ariaLabel, tone, spinning }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className={cn(
        'flex items-center justify-center h-8 rounded-md text-white',
        'disabled:cursor-not-allowed transition-colors',
        TONE_CLASSES[tone] ?? TONE_CLASSES.red,
      )}
    >
      <Icon
        {...(spinning ? {} : { fill: 'currentColor' })}
        style={{ width: 16, height: 16 }}
        className={spinning ? 'animate-spin' : undefined}
      />
    </button>
  );
}

// Camera-mode toggle. Two half-width chips under the play/stop row.
// Focused view = adaptive chase-cam; Drone view = near-nadir plan
// glide. Reads current mode from context and swaps on click; the map
// layer applies the mode's pitch / bearing-lerp on the very next
// RAF tick.
function ModeRow() {
  const { flightMode, setFlightMode } = useFlypath();
  return (
    <div className="grid grid-cols-2 gap-1.5">
      <ModeButton
        active={flightMode === 'focused'}
        onClick={() => setFlightMode('focused')}
        icon={Eye}
        label="Focused"
        title="Chase-cam view — pitch adapts to terrain, bearing follows the path"
      />
      <ModeButton
        active={flightMode === 'drone'}
        onClick={() => setFlightMode('drone')}
        icon={Plane}
        label="Drone"
        title="Top-down drone view — near-vertical pitch, damped rotation"
      />
    </div>
  );
}

function ModeButton({ icon: Icon, label, active, onClick, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={cn(
        'inline-flex items-center justify-center gap-1 h-7 rounded-md',
        'text-[11px] font-semibold transition-colors',
        active
          ? 'bg-[#84cc16] text-[#1a2e05] hover:bg-[#65a30d]'
          : 'bg-day-bg dark:bg-night-bg text-day-text dark:text-night-text border border-day-border dark:border-night-border hover:border-[#84cc16]',
      )}
    >
      <Icon style={{ width: 12, height: 12 }} />
      {label}
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
// Speed control — Nx multiplier over a distance-derived baseline.
// The slider moves in log space between 0.25 × and 8 × so that both
// halves of the range have similar visual weight (the geometric
// midpoint of the range is 1 ×). Actual flight duration is computed
// in the context from the selected route's length; this control just
// picks the multiplier. Readout shows both the multiplier and the
// resulting duration so the operator can eyeball the effect.
// ---------------------------------------------------------------------------
const SPEED_LOG_MIN = -2;   // 2^-2 = 0.25×
const SPEED_LOG_MAX =  3;   // 2^3  = 8×
const SPEED_LOG_STEP = 0.05;

function SpeedControl() {
  const { speedMultiplier, setSpeedMultiplier, flightDuration } = useFlypath();
  const logPos = Math.log2(Math.max(0.05, speedMultiplier));

  return (
    <div className="flex items-center gap-2 text-[10.5px] text-day-muted dark:text-night-muted min-h-6">
      <Gauge className="h-3.5 w-3.5 text-brand-700 dark:text-brand-200 shrink-0" />
      <span className="uppercase tracking-wide w-12 shrink-0">Speed</span>
      <input
        type="range"
        min={SPEED_LOG_MIN}
        max={SPEED_LOG_MAX}
        step={SPEED_LOG_STEP}
        value={logPos}
        onChange={(e) => setSpeedMultiplier(2 ** Number(e.target.value))}
        onDoubleClick={() => setSpeedMultiplier(1)}
        className="flex-1 h-1 accent-[#84cc16] min-w-0"
        aria-label="Flight speed multiplier"
        title="Drag to change speed · double-click to reset to 1×"
      />
      <div className="flex items-center justify-end shrink-0 w-[92px] gap-1 tabular-nums">
        <span className="text-day-text dark:text-night-text text-[11px] font-semibold">
          {formatMultiplier(speedMultiplier)}×
        </span>
        <span className="text-day-muted dark:text-night-muted text-[10px]">
          · {formatDurationLabel(flightDuration)}
        </span>
      </div>
    </div>
  );
}

// Compact label for the multiplier readout — 0.25 stays as "0.25",
// integers drop the decimal, everything else prints one decimal.
function formatMultiplier(x) {
  if (!Number.isFinite(x)) return '1';
  if (x >= 10)  return x.toFixed(0);
  if (x >= 1)   return x % 1 === 0 ? x.toFixed(0) : x.toFixed(1);
  return x.toFixed(2).replace(/0$/, '');
}

// "18s" / "1m 24s" / "12m" — never longer than 5 chars.
function formatDurationLabel(ms) {
  const totalSec = Math.max(1, Math.round(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m >= 10 || s === 0) return `${m}m`;
  return `${m}m ${s}s`;
}

// ---------------------------------------------------------------------------
// Loop control — toggle chip that restarts the animation at phase 1
// instead of transitioning to 'stopped'. Same row silhouette as
// SpeedControl for visual consistency.
// ---------------------------------------------------------------------------
function LoopControl() {
  const { loop, toggleLoop } = useFlypath();
  return (
    // Matching min-h-7 so Speed + Loop rows read as a uniform stack.
    <div className="flex items-center gap-2 text-[10.5px] text-day-muted dark:text-night-muted min-h-6">
      <Repeat className="h-3.5 w-3.5 text-brand-700 dark:text-brand-200 shrink-0" />
      <span className="uppercase tracking-wide w-12 shrink-0">Loop</span>
      <span className="flex-1 text-day-text dark:text-night-text normal-case tracking-normal">
        {loop ? 'Animation restarts at finish' : 'Animation stops at finish'}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={loop}
        onClick={toggleLoop}
        title={loop ? 'Disable loop' : 'Enable loop'}
        className={cn(
          'relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors',
          loop ? 'bg-[#84cc16]' : 'bg-day-border dark:bg-night-border',
        )}
      >
        <span
          className={cn(
            'inline-block h-3 w-3 rounded-full bg-white shadow',
            'transition-transform will-change-transform',
            loop ? 'translate-x-3.5' : 'translate-x-0.5',
          )}
          style={{ marginTop: 2 }}
          aria-hidden
        />
      </button>
    </div>
  );
}
