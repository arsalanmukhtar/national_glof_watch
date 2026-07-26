// Utilities for the Flypath features label expression + unit catalog.
// The expression language is a tiny SQL-style dialect designed to feel
// natural to QGIS / ArcGIS users:
//
//   name                              → the value of the "name" field
//   name || ' - ' || area             → concatenation with a literal
//   'Lake: ' || name                  → literal prefix
//   name || ' (' || area || ')'       → multi-segment
//
// It compiles to a Mapbox `text-field` expression (a `concat` array),
// which is what the symbol layer's `text-field` layout property
// accepts.
//
// Supported tokens:
//   • Bare identifiers  → treated as attribute keys (map `get`).
//   • Single / double-quoted string literals with `\` escapes.
//   • `||` concatenation operator.
//   • Whitespace is ignored between tokens.
// Anything else (parentheses, arithmetic, functions) is intentionally
// out of scope; users needing that can shape the data upstream.

// -------------------------------------------------------------------
// Unit catalog. Suffixes use real unicode super/subscript glyphs
// (² ³ ⁻¹ …) so Mapbox renders them without needing per-segment
// font-scale wrangling — a `text-field` string with U+00B2 for
// squared shows up correctly at any zoom.
// -------------------------------------------------------------------
export const LABEL_UNITS = [
  { id: 'none', label: 'None',                   suffix: '' },

  // Length
  { id: 'm',      label: 'Meter (m)',            suffix: ' m' },
  { id: 'km',     label: 'Kilometer (km)',       suffix: ' km' },
  { id: 'cm',     label: 'Centimeter (cm)',      suffix: ' cm' },
  { id: 'mm',     label: 'Millimeter (mm)',      suffix: ' mm' },
  { id: 'ft',     label: 'Feet (ft)',            suffix: ' ft' },
  { id: 'mi',     label: 'Miles (mi)',           suffix: ' mi' },

  // Area
  { id: 'm2',     label: 'Square meter (m²)',    suffix: ' m²' },
  { id: 'km2',    label: 'Square kilometer (km²)', suffix: ' km²' },
  { id: 'ha',     label: 'Hectare (ha)',         suffix: ' ha' },
  { id: 'ac',     label: 'Acre (ac)',            suffix: ' ac' },

  // Volume
  { id: 'm3',     label: 'Cubic meter (m³)',     suffix: ' m³' },
  { id: 'km3',    label: 'Cubic kilometer (km³)', suffix: ' km³' },
  { id: 'l',      label: 'Litre (L)',            suffix: ' L' },

  // Speed / rate
  { id: 'ms',     label: 'Meter per second (m/s)',   suffix: ' m/s' },
  { id: 'kmh',    label: 'Kilometer per hour (km/h)', suffix: ' km/h' },
  { id: 'mmyr',   label: 'Millimeters per year (mm/yr)', suffix: ' mm/yr' },
  { id: 'mmday',  label: 'Millimeters per day (mm/day)', suffix: ' mm/day' },

  // Environment
  { id: 'celsius',    label: 'Celsius (°C)',      suffix: ' °C' },
  { id: 'fahrenheit', label: 'Fahrenheit (°F)',   suffix: ' °F' },
  { id: 'kelvin',     label: 'Kelvin (K)',        suffix: ' K' },
  { id: 'percent',    label: 'Percent (%)',       suffix: '%' },
  { id: 'deg',        label: 'Degree (°)',        suffix: '°' },
  { id: 'masl',       label: 'Metres above sea level (m a.s.l.)', suffix: ' m a.s.l.' },
];

export function unitById(id) {
  return LABEL_UNITS.find((u) => u.id === id) ?? LABEL_UNITS[0];
}

// -------------------------------------------------------------------
// Attribute discovery — union of every property key across features.
// -------------------------------------------------------------------
export function extractFeatureAttributes(fc) {
  const set = new Set();
  const features = fc?.features;
  if (!Array.isArray(features)) return [];
  for (const f of features) {
    const props = f?.properties;
    if (props && typeof props === 'object') {
      for (const k of Object.keys(props)) set.add(k);
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

// -------------------------------------------------------------------
// Tokeniser → segment list.
// -------------------------------------------------------------------
export function parseLabelExpression(expr) {
  const segments = [];
  const s = String(expr ?? '').trim();
  if (!s) return segments;
  let i = 0;
  while (i < s.length) {
    // Skip whitespace between tokens.
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;

    // `||` concat operator — skipped; it's implicit in the segment list.
    if (s[i] === '|' && s[i + 1] === '|') { i += 2; continue; }

    // Quoted literal.
    if (s[i] === "'" || s[i] === '"') {
      const q = s[i]; i++;
      let lit = '';
      while (i < s.length && s[i] !== q) {
        if (s[i] === '\\' && i + 1 < s.length) { lit += s[i + 1]; i += 2; }
        else { lit += s[i]; i++; }
      }
      if (s[i] === q) i++;
      segments.push({ type: 'literal', value: lit });
      continue;
    }

    // Bare identifier → attribute name. Allow letters, digits, `_`,
    // and `.` / `:` for prefixed keys (some sources use "raster:val").
    const start = i;
    while (i < s.length && /[A-Za-z0-9_\-.:]/.test(s[i])) i++;
    if (i > start) {
      segments.push({ type: 'attr', value: s.slice(start, i) });
      continue;
    }

    // Unknown character — skip so a stray comma / paren doesn't hang
    // the tokeniser.
    i++;
  }
  return segments;
}

// -------------------------------------------------------------------
// Compile to a Mapbox `text-field` value.
//   • empty expr + no unit  → '' (no label)
//   • single segment + no unit → the bare `get` expression (Mapbox
//     handles string/number automatically)
//   • otherwise → concat array with a trailing unit suffix literal
//
// Numeric attribute values are rounded to two decimals via
// `number-format` — that's the operator-friendly default for lake
// areas / volumes / elevations. Non-numeric values fall through to
// `to-string` unchanged.
// -------------------------------------------------------------------
export function buildMapboxTextField(expression, unitSuffix = '') {
  const segments = parseLabelExpression(expression);
  const trailing = String(unitSuffix ?? '');

  if (segments.length === 0 && !trailing) return '';

  const parts = ['concat'];
  for (const seg of segments) {
    if (seg.type === 'literal') {
      parts.push(seg.value);
    } else {
      parts.push(attributeGetterExpr(seg.value));
    }
  }
  if (trailing) parts.push(trailing);
  return parts;
}

// Attribute getter that:
//   • returns '' when the key is missing (coalesce guard);
//   • rounds numeric values to 2 decimals via number-format;
//   • coerces anything else to string so mixed-type attributes
//     don't crash the layer.
function attributeGetterExpr(attrName) {
  return [
    'case',
    ['==', ['typeof', ['get', attrName]], 'number'],
    ['number-format', ['get', attrName], { 'max-fraction-digits': 2, 'min-fraction-digits': 0 }],
    ['to-string', ['coalesce', ['get', attrName], '']],
  ];
}

// -------------------------------------------------------------------
// Helper: when the user picks an attribute (chip / dropdown check),
// append it to the existing expression with a `||` if there's
// anything there already. Uses the identifier bare (no quotes) —
// that's the QGIS convention.
// -------------------------------------------------------------------
export function appendAttributeToExpression(expr, attrName) {
  const trimmed = String(expr ?? '').trim();
  if (!trimmed) return attrName;
  return `${trimmed} || ' - ' || ${attrName}`;
}

// -------------------------------------------------------------------
// Remove the first occurrence of an attribute name from the
// expression. Also drops one adjacent whitespace-only literal so the
// remaining string doesn't end up with a dangling `||` or a stray
// separator like `name || ' - '`. Best-effort — anything the user
// typed by hand that doesn't survive the round-trip cleanly stays
// as-is under advanced edits.
// -------------------------------------------------------------------
export function removeAttributeFromExpression(expr, attrName) {
  const segments = parseLabelExpression(expr);
  const kept = [];
  let removed = false;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (!removed && s.type === 'attr' && s.value === attrName) {
      removed = true;
      // Drop one adjacent whitespace / punctuation-only literal so
      // we don't leave `name || ' - '` behind.
      const prev = kept[kept.length - 1];
      const next = segments[i + 1];
      if (prev && prev.type === 'literal' && isSeparatorLiteral(prev.value)) {
        kept.pop();
      } else if (next && next.type === 'literal' && isSeparatorLiteral(next.value)) {
        i++;
      }
      continue;
    }
    kept.push(s);
  }
  return kept.map(rebuildSegment).join(' || ');
}

function isSeparatorLiteral(text) {
  // Whitespace, dashes, commas, semicolons, parens — the punctuation
  // people typically use as separators between attributes.
  return /^[\s\-,;:()\[\]|/]*$/.test(text);
}

function rebuildSegment(seg) {
  if (seg.type === 'literal') return `'${seg.value.replace(/'/g, "\\'")}'`;
  return seg.value;
}

// -------------------------------------------------------------------
// Set of attribute names currently referenced in the expression.
// Used to drive multi-select checkbox states.
// -------------------------------------------------------------------
export function attributesInExpression(expr) {
  return new Set(
    parseLabelExpression(expr)
      .filter((s) => s.type === 'attr')
      .map((s) => s.value),
  );
}