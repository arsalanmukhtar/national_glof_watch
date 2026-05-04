import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

const ParameterContext = createContext(null);

export function ParameterProvider({ children }) {
  const [selected, setSelected] = useState(null);
  // statuses: { [element]: { lastFetchedAt: ISO|null, stationCount: number } }
  const [statuses, setStatuses] = useState({});
  // currently-refreshing element id, or 'ALL' for refresh-all, else null
  const [busy, setBusy] = useState(null);
  // station highlighted on map / scrolled-to in the table
  const [selectedStation, setSelectedStation] = useState(null);
  // GeoJSON features for the active parameter — shared by MapPanel + StationsTable
  const [stations, setStations] = useState([]);

  const select = useCallback((id) => {
    setSelected((prev) => (prev === id ? null : id));
    setSelectedStation(null);
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

  const loadStations = useCallback(async (element) => {
    if (!element) {
      setStations([]);
      return;
    }
    try {
      const res = await fetch(
        `/api/parameters/${encodeURIComponent(element)}/latest`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStations(Array.isArray(data?.features) ? data.features : []);
    } catch (err) {
      console.error('[parameter ctx] loadStations failed:', err);
    }
  }, []);

  const refresh = useCallback(
    async (element) => {
      if (!element) return;
      setBusy(element);
      try {
        const res = await fetch(
          `/api/parameters/${encodeURIComponent(element)}/store`,
          { method: 'POST' },
        );
        if (!res.ok) throw new Error(`Refresh failed (${res.status})`);
        const data = await res.json();
        setStatuses((prev) => ({
          ...prev,
          [element]: {
            lastFetchedAt: data.fetchedAt ?? new Date().toISOString(),
            stationCount: data.stationsUpserted ?? prev[element]?.stationCount ?? 0,
          },
        }));
        await loadStations(element);
      } finally {
        setBusy((b) => (b === element ? null : b));
      }
    },
    [loadStations],
  );

  const refreshAll = useCallback(async () => {
    setBusy('ALL');
    try {
      const res = await fetch('/api/parameters/refresh-all', { method: 'POST' });
      if (!res.ok) throw new Error(`Refresh-all failed (${res.status})`);
      await loadStatus();
      await loadStations(selected);
    } finally {
      setBusy((b) => (b === 'ALL' ? null : b));
    }
  }, [loadStatus, loadStations, selected]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    loadStations(selected);
  }, [selected, loadStations]);

  return (
    <ParameterContext.Provider
      value={{
        selected,
        select,
        setSelected,
        statuses,
        refresh,
        refreshAll,
        busy,
        selectedStation,
        setSelectedStation,
        stations,
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
