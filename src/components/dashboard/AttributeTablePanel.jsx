import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Database, FileJson, Inbox } from 'lucide-react';
import Badge from '@/components/ui/Badge';
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

function FilePicker({ uploads, selectedId, onSelect }) {
  if (uploads.length <= 1) return null;
  return (
    <div className="shrink-0 mb-2">
      <div className="text-[10px] uppercase tracking-wide text-day-muted dark:text-night-muted mb-1 px-0.5">
        File
      </div>
      <div className="flex flex-wrap gap-1">
        {uploads.map((u) => (
          <button
            key={u.id}
            type="button"
            onClick={() => onSelect(u.id)}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors',
              selectedId === u.id
                ? 'bg-[#16a085] text-white'
                : 'bg-day-bg dark:bg-night-bg text-day-text dark:text-night-text hover:bg-day-surface dark:hover:bg-night-surface',
            )}
            title={u.label}
          >
            <FileJson className="h-3 w-3 shrink-0" />
            <span className="truncate max-w-[140px]">{u.label}</span>
          </button>
        ))}
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

  const selected = uploads.find((u) => u.id === selectedId) ?? null;
  const features = useMemo(() => extractFeatures(selected), [selected]);
  const columns = useMemo(() => buildColumns(features), [features]);
  const visibleRows = features.slice(0, MAX_ROWS);

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
          {features.length} {features.length === 1 ? 'feature' : 'features'}
        </Badge>
      </div>

      {/* Table — borderless, zebra-striped */}
      {features.length === 0 || columns.length === 0 ? (
        <div className="flex-1 min-h-0 flex items-center justify-center text-[12px] text-day-muted dark:text-night-muted px-6 text-center">
          {features.length === 0
            ? 'This file has no features.'
            : 'No attribute properties on these features.'}
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
                {columns.map(({ key, numeric }) => (
                  <th
                    key={key}
                    scope="col"
                    className={cn(
                      'px-2.5 py-2 font-semibold uppercase tracking-wide text-[10px] whitespace-nowrap text-day-muted dark:text-night-muted',
                      numeric ? 'text-right' : 'text-left',
                    )}
                  >
                    {key}
                  </th>
                ))}
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
                      // Zebra striping via background only — no borders.
                      i % 2 === 1 && 'bg-day-surface/40 dark:bg-night-surface/30',
                      'hover:bg-[#16a085]/10 dark:hover:bg-[#16a085]/15',
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

      {features.length > MAX_ROWS && (
        <div className="shrink-0 mt-1 px-0.5 text-[10px] text-day-muted dark:text-night-muted text-right">
          Showing {MAX_ROWS.toLocaleString()} of {features.length.toLocaleString()} rows
        </div>
      )}

      {/* Import button — logic to be wired up later */}
      <div className="shrink-0 mt-3 pt-2 border-t border-day-border dark:border-night-border">
        <button
          type="button"
          disabled={!selected || features.length === 0}
          onClick={() => {
            // TODO: wire the upload through to the backend ingest endpoint.
            // Logic deferred per spec.
            // eslint-disable-next-line no-console
            console.log('[attributes] Import to Database clicked', selected?.label);
          }}
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
    </div>
  );
}
