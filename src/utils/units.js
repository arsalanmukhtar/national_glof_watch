// Unit inference + formatting for feature attributes.
//
// Many of the columns in our GeoJSON / PostGIS sources have units baked
// into their names (`area_km2`, `length_m`, `volume_m3`, `height_m`,
// `temperature_c`, …). The Feature Details panel and the Attributes
// Table both want to show the value with its unit suffix and a label
// without the suffix — `area_km2: 12.34` should render as "Area: 12.34
// km²", not "Area Km2: 12.34". This module centralises the matching.
//
// We also expose a tiny formatter that pairs a numeric value with its
// unit so callers don't have to re-derive the formatting rules.

// ---------------------------------------------------------------------------
// Suffix → unit string (the symbol the user sees in the rendered cell).
// Order matters: longer suffixes first so `_km2` matches before `_km`,
// `_m3` before `_m`, etc. Anchored on `_` so a column called "team"
// doesn't get mistaken for "te" + "am".
// ---------------------------------------------------------------------------
const SUFFIX_TO_UNIT = [
  { suffix: 'km2',     unit: 'km²' },
  { suffix: 'km3',     unit: 'km³' },
  { suffix: 'm2',      unit: 'm²'  },
  { suffix: 'm3',      unit: 'm³'  },
  { suffix: 'kmh',     unit: 'km/h' },
  { suffix: 'mps',     unit: 'm/s' },
  { suffix: 'mph',     unit: 'mph' },
  { suffix: 'hpa',     unit: 'hPa' },
  { suffix: 'pct',     unit: '%'   },
  { suffix: 'percent', unit: '%'   },
  { suffix: 'acre',    unit: 'acre' },
  { suffix: 'acres',   unit: 'acres' },
  { suffix: 'ha',      unit: 'ha'  },
  { suffix: 'km',      unit: 'km'  },
  { suffix: 'm',       unit: 'm'   },
  { suffix: 'ft',      unit: 'ft'  },
  { suffix: 'in',      unit: 'in'  },
  { suffix: 'cm',      unit: 'cm'  },
  { suffix: 'mm',      unit: 'mm'  },
  { suffix: 'c',       unit: '°C'  },
  { suffix: 'f',       unit: '°F'  },
  { suffix: 'k',       unit: 'K'   },
  { suffix: 'v',       unit: 'V'   },
];

// Specific keys whose units aren't expressible as a `_unit` suffix.
// E.g. `population` is unitless (a count), but we still want a clean
// label override. Looked up case-insensitively.
const KEY_HINT_OVERRIDES = {
  population: { label: 'Population', unit: null },
  return_per: { label: 'Return Period', unit: 'yr' },
  enrolmnt:   { label: 'Enrolment',   unit: null },
  teachers:   { label: 'Teachers',    unit: null },
  elev:       { label: 'Elevation',   unit: 'm' },
  altitude:   { label: 'Altitude',    unit: 'm' },
};

// Some bases consistently mean a particular concept; rewrite those to
// the canonical word. Applied AFTER suffix stripping.
const BASE_RELABEL = {
  area:      'Area',
  length:    'Length',
  perimeter: 'Perimeter',
  height:    'Height',
  width:     'Width',
  depth:     'Depth',
  volume:    'Volume',
  elevation: 'Elevation',
  altitude:  'Altitude',
  temp:      'Temperature',
  temperature: 'Temperature',
};

// Match a key against the suffix table. Returns { baseKey, unit } or
// null if no suffix recognised. Case-insensitive on both sides; keys
// like `Area_KM2` and `area_km2` both resolve.
function matchSuffix(key) {
  const lower = String(key).toLowerCase();
  for (const { suffix, unit } of SUFFIX_TO_UNIT) {
    const tail = `_${suffix}`;
    if (lower.endsWith(tail) && lower.length > tail.length) {
      const base = lower.slice(0, -tail.length);
      return { baseKey: base, unit };
    }
  }
  return null;
}

// snake_case / camelCase → "Title Case". Used for the displayed label
// after the unit suffix has been stripped.
function humanize(key) {
  return String(key)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b([a-z])(\w*)/g, (_, a, b) => a.toUpperCase() + b);
}

// Resolve a property key into its display label + unit. Returns
// `{ label, unit }` where `unit` may be null. Result shape is stable
// regardless of which path matched, so callers don't have to branch.
export function inferUnit(rawKey) {
  if (!rawKey) return { label: '', unit: null };

  const overrideKey = String(rawKey).toLowerCase();
  if (KEY_HINT_OVERRIDES[overrideKey]) {
    return KEY_HINT_OVERRIDES[overrideKey];
  }

  const m = matchSuffix(rawKey);
  if (m) {
    const baseLower = m.baseKey;
    const canonical = BASE_RELABEL[baseLower];
    return {
      label: canonical ?? humanize(m.baseKey),
      unit:  m.unit,
    };
  }

  return { label: humanize(rawKey), unit: null };
}

// Format a primitive value with optional unit. Numbers get locale
// grouping + truncation matching the rest of the dashboard's numeric
// rendering. Non-numeric values pass through untouched (string, bool).
export function formatValueWithUnit(value, unit) {
  if (value == null || value === '') return '—';
  if (typeof value === 'number' && Number.isFinite(value)) {
    const abs = Math.abs(value);
    let formatted;
    if (Number.isInteger(value)) {
      formatted = value.toLocaleString();
    } else if (abs !== 0 && (abs < 1e-3 || abs >= 1e9)) {
      formatted = value.toExponential(3);
    } else {
      formatted = Number(value.toFixed(4)).toLocaleString(undefined, {
        maximumFractionDigits: 4,
      });
    }
    return unit ? `${formatted} ${unit}` : formatted;
  }
  return String(value);
}
