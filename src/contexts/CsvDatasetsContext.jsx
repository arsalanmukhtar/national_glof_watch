import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

// ---------------------------------------------------------------------------
// CsvDatasetsContext — shared store for CSVs added in the sidebar's CSV
// Data panel and consumed by the chart card's Lakes Trend tab. One
// dataset shape:
//
//   {
//     id, name,
//     source: 'upload' | 'paste' | 'url',
//     columns: string[],
//     rows: Array<Record<string, unknown>>,
//     types: { [col]: 'number' | 'date' | 'string' | 'unknown' },
//     chartConfig: { x, y },
//     filters: [{ id, column, op, value }],
//   }
// ---------------------------------------------------------------------------

const CsvDatasetsContext = createContext(null);

export function CsvDatasetsProvider({ children }) {
  const [datasets, setDatasets] = useState([]);
  const [activeId, setActiveId] = useState(null);

  const addDataset = useCallback(
    ({ name, source, columns, rows, types }) => {
      const id = `csv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const safeTypes = types ?? {};
      const x = pickAxisDefault(columns, safeTypes, 'x');
      const y = pickAxisDefault(columns, safeTypes, 'y');
      const dataset = {
        id,
        name: name || 'Dataset',
        source: source || 'upload',
        columns: columns ?? [],
        rows: rows ?? [],
        types: safeTypes,
        chartConfig: { x, y },
        filters: [],
      };
      setDatasets((prev) => [...prev, dataset]);
      setActiveId(id);
      return id;
    },
    [],
  );

  const removeDataset = useCallback((id) => {
    setDatasets((prev) => prev.filter((d) => d.id !== id));
    setActiveId((curr) => (curr === id ? null : curr));
  }, []);

  const updateDataset = useCallback((id, partial) => {
    setDatasets((prev) =>
      prev.map((d) =>
        d.id === id
          ? {
              ...d,
              ...partial,
              chartConfig: partial.chartConfig
                ? { ...d.chartConfig, ...partial.chartConfig }
                : d.chartConfig,
            }
          : d,
      ),
    );
  }, []);

  const activeDataset =
    datasets.find((d) => d.id === activeId) ?? datasets[0] ?? null;

  const value = useMemo(
    () => ({
      datasets,
      activeId: activeDataset?.id ?? null,
      activeDataset,
      setActiveId,
      addDataset,
      removeDataset,
      updateDataset,
    }),
    [datasets, activeDataset, addDataset, removeDataset, updateDataset],
  );

  return (
    <CsvDatasetsContext.Provider value={value}>
      {children}
    </CsvDatasetsContext.Provider>
  );
}

export function useCsvDatasets() {
  const ctx = useContext(CsvDatasetsContext);
  if (!ctx) {
    throw new Error(
      'useCsvDatasets must be used inside CsvDatasetsProvider',
    );
  }
  return ctx;
}

// Default axis pick: X prefers the first date-like column, then string,
// then anything; Y prefers the first numeric column. Keeps the chart
// useful out-of-the-box even before the user touches the axis pickers.
function pickAxisDefault(columns, types, axis) {
  if (!columns?.length) return null;
  if (axis === 'x') {
    const date = columns.find((c) => types[c] === 'date');
    if (date) return date;
    const str = columns.find((c) => types[c] === 'string');
    if (str) return str;
    return columns[0];
  }
  const num = columns.find((c) => types[c] === 'number');
  if (num) return num;
  return columns[columns.length - 1];
}
