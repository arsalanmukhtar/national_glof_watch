import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

const ParameterContext = createContext(null);

// Tightening factor for NDMA early-warning classification. 0.9 means the
// upper bounds of every alarm band shift down by 10% (and the lower
// bounds shift up by ~11%), so a Pre-alarm fires ahead of PMD's own
// threshold. Kept as a module constant, not user-facing, because tuning
// it is a policy call — the toggle is a switch, not a slider.
export const EARLY_WARNING_FACTOR = 0.9;

export function ParameterProvider({ children }) {
  const [selected, setSelected] = useState(null);
  // Full element catalog from the backend: [{ name, unit, stationCount }].
  const [elements, setElements] = useState([]);
  // statuses: { [element]: { lastFetchedAt: ISO|null, stationCount: number } }
  const [statuses, setStatuses] = useState({});
  // currently-refreshing element id, or 'ALL' for refresh-all, else null
  const [busy, setBusy] = useState(null);
  // station highlighted on map / scrolled-to in the table
  const [selectedStation, setSelectedStation] = useState(null);
  // GeoJSON features for the active parameter — shared by MapPanel + StationsTable
  const [stations, setStations] = useState([]);
  // Set of alert-state keys the user has hidden via the legend; map
  // circles + attribute-table rows both filter against it.
  const [disabledStates, setDisabledStates] = useState(() => new Set());
  // NDMA early-warning toggle. When true, /latest is fetched with
  // ?earlyFactor=EARLY_WARNING_FACTOR and consumers read `ourStateId`
  // instead of PMD's `stateId`. Single source of truth so the map dot,
  // stations table, and threshold breaches card can't disagree on which
  // classification is showing.
  const [earlyWarning, setEarlyWarning] = useState(false);

  const select = useCallback((id) => {
    setSelected((prev) => (prev === id ? null : id));
  }, []);

  const toggleState = useCallback((stateId) => {
    setDisabledStates((prev) => {
      const next = new Set(prev);
      if (next.has(stateId)) next.delete(stateId);
      else next.add(stateId);
      return next;
    });
  }, []);

  // Whenever the active parameter changes, clear the highlighted station
  // and reset the legend's hidden states.
  useEffect(() => {
    setSelectedStation(null);
    setDisabledStates(new Set());
  }, [selected]);

  const loadElements = useCallback(async () => {
    try {
      const res = await fetch('/api/parameters/elements');
      if (!res.ok) return;
      const data = await res.json();
      setElements(Array.isArray(data?.elements) ? data.elements : []);
    } catch {
      /* swallow — UI keeps the previous catalog */
    }
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/parameters/status');
      if (!res.ok) return;
      const data = await res.json();
      setStatuses(data);
    } catch {
      /* swallow — UI will keep showing previous values */
    }
  }, []);

  const loadStations = useCallback(async (element, opts = {}) => {
    if (!element) {
      setStations([]);
      return;
    }
    const useEarly = opts.earlyWarning ?? false;
    const qs = useEarly ? `?earlyFactor=${EARLY_WARNING_FACTOR}` : '';
    try {
      const res = await fetch(
        `/api/parameters/${encodeURIComponent(element)}/latest${qs}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStations(Array.isArray(data?.features) ? data.features : []);
    } catch (err) {
      console.error('[parameter ctx] loadStations failed:', err);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setBusy('ALL');
    try {
      const res = await fetch('/api/parameters/refresh-all', { method: 'POST' });
      if (!res.ok) throw new Error(`Refresh-all failed (${res.status})`);
      await loadStatus();
      await loadElements();
      await loadStations(selected, { earlyWarning });
    } finally {
      setBusy((b) => (b === 'ALL' ? null : b));
    }
  }, [loadStatus, loadElements, loadStations, selected, earlyWarning]);

  // Per-element refresh runs the same full v3 value cycle (the v3 pipeline
  // is per-station, not per-element) — just badged to the chosen element.
  const refresh = useCallback(
    async (element) => {
      if (!element) return;
      setBusy(element);
      try {
        const res = await fetch('/api/parameters/refresh-all', {
          method: 'POST',
        });
        if (!res.ok) throw new Error(`Refresh failed (${res.status})`);
        await loadStatus();
        await loadStations(element, { earlyWarning });
      } finally {
        setBusy((b) => (b === element ? null : b));
      }
    },
    [loadStatus, loadStations, earlyWarning],
  );

  // Decoded alert thresholds for one element instance — used by the
  // Feature Details threshold table. Returns null on any failure so the
  // caller can render an "unavailable" note without crashing.
  const fetchThresholds = useCallback(async (elementId) => {
    if (elementId == null) return null;
    try {
      const res = await fetch(`/api/parameters/element/${elementId}/thresholds`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    loadElements();
  }, [loadElements]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    loadStations(selected, { earlyWarning });
  }, [selected, earlyWarning, loadStations]);

  // If the catalog reloads and the selected element is gone, clear it.
  useEffect(() => {
    if (
      selected &&
      elements.length > 0 &&
      !elements.some((e) => e.name === selected)
    ) {
      setSelected(null);
    }
  }, [elements, selected]);

  return (
    <ParameterContext.Provider
      value={{
        selected,
        select,
        setSelected,
        elements,
        statuses,
        refresh,
        refreshAll,
        busy,
        selectedStation,
        setSelectedStation,
        stations,
        disabledStates,
        toggleState,
        fetchThresholds,
        earlyWarning,
        setEarlyWarning,
        earlyWarningFactor: EARLY_WARNING_FACTOR,
      }}
    >
      {children}
    </ParameterContext.Provider>
  );
}

export function useParameter() {
  const ctx = useContext(ParameterContext);
  if (!ctx) {
    throw new Error('useParameter must be used inside ParameterProvider');
  }
  return ctx;
}
