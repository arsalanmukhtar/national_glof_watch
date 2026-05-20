import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  ChevronDown,
  Filter,
  FilePlus2,
  FileSpreadsheet,
  Globe,
  Link2,
  Pencil,
  Sigma,
  Table2,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useCsvDatasets } from '@/contexts/CsvDatasetsContext';
import { applyFilters, parseCsv } from '@/utils/csvParser';
import { cn } from '@/utils/cn';

// ---------------------------------------------------------------------------
// CSV Data panel.
//
// Three intake methods (upload, paste/edit, online URL) feed the same
// parser pipeline (see `@/utils/csvParser`) and land in the shared
// `CsvDatasetsContext`. The chart card's Lakes Trend tab subscribes to
// the same context so the "active" dataset renders there immediately.
// ---------------------------------------------------------------------------

const INTAKE_METHODS = [
  { id: 'upload', label: 'Upload file', hint: '.csv from your computer', Icon: Upload },
  { id: 'paste',  label: 'Paste / edit', hint: 'Spreadsheet-style editor', Icon: Pencil },
  { id: 'url',    label: 'From URL',    hint: 'Public link to a .csv',    Icon: Link2 },
];

const FILTER_OPS = [
  { id: '=',        label: '=' },
  { id: '!=',       label: '≠' },
  { id: '>',        label: '>' },
  { id: '<',        label: '<' },
  { id: '>=',       label: '≥' },
  { id: '<=',       label: '≤' },
  { id: 'contains', label: 'contains' },
];

export default function CsvDataPanel() {
  const {
    datasets,
    activeDataset,
    setActiveId,
    addDataset,
    removeDataset,
    updateDataset,
  } = useCsvDatasets();

  const [intakeOpen, setIntakeOpen] = useState(false);
  const [intakeMethod, setIntakeMethod] = useState('upload');
  const [intakeError, setIntakeError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Single intake commit — every method calls this with raw CSV text +
  // a name; the parser does the rest. Anything that throws bubbles up
  // as an inline error so the user sees what went wrong.
  const commit = (text, name, source) => {
    setIntakeError(null);
    try {
      const { columns, rows, types } = parseCsv(text);
      if (columns.length === 0) {
        setIntakeError('No columns parsed from the input.');
        return;
      }
      addDataset({ name, source, columns, rows, types });
      setIntakeOpen(false);
    } catch (err) {
      setIntakeError(err.message || 'Failed to parse CSV.');
    }
  };

  const handleFile = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      commit(text, file.name, 'upload');
    } catch (err) {
      setIntakeError(err.message || 'Could not read file.');
    } finally {
      setBusy(false);
    }
  };

  const handlePaste = (text) => {
    if (!text.trim()) {
      setIntakeError('Paste some CSV first.');
      return;
    }
    commit(text, `Pasted ${new Date().toLocaleTimeString()}`, 'paste');
  };

  const handleUrl = async (url) => {
    if (!url.trim()) {
      setIntakeError('Enter a URL first.');
      return;
    }
    setBusy(true);
    setIntakeError(null);
    try {
      const proxied = `/api/csv/fetch?url=${encodeURIComponent(url.trim())}`;
      const r = await fetch(proxied);
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      const text = await r.text();
      const fileName = url.split('?')[0].split('/').pop() || 'Remote CSV';
      commit(text, fileName, 'url');
    } catch (err) {
      setIntakeError(err.message || 'Fetch failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => {
          setIntakeOpen((v) => !v);
          setIntakeError(null);
        }}
        aria-expanded={intakeOpen}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-md px-3 py-2',
          'text-[13px] font-semibold transition-colors',
          intakeOpen
            ? 'bg-[#65a30d] text-white'
            : 'bg-[#84cc16] text-[#1a2e05] hover:bg-[#65a30d]',
        )}
      >
        <FilePlus2 className="h-4 w-4" />
        <span>{intakeOpen ? 'Cancel' : 'Add CSV'}</span>
      </button>

      <AnimatePresence initial={false}>
        {intakeOpen ? (
          <motion.div
            key="intake"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <IntakeMethodPicker
              method={intakeMethod}
              onChange={(id) => {
                setIntakeMethod(id);
                setIntakeError(null);
              }}
            />
            <div className="mt-2">
              {intakeMethod === 'upload' && (
                <UploadDrop busy={busy} onFile={handleFile} />
              )}
              {intakeMethod === 'paste' && (
                <PasteEditor busy={busy} onCommit={handlePaste} />
              )}
              {intakeMethod === 'url' && (
                <UrlIntake busy={busy} onCommit={handleUrl} />
              )}
            </div>
            {intakeError ? (
              <div className="mt-1.5 inline-flex items-start gap-1.5 text-[11.5px] text-red-600 dark:text-red-400">
                <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                <span>{intakeError}</span>
              </div>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <Section title="Datasets" count={datasets.length}>
        {datasets.length === 0 ? (
          <EmptyHint>
            Add a CSV to preview its rows and configure a chart.
          </EmptyHint>
        ) : (
          <div className="flex flex-col gap-1">
            {datasets.map((d) => (
              <DatasetRow
                key={d.id}
                dataset={d}
                active={d.id === activeDataset?.id}
                onSelect={() => setActiveId(d.id)}
                onRemove={() => removeDataset(d.id)}
              />
            ))}
          </div>
        )}
      </Section>

      {activeDataset ? (
        <>
          <Section title="Attribute table">
            <AttributeTablePreview dataset={activeDataset} />
          </Section>

          <Section title="Chart axes" titleIcon={Sigma}>
            <ChartAxisConfig
              dataset={activeDataset}
              onChange={(next) => updateDataset(activeDataset.id, next)}
            />
          </Section>

          <Section title="Filters" titleIcon={Filter}>
            <FiltersConfig
              dataset={activeDataset}
              onChange={(next) => updateDataset(activeDataset.id, next)}
            />
          </Section>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Intake method radio strip
// ---------------------------------------------------------------------------

function IntakeMethodPicker({ method, onChange }) {
  return (
    <div
      role="radiogroup"
      aria-label="CSV intake method"
      className="grid grid-cols-3 gap-1"
    >
      {INTAKE_METHODS.map(({ id, label, hint, Icon }) => {
        const on = method === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(id)}
            className={cn(
              'flex flex-col items-start gap-1 rounded-md border px-2 py-2 text-left transition-colors',
              on
                ? 'bg-[#84cc16]/10 border-[#84cc16]/50 text-[#84cc16]'
                : 'border-day-border dark:border-night-border text-day-muted dark:text-night-muted hover:border-day-text/40 dark:hover:border-night-text/40',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="text-[12px] font-semibold leading-tight">
              {label}
            </span>
            <span className="text-[10.5px] leading-tight opacity-80">
              {hint}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upload — hidden file input + drag-and-drop dropzone
// ---------------------------------------------------------------------------

function UploadDrop({ busy, onFile }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const accept = (file) => {
    if (!file) return;
    onFile(file);
  };

  // The whole zone is the click target — `<button>` handles keyboard
  // (Enter/Space) and focus ring for free, and the dashed-border styling
  // sits on the button itself.
  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          accept(f);
        }}
        className={cn(
          'w-full flex flex-col items-center justify-center gap-1.5',
          'rounded-md border-2 border-dashed px-3 py-5 text-center cursor-pointer',
          'transition-colors focus:outline-none focus:ring-2 focus:ring-[#84cc16]/40',
          'disabled:cursor-not-allowed disabled:opacity-60',
          dragOver
            ? 'border-[#84cc16] bg-[#84cc16]/5'
            : 'border-day-border dark:border-night-border hover:border-[#84cc16]/60 hover:bg-[#84cc16]/5',
        )}
      >
        <Upload className="h-5 w-5 text-day-muted dark:text-night-muted" />
        <span className="text-[12px] text-day-text dark:text-night-text">
          Drop a .csv file or{' '}
          <span className="font-semibold text-[#84cc16]">
            {busy ? 'reading…' : 'click to browse'}
          </span>
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv,text/plain"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          accept(f);
          // reset so re-uploading the same file fires onChange again
          e.target.value = '';
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Paste — textarea + parse button
// ---------------------------------------------------------------------------

function PasteEditor({ busy, onCommit }) {
  const [text, setText] = useState('');
  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'name,value\nA,12\nB,7\nC,21'}
        rows={5}
        className={cn(
          'rounded-md border px-2 py-1.5 text-[12px] font-mono',
          'bg-day-bg dark:bg-night-bg',
          'border-day-border dark:border-night-border',
          'text-day-text dark:text-night-text',
          'focus:outline-none focus:ring-2 focus:ring-[#84cc16]/40',
        )}
      />
      <button
        type="button"
        disabled={!text.trim() || busy}
        onClick={() => onCommit(text)}
        className={cn(
          'btn-base btn-sm w-full',
          'bg-[#84cc16] text-[#1a2e05] hover:bg-[#65a30d]',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <Table2 className="h-3.5 w-3.5" />
        <span>{busy ? 'Parsing…' : 'Parse rows'}</span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// URL — fetched via the backend proxy so CORS-restricted hosts still
// work.
// ---------------------------------------------------------------------------

function UrlIntake({ busy, onCommit }) {
  const [url, setUrl] = useState('');
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <Globe className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-day-muted dark:text-night-muted pointer-events-none" />
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && url.trim() && !busy) onCommit(url);
          }}
          placeholder="https://example.org/data.csv"
          className={cn(
            'w-full pl-7 pr-2 py-1.5 rounded-md text-[12px]',
            'bg-day-bg dark:bg-night-bg',
            'border border-day-border dark:border-night-border',
            'text-day-text dark:text-night-text placeholder:text-day-muted dark:placeholder:text-night-muted',
            'focus:outline-none focus:ring-2 focus:ring-[#84cc16]/40',
          )}
        />
      </div>
      <button
        type="button"
        disabled={!url.trim() || busy}
        onClick={() => onCommit(url)}
        className={cn(
          'btn-base btn-sm w-full',
          'bg-[#84cc16] text-[#1a2e05] hover:bg-[#65a30d]',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <Link2 className="h-3.5 w-3.5" />
        <span>{busy ? 'Fetching…' : 'Fetch'}</span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dataset row + previews
// ---------------------------------------------------------------------------

function DatasetRow({ dataset, active, onSelect, onRemove }) {
  return (
    <div
      className={cn(
        'flex items-center gap-1 rounded-md border px-2 py-1.5 transition-colors',
        active
          ? 'border-[#84cc16]/40 bg-[#84cc16]/15'
          : 'border-day-border dark:border-night-border',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex-1 inline-flex items-center gap-2 truncate text-left"
        title={dataset.name}
      >
        <FileSpreadsheet
          className={cn(
            'h-3.5 w-3.5 shrink-0',
            active ? 'text-[#84cc16]' : 'text-brand-700 dark:text-brand-200',
          )}
        />
        <span className="truncate text-[13px] text-day-text dark:text-night-text">
          {dataset.name}
        </span>
        <span className="text-[10.5px] text-day-muted dark:text-night-muted ml-auto">
          {dataset.rows.length || '—'} rows
        </span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${dataset.name}`}
        className="inline-flex h-6 w-6 items-center justify-center rounded text-red-500 hover:bg-red-500/10"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

function AttributeTablePreview({ dataset }) {
  // The preview always reflects the active filter set so the user can
  // see how a filter is changing the data before reading the chart.
  const filtered = useMemo(
    () => applyFilters(dataset.rows, dataset.filters),
    [dataset.rows, dataset.filters],
  );
  if (!dataset.rows.length) {
    return <EmptyHint>Empty dataset.</EmptyHint>;
  }
  const visibleCols = dataset.columns.slice(0, 5);
  const visibleRows = filtered.slice(0, 50);
  return (
    <div className="rounded-md border border-day-border dark:border-night-border overflow-auto max-h-48">
      <table className="w-full text-[11.5px] tabular-nums border-collapse">
        <thead className="bg-day-bg/80 dark:bg-night-bg/80 sticky top-0">
          <tr>
            {visibleCols.map((c) => (
              <th
                key={c}
                className="px-2 py-1 text-left font-semibold uppercase tracking-wider text-day-muted dark:text-night-muted whitespace-nowrap"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleRows.length === 0 ? (
            <tr>
              <td
                colSpan={visibleCols.length}
                className="px-2 py-2 text-center text-day-muted dark:text-night-muted"
              >
                No rows match the active filters.
              </td>
            </tr>
          ) : (
            visibleRows.map((r, i) => (
              <tr
                key={i}
                className="border-b border-day-border/60 dark:border-night-border/60 odd:bg-day-bg/30 dark:odd:bg-night-bg/30"
              >
                {visibleCols.map((c) => (
                  <td
                    key={c}
                    className="px-2 py-1 text-day-text dark:text-night-text whitespace-nowrap max-w-[140px] truncate"
                  >
                    {r[c] == null || r[c] === '' ? '—' : String(r[c])}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chart axis pickers (X / Y)
// ---------------------------------------------------------------------------

function ChartAxisConfig({ dataset, onChange }) {
  const opts = dataset.columns;
  return (
    <div className="grid grid-cols-2 gap-2">
      <AxisPicker
        label="X axis"
        value={dataset.chartConfig.x}
        onChange={(x) => onChange({ chartConfig: { x } })}
        options={opts}
        types={dataset.types}
      />
      <AxisPicker
        label="Y axis"
        value={dataset.chartConfig.y}
        onChange={(y) => onChange({ chartConfig: { y } })}
        options={opts}
        types={dataset.types}
      />
    </div>
  );
}

function AxisPicker({ label, value, onChange, options, types }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-day-muted dark:text-night-muted">
        {label}
      </span>
      <div className="relative">
        <select
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          disabled={options.length === 0}
          className={cn(
            'w-full appearance-none pl-2 pr-6 py-1 rounded-md text-[12px]',
            'bg-day-bg dark:bg-night-bg',
            'border border-day-border dark:border-night-border',
            'text-day-text dark:text-night-text',
            'focus:outline-none focus:ring-2 focus:ring-[#84cc16]/40',
            'disabled:opacity-50',
          )}
        >
          <option value="">— select —</option>
          {options.map((c) => (
            <option key={c} value={c}>
              {c}
              {types?.[c] ? ` · ${types[c]}` : ''}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-day-muted dark:text-night-muted pointer-events-none" />
      </div>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Filters — editable column / op / value rows. Empty rows are tolerated
// (treated as "not yet configured" by `applyFilters`).
// ---------------------------------------------------------------------------

// Cap the values surfaced per column. 1k unique strings still renders
// fast in a <select>; beyond that the panel would lock up while React
// reconciled thousands of <option> nodes.
const FILTER_VALUE_CAP = 1000;

function FiltersConfig({ dataset, onChange }) {
  const filters = dataset.filters ?? [];

  // Build `{ [col]: sortedUniqueValues[] }` once per dataset. Numeric
  // columns sort ascending; everything else sorts as locale-compared
  // strings. Null / empty cells are skipped so they don't clog the
  // dropdown.
  const uniqueByColumn = useMemo(
    () => buildUniqueIndex(dataset.rows, dataset.columns, dataset.types),
    [dataset.rows, dataset.columns, dataset.types],
  );

  const update = (id, partial) =>
    onChange({
      filters: filters.map((f) => (f.id === id ? { ...f, ...partial } : f)),
    });
  const addFilter = () =>
    onChange({
      filters: [
        ...filters,
        {
          id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          column: dataset.columns[0] ?? null,
          op: '=',
          value: '',
        },
      ],
    });
  const removeFilter = (id) =>
    onChange({ filters: filters.filter((f) => f.id !== id) });

  return (
    <div className="flex flex-col gap-1.5">
      {filters.length === 0 ? (
        <EmptyHint>No filters · all rows used.</EmptyHint>
      ) : (
        filters.map((f) => (
          <div
            key={f.id}
            className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] gap-1.5 items-center"
          >
            <ColumnSelect
              value={f.column}
              options={dataset.columns}
              onChange={(column) =>
                // Reset value when switching columns — a value valid for
                // one column is rarely valid for another.
                update(f.id, { column, value: '' })
              }
            />
            <select
              value={f.op}
              onChange={(e) => update(f.id, { op: e.target.value })}
              className="rounded-md border border-day-border dark:border-night-border bg-day-bg dark:bg-night-bg text-[11.5px] px-1 py-1 text-day-text dark:text-night-text"
            >
              {FILTER_OPS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <FilterValueField
              filter={f}
              uniques={f.column ? uniqueByColumn[f.column] : null}
              onChange={(value) => update(f.id, { value })}
            />
            <button
              type="button"
              onClick={() => removeFilter(f.id)}
              aria-label="Remove filter"
              className="inline-flex h-6 w-6 items-center justify-center rounded text-red-500 hover:bg-red-500/10"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))
      )}
      <button
        type="button"
        onClick={addFilter}
        disabled={dataset.columns.length === 0}
        className={cn(
          'inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[12px]',
          'border border-dashed border-day-border dark:border-night-border',
          'text-day-muted dark:text-night-muted',
          'hover:text-[#84cc16] hover:border-[#84cc16]/60 transition-colors',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <Filter className="h-3 w-3" />
        Add filter
      </button>
    </div>
  );
}

// Value field that adapts to the active operator + the column's
// cardinality:
//   • `=` / `!=` with ≤ FILTER_VALUE_CAP uniques → strict <select>.
//   • everything else (>, <, >=, <=, contains, or huge cardinality)
//     → free-form input with a <datalist> so the user still gets
//       autocomplete from the actual data.
function FilterValueField({ filter, uniques, onChange }) {
  const { op, value, column } = filter;
  const equality = op === '=' || op === '!=';
  const tooManyForSelect =
    !uniques || uniques.length === 0 || uniques.length > FILTER_VALUE_CAP;

  if (!column) {
    return (
      <input
        type="text"
        value={value}
        disabled
        placeholder="pick a column"
        className="w-full min-w-0 rounded-md border border-day-border dark:border-night-border bg-day-bg/40 dark:bg-night-bg/40 text-[11.5px] px-1.5 py-1 text-day-muted dark:text-night-muted"
      />
    );
  }

  if (equality && !tooManyForSelect) {
    return (
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-w-0 rounded-md border border-day-border dark:border-night-border bg-day-bg dark:bg-night-bg text-[11.5px] px-1 py-1 text-day-text dark:text-night-text truncate"
      >
        <option value="">— select —</option>
        {uniques.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>
    );
  }

  // datalist id has to be stable per filter id so each row's typeahead
  // is independent (otherwise two filters on the same column would
  // share an id and stomp on each other).
  const listId = `filter-vals-${filter.id}`;
  return (
    <>
      <input
        type="text"
        list={uniques?.length ? listId : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={tooManyForSelect ? 'value (typeahead)' : 'value'}
        className="w-full min-w-0 rounded-md border border-day-border dark:border-night-border bg-day-bg dark:bg-night-bg text-[11.5px] px-1.5 py-1 text-day-text dark:text-night-text"
      />
      {uniques?.length ? (
        <datalist id={listId}>
          {uniques.slice(0, FILTER_VALUE_CAP).map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
      ) : null}
    </>
  );
}

// Pre-computed `{ column: sortedUniques }` map. Built once per dataset
// load (not per render) so a 50k-row CSV doesn't pay this cost on every
// keystroke.
function buildUniqueIndex(rows, columns, types) {
  const out = {};
  if (!rows?.length || !columns?.length) return out;
  for (const col of columns) {
    const set = new Set();
    for (let i = 0; i < rows.length; i++) {
      const v = rows[i]?.[col];
      if (v == null || v === '') continue;
      set.add(typeof v === 'number' ? v : String(v));
      if (set.size > FILTER_VALUE_CAP) break; // bail early on huge columns
    }
    const arr = [...set];
    if (types?.[col] === 'number') {
      arr.sort((a, b) => Number(a) - Number(b));
    } else {
      arr.sort((a, b) => String(a).localeCompare(String(b)));
    }
    out[col] = arr.map((v) => String(v));
  }
  return out;
}

function ColumnSelect({ value, options, onChange }) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={options.length === 0}
      className="w-full min-w-0 rounded-md border border-day-border dark:border-night-border bg-day-bg dark:bg-night-bg text-[11.5px] px-1 py-1 text-day-text dark:text-night-text truncate"
    >
      <option value="">column</option>
      {options.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Section / EmptyHint helpers
// ---------------------------------------------------------------------------

function Section({ title, titleIcon: TitleIcon, count, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 mt-1">
        {TitleIcon ? (
          <TitleIcon className="h-3 w-3 text-brand-700 dark:text-brand-200" />
        ) : null}
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-day-muted dark:text-night-muted">
          {title}
        </span>
        {typeof count === 'number' ? (
          <span className="ml-auto text-[11px] tabular-nums text-day-muted dark:text-night-muted">
            {count}
          </span>
        ) : null}
        <span className="flex-1 h-px bg-day-border/60 dark:bg-night-border/60" />
      </div>
      {children}
    </div>
  );
}

function EmptyHint({ children }) {
  return (
    <p className="text-[11.5px] text-day-muted dark:text-night-muted text-center px-2 py-3 rounded-md border border-dashed border-day-border dark:border-night-border">
      {children}
    </p>
  );
}
