import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Database,
  FileArchive,
  FileJson,
  Inbox,
} from 'lucide-react';
import Badge from '@/components/ui/Badge';
import SearchBox from '@/components/ui/SearchBox';
import ImportToDatabaseModal from '@/components/dashboard/ImportToDatabaseModal';
import { cn } from '@/utils/cn';
import { useSecondary } from '@/contexts/SecondaryContext';

// Cap rendered rows so a 100k-feature upload doesn't lock the panel.
// "Showing N of M" copy below the table makes the truncation explicit.
const MAX_ROWS = 500;

function formatValue(v) {
  if (v == null) return '—';
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  if (typeof v === 'number') {
    return Number.isInteger(v) ? v.toLocaleString() : Number(v.toFixed(6)).toString();
  }
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function isNumeric(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function extractFeatures(upload) {
  const data = upload?.data;
  if (!data) return [];
  if (data.type === 'FeatureCollection') return Array.isArray(data.features) ? data.features : [];
  if (data.type === 'Feature') return [data];
  return [];
}

function buildColumns(features) {
  // Stable column order: first-seen wins. Numeric-vs-text decided by majority
  // of non-null values per column (used to right-align number columns).
  const order = [];
  const seen = new Set();
  const numericTally = new Map();
  for (const feat of features) {
    const props = feat?.properties ?? {};
    for (const key of Object.keys(props)) {
      if (!seen.has(key)) {
        seen.add(key);
        order.push(key);
        numericTally.set(key, { num: 0, total: 0 });
      }
      const tally = numericTally.get(key);
      const v = props[key];
      if (v != null) {
        tally.total += 1;
        if (isNumeric(v)) tally.num += 1;
      }
    }
  }
  return order.map((key) => {
    const t = numericTally.get(key);
    const numeric = t && t.total > 0 && t.num / t.total >= 0.7;
    return { key, numeric };
  });
}

// Horizontal slider used to switch which uploaded file's attributes are
// shown. Each pill snaps to the left edge; the selected pill takes the
// accent color. Only renders when there's more than one upload to choose
// between (no need to slide a single file).
function FilePicker({ uploads, selectedId, onSelect }) {
  if (uploads.length <= 1) return null;
  return (
    <div className="shrink-0 mb-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-day-muted dark:text-night-muted mb-1 px-0.5">
        File
      </div>
      <div className="-mx-3 px-3 overflow-x-auto pb-1 snap-x snap-mandatory">
        <div className="flex gap-1.5 w-max">
          {uploads.map((u) => {
            const isSelected = selectedId === u.id;
            const Icon = u.kind === 'shapefile' ? FileArchive : FileJson;
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => onSelect(u.id)}
                aria-pressed={isSelected}
                title={u.label}
                className={cn(
                  'shrink-0 w-[180px] snap-start inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium border transition-colors',
                  isSelected
                    ? 'bg-[#16a085] text-white border-[#16a085] shadow-sm'
                    : 'bg-slate-100 dark:bg-night-bg text-day-text dark:text-night-text border-day-border dark:border-night-border hover:border-[#16a085]/60',
                )}
              >
                <Icon
                  className={cn(
                    'h-3.5 w-3.5 shrink-0',
                    isSelected ? 'text-white' : 'text-brand-700 dark:text-brand-200',
                  )}
                />
                <span className="flex-1 truncate text-left">{u.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-2 text-center px-6 py-10">
      <Inbox className="h-8 w-8 text-day-muted/60 dark:text-night-muted/60" />
      <div className="text-sm font-medium text-day-text dark:text-night-text">
        No uploads yet
      </div>
      <div className="text-[12px] text-day-muted dark:text-night-muted">
        Drop a GeoJSON or zipped shapefile in the Secondary panel.
        Its attributes will appear here.
      </div>
    </div>
  );
}

export default function AttributeTablePanel() {
  const { uploads } = useSecondary();
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState({ key: null, dir: null }); // dir: 'asc' | 'desc' | null
  const [importOpen, setImportOpen] = useState(false);

  // Auto-select the latest upload, and follow new arrivals; fall back if
  // the selected file is removed while open.
  useEffect(() => {
    if (uploads.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    const stillThere = uploads.some((u) => u.id === selectedId);
    if (!stillThere) {
      setSelectedId(uploads[uploads.length - 1].id);
    }
  }, [uploads, selectedId]);

  // Reset filter + sort when the selected file changes — column set and
  // value space differ between files, so prior state is meaningless.
  useEffect(() => {
    setQuery('');
    setSort({ key: null, dir: null });
  }, [selectedId]);

  const selected = uploads.find((u) => u.id === selectedId) ?? null;
  const features = useMemo(() => extractFeatures(selected), [selected]);
  const columns = useMemo(() => buildColumns(features), [features]);

  // Filter: case-insensitive substring match against any column value.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return features;
    return features.filter((feat) => {
      const props = feat?.properties ?? {};
      for (const { key } of columns) {
        const v = props[key];
        if (v == null) continue;
        if (String(v).toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }, [features, columns, query]);

  // Sort: number columns numerically, others lexicographically; nulls last.
  const sorted = useMemo(() => {
    if (!sort.key || !sort.dir) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return filtered;
    const dirMul = sort.dir === 'asc' ? 1 : -1;
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = a?.properties?.[sort.key];
      const bv = b?.properties?.[sort.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (col.numeric) {
        const an = Number(av);
        const bn = Number(bv);
        if (!Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * dirMul;
      }
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dirMul;
    });
    return arr;
  }, [filtered, sort, columns]);

  const visibleRows = sorted.slice(0, MAX_ROWS);

  const cycleSort = (key) => {
    setSort((cur) => {
      if (cur.key !== key) return { key, dir: 'asc' };
      if (cur.dir === 'asc') return { key, dir: 'desc' };
      return { key: null, dir: null };
    });
  };

  if (uploads.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <FilePicker uploads={uploads} selectedId={selectedId} onSelect={setSelectedId} />

      {/* File summary */}
      <div className="shrink-0 mb-2 flex items-center gap-2 px-0.5">
        <FileJson className="h-3.5 w-3.5 text-brand-700 dark:text-brand-200 shrink-0" />
        <span
          className="text-[13px] font-medium text-day-text dark:text-night-text truncate"
          title={selected?.label}
        >
          {selected?.label ?? '—'}
        </span>
        <Badge tone="brand" className="ml-auto whitespace-nowrap">
          {query
            ? `${sorted.length} / ${features.length}`
            : `${features.length} ${features.length === 1 ? 'feature' : 'features'}`}
        </Badge>
      </div>

      {/* Search filter */}
      {features.length > 0 && (
        <div className="shrink-0 mb-2">
          <SearchBox
            placeholder="Filter attributes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      {/* Table — borderless, zebra-striped, sortable headers */}
      {features.length === 0 || columns.length === 0 ? (
        <div className="flex-1 min-h-0 flex items-center justify-center text-[12px] text-day-muted dark:text-night-muted px-6 text-center">
          {features.length === 0
            ? 'This file has no features.'
            : 'No attribute properties on these features.'}
        </div>
      ) : sorted.length === 0 ? (
        <div className="flex-1 min-h-0 flex items-center justify-center text-[12px] text-day-muted dark:text-night-muted px-6 text-center">
          No rows match “{query}”.
        </div>
      ) : (
        <motion.div
          key={selected?.id}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className="flex-1 min-h-0 overflow-auto rounded-md bg-day-bg/60 dark:bg-night-bg/60"
        >
          <table className="w-full text-[12px] tabular-nums">
            <thead className="sticky top-0 z-10 bg-day-surface/95 dark:bg-night-surface/95 backdrop-blur supports-[backdrop-filter]:bg-day-surface/80 dark:supports-[backdrop-filter]:bg-night-surface/80">
              <tr>
                {columns.map(({ key, numeric }) => {
                  const isSorted = sort.key === key;
                  const SortIcon =
                    isSorted && sort.dir === 'asc'  ? ArrowUp
                    : isSorted && sort.dir === 'desc' ? ArrowDown
                    : ArrowUpDown;
                  return (
                    <th
                      key={key}
                      scope="col"
                      aria-sort={
                        isSorted
                          ? sort.dir === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                      className={cn(
                        'group p-0 font-semibold uppercase tracking-wide text-[10px] whitespace-nowrap',
                        numeric ? 'text-right' : 'text-left',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => cycleSort(key)}
                        className={cn(
                          'inline-flex items-center gap-1 px-2.5 py-2 w-full transition-colors',
                          numeric ? 'justify-end flex-row-reverse' : 'justify-start',
                          isSorted
                            ? 'text-[#16a085]'
                            : 'text-day-muted dark:text-night-muted hover:text-day-text dark:hover:text-night-text',
                        )}
                      >
                        <SortIcon
                          className={cn(
                            'h-3 w-3 shrink-0 transition-opacity',
                            isSorted
                              ? 'opacity-100'
                              : 'opacity-40 group-hover:opacity-70',
                          )}
                          aria-hidden
                        />
                        <span className="truncate">{key}</span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((feat, i) => {
                const props = feat?.properties ?? {};
                return (
                  <tr
                    key={i}
                    className={cn(
                      'transition-colors',
                      // Distinct zebra: solid slate-100 in day mode, slate-800
                      // at 60% in night. Hover override (#16a085/15) wins.
                      i % 2 === 1
                        ? 'bg-slate-100 dark:bg-slate-800/60'
                        : 'bg-transparent',
                      'hover:bg-[#16a085]/15 dark:hover:bg-[#16a085]/20',
                    )}
                  >
                    {columns.map(({ key, numeric }) => {
                      const v = props[key];
                      const display = formatValue(v);
                      return (
                        <td
                          key={key}
                          className={cn(
                            'px-2.5 py-1.5 whitespace-nowrap text-day-text dark:text-night-text max-w-[220px] truncate',
                            numeric ? 'text-right tabular-nums' : 'text-left',
                            v == null && 'text-day-muted dark:text-night-muted',
                          )}
                          title={display}
                        >
                          {display}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </motion.div>
      )}

      {sorted.length > MAX_ROWS && (
        <div className="shrink-0 mt-1 px-0.5 text-[10px] text-day-muted dark:text-night-muted text-right">
          Showing {MAX_ROWS.toLocaleString()} of {sorted.length.toLocaleString()} rows
        </div>
      )}

      {/* Import button — opens the configure-and-push modal */}
      <div className="shrink-0 mt-3 pt-2 border-t border-day-border dark:border-night-border">
        <button
          type="button"
          disabled={!selected || features.length === 0}
          onClick={() => setImportOpen(true)}
          className={cn(
            'btn-base btn-md w-full',
            'bg-[#16a085] text-white hover:bg-[#138b72]',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <Database className="h-4 w-4" />
          <span>Import to Database</span>
        </button>
      </div>

      <ImportToDatabaseModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        upload={selected}
      />
    </div>
  );
}
