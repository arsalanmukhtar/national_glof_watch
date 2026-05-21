import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CircleDot,
  Database,
  Layers as LayersIcon,
  Loader2,
  Search,
  Slash,
  Square,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { useSecondary } from '@/contexts/SecondaryContext';
import { cn } from '@/utils/cn';

// Compose the dbLayer id used by SecondaryContext / MapPanel — needs to be
// unique across schemas so two tables with the same name in different
// schemas don't collide.
function dbLayerIdFor(schema, table) {
  return `db:${schema}.${table}`;
}

function GeomGlyph({ bucket }) {
  const Icon =
    bucket === 'point' ? CircleDot
    : bucket === 'line' ? Slash
    : Square;
  return <Icon className="h-3 w-3 text-[#84cc16]" aria-hidden />;
}

function fmtCount(n) {
  if (n == null) return '—';
  return n.toLocaleString();
}

export default function BrowseDatabaseModal({ open, onClose }) {
  const { dbLayers, addDbLayers } = useSecondary();

  const [schemas, setSchemas] = useState([]);
  const [activeSchema, setActiveSchema] = useState(null);
  const [tables, setTables] = useState([]);
  const [filter, setFilter] = useState('');

  const [selected, setSelected] = useState(() => new Set());

  const [loadingSchemas, setLoadingSchemas] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  // Schema list — fetched once each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSelected(new Set());
    setLoadingSchemas(true);
    fetch('/api/db/schemas')
      .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(j))))
      .then((d) => {
        const list = d.schemas ?? [];
        setSchemas(list);
        if (list.length && !list.find((s) => s.schema === activeSchema)) {
          setActiveSchema(list[0].schema);
        } else if (!list.length) {
          setActiveSchema(null);
        }
      })
      .catch((e) => setError(e?.error ?? e?.message ?? 'Failed to list schemas'))
      .finally(() => setLoadingSchemas(false));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tables list — refetched whenever the active schema changes.
  useEffect(() => {
    if (!open || !activeSchema) {
      setTables([]);
      return;
    }
    setLoadingTables(true);
    fetch(`/api/db/schemas/${encodeURIComponent(activeSchema)}/tables`)
      .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(j))))
      .then((d) => setTables(d.tables ?? []))
      .catch((e) => setError(e?.error ?? e?.message ?? 'Failed to list tables'))
      .finally(() => setLoadingTables(false));
  }, [open, activeSchema]);

  const filteredTables = useMemo(() => {
    if (!filter.trim()) return tables;
    const q = filter.toLowerCase();
    return tables.filter((t) => t.table.toLowerCase().includes(q));
  }, [tables, filter]);

  const loadedIds = useMemo(
    () => new Set(dbLayers.map((l) => l.id)),
    [dbLayers],
  );

  const toggleTable = (schema, t) => {
    const id = dbLayerIdFor(schema, t.table);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleLoad = async () => {
    const list = [...selected];
    if (!list.length) return;
    setBusy(true);
    setError(null);
    setProgress({ done: 0, total: list.length });

    const results = [];
    for (const id of list) {
      // id format: db:<schema>.<table>
      const stripped = id.startsWith('db:') ? id.slice(3) : id;
      const dot = stripped.indexOf('.');
      if (dot < 0) continue;
      const schema = stripped.slice(0, dot);
      const table = stripped.slice(dot + 1);
      try {
        const r = await fetch(
          `/api/db/table/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`,
        );
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j?.error || `${schema}.${table}: HTTP ${r.status}`);
        }
        const fc = await r.json();
        // Prefer the metadata bucket from the table list, then refine from
        // the actual feature geometry if needed.
        const meta = tables.find((t) => t.table === table);
        const bucket =
          meta?.bucket ||
          (() => {
            const t = fc?.features?.[0]?.geometry?.type || '';
            if (t.includes('Point')) return 'point';
            if (t.includes('LineString')) return 'line';
            return 'polygon';
          })();
        results.push({
          id,
          label: `${schema}.${table}`,
          schema,
          table,
          geometry: bucket,
          data: fc,
          kind: 'db',
        });
        setProgress((p) => ({ done: p.done + 1, total: p.total }));
      } catch (err) {
        setError(err?.message ?? 'Load failed');
        // Stop on first failure — partial loads are confusing.
        setBusy(false);
        return;
      }
    }

    if (results.length) addDbLayers(results);
    setBusy(false);
    setSelected(new Set());
    onClose?.();
  };

  const selectionCount = selected.size;

  const footer = (
    <div className="flex items-center gap-2">
      <span className="text-[12px] text-day-muted dark:text-night-muted">
        {selectionCount === 0
          ? 'No tables selected'
          : `${selectionCount} table${selectionCount === 1 ? '' : 's'} selected`}
      </span>
      <button
        type="button"
        onClick={onClose}
        disabled={busy}
        className="btn-light btn-md ml-auto"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={handleLoad}
        disabled={busy || selectionCount === 0}
        className="btn-primary btn-md inline-flex items-center gap-1.5"
      >
        <Database className="h-3.5 w-3.5" />
        Load{' '}
        {selectionCount > 0
          ? `${selectionCount} layer${selectionCount === 1 ? '' : 's'}`
          : 'layers'}
      </button>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Browse Database"
      size="xl"
      footer={footer}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-2 text-[13px] text-day-muted dark:text-night-muted">
          <Database className="h-4 w-4 shrink-0 mt-0.5 text-[#84cc16]" />
          <span>
            Pick one or more spatial tables from the connected PostGIS
            database to load as map layers. Only point, line, and polygon
            geometries are supported.
          </span>
        </div>

        {/* Two-pane layout — schemas left, tables right */}
        <div className="grid grid-cols-[180px_1fr] gap-2 min-h-[320px] max-h-[55vh]">
          {/* Schemas */}
          <div className="rounded-md border border-day-border dark:border-night-border bg-day-bg/40 dark:bg-night-bg/40 flex flex-col min-h-0">
            <div className="px-2.5 py-1.5 border-b border-day-border/60 dark:border-night-border/60 text-[11px] font-semibold uppercase tracking-[0.08em] text-day-muted dark:text-night-muted">
              Schemas
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-1">
              {loadingSchemas ? (
                <div className="flex items-center gap-1.5 px-2 py-3 text-[12px] text-day-muted dark:text-night-muted">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                </div>
              ) : schemas.length === 0 ? (
                <div className="px-2 py-3 text-[12px] text-day-muted dark:text-night-muted">
                  No spatial schemas found.
                </div>
              ) : (
                schemas.map((s) => {
                  const on = s.schema === activeSchema;
                  return (
                    <button
                      key={s.schema}
                      type="button"
                      onClick={() => setActiveSchema(s.schema)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] transition-colors',
                        on
                          ? 'bg-[#84cc16]/15 text-day-text dark:text-night-text'
                          : 'hover:bg-day-bg dark:hover:bg-night-bg text-day-text dark:text-night-text',
                      )}
                    >
                      <LayersIcon
                        className={cn(
                          'h-3.5 w-3.5 shrink-0',
                          on
                            ? 'text-[#84cc16]'
                            : 'text-day-muted dark:text-night-muted',
                        )}
                      />
                      <span className="flex-1 truncate">{s.schema}</span>
                      <span className="text-[11px] tabular-nums text-day-muted dark:text-night-muted">
                        {s.table_count}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Tables */}
          <div className="rounded-md border border-day-border dark:border-night-border bg-day-bg/40 dark:bg-night-bg/40 flex flex-col min-h-0">
            <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-day-border/60 dark:border-night-border/60">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-day-muted dark:text-night-muted">
                Tables in {activeSchema || '—'}
              </span>
              <div className="ml-auto flex items-center gap-1.5 rounded border border-day-border dark:border-night-border bg-white dark:bg-night-bg px-2 py-0.5">
                <Search className="h-3 w-3 text-day-muted dark:text-night-muted" />
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter…"
                  className="bg-transparent text-[12px] focus:outline-none w-24"
                />
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-1">
              {loadingTables ? (
                <div className="flex items-center gap-1.5 px-2 py-3 text-[12px] text-day-muted dark:text-night-muted">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading tables…
                </div>
              ) : filteredTables.length === 0 ? (
                <div className="px-2 py-3 text-[12px] text-day-muted dark:text-night-muted">
                  {tables.length === 0
                    ? 'No spatial tables in this schema.'
                    : 'No tables match the filter.'}
                </div>
              ) : (
                filteredTables.map((t) => {
                  const id = dbLayerIdFor(activeSchema, t.table);
                  const isSelected = selected.has(id);
                  const isLoaded = loadedIds.has(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => !isLoaded && toggleTable(activeSchema, t)}
                      disabled={isLoaded}
                      className={cn(
                        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors',
                        isLoaded
                          ? 'opacity-50 cursor-not-allowed'
                          : isSelected
                            ? 'bg-[#84cc16]/15'
                            : 'hover:bg-day-bg dark:hover:bg-night-bg',
                      )}
                    >
                      <span
                        className={cn(
                          'inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border transition-colors',
                          isLoaded
                            ? 'bg-[#84cc16] border-[#84cc16]'
                            : isSelected
                              ? 'bg-[#84cc16] border-[#84cc16]'
                              : 'border-day-border dark:border-night-border',
                        )}
                      >
                        {(isSelected || isLoaded) && (
                          <CheckCircle2 className="h-3 w-3 text-[#1a2e05]" strokeWidth={3} />
                        )}
                      </span>
                      <span className="flex-1 min-w-0 truncate text-[13px] text-day-text dark:text-night-text">
                        {t.table}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] capitalize text-day-muted dark:text-night-muted">
                        <GeomGlyph bucket={t.bucket} />
                        {t.bucket}
                      </span>
                      <span className="w-16 text-right text-[11px] tabular-nums text-day-muted dark:text-night-muted">
                        {fmtCount(t.count)}
                      </span>
                      {isLoaded && (
                        <span className="text-[10px] uppercase tracking-wider text-[#84cc16]">
                          loaded
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Error / progress + footer actions */}
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-red-300/60 bg-red-50 dark:bg-red-900/20 px-2.5 py-1.5"
          >
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-red-600 dark:text-red-300" />
            <span className="text-[12px] leading-snug text-red-800 dark:text-red-200">
              {error}
            </span>
          </div>
        )}

        {busy && (
          <div className="flex items-center gap-2 text-[12px] text-day-muted dark:text-night-muted">
            <Loader2 className="h-3 w-3 animate-spin text-[#84cc16]" />
            Loading {progress.done} / {progress.total}…
          </div>
        )}
      </div>
    </Modal>
  );
}
