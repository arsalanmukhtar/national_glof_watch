import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Circle, Loader2, RotateCcw, Square, X } from 'lucide-react';
import { useFlypath } from '@/contexts/FlypathContext';
import { cn } from '@/utils/cn';

// FlypathExportRecorder — captures the Lake Flypath animation as a
// WebM video and lets the operator save it to a chosen directory.
//
// State machine:
//   idle       → nothing rendered.
//   selecting  → dark backdrop with a click-drag bounding-box tool.
//   armed      → bbox locked; right-mid ActionRail exposes start /
//                redraw / cancel.
//   preparing  → browser is showing the getDisplayMedia picker; user
//                needs to click "Share" on the current tab.
//   countdown  → 5-second white countdown, black halo, centred.
//   recording  → MediaRecorder writing frames from an off-screen
//                canvas fed by the display-media stream, cropped to
//                the bbox. NO recorder UI is drawn during this phase
//                — every DOM element on the tab appears in the
//                output, so bbox borders / REC pips / stop buttons
//                would all end up in the video. The operator stops
//                via the browser's native "Stop sharing" chip or the
//                Esc key; the track.onended handler catches both.
//   saving     → MediaRecorder flushing; brief spinner overlay.
//   error      → dismissible modal with the failure message.
//
// The frame source is a screen-capture stream — the operator picks
// "This tab" (the picker is biased to the current tab via the Chrome-
// specific `preferCurrentTab: true`), the stream plays into an off-
// screen `<video>` element, and each RAF tick blits the cropped
// region of that video into an off-screen `<canvas>` whose
// captureStream feeds the MediaRecorder. Because we're capturing what
// the user sees, every HTML overlay — geocoder, basemap toggler,
// stations table, legend, elevation profile, the pulsating marker —
// appears in the recording just like on the live tab.
//
// Entering the flow is externally triggered: `useFlypath().exportTick`
// increments once when the Export button is pressed, and we watch
// that counter to enter `selecting`.

const MIN_BBOX_PX      = 80;   // reject accidental tiny drags
const COUNTDOWN_START  = 5;    // seconds shown centred on the map
// 120 fps target — the browser will clamp to what the display and
// encoder can actually deliver, but we ask for the ceiling so
// operators on high-refresh monitors get everything the compositor
// can hand us. Bitrate bumped to match — 120 fps at 24 Mbps VP9
// keeps detail on mountain terrain without a soft frame.
const RECORDING_FPS    = 120;
const RECORDING_BPS    = 24_000_000;

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
  const offCanvasRef       = useRef(null);
  const videoElRef         = useRef(null);   // hidden <video> playing the display stream
  const recorderRef        = useRef(null);
  const outStreamRef       = useRef(null);   // canvas.captureStream() feeding MediaRecorder
  const displayStreamRef   = useRef(null);   // stream from getDisplayMedia
  const displayTrackRef    = useRef(null);
  const rafRef             = useRef(null);
  const chunksRef          = useRef([]);
  const cancelledRef       = useRef(false);
  const dragStartRef       = useRef(null);
  const bboxRef            = useRef(null);
  bboxRef.current          = bbox;

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
    if (outStreamRef.current) {
      outStreamRef.current.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
      outStreamRef.current = null;
    }
    if (displayStreamRef.current) {
      displayStreamRef.current.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
      displayStreamRef.current = null;
    }
    if (displayTrackRef.current) {
      try { displayTrackRef.current.removeEventListener('ended', onDisplayTrackEnded); } catch { /* ignore */ }
      displayTrackRef.current = null;
    }
    if (videoElRef.current) {
      try { videoElRef.current.pause(); } catch { /* ignore */ }
      try { videoElRef.current.srcObject = null; } catch { /* ignore */ }
      videoElRef.current = null;
    }
    chunksRef.current = [];
    dragStartRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handler for the display-track's 'ended' event — fires when the
  // user clicks the browser's native "Stop sharing" chip. Defined
  // outside the effect so cleanup can removeEventListener with the
  // same reference.
  const onDisplayTrackEnded = useCallback(() => {
    // Only meaningful when we're actively recording — spurious end
    // events at teardown are a no-op.
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      stopRecording();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Escape cancels selection / armed / countdown, and stops an
  // active recording.
  useEffect(() => {
    if (phase === 'idle') return;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (phase === 'recording' || phase === 'saving') {
        stopRecording();
        return;
      }
      cancelledRef.current = true;
      cleanup();
      setBbox(null);
      setPhase('idle');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const startPt = dragStartRef.current;
    setBbox({
      x: Math.min(startPt.x, cx),
      y: Math.min(startPt.y, cy),
      w: Math.abs(cx - startPt.x),
      h: Math.abs(cy - startPt.y),
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
  const beginRecording = async () => {
    // Remember which element (if any) was in fullscreen at the moment
    // of the click — the browser exits fullscreen the instant we
    // call getDisplayMedia (the picker needs to paint over the tab).
    // We re-request fullscreen on this element the moment the picker
    // resolves so the operator's fullscreen view isn't lost.
    const fsTargetBefore =
      typeof document !== 'undefined' ? document.fullscreenElement : null;

    // Start the flypath IMMEDIATELY with the currently-configured
    // origin / style / camera mode. The operator sees the animation
    // kick off from the moment they click Record, confirming the
    // Manually-pinned origin (or any other setting) actually took
    // effect. It also means the map is already animating underneath
    // the picker + countdown so the recorder captures a moving
    // frame the instant recording turns on.
    try { stop(); } catch { /* ignore */ }
    await sleep(30);
    try { start(); } catch { /* ignore */ }

    // Ask for screen-share permission next. The picker exits
    // fullscreen — we restore it once the stream is granted.
    setPhase('preparing');
    let displayStream;
    try {
      displayStream = await requestDisplayMedia();
    } catch (err) {
      if (err && err.name === 'NotAllowedError') {
        // User dismissed the picker — silently return to armed so
        // they can re-try or cancel.
        setPhase('armed');
        return;
      }
      console.error('flypath export: getDisplayMedia failed', err);
      setError(err?.message || 'Screen capture permission was denied');
      setPhase('error');
      return;
    }

    // Restore fullscreen if we lost it to the picker. Best-effort:
    // the transient user activation from the picker's Share click
    // usually persists long enough for requestFullscreen to be
    // honoured; if it doesn't, the operator can hit F again after
    // the recording completes.
    if (fsTargetBefore && !document.fullscreenElement) {
      try { await fsTargetBefore.requestFullscreen(); } catch { /* activation expired */ }
    }

    // Cache the stream + track. Track.onended fires on native
    // "Stop sharing" — wire that to stopRecording so the flow ends
    // gracefully in that path too.
    displayStreamRef.current = displayStream;
    const displayTrack = displayStream.getVideoTracks()[0];
    displayTrackRef.current = displayTrack;
    displayTrack.addEventListener('ended', onDisplayTrackEnded);

    // Countdown — animation is already running from the beginRecording
    // start() call above, so all this does is give the operator a
    // visible ready-set-go before the actual capture pipeline latches
    // on.
    setPhase('countdown');
    for (let s = COUNTDOWN_START; s >= 1; s--) {
      if (cancelledRef.current) {
        cleanup();
        return;
      }
      setCountdown(s);
      await sleep(1000);
    }
    if (cancelledRef.current) {
      cleanup();
      return;
    }

    try {
      await startCapturePipeline(displayStream, displayTrack);
    } catch (err) {
      console.error('flypath export: capture pipeline failed', err);
      setError(err?.message || 'Recording failed to start');
      setPhase('error');
      cleanup();
    }
  };

  // Set up the video element that receives the display stream, the
  // crop math, the off-canvas MediaRecorder, and the frame pump.
  // Assumes `displayStream` has already been acquired and the
  // 5-second countdown has just elapsed — this is the last step
  // before the recording starts running for real.
  const startCapturePipeline = async (displayStream, displayTrack) => {
    if (!map) throw new Error('Map is not ready');
    const b = bboxRef.current;
    if (!b) throw new Error('No region selected');

    // Hidden video that renders the display stream. It's not in the
    // DOM — MediaRecorder only needs it as a drawable source. Some
    // browsers require the video to be attached to the document to
    // start playback; if that turns out to be an issue we can move
    // it into a hidden container.
    const video = document.createElement('video');
    video.autoplay   = true;
    video.muted      = true;
    video.playsInline = true;
    video.srcObject  = displayStream;
    videoElRef.current = video;

    await video.play().catch(() => { /* ignore autoplay quirks */ });
    if (video.readyState < 2) {
      await new Promise((resolve) => {
        const onOk = () => { video.removeEventListener('loadedmetadata', onOk); resolve(); };
        video.addEventListener('loadedmetadata', onOk, { once: true });
      });
    }

    // Figure out where the bbox lives inside the captured video.
    // Only cropping is safe for tab captures — for window / screen
    // captures the pixel origin is the shared surface, not the tab
    // viewport, so wrapper-relative math would land somewhere else
    // entirely. Fall back to recording the whole stream in that case.
    const trackSettings = (displayTrack.getSettings && displayTrack.getSettings()) || {};
    const surface = trackSettings.displaySurface || '';
    const isTab = surface === 'browser';

    const wrapperEl = map.getContainer().parentElement;
    const wrapperRect = wrapperEl.getBoundingClientRect();

    // videoWidth / videoHeight are the capture resolution in device
    // pixels; window.innerWidth / innerHeight are in CSS pixels. The
    // ratio is effectively devicePixelRatio, but computing it from
    // the video's actual size handles the Chrome case where the
    // capture is throttled below native resolution.
    const scaleX = video.videoWidth  / window.innerWidth;
    const scaleY = video.videoHeight / window.innerHeight;

    let sx, sy, sw, sh;
    if (isTab) {
      sx = Math.max(0, Math.round((wrapperRect.left + b.x) * scaleX));
      sy = Math.max(0, Math.round((wrapperRect.top  + b.y) * scaleY));
      sw = Math.max(1, Math.min(video.videoWidth  - sx, Math.round(b.w * scaleX)));
      sh = Math.max(1, Math.min(video.videoHeight - sy, Math.round(b.h * scaleY)));
    } else {
      // Not a tab capture — record the whole shared surface.
      sx = 0;
      sy = 0;
      sw = video.videoWidth;
      sh = video.videoHeight;
    }

    const offCanvas = offCanvasRef.current;
    if (!offCanvas) throw new Error('Offscreen canvas not ready');
    offCanvas.width  = sw;
    offCanvas.height = sh;
    const ctx = offCanvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable');

    // Prime a first frame so the recorder has a non-blank source.
    try { ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh); } catch { /* ignore */ }

    const outStream = offCanvas.captureStream(RECORDING_FPS);
    outStreamRef.current = outStream;

    // requestFrame() couples the recorded frame timing to the
    // drawImage tick instead of the browser's async sampler — makes
    // for visibly smoother output.
    const outTrack = outStream.getVideoTracks?.()[0];
    const canRequestFrame = !!outTrack && typeof outTrack.requestFrame === 'function';

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(outStream, {
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
      if (cancelledRef.current) return;
      const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
      // Save-file picker will exit fullscreen (browser security);
      // remember which element was in fullscreen so we can re-enter
      // after the picker closes. The requestFullscreen call is
      // best-effort — transient user activation may have expired by
      // the time saveBlob resolves.
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

    recorder.start(500);   // chunks flushed every 500 ms

    const pump = () => {
      try {
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
        if (canRequestFrame) {
          try { outTrack.requestFrame(); } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
      rafRef.current = requestAnimationFrame(pump);
    };
    rafRef.current = requestAnimationFrame(pump);

    // The flypath is already running (beginRecording start() call
    // fires at click time so the operator's picker/countdown wait
    // isn't dead air). Just flip the phase.
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

  // During 'recording' and 'saving' phases, NO recorder UI is drawn
  // inside the tab — every DOM element would show up in the video
  // output. The offscreen canvas stays mounted for the frame pump.
  // The browser's own "Stop sharing" chip is the primary stop
  // affordance; Esc is the keyboard equivalent.
  if (phase === 'recording' || phase === 'saving') {
    return (
      <>
        <canvas ref={offCanvasRef} aria-hidden className="hidden" />
        {phase === 'saving' ? (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 pointer-events-none"
            aria-hidden
          >
            <div className="flex items-center gap-2 px-4 py-2 rounded-md bg-black/80 text-white text-[13px] font-medium shadow-2xl">
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving recording…
            </div>
          </div>
        ) : null}
      </>
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
          className="absolute inset-0 pointer-events-none bg-black/45"
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

      {/* Armed / countdown — bbox outline stays visible. Action
          buttons live in the vertical right-mid rail. */}
      {(phase === 'armed' || phase === 'countdown') && bbox && (
        <div
          className={cn(
            'absolute border-2 pointer-events-none',
            phase === 'countdown' ? 'border-[#84cc16]/70' : 'border-[#84cc16]',
          )}
          style={{ left: bbox.x, top: bbox.y, width: bbox.w, height: bbox.h }}
        />
      )}

      {/* Countdown — big centred number with white fill + black halo */}
      {phase === 'countdown' && (
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
      )}

      {/* Preparing — waiting on the browser's screen-share picker.
          A small spinner + hint in the middle so the operator knows
          the click was received and to look for the picker chrome. */}
      {phase === 'preparing' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex items-center gap-2 px-4 py-2 rounded-md bg-black/85 text-white text-[13px] font-medium shadow-2xl">
            <Loader2 className="h-4 w-4 animate-spin" />
            Choose &quot;This tab&quot; in the sharing picker
          </div>
        </div>
      )}

      {/* ActionRail — vertical column of icon-only buttons pinned to
          the right-middle of the map wrapper. Only shown while armed;
          during recording/saving it's hidden so it never appears in
          the exported video. */}
      <ActionRail
        phase={phase}
        hasRoute={hasRoute}
        onStart={beginRecording}
        onRedraw={() => { setBbox(null); setPhase('selecting'); }}
        onCancel={cancelSession}
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

// Request a display-media stream biased toward the current tab.
// The Chrome-specific hints (`preferCurrentTab`, `selfBrowserSurface`,
// `monitorTypeSurfaces`, `surfaceSwitching`) push the picker toward
// a one-click "Share this tab" affordance; browsers that don't
// understand them fall back to the standard picker.
async function requestDisplayMedia() {
  if (!navigator?.mediaDevices?.getDisplayMedia) {
    throw new Error('Screen capture is not supported in this browser');
  }
  return navigator.mediaDevices.getDisplayMedia({
    video: {
      frameRate: { ideal: RECORDING_FPS, max: RECORDING_FPS },
    },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    monitorTypeSurfaces: 'exclude',
    surfaceSwitching: 'exclude',
  });
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
// right-middle of the map wrapper. Only shown during 'armed' — the
// recording / saving phases hide it because every DOM overlay is
// captured by the display-media stream.
function ActionRail({ phase, hasRoute, onStart, onRedraw, onCancel }) {
  if (phase !== 'armed') return null;

  return (
    <div
      className="absolute right-3 top-1/2 -translate-y-1/2 z-10 pointer-events-auto flex flex-col gap-1.5"
      role="toolbar"
      aria-label="Export animation controls"
    >
      <RailButton
        icon={Circle}
        iconFill
        onClick={onStart}
        disabled={!hasRoute}
        title={hasRoute
          ? 'Start recording (5-second countdown after picker)'
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
    </div>
  );
}

// Single button in the ActionRail. `tone` chooses the palette:
//   record  → filled red circle (Start recording)
//   neutral → dark chrome, subtle border, white icon
function RailButton({ icon: Icon, iconFill, onClick, disabled, title, ariaLabel, tone }) {
  const base = 'inline-flex items-center justify-center h-9 w-9 rounded-md shadow-2xl transition-colors';
  const palette = disabled
    ? 'bg-black/60 text-white/40 border border-white/10 cursor-not-allowed'
    : tone === 'record'
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