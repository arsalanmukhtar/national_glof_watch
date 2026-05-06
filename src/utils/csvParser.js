// ---------------------------------------------------------------------------
// CSV parser — RFC 4180-ish. Handles:
//   • quoted fields ("a, b")
//   • escaped quotes inside quoted fields (""→")
//   • multiline fields when wrapped in quotes
//   • CRLF / LF line endings
//   • UTF-8 BOM stripping
//   • auto-detected delimiter (, ; \t |)
//   • value coercion (numeric strings → Number)
//   • per-column type inference (number / date / string)
//
// Returns `{ columns, rows, types }`. `columns` are header strings (with
// duplicates suffixed); `rows` is an array of plain objects keyed by
// column name; `types` is `{ [col]: 'number' | 'date' | 'string' | 'unknown' }`.
// ---------------------------------------------------------------------------

const DEFAULT_TYPE_SAMPLE = 200;

export function parseCsv(input, opts = {}) {
  if (typeof input !== 'string') {
    return { columns: [], rows: [], types: {} };
  }
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (!text.trim()) return { columns: [], rows: [], types: {} };

  const delimiter = opts.delimiter ?? detectDelimiter(text);
  const records = splitRecords(text, delimiter);
  if (records.length === 0) return { columns: [], rows: [], types: {} };

  const headerRow = records[0];
  const columns = uniquifyHeaders(headerRow);

  const rows = new Array(records.length - 1);
  for (let r = 1; r < records.length; r++) {
    const cells = records[r];
    const obj = {};
    for (let c = 0; c < columns.length; c++) {
      obj[columns[c]] = coerce(cells[c] ?? '');
    }
    rows[r - 1] = obj;
  }

  const types = {};
  for (const col of columns) types[col] = inferColumnType(rows, col);

  return { columns, rows, types };
}

// Lower-level split: walks the source character by character respecting
// quotes. Any record consisting of a single empty field is dropped (this
// handles trailing-newline / blank-line artifacts).
function splitRecords(text, delimiter) {
  const out = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      field = '';
      if (!(row.length === 1 && row[0] === '')) out.push(row);
      row = [];
    } else if (ch === '\r') {
      // ignore — \r\n handled by the \n branch
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (!(row.length === 1 && row[0] === '')) out.push(row);
  }
  return out;
}

function detectDelimiter(text) {
  // Score each candidate by the count on the first non-empty line. Tie-
  // break by lexical order in the candidates array (favors comma).
  const firstLineEnd = text.indexOf('\n');
  const line = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd);
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestCount = -1;
  for (const d of candidates) {
    let c = 0;
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') inQ = !inQ;
      else if (ch === d && !inQ) c++;
    }
    if (c > bestCount) {
      best = d;
      bestCount = c;
    }
  }
  return best;
}

function uniquifyHeaders(headerRow) {
  const seen = new Map();
  return headerRow.map((h, i) => {
    let name = (h ?? '').trim() || `col_${i + 1}`;
    if (seen.has(name)) {
      const n = seen.get(name) + 1;
      seen.set(name, n);
      name = `${name} (${n})`;
    } else {
      seen.set(name, 1);
    }
    return name;
  });
}

function coerce(raw) {
  if (raw === '' || raw == null) return null;
  // Reject leading-zero strings like "00123" that are likely codes/IDs
  // (account numbers, station IDs) — keep them as strings so the user
  // doesn't lose the leading zero.
  if (/^0\d+$/.test(raw)) return raw;
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return raw;
}

function inferColumnType(rows, col) {
  let total = 0;
  let num = 0;
  let dt = 0;
  const sample = Math.min(DEFAULT_TYPE_SAMPLE, rows.length);
  for (let i = 0; i < sample; i++) {
    const v = rows[i][col];
    if (v == null || v === '') continue;
    total++;
    if (typeof v === 'number') {
      num++;
      continue;
    }
    if (looksLikeDate(String(v))) dt++;
  }
  if (total === 0) return 'unknown';
  if (num / total >= 0.8) return 'number';
  if (dt / total >= 0.7) return 'date';
  return 'string';
}

function looksLikeDate(s) {
  // ISO 8601 prefix: 2024-01-31, 2024-01-31T..., 2024/01/31, 2024-01-31 12:34
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[T ]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(s)) {
    return true;
  }
  // DMY / MDY with 4-digit year
  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}/.test(s)) return true;
  return false;
}

// Apply user-defined filter rows to a row set. Each filter is
//   { column, op: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'contains', value }
// Empty `column` or `value` rows are skipped (treat as "not yet
// configured" — matches the panel's UX of pre-creating an empty row).
export function applyFilters(rows, filters) {
  if (!Array.isArray(filters) || filters.length === 0) return rows;
  const active = filters.filter(
    (f) => f && f.column && f.value !== '' && f.value != null,
  );
  if (active.length === 0) return rows;
  return rows.filter((row) => active.every((f) => matchFilter(row, f)));
}

function matchFilter(row, f) {
  const cell = row[f.column];
  const target = f.value;
  if (cell == null) return false;
  switch (f.op) {
    case '!=':
      return String(cell) !== String(target);
    case '>':
      return Number(cell) > Number(target);
    case '<':
      return Number(cell) < Number(target);
    case '>=':
      return Number(cell) >= Number(target);
    case '<=':
      return Number(cell) <= Number(target);
    case 'contains':
      return String(cell).toLowerCase().includes(String(target).toLowerCase());
    case '=':
    default:
      return String(cell) === String(target);
  }
}
