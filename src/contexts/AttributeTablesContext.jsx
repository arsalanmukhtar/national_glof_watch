import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

// Tracks which layers / parameters have their attribute table open in
// the chart panel's "Attributes Table" tab, plus which sub-tab is
// currently active. Also exposes a flag the chart panel uses to auto-
// switch to the Attributes tab whenever a new table is opened from the
// sidebar.
//
// Spec shape (one entry per open table):
//   {
//     id:    'param:Air Temperature' | `region:${regionId}:${layerKey}`,
//     label: 'Air Temperature' | 'Badswat · Lake',
//     kind:  'parameter' | 'region' | 'risk',
//     element?:   string,   // for kind=parameter
//     regionId?:  string,   // for kind=region | risk
//     layerKey?:  string,   // for kind=region (e.g. 'lake', 'glacier')
//   }

const AttributeTablesContext = createContext(null);

export function AttributeTablesProvider({ children }) {
  const [tables, setTables] = useState([]);
  const [activeId, setActiveId] = useState(null);
  // The chart card's active top-level tab, lifted into context so the
  // Dashboard can react (collapsing the map when the user is browsing
  // attribute tables, restoring it when they switch to a chart tab).
  const [chartTab, setChartTab] = useState('pmd');
  // The most recently clicked map feature, plus enough metadata for the
  // Feature Details tab to render a meaningful header (layer kind, human
  // label, accent color). Set by MapPanel's overlay click handler;
  // intentionally NOT auto-switching the chart tab — the user toggles to
  // "Feature Details" manually.
  //
  // Spec shape:
  //   {
  //     feature:     GeoJSONFeature,         // raw click hit
  //     kind:        'region' | 'secondary' | 'upload' | 'db',
  //     overlayKey:  string,                 // e.g. 'region:badswat::lake'
  //     label:       string,                 // 'Badswat · Lake'
  //     sublabel?:   string,                 // 'Polygon' / 'Line' / 'Point'
  //     accentColor: string,                 // hex, drives header bar tint
  //   }
  const [selectedFeature, setSelectedFeature] = useState(null);

  const openTable = useCallback((spec) => {
    if (!spec?.id) return;
    setTables((prev) => {
      if (prev.some((t) => t.id === spec.id)) return prev;
      return [...prev, spec];
    });
    setActiveId(spec.id);
    setChartTab('attributes');
  }, []);

  const closeTable = useCallback((id) => {
    setTables((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx === -1) return prev;
      const next = prev.filter((t) => t.id !== id);
      setActiveId((curr) => {
        if (curr !== id) return curr;
        if (next.length === 0) return null;
        // Pick the neighbor (previous if exists, else next).
        const fallback = next[Math.max(0, idx - 1)] ?? next[0];
        return fallback?.id ?? null;
      });
      return next;
    });
  }, []);

  const toggleTable = useCallback(
    (spec) => {
      if (!spec?.id) return;
      setTables((prev) => {
        const idx = prev.findIndex((t) => t.id === spec.id);
        if (idx >= 0) {
          // close
          const next = prev.filter((t) => t.id !== spec.id);
          setActiveId((curr) => {
            if (curr !== spec.id) return curr;
            if (next.length === 0) return null;
            const fallback = next[Math.max(0, idx - 1)] ?? next[0];
            return fallback?.id ?? null;
          });
          return next;
        }
        // open
        setActiveId(spec.id);
        setChartTab('attributes');
        return [...prev, spec];
      });
    },
    [],
  );

  const isOpen = useCallback(
    (id) => tables.some((t) => t.id === id),
    [tables],
  );

  const value = useMemo(
    () => ({
      tables,
      activeId,
      setActiveId,
      openTable,
      closeTable,
      toggleTable,
      isOpen,
      chartTab,
      setChartTab,
      selectedFeature,
      setSelectedFeature,
    }),
    [
      tables,
      activeId,
      openTable,
      closeTable,
      toggleTable,
      isOpen,
      chartTab,
      selectedFeature,
    ],
  );

  return (
    <AttributeTablesContext.Provider value={value}>
      {children}
    </AttributeTablesContext.Provider>
  );
}

export function useAttributeTables() {
  const ctx = useContext(AttributeTablesContext);
  if (!ctx) {
    throw new Error(
      'useAttributeTables must be used inside AttributeTablesProvider',
    );
  }
  return ctx;
}
