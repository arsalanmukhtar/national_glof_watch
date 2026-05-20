import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Search,
  X,
} from 'lucide-react';
import { useAttributeTables } from '@/contexts/AttributeTablesContext';
import {
  fetchGeoJson,
  regionLayerUrl,
  secondaryLayerUrl,
} from '@/config/layerSources';
import { inferUnit } from '@/utils/units';
import { cn } from '@/utils/cn';

// Cap the rows the table actually puts in the DOM. A 250k-row layer
// would otherwise create a quarter-million `<tr>` nodes and freeze the
// browser. Filter + sort still operate over the full rowset; the page
// slice only affects what's rendered.
const PAGE_SIZE = 500;

// Renders inside the chart card's "Attributes Table" tab. Lets the user
// inspect the raw attributes of any open PMD parameter / region layer /
// risk-zone bundle. One sub-tab per open spec; clicking a sub-tab swaps
// the rendered table.

export default function LayerAttributesPanel() {
  const { tables, activeId, setActiveId, closeTable } = useAttributeTables();
  const active = tables.find((t) => t.id === activeId) ?? tables[0] ?? null;

  // Search + sort + pagination state live at the panel level so the
  // controls (search, page indicator) can sit alongside the sub-tab strip
  // and the table itself can stay stateless.
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState({ col: null, dir: 'asc' });
  const [page, setPage] = useState(1);

  // Reset everything whenever the active table changes — the column
  // set differs between specs, so prior state is meaningless.
  useEffect(() => {
    setSearch('');
    setSortBy({ col: null, dir: 'asc' });
    setPage(1);
  }, [active?.id]);

  // Filtering / sorting changes the result-set size — drop back to page 1
  // so the user isn't stranded on a now-empty page.
  useEffect(() => {
    setPage(1);
  }, [search, sortBy]);

  const { rows, columns, loading, error } = useTableData(active);

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

  const pageCount = Math.max(1, Math.ceil(filteredSorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageRows = useMemo(
    () => filteredSorted.slice(pageStart, pageStart + PAGE_SIZE),
    [filteredSorted, pageStart],
  );

  const onSort = (col) => {
    setSortBy((prev) => {
      if (prev.col !== col) return { col, dir: 'asc' };
      if (prev.dir === 'asc') return { col, dir: 'desc' };
      return { col: null, dir: 'asc' };
    });
  };

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
      {/* One-row header: sub-tabs grow + scroll horizontally, search +
          row-count sit at the far right. */}
      <div className="flex items-center gap-2 shrink-0 min-w-0">
        <SubTabs
          tables={tables}
          activeId={active?.id}
          onActivate={setActiveId}
          onClose={closeTable}
        />
        <SearchInput value={search} onChange={setSearch} />
        <RowCount
          count={filteredSorted.length}
          total={rows.length}
          loading={loading}
        />
      </div>
      {active ? (
        <div className="relative flex-1 min-h-0 flex flex-col gap-1.5">
          <TableView
            rows={pageRows}
            columns={columns}
            totalRows={rows.length}
            indexOffset={pageStart}
            sortBy={sortBy}
            onSort={onSort}
            loading={loading}
            error={error}
          />
          {pageCount > 1 ? (
            <Pagination
              page={safePage}
              pageCount={pageCount}
              pageSize={PAGE_SIZE}
              total={filteredSorted.length}
              onChange={setPage}
            />
          ) : null}
          {/* Loading overlay — same .map-loader spinner used on the
              map, so a slow attribute fetch reads as "still working"
              instead of an empty table. */}
          <AnimatePresence>
            {loading ? (
              <motion.div
                key="attr-loader"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                role="status"
                aria-label="Loading attributes"
                className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 backdrop-blur-sm rounded-md pointer-events-auto"
              >
                <span className="loader" aria-hidden />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagination footer — Prev / Next + jump-to-edge controls. Only shown
// when the result-set spills past one page.
// ---------------------------------------------------------------------------

function Pagination({ page, pageCount, pageSize, total, onChange }) {
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  const go = (p) => onChange(Math.max(1, Math.min(pageCount, p)));
  const Btn = ({ onClick, disabled, label, children }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors',
        'border border-day-border dark:border-night-border',
        'text-day-muted dark:text-night-muted',
        'hover:text-[#84cc16] hover:border-[#84cc16]/60',
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-day-muted disabled:hover:border-day-border dark:disabled:hover:text-night-muted dark:disabled:hover:border-night-border',
      )}
    >
      {children}
    </button>
  );
  return (
    <div className="shrink-0 flex items-center justify-between gap-2 px-1">
      <span className="text-[11.5px] text-day-muted dark:text-night-muted tabular-nums">
        Showing {start.toLocaleString()}–{end.toLocaleString()} of{' '}
        {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-1">
        <Btn onClick={() => go(1)} disabled={page === 1} label="First page">
          <ChevronsLeft className="h-3 w-3" />
        </Btn>
        <Btn
          onClick={() => go(page - 1)}
          disabled={page === 1}
          label="Previous page"
        >
          <ChevronLeft className="h-3 w-3" />
        </Btn>
        <span className="text-[11.5px] text-day-text dark:text-night-text tabular-nums px-1.5">
          {page} / {pageCount}
        </span>
        <Btn
          onClick={() => go(page + 1)}
          disabled={page === pageCount}
          label="Next page"
        >
          <ChevronRight className="h-3 w-3" />
        </Btn>
        <Btn
          onClick={() => go(pageCount)}
          disabled={page === pageCount}
          label="Last page"
        >
          <ChevronsRight className="h-3 w-3" />
        </Btn>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-tabs — one chip per open table; click switches, X closes. Scrolls
// horizontally inside its flex-1 container so a long list of open tables
// never pushes the search input off-screen.
// ---------------------------------------------------------------------------

function SubTabs({ tables, activeId, onActivate, onClose }) {
  return (
    <div className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto pb-1">
      {tables.map((t) => {
        const isActive = t.id === activeId;
        return (
          <div
            key={t.id}
            className={cn(
              'group inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-md text-[12px] font-medium border transition-colors shrink-0',
              isActive
                ? 'bg-[#84cc16]/10 border-[#84cc16]/50 text-[#84cc16]'
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
      ? '#84cc16'
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
// Stateless table view — receives already-filtered/sorted rows and the
// active sort spec. Sticky header, empty / loading / error states inline.
// ---------------------------------------------------------------------------

function TableView({
  rows,
  columns,
  totalRows,
  indexOffset = 0,
  sortBy,
  onSort,
  loading,
  error,
}) {
  return (
    <div className="flex-1 min-h-0 overflow-auto rounded-md border border-day-border dark:border-night-border bg-white dark:bg-night-surface">
      {error ? (
        <EmptyState>
          <span className="text-red-600 dark:text-red-400">
            Failed to load attributes: {error}
          </span>
        </EmptyState>
      ) : !loading && totalRows === 0 ? (
        <EmptyState>No features found for this layer.</EmptyState>
      ) : (
        <table className="w-full text-[12px] tabular-nums border-collapse">
          <thead>
            <tr className="bg-day-bg/80 dark:bg-night-bg/80 backdrop-blur-sm sticky top-0 z-[1] shadow-[inset_0_-1px_0_0] shadow-day-border dark:shadow-night-border">
              <th className="px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-day-muted dark:text-night-muted w-10">
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
                      'px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap select-none cursor-pointer hover:text-[#84cc16]',
                      sorted
                        ? 'text-[#84cc16]'
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
            {rows.map((row, i) => (
              <tr
                key={i}
                className={cn(
                  'border-b border-day-border/60 dark:border-night-border/60',
                  'odd:bg-day-bg/30 dark:odd:bg-night-bg/30',
                  'hover:bg-[#84cc16]/10 transition-colors',
                )}
              >
                <td className="px-2 py-1 text-day-muted dark:text-night-muted">
                  {indexOffset + i + 1}
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
  );
}

function SearchInput({ value, onChange }) {
  return (
    <div className="relative w-44 sm:w-56 shrink-0">
      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-day-muted dark:text-night-muted pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search rows…"
        className={cn(
          'w-full pl-7 pr-2 py-1 rounded-md text-[12px]',
          'bg-day-bg dark:bg-night-bg',
          'border border-day-border dark:border-night-border',
          'text-day-text dark:text-night-text placeholder:text-day-muted dark:placeholder:text-night-muted',
          'focus:outline-none focus:ring-2 focus:ring-[#84cc16]/40',
        )}
      />
    </div>
  );
}

function RowCount({ count, total, loading }) {
  return (
    <span className="text-[11.5px] text-day-muted dark:text-night-muted shrink-0 whitespace-nowrap">
      {loading
        ? 'Loading…'
        : total === count
          ? `${total} row${total === 1 ? '' : 's'}`
          : `${count} of ${total}`}
    </span>
  );
}

function EmptyState({ children }) {
  return (
    <div className="h-full flex items-center justify-center text-center px-3 py-8">
      <p className="text-[12.5px] text-day-muted dark:text-night-muted">
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
        } else if (spec.kind === 'secondary') {
          // Routes through secondaryLayerUrl, which transparently picks
          // bundled GeoJSON, the local PostGIS proxy, or the live PMD GIS
          // proxy depending on the layer id.
          const url = secondaryLayerUrl(spec.layerId);
          if (!url) throw new Error('No URL for secondary layer');
          const json = await fetchGeoJson(url);
          collected = featuresToRows(json?.features);
        } else if (spec.kind === 'database') {
          // The Browse Database flow already loaded the full
          // FeatureCollection into memory — read it straight off the
          // spec instead of re-fetching.
          collected = featuresToRows(spec.data?.features);
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
// When a unit suffix is recognised (`area_km2`, `length_m`, …) the unit
// is appended in parentheses so the column heading reads "Area (km²)"
// without the cell having to repeat the unit on every row. The
// underlying row keys stay raw so sort + search continue to match
// what's actually in the GeoJSON.
function prettyHeader(key) {
  if (!key) return '';
  const { label, unit } = inferUnit(key);
  return unit ? `${label} (${unit})` : label;
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
