// Utilities for the Flypath features label expression + unit catalog.
// The expression language is a tiny SQL-style dialect designed to feel
// natural to QGIS / ArcGIS users:
//
//   name                              → the value of the "name" field
//   "Lake Area" || ' - ' || area      → double-quoted for identifiers
//                                        that have spaces / punctuation
//                                        / non-ASCII chars.
//   'Lake: ' || name                  → single-quoted for string literals.
//   name || ' (' || area || ')'       → multi-segment
//
// It compiles to a Mapbox `text-field` expression (a `concat` array),
// which is what the symbol layer's `text-field` layout property
// accepts.
//
// Supported tokens:
//   • Bare identifiers matching [A-Za-z0-9_\-.:] → attribute keys.
//   • Double-quoted identifiers "…"              → attribute keys.
//     Use this form for any attribute name a shapefile / GeoJSON
//     source produced that contains spaces, punctuation, or non-
//     ASCII characters (`"Lake Area"`, `"Volume (m³)"`, `"عمق"`).
//   • Single-quoted literals '…'                 → string literals.
//     Common escapes: \n \t \r \\ \'
//   • `||` concatenation operator.
//   • Whitespace is ignored between tokens.
// Anything else (arithmetic, functions) is intentionally out of scope.

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
// Attribute discovery — union of every property key across every
// feature, regardless of geometry type (Point / LineString / Polygon
// / Multi*). Robust to:
//   • Features with null / missing / non-object `properties`.
//   • Feature-level property keys wrapped one layer deep as
//     `properties.attributes` (some ArcGIS EsriJSON→GeoJSON converters
//     produce this shape).
//   • Exotic property bags (proxies, prototype-heavy) — walks both
//     Object.keys and for..in with hasOwnProperty for full coverage.
//   • Whitespace / control-char noise in keys (trimmed before storing
//     so `"volume_MAF "` and `"volume_MAF"` don't appear as two rows).
// Returns the sorted, deduplicated list.
// -------------------------------------------------------------------
export function extractFeatureAttributes(fc) {
  const set = new Set();
  const features = fc?.features;
  if (!Array.isArray(features)) return [];

  const collect = (bag) => {
    if (!bag || typeof bag !== 'object') return;
    // Own enumerable string keys via both Object.keys and for..in +
    // hasOwnProperty. Redundant on plain objects; catches Proxy-
    // backed / prototype-heavy bags that Object.keys alone misses.
    for (const k of Object.keys(bag)) addKey(k);
    for (const k in bag) {
      if (Object.prototype.hasOwnProperty.call(bag, k)) addKey(k);
    }
  };
  const addKey = (k) => {
    if (typeof k !== 'string') return;
    // Strip zero-width / BOM characters (U+200B..U+200D, U+FEFF)
    // that some export pipelines sneak into column names, then
    // trim outer whitespace. Do NOT collapse internal spaces --
    // "Lake Area" is a legitimate attribute name that must
    // round-trip byte-for-byte so Mapbox get still hits it.
    // eslint-disable-next-line no-misleading-character-class, no-control-regex
    const clean = k.replace(/[\u0000\u200B\u200C\u200D\uFEFF]/g, '').trim();
    if (clean.length > 0) set.add(clean);
  };

  for (const f of features) {
    if (!f) continue;
    const props = f.properties;
    collect(props);
    // Some Esri→GeoJSON exports nest the attribute bag one layer
    // deep under an `attributes` key. Peek in so operators using
    // that pipeline still see their columns.
    if (props && typeof props === 'object' && props.attributes) {
      collect(props.attributes);
    }
  }

  const result = Array.from(set).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );

  // One-time dev diagnostic: if the caller's feature count is high
  // but we only surfaced a handful of attributes, log both counts +
  // the discovered list so a missing column shows up in devtools.
  if (typeof console !== 'undefined' && features.length > 0) {
    console.info(
      `[flypath] discovered ${result.length} attribute(s) across ${features.length} feature(s):`,
      result,
    );
  }

  return result;
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

    // Quoted token. Two flavours:
    //   '…'  → string literal (renders as text in the label)
    //   "…"  → attribute identifier (looked up on each feature)
    // The QGIS / SQL convention. Escape sequences follow JS: \n \t
    // \r \\ \' \". Anything else after \ passes through raw.
    if (s[i] === "'" || s[i] === '"') {
      const q = s[i]; i++;
      let buf = '';
      while (i < s.length && s[i] !== q) {
        if (s[i] === '\\' && i + 1 < s.length) {
          const esc = s[i + 1];
          if      (esc === 'n')  buf += '\n';
          else if (esc === 't')  buf += '\t';
          else if (esc === 'r')  buf += '\r';
          else                   buf += esc;
          i += 2;
        } else {
          buf += s[i];
          i++;
        }
      }
      if (s[i] === q) i++;
      if (q === '"') {
        segments.push({ type: 'attr',    value: buf });
      } else {
        segments.push({ type: 'literal', value: buf });
      }
      continue;
    }

    // Bare identifier → attribute name. Allow letters, digits, `_`,
    // and `.` / `:` for prefixed keys (some sources use "raster:val").
    // Attributes with any other character (space, parens, non-ASCII)
    // must use the "double-quoted" form above.
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
  const token = attrTokenFor(attrName);
  if (!trimmed) return token;
  // '\n' separator so each subsequent attribute lands on its own
  // line under the previous one — makes multi-attribute labels
  // scannable on the map instead of running everything onto a single
  // line separated by dashes.
  return `${trimmed} || '\\n' || ${token}`;
}

// Serialise an attribute name to source form. Bare identifier when
// the name is a safe [A-Za-z0-9_\-.:] run; double-quoted (with
// escapes) otherwise, so shapefile attributes like "Lake Area",
// "Volume (m³)", or non-ASCII names still round-trip through the
// expression cleanly.
function attrTokenFor(attrName) {
  const s = String(attrName ?? '');
  if (s && /^[A-Za-z0-9_\-.:]+$/.test(s)) return s;
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g,  '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
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
  if (seg.type === 'literal') {
    // Escape the outer quote plus common whitespace control chars so
    // the round-trip through the textarea stays readable — otherwise
    // a literal containing an actual newline would render as a
    // hard line break inside the quotes, which reads as broken source.
    const escaped = seg.value
      .replace(/\\/g, '\\\\')
      .replace(/'/g,  "\\'")
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    return `'${escaped}'`;
  }
  // Attribute — bare when safe, "quoted" when the name has spaces
  // or any other character outside [A-Za-z0-9_\-.:].
  return attrTokenFor(seg.value);
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