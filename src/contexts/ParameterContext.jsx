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
  // station whose attribute panel is open at bottom-right of the map
  const [selectedStation, setSelectedStation] = useState(null);

  const select = useCallback((id) => {
    setSelected((prev) => (prev === id ? null : id));
    setSelectedStation(null); // clear stale detail when switching parameters
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

  const refresh = useCallback(async (element) => {
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
    } finally {
      setBusy((b) => (b === element ? null : b));
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setBusy('ALL');
    try {
      const res = await fetch('/api/parameters/refresh-all', { method: 'POST' });
      if (!res.ok) throw new Error(`Refresh-all failed (${res.status})`);
      await loadStatus();
    } finally {
      setBusy((b) => (b === 'ALL' ? null : b));
    }
  }, [loadStatus]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

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
