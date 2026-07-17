import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { TOURS } from '@/components/tour/tours';

// TourContext — global state for the guided-tour overlay system.
// ---------------------------------------------------------------------------
// A "tour" is an ordered list of steps; each step points at a CSS
// selector (usually a `data-tour-id="…"` attribute) and carries the
// tooltip title + body. The overlay component reads `activeTour`,
// `stepIndex`, and the current step's target rect (recomputed on
// scroll/resize) to render the backdrop, spotlight, and tooltip.
//
// Persistence:
//   • Each completed tour is marked in localStorage so the app doesn't
//     re-prompt on every visit.
//   • A first-visit flag auto-launches the Welcome tour once.
//   • The launcher button itself can always re-start any tour.

const TourContext = createContext(null);

const STORAGE = 'tour';
const KEY_FIRST_VISIT   = `${STORAGE}:first-visit-shown:v1`;
const keyForSeen        = (tourId) => `${STORAGE}:seen:${tourId}:v1`;

// Order in which tours run when the first-visit chain is accepted.
// Sourced from TOURS' declaration order — this is the same order the
// picker menu shows, so the chain feels like "the picker, in sequence".
function chainOrder() {
  return TOURS.map((t) => t.id);
}

// Read / write helpers isolate localStorage so private-mode or
// disabled-storage browsers don't blow the app up — we just lose the
// "don't re-prompt" persistence, tours still work.
function readFlag(key) {
  if (typeof window === 'undefined') return false;
  try { return window.localStorage.getItem(key) === '1'; } catch { return false; }
}
function writeFlag(key, value) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(key, value ? '1' : '0'); } catch { /* ignore */ }
}

export function TourProvider({ children }) {
  // Which tour is running, and where inside it. `activeTour` is the
  // tour object (from TOURS) not just the id, so consumers don't have
  // to re-look-it-up on every render.
  const [activeTour, setActiveTour] = useState(null);
  const [stepIndex, setStepIndex] = useState(0);

  // First-visit gate: renders the "Start the Guided Tour? Yes | Skip"
  // popover under the launcher on the very first load. Set once from
  // localStorage on mount; flipped to false when the user answers.
  const [firstVisitPrompt, setFirstVisitPrompt] = useState(false);

  // Fires on tour completion so callers (e.g. the picker) can react.
  const onCompleteRef = useRef(null);

  const start = useCallback((tourId, opts = {}) => {
    const tour = TOURS.find((t) => t.id === tourId);
    if (!tour || tour.steps.length === 0) return;
    onCompleteRef.current = opts.onComplete ?? null;
    setActiveTour(tour);
    setStepIndex(0);
  }, []);

  const stop = useCallback((reason = 'skipped') => {
    if (activeTour && reason === 'completed') {
      writeFlag(keyForSeen(activeTour.id), true);
    }
    const cb = onCompleteRef.current;
    onCompleteRef.current = null;
    setActiveTour(null);
    setStepIndex(0);
    cb?.(reason);
  }, [activeTour]);

  const next = useCallback(() => {
    if (!activeTour) return;
    setStepIndex((i) => {
      if (i >= activeTour.steps.length - 1) {
        // Completed — clear via the effect below, but also trigger
        // the write here so completion isn't lost if setActiveTour
        // races.
        writeFlag(keyForSeen(activeTour.id), true);
        const cb = onCompleteRef.current;
        onCompleteRef.current = null;
        setActiveTour(null);
        cb?.('completed');
        return 0;
      }
      return i + 1;
    });
  }, [activeTour]);

  const prev = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  const goTo = useCallback((i) => {
    if (!activeTour) return;
    const clamped = Math.max(0, Math.min(activeTour.steps.length - 1, i));
    setStepIndex(clamped);
  }, [activeTour]);

  // First-visit gate: show the "Start the Guided Tour?" popover under
  // the launcher instead of auto-launching. The user must explicitly
  // Yes/Skip. Delayed briefly so the titlebar has mounted and the
  // popover has an anchor to sit under.
  useEffect(() => {
    if (readFlag(KEY_FIRST_VISIT)) return;
    const t = setTimeout(() => setFirstVisitPrompt(true), 600);
    return () => clearTimeout(t);
  }, []);

  // Chain the tours together — used when the user accepts the
  // first-visit prompt. Each tour's `onComplete('completed')` starts
  // the next one after a short breath so the transition reads as a
  // deliberate hand-off, not a jarring cut. A user Skip breaks the
  // chain (reason !== 'completed') and no further tours auto-launch.
  const startChainRef = useRef(null);
  startChainRef.current = (fromIndex) => {
    const order = chainOrder();
    const tourId = order[fromIndex];
    if (!tourId) return;
    start(tourId, {
      onComplete: (reason) => {
        if (reason !== 'completed') return;
        setTimeout(() => startChainRef.current?.(fromIndex + 1), 400);
      },
    });
  };

  const acceptFirstVisit = useCallback(() => {
    writeFlag(KEY_FIRST_VISIT, true);
    setFirstVisitPrompt(false);
    // Kick off the chain from the first tour in TOURS order.
    setTimeout(() => startChainRef.current?.(0), 200);
  }, []);

  const skipFirstVisit = useCallback(() => {
    writeFlag(KEY_FIRST_VISIT, true);
    setFirstVisitPrompt(false);
  }, []);

  // Global Escape → stop. Keeps the tour dismissible even if the
  // tooltip loses focus.
  useEffect(() => {
    if (!activeTour) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') stop('skipped');
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft')  prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTour, stop, next, prev]);

  const currentStep = useMemo(() => {
    if (!activeTour) return null;
    return activeTour.steps[stepIndex] ?? null;
  }, [activeTour, stepIndex]);

  const value = useMemo(
    () => ({
      activeTour,
      stepIndex,
      currentStep,
      totalSteps: activeTour?.steps.length ?? 0,
      start,
      stop,
      next,
      prev,
      goTo,
      tours: TOURS,
      hasSeen: (tourId) => readFlag(keyForSeen(tourId)),
      firstVisitPrompt,
      acceptFirstVisit,
      skipFirstVisit,
    }),
    [
      activeTour, stepIndex, currentStep,
      start, stop, next, prev, goTo,
      firstVisitPrompt, acceptFirstVisit, skipFirstVisit,
    ],
  );

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}

export function useTour() {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('useTour must be used inside TourProvider');
  return ctx;
}
