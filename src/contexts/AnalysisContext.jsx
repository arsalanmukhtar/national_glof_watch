import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

// ---------------------------------------------------------------------------
// AnalysisContext — shared state for the on-demand Sentinel-2 index
// analysis flow. Lives one place so:
//   • ImageryAnalysisPanel (sidebar) can drive the drawn AOI, date
//     windows, index selection, and kick off /api/analysis/sentinel.
//   • MapPanel can render the drawn AOI overlay + the returned COG(s)
//     as raster layers without the panel having to reach into it.
//   • ChartsRow can pick up the returned stats and switch to the new
//     Analysis tab automatically when a run completes.
//
// State surface intentionally flat — no reducer, no derived caches. The
// AOI is a plain GeoJSON Feature, results are the raw JSON envelope
// returned by the backend (so `hash`, `windowA.cogUrl`, etc. survive
// intact for downstream consumers).
// ---------------------------------------------------------------------------

const AnalysisContext = createContext(null);

const DEFAULT_MAX_CLOUD = 40;
const DEFAULT_INDEX = 'NDVI';

// Convenience for date windows: last full calendar month + the one
// before it, in the 'YYYY-MM' short form the backend understands.
function ymOffset(monthOffset) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + monthOffset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function AnalysisProvider({ children }) {
  const [drawnGeometry, setDrawnGeometry] = useState(null);
  // Two default windows — last full month vs the month before that.
  const [windowA, setWindowA] = useState(() => ymOffset(-2));
  const [windowB, setWindowB] = useState(() => ymOffset(-1));
  const [compareEnabled, setCompareEnabled] = useState(true);
  const [index, setIndex] = useState(DEFAULT_INDEX);
  const [maxCloud, setMaxCloud] = useState(DEFAULT_MAX_CLOUD);

  const [status, setStatus] = useState('idle'); // idle | running | success | error
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null); // backend summary JSON

  // Bumped when a new run succeeds so ChartsRow can auto-open the
  // Analysis tab without re-running on every re-render.
  const [resultsToken, setResultsToken] = useState(0);

  // Abort controller for the in-flight fetch. Cleared on completion.
  const abortRef = useRef(null);

  const clearResults = useCallback(() => {
    setResults(null);
    setError(null);
    setStatus('idle');
  }, []);

  const clearGeometry = useCallback(() => {
    setDrawnGeometry(null);
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus('idle');
  }, []);

  const run = useCallback(async () => {
    if (!drawnGeometry) {
      setError('Draw an AOI on the map first');
      setStatus('error');
      return;
    }
    if (!windowA) {
      setError('Pick a date window for period A');
      setStatus('error');
      return;
    }
    if (compareEnabled && !windowB) {
      setError('Pick a date window for period B (or turn comparison off)');
      setStatus('error');
      return;
    }

    // Abort any prior in-flight run.
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setStatus('running');
    setError(null);
    setResults(null);

    try {
      const body = {
        geometry: drawnGeometry.geometry ?? drawnGeometry,
        windowA,
        windowB: compareEnabled ? windowB : null,
        index,
        maxCloud,
      };
      const res = await fetch('/api/analysis/sentinel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        // Preserve the stderr tail alongside the summary so the panel
        // can offer a "show details" affordance. Python's own
        // traceback usually ends up in stderrTail, which is what we
        // actually need to diagnose bad AOIs / missing scenes / etc.
        const parts = [];
        if (json?.error)      parts.push(json.error);
        if (json?.hint)       parts.push(json.hint);
        if (json?.stderrTail) parts.push(`\n\n--- Python stderr (last lines) ---\n${json.stderrTail.trim()}`);
        const msg = parts.length
          ? parts.join('\n')
          : `Analysis failed (${res.status})`;
        setError(msg);
        setStatus('error');
        return;
      }
      setResults(json);
      setResultsToken((n) => n + 1);
      setStatus('success');
    } catch (err) {
      if (err.name === 'AbortError') return;
      setError(err.message || 'Network error');
      setStatus('error');
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  }, [drawnGeometry, windowA, windowB, compareEnabled, index, maxCloud]);

  const value = useMemo(
    () => ({
      drawnGeometry, setDrawnGeometry, clearGeometry,
      windowA, setWindowA,
      windowB, setWindowB,
      compareEnabled, setCompareEnabled,
      index, setIndex,
      maxCloud, setMaxCloud,
      status, error, results, resultsToken,
      run, cancel, clearResults,
    }),
    [
      drawnGeometry, clearGeometry,
      windowA, windowB, compareEnabled, index, maxCloud,
      status, error, results, resultsToken,
      run, cancel, clearResults,
    ],
  );

  return (
    <AnalysisContext.Provider value={value}>{children}</AnalysisContext.Provider>
  );
}

export function useAnalysis() {
  const ctx = useContext(AnalysisContext);
  if (!ctx) throw new Error('useAnalysis must be used inside <AnalysisProvider>');
  return ctx;
}
