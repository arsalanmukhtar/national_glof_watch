import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Eye,
  EyeClosed,
  Loader2,
  Server,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { useSecondary } from '@/contexts/SecondaryContext';
import { useMapView } from '@/contexts/MapContext';
import { cn } from '@/utils/cn';

// Sanitize a potential identifier — same rule the backend re-applies.
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

// Same SSE-style stream parser used by the file-import flow. Calls
// `onEvent` once per `data: {...}\n\n` block coming off the wire.
async function streamFromDb(payload, onEvent) {
  const res = await fetch('/api/upload/from-db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok || !res.body) {
    let text = '';
    try {
      const json = await res.json();
      text = json?.error ?? '';
    } catch {
      text = await res.text().catch(() => '');
    }
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
            /* malformed — skip */
          }
        }
      }
    }
  }
}

const INITIAL_FORM = {
  host: 'localhost',
  port: '5432',
  database: '',
  user: 'postgres',
  password: '',
  ssl: false,
  sourceSchema: 'public',
  sourceTable: '',
  targetSchema: 'public',
  targetTable: '',
};

export default function ConnectDatabaseModal({ open, onClose }) {
  const { addDbLayers } = useSecondary();
  const { zoomToGeoJson, trackPromise } = useMapView();
  // 'import'    → write the remote table into the local PostGIS DB
  // 'visualize' → fetch the FeatureCollection and add it as an in-memory
  //                dbLayer (same path as Browse Database) without
  //                writing anything to the local DB.
  const [mode, setMode] = useState('import');
  const [form, setForm] = useState(INITIAL_FORM);
  const [showPassword, setShowPassword] = useState(false);
  const [phase, setPhase] = useState('idle'); // 'idle' | 'running' | 'done' | 'error'
  const [progress, setProgress] = useState(0);
  const [insertedCount, setInsertedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [stage, setStage] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  // Re-seed every time the modal opens so a previous failure doesn't
  // leave stale credentials sitting in the form.
  useEffect(() => {
    if (!open) return;
    setMode('import');
    setForm(INITIAL_FORM);
    setShowPassword(false);
    setPhase('idle');
    setProgress(0);
    setInsertedCount(0);
    setTotalCount(0);
    setStage(null);
    setError(null);
    setResult(null);
  }, [open]);

  const update = (k, v) => setForm((cur) => ({ ...cur, [k]: v }));

  const canSubmit =
    phase !== 'running' &&
    form.host.trim() &&
    form.database.trim() &&
    form.user.trim() &&
    form.sourceTable.trim() &&
    (mode === 'visualize' ||
      (form.targetSchema.trim() && form.targetTable.trim()));

  const handleSubmit = async () => {
    setPhase('running');
    setProgress(0);
    setInsertedCount(0);
    setTotalCount(0);
    setStage('connecting');
    setError(null);
    setResult(null);

    const sourcePayload = {
      host: form.host.trim(),
      port: Number(form.port) || 5432,
      database: form.database.trim(),
      user: form.user.trim(),
      password: form.password,
      ssl: form.ssl,
      schema: toIdent(form.sourceSchema) || 'public',
      table: toIdent(form.sourceTable),
    };

    if (mode === 'visualize') {
      // One-shot fetch — no streaming, no progress bar in the modal,
      // but the wrapping `trackPromise` lights up the map's existing
      // loading overlay so the user has a clear visual cue while a
      // large remote table is being assembled and transferred.
      try {
        const reqPromise = (async () => {
          const r = await fetch('/api/upload/peek-db', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: sourcePayload }),
          });
          const json = await r.json().catch(() => ({}));
          if (!r.ok) {
            throw new Error(json?.error ?? `Server returned ${r.status}`);
          }
          return json;
        })();
        const json = await trackPromise(reqPromise);
        const layerId = `remote:${sourcePayload.host}:${sourcePayload.schema}:${sourcePayload.table}`;
        const layerLabel = `${sourcePayload.host} · ${sourcePayload.schema}.${sourcePayload.table}`;
        addDbLayers([
          {
            id: layerId,
            label: layerLabel,
            schema: `${sourcePayload.host} · ${sourcePayload.schema}`,
            table: sourcePayload.table,
            geometry: json.geometry || 'polygon',
            data: json.featureCollection,
          },
        ]);
        // Frame the layer so the user immediately sees what they
        // just connected — same UX as the local Browse-Database flow.
        zoomToGeoJson(json.featureCollection);
        setProgress(1);
        setStage(null);
        setResult({
          mode: 'visualize',
          rowCount: json.rowCount ?? 0,
          schema: sourcePayload.schema,
          table: sourcePayload.table,
        });
        setPhase('done');
        // Auto-close on successful visualize so the user lands straight
        // on the map with the new layer in view. Import keeps the modal
        // open so the success summary (table name, SRID, feature count)
        // remains readable.
        onClose?.();
      } catch (err) {
        setError(err?.message ?? String(err));
        setPhase('error');
      }
      return;
    }

    // Import path — streaming, writes into local PostGIS.
    const payload = {
      source: sourcePayload,
      target: {
        schema: toIdent(form.targetSchema) || 'public',
        table: toIdent(form.targetTable),
      },
    };

    try {
      await streamFromDb(payload, (evt) => {
        if (typeof evt.progress === 'number') setProgress(evt.progress);
        if (typeof evt.inserted === 'number') setInsertedCount(evt.inserted);
        if (typeof evt.total === 'number') setTotalCount(evt.total);
        if (evt.stage) setStage(evt.stage);
        if (evt.error) {
          setError(evt.error);
          setPhase('error');
        }
        if (evt.done) {
          setProgress(1);
          setStage(null);
          setResult({
            mode: 'import',
            inserted: evt.inserted,
            schema: evt.schema,
            table: evt.table,
            index: evt.index,
            srid: evt.srid,
          });
          setPhase('done');
        }
      });
      setPhase((p) => (p === 'running' ? 'done' : p));
    } catch (err) {
      setError(err.message ?? String(err));
      setPhase('error');
    }
  };

  const stageLabel =
    stage === 'connecting'
      ? 'Connecting to remote database…'
      : stage === 'preparing'
        ? 'Reading source schema…'
        : stage === 'indexing'
          ? 'Building spatial index…'
          : null;

  return (
    <Modal
      open={open}
      onClose={phase === 'running' ? () => {} : onClose}
      title="Connect to Database"
      size="lg"
    >
      <div className="flex items-center gap-2 mb-3 text-[13px] text-day-muted dark:text-night-muted">
        <Server className="h-3.5 w-3.5 text-brand-700 dark:text-brand-200" />
        <span>
          Connect to any reachable PostgreSQL/PostGIS server. You can
          either pull the table into this database, or just visualize it
          on the map without writing anything locally.
        </span>
      </div>

      {/* Mode toggle — Import vs Visualize. Disabled mid-run so we
          don't switch payload shape while the request is in flight. */}
      <div className="mb-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-day-muted dark:text-night-muted mb-1.5">
          Action
        </div>
        <div
          role="radiogroup"
          aria-label="Connection action"
          className={cn(
            'grid grid-cols-2 gap-1 p-1 rounded-md',
            'bg-day-bg dark:bg-night-bg',
            'border border-day-border dark:border-night-border',
            phase === 'running' && 'opacity-50 pointer-events-none',
          )}
        >
          {[
            {
              id: 'import',
              label: 'Import to database',
              hint: 'Write into local PostGIS',
              Icon: Database,
            },
            {
              id: 'visualize',
              label: 'Visualize only',
              hint: 'In-memory · no local copy',
              Icon: Eye,
            },
          ].map(({ id, label, hint, Icon }) => {
            const active = mode === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setMode(id)}
                className={cn(
                  'relative flex items-start gap-2 px-3 py-2 rounded text-left transition-colors',
                  active
                    ? 'bg-[#84cc16] text-[#1a2e05] shadow-sm'
                    : 'text-day-text dark:text-night-text hover:bg-day-bg/60 dark:hover:bg-night-bg/60',
                )}
              >
                <Icon className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold leading-tight">
                    {label}
                  </div>
                  <div
                    className={cn(
                      'text-[11.5px] leading-tight mt-0.5',
                      active ? 'text-white/80' : 'text-day-muted dark:text-night-muted',
                    )}
                  >
                    {hint}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Connection */}
      <Section title="Connection">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Host" className="sm:col-span-2">
            <input
              type="text"
              value={form.host}
              onChange={(e) => update('host', e.target.value)}
              disabled={phase === 'running'}
              className="input-base w-full"
              placeholder="localhost or 192.168.1.50"
            />
          </Field>
          <Field label="Port">
            <input
              type="number"
              value={form.port}
              onChange={(e) => update('port', e.target.value)}
              disabled={phase === 'running'}
              className="input-base w-full"
              placeholder="5432"
            />
          </Field>
          <Field label="Database" className="sm:col-span-3">
            <input
              type="text"
              value={form.database}
              onChange={(e) => update('database', e.target.value)}
              disabled={phase === 'running'}
              className="input-base w-full"
              placeholder="my_remote_db"
            />
          </Field>
          <Field label="User">
            <input
              type="text"
              value={form.user}
              onChange={(e) => update('user', e.target.value)}
              disabled={phase === 'running'}
              className="input-base w-full"
              placeholder="postgres"
            />
          </Field>
          <Field label="Password" className="sm:col-span-2">
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => update('password', e.target.value)}
                disabled={phase === 'running'}
                className="input-base w-full pr-9"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                disabled={phase === 'running'}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
                className={cn(
                  'absolute right-1.5 top-1/2 -translate-y-1/2',
                  'inline-flex h-7 w-7 items-center justify-center rounded-md',
                  'text-day-muted dark:text-night-muted',
                  'hover:text-[#84cc16] hover:bg-[#84cc16]/10 transition-colors',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
              >
                {showPassword ? (
                  <Eye className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <EyeClosed className="h-3.5 w-3.5" aria-hidden />
                )}
              </button>
            </div>
          </Field>
        </div>
        <label className="mt-2 inline-flex items-center gap-2 text-[13px] text-day-text dark:text-night-text">
          <input
            type="checkbox"
            checked={form.ssl}
            onChange={(e) => update('ssl', e.target.checked)}
            disabled={phase === 'running'}
            className="h-3.5 w-3.5 accent-[#84cc16] cursor-pointer"
          />
          Connect over SSL (recommended for non-LAN servers)
        </label>
      </Section>

      {/* Source */}
      <Section title="Source table">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Schema">
            <input
              type="text"
              value={form.sourceSchema}
              onChange={(e) => update('sourceSchema', e.target.value)}
              disabled={phase === 'running'}
              className="input-base w-full"
              placeholder="public"
            />
          </Field>
          <Field label="Table">
            <input
              type="text"
              value={form.sourceTable}
              onChange={(e) => update('sourceTable', e.target.value)}
              disabled={phase === 'running'}
              className="input-base w-full"
              placeholder="rivers"
            />
          </Field>
        </div>
      </Section>

      {/* Target — only when importing into the local DB. Visualize-only
          mode doesn't write anywhere, so no target naming is needed. */}
      {mode === 'import' && (
        <Section title="Target (this database)">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Schema">
              <input
                type="text"
                value={form.targetSchema}
                onChange={(e) => update('targetSchema', e.target.value)}
                disabled={phase === 'running'}
                className="input-base w-full"
                placeholder="secondary"
              />
            </Field>
            <Field label="Table">
              <input
                type="text"
                value={form.targetTable}
                onChange={(e) => update('targetTable', e.target.value)}
                disabled={phase === 'running'}
                className="input-base w-full"
                placeholder="imported_rivers"
              />
            </Field>
          </div>
        </Section>
      )}

      {/* Progress */}
      {phase !== 'idle' ? (
        <div className="mb-4">
          <div className="flex items-start justify-between gap-3 text-[12px] mb-1">
            <div
              className={cn(
                'flex items-start gap-1.5 font-medium min-w-0 flex-1',
                phase === 'error'
                  ? 'text-red-600 dark:text-red-400'
                  : phase === 'done'
                    ? 'text-[#84cc16]'
                    : 'text-day-text dark:text-night-text',
              )}
            >
              {phase === 'running' && <Loader2 className="h-3 w-3 mt-0.5 shrink-0 animate-spin" />}
              {phase === 'done' && <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" />}
              {phase === 'error' && <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />}
              <span className="break-words leading-snug">
                {phase === 'running' &&
                  (mode === 'visualize'
                    ? 'Fetching features from remote database…'
                    : stageLabel ??
                      `Inserting features… ${insertedCount.toLocaleString()} / ${totalCount.toLocaleString()}`)}
                {phase === 'done' && result &&
                  (result.mode === 'visualize'
                    ? `Loaded ${result.rowCount.toLocaleString()} features from ${result.schema}.${result.table} into the map.`
                    : `Imported ${result.inserted.toLocaleString()} features into ${result.schema}.${result.table} (SRID ${result.srid})`)}
                {phase === 'error' &&
                  `${mode === 'visualize' ? 'Visualization' : 'Import'} failed: ${error}`}
              </span>
            </div>
            <span className="tabular-nums text-day-muted dark:text-night-muted shrink-0">
              {Math.round(progress * 100)}%
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-day-border/60 dark:bg-night-border/60">
            <motion.div
              className={cn(
                'h-full rounded-full',
                phase === 'error' ? 'bg-red-500' : 'bg-[#84cc16]',
              )}
              animate={{
                width: `${Math.max(progress * 100, phase === 'running' ? 4 : 0)}%`,
              }}
              transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            />
          </div>
        </div>
      ) : null}

      {/* Footer */}
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
          onClick={handleSubmit}
          disabled={!canSubmit || phase === 'done'}
          className={cn(
            'btn-base btn-md',
            'bg-[#84cc16] text-[#1a2e05] hover:bg-[#65a30d]',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {phase === 'running' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : mode === 'visualize' ? (
            <Eye className="h-4 w-4" />
          ) : (
            <Database className="h-4 w-4" />
          )}
          <span>
            {phase === 'running'
              ? mode === 'visualize'
                ? 'Connecting…'
                : 'Importing…'
              : phase === 'error'
                ? 'Retry'
                : mode === 'visualize'
                  ? 'Connect & Visualize'
                  : 'Import'}
          </span>
        </button>
      </div>
    </Modal>
  );
}

// Section wrapper — small uppercase title with a hairline rule, mirrors
// the existing "ATTRIBUTES" style used in ImportToDatabaseModal so the
// two modals feel like part of the same family.
function Section({ title, children }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-day-muted dark:text-night-muted">
          {title}
        </span>
        <span className="flex-1 h-px bg-day-border/60 dark:bg-night-border/60" />
      </div>
      {children}
    </div>
  );
}

function Field({ label, children, className }) {
  return (
    <label className={cn('flex flex-col gap-1', className)}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-day-muted dark:text-night-muted">
        {label}
      </span>
      {children}
    </label>
  );
}
