import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, CheckCircle2, Database, Loader2 } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { cn } from '@/utils/cn';

// Common projections shown first; everything else can be typed via the
// "Custom EPSG…" option. WGS84 is the GeoJSON default per RFC 7946 so we
// preselect it.
const COMMON_CRS = [
  { code: 4326, label: 'WGS 84 (EPSG:4326)' },
  { code: 3857, label: 'Web Mercator (EPSG:3857)' },
  { code: 32642, label: 'UTM Zone 42N (EPSG:32642)' },
  { code: 32643, label: 'UTM Zone 43N (EPSG:32643)' },
];

// Postgres-side types the backend will accept. Keep this list short so
// the dropdown stays approachable; jsonb is the escape hatch for nested
// values and arrays.
const COLUMN_TYPES = [
  { value: 'text',             label: 'text' },
  { value: 'integer',          label: 'integer' },
  { value: 'double precision', label: 'double' },
  { value: 'boolean',          label: 'boolean' },
  { value: 'date',             label: 'date' },
  { value: 'timestamp',        label: 'timestamp' },
  { value: 'jsonb',            label: 'jsonb' },
];

// Convert a JS value's runtime type into one of the dropdown options.
// Used to pre-fill the type column from a sample of feature properties.
function inferType(v) {
  if (v == null) return 'text';
  if (typeof v === 'number') {
    return Number.isInteger(v) ? 'integer' : 'double precision';
  }
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'object') return 'jsonb';
  // Cheap date heuristic — ISO 8601-ish strings get 'timestamp'.
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return 'timestamp';
  return 'text';
}

// Sanitize a string into a valid Postgres identifier (lowercase, snake
// case, leading-digit safe). The backend re-validates so this is a UX
// nicety only — a wrong value won't reach the DB unsanitized.
function toIdent(s) {
  const cleaned = String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  if (!cleaned) return '';
  return /^\d/.test(cleaned) ? `_${cleaned}` : cleaned;
}

function defaultTableName(label) {
  // Strip extension and sanitize. "Union_Council_Boundary.zip" → "union_council_boundary"
  return toIdent(label?.replace(/\.[^.]+$/, '') ?? '');
}

function buildInitialColumns(features) {
  // Walk a sample of features (cap at 50) to build a stable column
  // catalog with type inference. First-seen order wins so the user's
  // mental model from the attribute table is preserved.
  const order = [];
  const seen = new Set();
  const samples = new Map();
  const sample = features.slice(0, 50);
  for (const feat of sample) {
    const props = feat?.properties ?? {};
    for (const key of Object.keys(props)) {
      if (!seen.has(key)) {
        seen.add(key);
        order.push(key);
      }
      // First non-null value per column drives the inferred type.
      if (props[key] != null && !samples.has(key)) {
        samples.set(key, props[key]);
      }
    }
  }
  return order.map((source) => ({
    source,
    target: toIdent(source),
    type: inferType(samples.get(source)),
    include: true,
  }));
}

// Stream the SSE-style chunked response from the backend, calling
// `onEvent` for each `data: {...}\n\n` block. Buffers partial lines so
// a chunk that splits mid-event still parses correctly.
async function streamImport(payload, onEvent) {
  const res = await fetch('/api/upload/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Server returned ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 2);
      for (const line of block.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            onEvent(JSON.parse(line.slice(6)));
          } catch {
            /* malformed line — skip */
          }
        }
      }
    }
  }
}

export default function ImportToDatabaseModal({ open, onClose, upload }) {
  const features = useMemo(() => {
    const data = upload?.data;
    if (!data) return [];
    if (data.type === 'FeatureCollection') return Array.isArray(data.features) ? data.features : [];
    if (data.type === 'Feature') return [data];
    return [];
  }, [upload]);

  const [schema, setSchema] = useState('public');
  const [table, setTable] = useState('');
  const [crs, setCrs] = useState(4326);
  const [columns, setColumns] = useState([]);

  // 'idle' | 'running' | 'done' | 'error'
  const [phase, setPhase] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [insertedCount, setInsertedCount] = useState(0);
  const [error, setError] = useState(null);

  // Re-seed every time the modal is opened with a fresh upload so we
  // don't keep stale state from a previous file.
  useEffect(() => {
    if (!open) return;
    setSchema('public');
    setTable(defaultTableName(upload?.label));
    setCrs(4326);
    setColumns(buildInitialColumns(features));
    setPhase('idle');
    setProgress(0);
    setInsertedCount(0);
    setError(null);
  }, [open, upload, features]);

  const includedCount = columns.filter((c) => c.include).length;
  const canSubmit =
    phase !== 'running' &&
    schema.trim() &&
    table.trim() &&
    Number.isFinite(Number(crs)) &&
    features.length > 0;

  const updateColumn = (idx, patch) => {
    setColumns((cur) => cur.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };

  const handleImport = async () => {
    setPhase('running');
    setProgress(0);
    setInsertedCount(0);
    setError(null);
    try {
      await streamImport(
        {
          schema: toIdent(schema),
          table: toIdent(table),
          crs: Number(crs),
          columns: columns
            .filter((c) => c.include)
            .map(({ source, target, type }) => ({
              source,
              target: toIdent(target) || toIdent(source),
              type,
            })),
          geojson: { type: 'FeatureCollection', features },
        },
        (evt) => {
          if (typeof evt.progress === 'number') setProgress(evt.progress);
          if (typeof evt.inserted === 'number') setInsertedCount(evt.inserted);
          if (evt.error) {
            setError(evt.error);
            setPhase('error');
          }
          if (evt.done) {
            setProgress(1);
            setPhase('done');
          }
        },
      );
      // Server may close the stream without an explicit `done` (e.g. when
      // it errored late). Promote to a final state if we're still running.
      setPhase((p) => (p === 'running' ? 'done' : p));
    } catch (err) {
      setError(err.message ?? String(err));
      setPhase('error');
    }
  };

  return (
    <Modal
      open={open}
      onClose={phase === 'running' ? () => {} : onClose}
      title="Import to Database"
      size="xl"
    >
      {/* File summary */}
      <div className="flex items-center gap-2 mb-3 text-[12px] text-day-muted dark:text-night-muted">
        <Database className="h-3.5 w-3.5 text-brand-700 dark:text-brand-200" />
        <span className="truncate">
          <span className="font-medium text-day-text dark:text-night-text">
            {upload?.label ?? '—'}
          </span>
          <span className="ml-2">
            {features.length.toLocaleString()} features · {columns.length} columns
          </span>
        </span>
      </div>

      {/* Target form */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Field label="Schema">
          <input
            type="text"
            value={schema}
            onChange={(e) => setSchema(e.target.value)}
            disabled={phase === 'running'}
            className="input-base w-full"
            placeholder="public"
          />
        </Field>
        <Field label="Table">
          <input
            type="text"
            value={table}
            onChange={(e) => setTable(e.target.value)}
            disabled={phase === 'running'}
            className="input-base w-full"
            placeholder="my_table"
          />
        </Field>
        <Field label="Source CRS">
          <select
            value={crs}
            onChange={(e) => setCrs(Number(e.target.value))}
            disabled={phase === 'running'}
            className="select-base w-full"
          >
            {COMMON_CRS.map(({ code, label }) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
        </Field>
      </div>

      {/* Attribute mapping */}
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-day-muted dark:text-night-muted">
          Attributes
        </span>
        <span className="text-[10px] text-day-muted dark:text-night-muted">
          {includedCount} of {columns.length} included
        </span>
      </div>
      <div className="rounded-md border border-day-border dark:border-night-border max-h-[260px] overflow-auto mb-4">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 z-10 bg-day-surface dark:bg-night-surface">
            <tr className="text-left text-[10px] uppercase tracking-wide text-day-muted dark:text-night-muted">
              <th className="w-8 px-2 py-1.5 text-center">On</th>
              <th className="px-2 py-1.5">Source</th>
              <th className="px-2 py-1.5">Target</th>
              <th className="px-2 py-1.5 w-32">Type</th>
            </tr>
          </thead>
          <tbody>
            {columns.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-day-muted dark:text-night-muted">
                  No attribute columns detected.
                </td>
              </tr>
            ) : (
              columns.map((col, idx) => (
                <tr
                  key={col.source}
                  className={cn(
                    'border-t border-day-border dark:border-night-border',
                    !col.include && 'opacity-50',
                  )}
                >
                  <td className="px-2 py-1 text-center">
                    <input
                      type="checkbox"
                      checked={col.include}
                      onChange={(e) => updateColumn(idx, { include: e.target.checked })}
                      disabled={phase === 'running'}
                      aria-label={`Include ${col.source}`}
                      className="h-3.5 w-3.5 accent-[#16a085] cursor-pointer"
                    />
                  </td>
                  <td className="px-2 py-1 font-mono text-[11px] text-day-text dark:text-night-text truncate max-w-[160px]" title={col.source}>
                    {col.source}
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="text"
                      value={col.target}
                      onChange={(e) => updateColumn(idx, { target: e.target.value })}
                      disabled={!col.include || phase === 'running'}
                      className="input-base w-full text-[12px] py-1 font-mono"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <select
                      value={col.type}
                      onChange={(e) => updateColumn(idx, { type: e.target.value })}
                      disabled={!col.include || phase === 'running'}
                      className="select-base w-full text-[12px] py-1"
                    >
                      {COLUMN_TYPES.map(({ value, label }) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Progress / status */}
      {phase !== 'idle' ? (
        <div className="mb-4">
          <div className="flex items-center justify-between text-[11px] mb-1">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 font-medium',
                phase === 'error'
                  ? 'text-red-600 dark:text-red-400'
                  : phase === 'done'
                    ? 'text-[#16a085]'
                    : 'text-day-text dark:text-night-text',
              )}
            >
              {phase === 'running' && <Loader2 className="h-3 w-3 animate-spin" />}
              {phase === 'done' && <CheckCircle2 className="h-3 w-3" />}
              {phase === 'error' && <AlertCircle className="h-3 w-3" />}
              {phase === 'running' && `Inserting features… ${insertedCount.toLocaleString()} / ${features.length.toLocaleString()}`}
              {phase === 'done' && `Imported ${insertedCount.toLocaleString()} features into ${schema}.${table}`}
              {phase === 'error' && `Import failed: ${error}`}
            </span>
            <span className="tabular-nums text-day-muted dark:text-night-muted">
              {Math.round(progress * 100)}%
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-day-border/60 dark:bg-night-border/60">
            <motion.div
              className={cn(
                'h-full rounded-full',
                phase === 'error' ? 'bg-red-500' : 'bg-[#16a085]',
              )}
              animate={{ width: `${Math.max(progress * 100, phase === 'running' ? 4 : 0)}%` }}
              transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            />
          </div>
        </div>
      ) : null}

      {/* Footer actions */}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={phase === 'running'}
          className="btn-base btn-md btn-ghost disabled:opacity-50"
        >
          {phase === 'done' ? 'Close' : 'Cancel'}
        </button>
        <button
          type="button"
          onClick={handleImport}
          disabled={!canSubmit || phase === 'done'}
          className={cn(
            'btn-base btn-md',
            'bg-[#16a085] text-white hover:bg-[#138b72]',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {phase === 'running' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Database className="h-4 w-4" />
          )}
          <span>{phase === 'running' ? 'Importing…' : phase === 'error' ? 'Retry' : 'Import'}</span>
        </button>
      </div>
    </Modal>
  );
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-day-muted dark:text-night-muted">
        {label}
      </span>
      {children}
    </label>
  );
}
