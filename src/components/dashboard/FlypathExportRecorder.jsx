import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Circle, RotateCcw, Square, X } from 'lucide-react';
import { useFlypath } from '@/contexts/FlypathContext';
import { cn } from '@/utils/cn';

// FlypathExportRecorder — captures the Lake Flypath animation as a
// WebM video and lets the operator save it to a chosen directory.
//
// State machine:
//   idle       → nothing rendered.
//   selecting  → dark backdrop with a click-drag bounding-box tool.
//   armed      → bbox locked; toolbar to start / redraw / cancel.
//   countdown  → 5-second white countdown, black halo, centred.
//   recording  → MediaRecorder writing frames from an off-screen
//                canvas that only holds the cropped map pixels.
//                Small floating "Stop & save" button + REC indicator.
//   saving     → same overlay as recording, button disabled while
//                the MediaRecorder is flushing.
//   error      → dismissible modal with the failure message.
//
// The recording surface is an off-screen `<canvas>` that we blit the
// cropped region of `map.getCanvas()` into on every frame. Everything
// this component renders — the bbox border, the stop button, the REC
// pip — lives as normal React DOM on top of the map and is NEVER
// captured, because the frame source is the WebGL canvas pixel
// buffer, not a screen-capture stream.
//
// Entering the flow is externally triggered: `useFlypath().exportTick`
// increments once when the Export button is pressed, and we watch
// that counter to enter `selecting`.

const MIN_BBOX_PX      = 80;   // reject accidental tiny drags
const COUNTDOWN_START  = 5;    // seconds shown centred on the map
// 60 fps target with a generous bitrate — the recorded stream at
// 30 fps read as visibly juddery next to the 60 Hz on-screen
// playback. VP9 at ~16 Mbps holds detail on the mountain terrain at
// this rate; increase if the operator's monitor is > 1080p and the
// output looks soft.
const RECORDING_FPS    = 60;
const RECORDING_BPS    = 16_000_000;

export default function FlypathExportRecorder({ map }) {
  const {
    exportTick,
    start,
    stop,
    selectedRoute,
    hasRoute,
  } = useFlypath();

  const [phase, setPhase]         = useState('idle');
  const [bbox, setBbox]           = useState(null);   // {x,y,w,h} in wrapper CSS px
  const [countdown, setCountdown] = useState(COUNTDOWN_START);
  const [error, setError]         = useState(null);

  // Held across the recording lifetime — refs rather than state so
  // an in-flight session doesn't accidentally re-render itself out
  // of existence.
  const offCanvasRef  = useRef(null);
  const recorderRef   = useRef(null);
  const streamRef     = useRef(null);
  const rafRef        = useRef(null);
  const chunksRef     = useRef([]);
  const cancelledRef  = useRef(false);
  const dragStartRef  = useRef(null);
  const bboxRef       = useRef(null);
  bboxRef.current     = bbox;

  // Tear-down helper — safe to call from any phase, idempotent.
  const cleanup = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try { recorderRef.current.stop(); } catch { /* ignore */ }
    }
    recorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
      streamRef.current = null;
    }
    chunksRef.current = [];
    dragStartRef.current = null;
  }, []);

  // Enter selection on every exportTick change (skip the initial 0).
  useEffect(() => {
    if (exportTick === 0) return;
    if (!map) return;
    cancelledRef.current = true;   // discard any in-flight save
    cleanup();
    setError(null);
    setBbox(null);
    setCountdown(COUNTDOWN_START);
    setPhase('selecting');
    // Reset the cancelled guard for the fresh session
    cancelledRef.current = false;
  }, [exportTick, map, cleanup]);

  // Escape cancels at any non-idle phase
  useEffect(() => {
    if (phase === 'idle') return;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      cancelledRef.current = true;
      cleanup();
      setBbox(null);
      setPhase('idle');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, cleanup]);

  // Unmount safety
  useEffect(() => () => cleanup(), [cleanup]);

  // --------- selection drag handlers ---------
  const onSelectDown = (e) => {
    if (phase !== 'selecting') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    dragStartRef.current = { x, y };
    setBbox({ x, y, w: 0, h: 0 });
  };
  const onSelectMove = (e) => {
    if (phase !== 'selecting' || !dragStartRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const start = dragStartRef.current;
    setBbox({
      x: Math.min(start.x, cx),
      y: Math.min(start.y, cy),
      w: Math.abs(cx - start.x),
      h: Math.abs(cy - start.y),
    });
  };
  const onSelectUp = () => {
    if (phase !== 'selecting' || !dragStartRef.current) return;
    dragStartRef.current = null;
    const b = bboxRef.current;
    if (!b || b.w < MIN_BBOX_PX || b.h < MIN_BBOX_PX) {
      setBbox(null);           // stay in selecting for a re-draw
      return;
    }
    setPhase('armed');
  };

  // --------- recording lifecycle ---------
  const beginCountdown = async () => {
    setPhase('countdown');
    for (let s = COUNTDOWN_START; s >= 1; s--) {
      if (cancelledRef.current) return;
      setCountdown(s);
      await sleep(1000);
    }
    try {
      await startRecordingSession();
    } catch (err) {
      console.error('flypath export: recording failed to start', err);
      setError(err?.message || 'Recording failed to start');
      setPhase('error');
      cleanup();
    }
  };

  const startRecordingSession = async () => {
    if (!map) throw new Error('Map is not ready');
    const b = bboxRef.current;
    if (!b) throw new Error('No region selected');

    const mapCanvas = map.getCanvas();
    const canvasRect = mapCanvas.getBoundingClientRect();
    // devicePixelRatio-aware scale from CSS px → canvas px
    const scale = mapCanvas.width / canvasRect.width;
    const sx = Math.max(0, Math.round(b.x * scale));
    const sy = Math.max(0, Math.round(b.y * scale));
    const sw = Math.max(1, Math.round(b.w * scale));
    const sh = Math.max(1, Math.round(b.h * scale));

    const offCanvas = offCanvasRef.current;
    if (!offCanvas) throw new Error('Offscreen canvas not ready');
    offCanvas.width  = sw;
    offCanvas.height = sh;
    const ctx = offCanvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable');

    // Prime a first frame so the recorder has a non-blank source
    try { ctx.drawImage(mapCanvas, sx, sy, sw, sh, 0, 0, sw, sh); } catch { /* ignore */ }

    const stream = offCanvas.captureStream(RECORDING_FPS);
    streamRef.current = stream;
    // Some browsers expose `requestFrame()` on the video track so we
    // can push a frame the moment drawImage completes — this couples
    // the recorded frame timing to the map's render clock instead of
    // the 60 Hz auto-sampler, which typically yields visibly smoother
    // output. Falls back silently if unavailable (older Firefox).
    const videoTrack = stream.getVideoTracks?.()[0];
    const canRequestFrame =
      !!videoTrack && typeof videoTrack.requestFrame === 'function';

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, {
      mimeType: mimeType || undefined,
      videoBitsPerSecond: RECORDING_BPS,
    });
    recorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) chunksRef.current.push(e.data);
    };
    recorder.onstop = async () => {
      const chunks = chunksRef.current.slice();
      chunksRef.current = [];
      // Drop the blob on the floor if the user cancelled the session
      if (cancelledRef.current) return;
      const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
      // Save-file picker will exit fullscreen (browser security);
      // remember which element was in fullscreen so we can re-enter
      // after the picker closes. The requestFullscreen call is
      // best-effort — transient user activation may have expired by
      // the time saveBlob resolves, in which case the browser will
      // reject silently and the user just re-clicks Fullscreen.
      const fsTargetBeforeSave =
        typeof document !== 'undefined' ? document.fullscreenElement : null;
      try {
        await saveBlob(blob, defaultFileName(selectedRoute?.name));
      } catch (err) {
        console.warn('flypath export: save failed', err);
      } finally {
        cleanup();
        setBbox(null);
        setPhase('idle');
        if (fsTargetBeforeSave && !document.fullscreenElement) {
          try { await fsTargetBeforeSave.requestFullscreen(); } catch { /* activation expired */ }
        }
      }
    };

    // MediaRecorder chunks flushed every 500 ms
    recorder.start(500);

    // Frame pump — one blit per RAF tick (typically 60 Hz on the
    // operator's monitor), plus an explicit `requestFrame()` on the
    // video track when available so the recorded stream is locked
    // to the map's actual render clock rather than the browser's
    // async 60 Hz sampler.
    const pump = () => {
      try {
        ctx.drawImage(mapCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
        if (canRequestFrame) {
          try { videoTrack.requestFrame(); } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
      rafRef.current = requestAnimationFrame(pump);
    };
    rafRef.current = requestAnimationFrame(pump);

    // Reset the flypath so recording captures the whole run from t=0.
    // The tiny sleep lets the stop → idle transition settle before the
    // start() call flips the state back to 'playing'.
    try { stop(); } catch { /* ignore */ }
    await sleep(80);
    try { start(); } catch { /* ignore */ }

    setPhase('recording');
  };

  const stopRecording = () => {
    const rec = recorderRef.current;
    if (!rec) {
      setPhase('idle');
      setBbox(null);
      return;
    }
    setPhase('saving');
    try {
      rec.requestData?.();
      rec.stop();               // triggers onstop → saveBlob
    } catch (err) {
      console.error('flypath export: stop failed', err);
      setError(err?.message || 'Stop failed');
      setPhase('error');
      cleanup();
    }
  };

  const cancelSession = () => {
    cancelledRef.current = true;
    cleanup();
    setBbox(null);
    setPhase('idle');
  };

  const clipPath = bboxClipPath(bbox);
  const hintText = phase === 'selecting'
    ? (bbox ? 'Release to lock this region' : 'Click and drag to draw a recording region')
    : null;

  if (phase === 'idle' && !error) {
    // Keep the offscreen canvas mounted so the ref survives StrictMode
    // remounts even at idle. Rendering it in a hidden container is
    // cheaper than gating the ref on phase and dealing with a null on
    // the very first recording start.
    return (
      <canvas
        ref={offCanvasRef}
        aria-hidden
        className="hidden"
      />
    );
  }

  return (
    <div className="absolute inset-0 z-30 pointer-events-none">
      <canvas ref={offCanvasRef} aria-hidden className="hidden" />

      {/* Darkened backdrop with a rectangular cutout over the bbox.
          Only rendered when there is a bbox (or during selection with
          no draft yet, in which case it's a full-cover backdrop). */}
      {phase !== 'idle' && phase !== 'error' && (
        <div
          className={cn(
            'absolute inset-0 pointer-events-none',
            phase === 'recording' || phase === 'saving' ? 'bg-black/35' : 'bg-black/45',
          )}
          style={clipPath ? { clipPath } : undefined}
        />
      )}

      {/* Selection interaction surface */}
      {phase === 'selecting' && (
        <div
          className="absolute inset-0 cursor-crosshair pointer-events-auto"
          onMouseDown={onSelectDown}
          onMouseMove={onSelectMove}
          onMouseUp={onSelectUp}
          onMouseLeave={onSelectUp}
        >
          {bbox ? (
            <div
              className="absolute border-2 border-[#84cc16] pointer-events-none"
              style={{
                left: bbox.x,
                top: bbox.y,
                width: bbox.w,
                height: bbox.h,
                boxShadow: '0 0 0 1px rgba(0,0,0,0.4) inset',
              }}
            >
              {bbox.w >= 40 && bbox.h >= 20 && (
                <div className="absolute -top-6 left-0 px-1.5 py-0.5 rounded-sm bg-black/80 text-white text-[10.5px] font-medium tabular-nums">
                  {Math.round(bbox.w)} × {Math.round(bbox.h)}
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* Armed — bbox outline stays, action buttons live in the
          vertical right-mid rail (see ActionRail below) so they
          don't cover the region the user just framed. */}
      {phase === 'armed' && bbox && (
        <div
          className="absolute border-2 border-[#84cc16] pointer-events-none"
          style={{ left: bbox.x, top: bbox.y, width: bbox.w, height: bbox.h }}
        />
      )}

      {/* Countdown — big centred number with white fill + black halo */}
      {phase === 'countdown' && (
        <>
          {bbox && (
            <div
              className="absolute border-2 border-[#84cc16]/70 pointer-events-none"
              style={{ left: bbox.x, top: bbox.y, width: bbox.w, height: bbox.h }}
            />
          )}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <AnimatePresence mode="wait">
              <motion.span
                key={countdown}
                initial={{ scale: 1.4, opacity: 0 }}
                animate={{ scale: 1,   opacity: 1 }}
                exit={{    scale: 0.6, opacity: 0 }}
                transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
                style={{
                  fontFamily:
                    '"DIN Pro", "DIN Alternate", "DIN Condensed", ' +
                    '"Helvetica Neue Condensed", "Arial Narrow", ' +
                    '"Inter", "Segoe UI", system-ui, sans-serif',
                  fontSize: '180px',
                  fontWeight: 700,
                  color: '#ffffff',
                  lineHeight: 1,
                  letterSpacing: '-0.02em',
                  textShadow:
                    '-3px -3px 0 rgba(0,0,0,0.9),' +
                    ' 3px -3px 0 rgba(0,0,0,0.9),' +
                    '-3px  3px 0 rgba(0,0,0,0.9),' +
                    ' 3px  3px 0 rgba(0,0,0,0.9),' +
                    ' 0 0 24px rgba(0,0,0,0.6),' +
                    ' 0 6px 20px rgba(0,0,0,0.55)',
                }}
              >
                {countdown}
              </motion.span>
            </AnimatePresence>
          </div>
        </>
      )}

      {/* Recording / saving — bbox outline + REC pip. The Stop &
          save action button lives in the right-mid ActionRail. */}
      {(phase === 'recording' || phase === 'saving') && bbox && (
        <>
          <div
            className="absolute border-2 border-red-500 pointer-events-none"
            style={{ left: bbox.x, top: bbox.y, width: bbox.w, height: bbox.h }}
          />
          <div className="absolute top-3 left-1/2 -translate-x-1/2 pointer-events-none flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/75 backdrop-blur text-white text-[11px] font-semibold tracking-wide">
            <motion.span
              animate={{ opacity: [1, 0.25, 1] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
              className="inline-block h-2 w-2 rounded-full bg-red-500"
              aria-hidden
            />
            {phase === 'saving' ? 'SAVING' : 'REC'}
          </div>
        </>
      )}

      {/* ActionRail — vertical column of icon-only buttons pinned to
          the right-middle of the map wrapper. Same silhouette across
          armed / recording / saving so the operator's hand doesn't
          have to hunt for the next control. */}
      <ActionRail
        phase={phase}
        hasRoute={hasRoute}
        onStart={beginCountdown}
        onRedraw={() => { setBbox(null); setPhase('selecting'); }}
        onCancel={cancelSession}
        onStop={stopRecording}
      />

      {/* Selection hint — the pill at the top */}
      {hintText ? (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-md bg-black/75 backdrop-blur text-white text-[12.5px] font-medium pointer-events-none">
          {hintText} <span className="opacity-70 ml-1.5">·  Esc to cancel</span>
        </div>
      ) : null}

      {/* Error modal */}
      {phase === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-auto bg-black/60">
          <div className="max-w-sm rounded-md bg-white dark:bg-night-surface border border-day-border dark:border-night-border p-4 shadow-2xl">
            <div className="text-[13px] font-semibold text-red-600 dark:text-red-400 mb-2">
              Recording failed
            </div>
            <div className="text-[12px] text-day-text dark:text-night-text mb-3">
              {error || 'Something went wrong while starting the recording.'}
            </div>
            <button
              type="button"
              onClick={() => { setError(null); setBbox(null); setPhase('idle'); }}
              className="inline-flex items-center h-7 px-2.5 rounded text-[12px] font-medium bg-day-bg dark:bg-night-bg text-day-text dark:text-night-text border border-day-border dark:border-night-border hover:bg-day-border/50 dark:hover:bg-night-border/50"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Pick the highest-quality codec MediaRecorder can encode. Falls
// back through VP9 → VP8 → default. Returns '' if the platform
// somehow supports none of them, in which case we let MediaRecorder
// choose its own default.
function pickMimeType() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

// clip-path definition of "full container minus the bbox rect" —
// used to darken the backdrop everywhere except the region the user
// is about to record. Returns null when no bbox is defined yet.
function bboxClipPath(bbox) {
  if (!bbox || bbox.w <= 0 || bbox.h <= 0) return null;
  const { x, y, w, h } = bbox;
  return (
    `polygon(` +
    `0 0, 100% 0, 100% 100%, 0 100%, 0 0, ` +
    `${x}px ${y}px, ` +
    `${x}px ${y + h}px, ` +
    `${x + w}px ${y + h}px, ` +
    `${x + w}px ${y}px, ` +
    `${x}px ${y}px` +
    `)`
  );
}

// ActionRail — vertical column of icon-only chips pinned to the
// right-middle of the map wrapper. Renders nothing during selection
// (the drag surface owns the whole map) and nothing at idle / error;
// during armed / recording / saving it presents phase-appropriate
// buttons. Icon-only per the operator's request — every button has
// a native `title` tooltip so the action is still discoverable.
function ActionRail({ phase, hasRoute, onStart, onRedraw, onCancel, onStop }) {
  if (phase !== 'armed' && phase !== 'recording' && phase !== 'saving') return null;

  const armed = phase === 'armed';
  const saving = phase === 'saving';

  return (
    <div
      className="absolute right-3 top-1/2 -translate-y-1/2 z-10 pointer-events-auto flex flex-col gap-1.5"
      role="toolbar"
      aria-label="Export animation controls"
    >
      {armed ? (
        <>
          <RailButton
            icon={Circle}
            iconFill
            onClick={onStart}
            disabled={!hasRoute}
            title={hasRoute
              ? 'Start recording (5-second countdown)'
              : 'Add a flypath route first'}
            ariaLabel="Start recording"
            tone="record"
          />
          <RailButton
            icon={RotateCcw}
            onClick={onRedraw}
            title="Redraw the region"
            ariaLabel="Redraw the region"
            tone="neutral"
          />
          <RailButton
            icon={X}
            onClick={onCancel}
            title="Cancel export"
            ariaLabel="Cancel export"
            tone="neutral"
          />
        </>
      ) : (
        <RailButton
          icon={Square}
          iconFill
          onClick={onStop}
          disabled={saving}
          title={saving ? 'Saving…' : 'Stop recording and save'}
          ariaLabel={saving ? 'Saving' : 'Stop recording and save'}
          tone="stop"
        />
      )}
    </div>
  );
}

// Single button in the ActionRail. `tone` chooses the palette:
//   record  → filled red circle (Start recording)
//   stop    → filled red square (Stop & save)
//   neutral → dark chrome, subtle border, white icon
function RailButton({ icon: Icon, iconFill, onClick, disabled, title, ariaLabel, tone }) {
  const base = 'inline-flex items-center justify-center h-9 w-9 rounded-md shadow-2xl transition-colors';
  const palette = disabled
    ? 'bg-black/60 text-white/40 border border-white/10 cursor-not-allowed'
    : tone === 'record'
      ? 'bg-red-600 text-white hover:bg-red-700'
      : tone === 'stop'
        ? 'bg-red-600 text-white hover:bg-red-700'
        : 'bg-black/80 text-white border border-white/20 hover:bg-black/90';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className={cn(base, palette)}
    >
      <Icon
        style={{ width: 15, height: 15 }}
        fill={iconFill ? 'currentColor' : 'none'}
        strokeWidth={2.25}
      />
    </button>
  );
}

// Suggested output filename. Includes the route name (sanitised) and
// an ISO-ish timestamp so successive recordings don't collide.
function defaultFileName(routeName) {
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace(/T/, '_')
    .replace(/Z$/, '');
  const safe = String(routeName || 'flypath')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64) || 'flypath';
  return `${safe}_${stamp}.webm`;
}

// Save a blob to disk. Prefers the File System Access API — which
// pops the native Save-As dialog and lets the user pick any folder
// — and falls back to a download-attribute anchor click on browsers
// that don't support it (Firefox, Safari).
async function saveBlob(blob, suggestedName) {
  if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: 'WebM video',
            accept: { 'video/webm': ['.webm'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      // User dismissed the picker — bail silently.
      if (err && err.name === 'AbortError') return;
      // Any other failure — fall through to the anchor download.
      console.warn('showSaveFilePicker failed, falling back to anchor', err);
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on next tick so the browser has time to start the download
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}