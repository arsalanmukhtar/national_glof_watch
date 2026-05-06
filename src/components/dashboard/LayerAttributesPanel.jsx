import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Search, X } from 'lucide-react';
import { useAttributeTables } from '@/contexts/AttributeTablesContext';
import { fetchGeoJson, regionLayerUrl } from '@/config/layerSources';
import { cn } from '@/utils/cn';

// Renders inside the chart card's "Attributes Table" tab. Lets the user
// inspect the raw attributes of any open PMD parameter / region layer /
// risk-zone bundle. One sub-tab per open spec; clicking a sub-tab swaps
// the rendered table.

export default function LayerAttributesPanel() {
  const { tables, activeId, setActiveId, closeTable } = useAttributeTables();
  const active = tables.find((t) => t.id === activeId) ?? tables[0] ?? null;

  if (tables.length === 0) {
    return (
      <div className="p-3 flex flex-col h-full min-h-0">
        <EmptyState>
          Click the table icon next to any PMD parameter, region layer, or
          risk-zone row to open its attribute table here.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="p-3 flex flex-col gap-2 h-full min-h-0">
      <SubTabs
        tables={tables}
        activeId={active?.id}
        onActivate={setActiveId}
        onClose={closeTable}
      />
      {active ? <ActiveTable spec={active} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-tabs — one chip per open table; click switches, X closes.
// ---------------------------------------------------------------------------

function SubTabs({ tables, activeId, onActivate, onClose }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto shrink-0 pb-1">
      {tables.map((t) => {
        const isActive = t.id === activeId;
        return (
          <div
            key={t.id}
            className={cn(
              'group inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-md text-[11px] font-medium border transition-colors shrink-0',
              isActive
                ? 'bg-[#16a085]/10 border-[#16a085]/50 text-[#16a085]'
                : 'border-day-border dark:border-night-border text-day-muted dark:text-night-muted hover:text-day-text dark:hover:text-night-text hover:border-day-text/40 dark:hover:border-night-text/40',
            )}
          >
            <button
              type="button"
              onClick={() => onActivate(t.id)}
              className="inline-flex items-center gap-1.5 truncate max-w-[200px] text-left"
              title={t.label}
            >
              <KindDot kind={t.kind} />
              <span className="truncate">{t.label}</span>
            </button>
            <button
              type="button"
              onClick={() => onClose(t.id)}
              aria-label={`Close ${t.label}`}
              className="inline-flex h-4 w-4 items-center justify-center rounded text-current opacity-60 hover:opacity-100 hover:bg-day-bg dark:hover:bg-night-bg"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function KindDot({ kind }) {
  const color =
    kind === 'parameter'
      ? '#16a085'
      : kind === 'risk'
        ? '#ef4444'
        : '#3b82f6';
  return (
    <span
      aria-hidden
      className="inline-block h-1.5 w-1.5 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

// ---------------------------------------------------------------------------
// Active table — fetches data for the selected spec, supports sort + search
// + sticky header, and renders empty / loading / error states inline.
// ---------------------------------------------------------------------------

function ActiveTable({ spec }) {
  const { rows, columns, loading, error } = useTableData(spec);
  const [sortBy, setSortBy] = useState({ col: null, dir: 'asc' });
  const [search, setSearch] = useState('');

  // Reset sort + search whenever the active table changes.
  useEffect(() => {
    setSortBy({ col: null, dir: 'asc' });
    setSearch('');
  }, [spec.id]);

  const filteredSorted = useMemo(() => {
    let r = rows;
    if (search) {
      const q = search.toLowerCase();
      r = r.filter((row) =>
        Object.values(row).some(
          (v) => v != null && String(v).toLowerCase().includes(q),
        ),
      );
    }
    if (sortBy.col) {
      const dir = sortBy.dir === 'asc' ? 1 : -1;
      r = [...r].sort((a, b) => {
        const av = a[sortBy.col];
        const bv = b[sortBy.col];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        const an = Number(av);
        const bn = Number(bv);
        if (Number.isFinite(an) && Number.isFinite(bn)) return (an - bn) * dir;
        return String(av).localeCompare(String(bv)) * dir;
      });
    }
    return r;
  }, [rows, search, sortBy]);

  const onSort = (col) => {
    setSortBy((prev) => {
      if (prev.col !== col) return { col, dir: 'asc' };
      if (prev.dir === 'asc') return { col, dir: 'desc' };
      return { col: null, dir: 'asc' };
    });
  };

  return (
    <>
      <Toolbar
        search={search}
        onSearch={setSearch}
        count={filteredSorted.length}
        total={rows.length}
        loading={loading}
      />
      <div className="flex-1 min-h-0 overflow-auto rounded-md border border-day-border dark:border-night-border bg-white dark:bg-night-surface">
        {error ? (
          <EmptyState>
            <span className="text-red-600 dark:text-red-400">
              Failed to load attributes: {error}
            </span>
          </EmptyState>
        ) : !loading && rows.length === 0 ? (
          <EmptyState>No features found for this layer.</EmptyState>
        ) : (
          <table className="w-full text-[11px] tabular-nums border-collapse">
            <thead>
              <tr className="bg-day-bg/80 dark:bg-night-bg/80 backdrop-blur-sm sticky top-0 z-[1] shadow-[inset_0_-1px_0_0] shadow-day-border dark:shadow-night-border">
                <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-day-muted dark:text-night-muted w-10">
                  #
                </th>
                {columns.map((c) => {
                  const sorted = sortBy.col === c;
                  const Icon = !sorted
                    ? ArrowUpDown
                    : sortBy.dir === 'asc'
                      ? ArrowUp
                      : ArrowDown;
                  return (
                    <th
                      key={c}
                      onClick={() => onSort(c)}
                      className={cn(
                        'px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap select-none cursor-pointer hover:text-[#16a085]',
                        sorted
                          ? 'text-[#16a085]'
                          : 'text-day-muted dark:text-night-muted',
                      )}
                    >
                      <span className="inline-flex items-center gap-1">
                        {prettyHeader(c)}
                        <Icon className="h-3 w-3 opacity-70" />
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filteredSorted.map((row, i) => (
                <tr
                  key={i}
                  className={cn(
                    'border-b border-day-border/60 dark:border-night-border/60',
                    'odd:bg-day-bg/30 dark:odd:bg-night-bg/30',
                    'hover:bg-[#16a085]/10 transition-colors',
                  )}
                >
                  <td className="px-2 py-1 text-day-muted dark:text-night-muted">
                    {i + 1}
                  </td>
                  {columns.map((c) => (
                    <td
                      key={c}
                      className="px-2 py-1 text-day-text dark:text-night-text whitespace-nowrap max-w-[280px] truncate"
                      title={formatCell(row[c])}
                    >
                      {formatCell(row[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function Toolbar({ search, onSearch, count, total, loading }) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <div className="relative flex-1 max-w-xs">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-day-muted dark:text-night-muted pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search rows…"
          className={cn(
            'w-full pl-7 pr-2 py-1 rounded-md text-[11px]',
            'bg-day-bg dark:bg-night-bg',
            'border border-day-border dark:border-night-border',
            'text-day-text dark:text-night-text placeholder:text-day-muted dark:placeholder:text-night-muted',
            'focus:outline-none focus:ring-2 focus:ring-[#16a085]/40',
          )}
        />
      </div>
      <span className="text-[10.5px] text-day-muted dark:text-night-muted">
        {loading
          ? 'Loading…'
          : total === count
            ? `${total} row${total === 1 ? '' : 's'}`
            : `${count} of ${total}`}
      </span>
    </div>
  );
}

function EmptyState({ children }) {
  return (
    <div className="h-full flex items-center justify-center text-center px-3 py-8">
      <p className="text-[11.5px] text-day-muted dark:text-night-muted">
        {children}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data fetcher — one call per spec change. Drops the GeoJSON `geometry`
// field so the table only shows real attributes.
// ---------------------------------------------------------------------------

function useTableData(spec) {
  const [rows, setRows] = useState([]);
  const [columns, setColumns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!spec) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRows([]);
    setColumns([]);

    const run = async () => {
      try {
        let collected = [];
        if (spec.kind === 'parameter') {
          const r = await fetch(
            `/api/parameters/${encodeURIComponent(spec.element)}/latest`,
          );
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const json = await r.json();
          collected = featuresToRows(json?.features);
        } else if (spec.kind === 'region') {
          const url = regionLayerUrl(spec.regionId, spec.layerKey);
          if (!url) throw new Error('No URL for region layer');
          const json = await fetchGeoJson(url);
          collected = featuresToRows(json?.features);
        } else if (spec.kind === 'risk') {
          // Combine all three risk levels — some regions only ship two
          // of the three files, so missing levels are skipped silently.
          const levels = ['low', 'medium', 'high'];
          for (const level of levels) {
            const url = regionLayerUrl(spec.regionId, `risk:${level}`);
            if (!url) continue;
            try {
              const json = await fetchGeoJson(url);
              for (const f of json?.features ?? []) {
                collected.push({ risk_level: level, ...(f.properties ?? {}) });
              }
            } catch {
              /* skip missing level */
            }
          }
        }
        if (cancelled) return;
        setRows(collected);
        setColumns(deriveColumns(collected));
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [spec?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return { rows, columns, loading, error };
}

function featuresToRows(features) {
  if (!Array.isArray(features)) return [];
  return features.map((f) => f?.properties ?? {});
}

function deriveColumns(rows) {
  if (!rows.length) return [];
  const cols = [];
  const seen = new Set();
  const sample = rows.slice(0, 100);
  for (const r of sample) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        seen.add(k);
        cols.push(k);
      }
    }
  }
  return cols;
}

// snake_case / camelCase / random keys → "Snake Case" / "Camel Case".
// Used purely for column headings; the underlying row keys stay raw so
// sort + search continue to match what's actually in the GeoJSON.
function prettyHeader(key) {
  if (!key) return '';
  return String(key)
    .replace(/[_\-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatCell(v) {
  if (v == null || v === '') return '—';
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return String(v);
    return Number(v.toFixed(4)).toString();
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
