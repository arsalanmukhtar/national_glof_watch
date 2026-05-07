// Categorical palettes — each is an array of distinct hues used to assign
// per-value colors in Categories mode. Order matters; first N values get
// first N colors, then we cycle.
export const CATEGORICAL_PALETTES = [
  {
    id: 'felt',
    label: 'Felt',
    colors: [
      '#dc2626', '#f97316', '#f59e0b', '#facc15', '#84cc16',
      '#22c55e', '#10b981', '#06b6d4', '#3b82f6', '#6366f1',
      '#8b5cf6', '#ec4899',
    ],
  },
  {
    id: 'tableau',
    label: 'Tableau 10',
    colors: [
      '#4e79a7', '#f28e2c', '#e15759', '#76b7b2', '#59a14f',
      '#edc949', '#af7aa1', '#ff9da7', '#9c755f', '#bab0ab',
    ],
  },
  {
    id: 'set2',
    label: 'Set 2',
    colors: [
      '#66c2a5', '#fc8d62', '#8da0cb', '#e78ac3', '#a6d854',
      '#ffd92f', '#e5c494', '#b3b3b3',
    ],
  },
  {
    id: 'set3',
    label: 'Set 3',
    colors: [
      '#8dd3c7', '#ffffb3', '#bebada', '#fb8072', '#80b1d3',
      '#fdb462', '#b3de69', '#fccde5', '#d9d9d9', '#bc80bd',
      '#ccebc5', '#ffed6f',
    ],
  },
  {
    id: 'dark2',
    label: 'Dark 2',
    colors: [
      '#1b9e77', '#d95f02', '#7570b3', '#e7298a', '#66a61e',
      '#e6ab02', '#a6761d', '#666666',
    ],
  },
  {
    id: 'pastel',
    label: 'Pastel',
    colors: [
      '#fbb4ae', '#b3cde3', '#ccebc5', '#decbe4', '#fed9a6',
      '#ffffcc', '#e5d8bd', '#fddaec', '#f2f2f2',
    ],
  },
  {
    id: 'accent',
    label: 'Accent',
    colors: [
      '#7fc97f', '#beaed4', '#fdc086', '#ffff99', '#386cb0',
      '#f0027f', '#bf5b17', '#666666',
    ],
  },
  {
    id: 'paired',
    label: 'Paired',
    colors: [
      '#a6cee3', '#1f78b4', '#b2df8a', '#33a02c', '#fb9a99',
      '#e31a1c', '#fdbf6f', '#ff7f00', '#cab2d6', '#6a3d9a',
      '#ffff99', '#b15928',
    ],
  },
  {
    id: 'vivid',
    label: 'Vivid',
    colors: [
      '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231',
      '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#fabebe',
      '#008080', '#e6beff',
    ],
  },
];

// Sequential / diverging color ramps — each defines stops (0..1) so the
// renderer can interpolate against an attribute's normalized value.
// Categories below are surfaced as group headings in the picker.
export const COLOR_RAMPS = [
  // ── Sequential perceptual ───────────────────────────────────────────
  { id: 'viridis', label: 'Viridis', category: 'Sequential',
    stops: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'] },
  { id: 'magma',   label: 'Magma', category: 'Sequential',
    stops: ['#000004', '#3b0f70', '#8c2981', '#de4968', '#fe9f6d', '#fcfdbf'] },
  { id: 'inferno', label: 'Inferno', category: 'Sequential',
    stops: ['#000004', '#280b54', '#65156e', '#9f2a63', '#d44842', '#f57d15', '#fac228', '#fcffa4'] },
  { id: 'plasma',  label: 'Plasma', category: 'Sequential',
    stops: ['#0d0887', '#5b02a3', '#9a179b', '#cb4778', '#eb7852', '#fbb32f', '#f0f921'] },
  { id: 'cividis', label: 'Cividis', category: 'Sequential',
    stops: ['#00204c', '#213d6b', '#555b6c', '#7b7a77', '#a59c74', '#d3c064', '#fde737'] },
  { id: 'turbo',   label: 'Turbo', category: 'Sequential',
    stops: ['#30123b', '#4145ab', '#4878d6', '#3eaff8', '#23d8c9', '#5dec73', '#a8f138', '#e3d83a', '#fb9921', '#e34d20', '#a31d12', '#7a0403'] },
  // ── Sequential single-hue ───────────────────────────────────────────
  { id: 'blues',   label: 'Blues', category: 'Single hue',
    stops: ['#f7fbff', '#c6dbef', '#6baed6', '#2171b5', '#08306b'] },
  { id: 'greens',  label: 'Greens', category: 'Single hue',
    stops: ['#f7fcf5', '#c7e9c0', '#74c476', '#238b45', '#00441b'] },
  { id: 'reds',    label: 'Reds', category: 'Single hue',
    stops: ['#fff5f0', '#fcbba1', '#fb6a4a', '#cb181d', '#67000d'] },
  { id: 'oranges', label: 'Oranges', category: 'Single hue',
    stops: ['#fff5eb', '#fdd0a2', '#fd8d3c', '#d94801', '#7f2704'] },
  { id: 'purples', label: 'Purples', category: 'Single hue',
    stops: ['#fcfbfd', '#dadaeb', '#9e9ac8', '#6a51a3', '#3f007d'] },
  { id: 'greys',   label: 'Greys', category: 'Single hue',
    stops: ['#ffffff', '#d9d9d9', '#969696', '#525252', '#000000'] },
  // ── Sequential multi-hue ────────────────────────────────────────────
  { id: 'ylorrd',  label: 'Yellow → Orange → Red', category: 'Multi-hue',
    stops: ['#ffffcc', '#ffeda0', '#fed976', '#feb24c', '#fd8d3c', '#fc4e2a', '#e31a1c', '#b10026'] },
  { id: 'ylorbr',  label: 'Yellow → Orange → Brown', category: 'Multi-hue',
    stops: ['#ffffe5', '#fff7bc', '#fee391', '#fec44f', '#fe9929', '#ec7014', '#cc4c02', '#662506'] },
  { id: 'ylgnbu',  label: 'Yellow → Green → Blue', category: 'Multi-hue',
    stops: ['#ffffd9', '#edf8b1', '#c7e9b4', '#7fcdbb', '#41b6c4', '#1d91c0', '#225ea8', '#0c2c84'] },
  { id: 'bugn',    label: 'Blue → Green', category: 'Multi-hue',
    stops: ['#f7fcfd', '#e5f5f9', '#ccece6', '#99d8c9', '#66c2a4', '#41ae76', '#238b45', '#005824'] },
  { id: 'gnbu',    label: 'Green → Blue', category: 'Multi-hue',
    stops: ['#f7fcf0', '#e0f3db', '#ccebc5', '#a8ddb5', '#7bccc4', '#4eb3d3', '#2b8cbe', '#08589e'] },
  { id: 'pubu',    label: 'Purple → Blue', category: 'Multi-hue',
    stops: ['#fff7fb', '#ece7f2', '#d0d1e6', '#a6bddb', '#74a9cf', '#3690c0', '#0570b0', '#034e7b'] },
  // ── Diverging ───────────────────────────────────────────────────────
  { id: 'rdylgn',  label: 'Red → Yellow → Green', category: 'Diverging',
    stops: ['#d73027', '#fc8d59', '#fee08b', '#d9ef8b', '#91cf60', '#1a9850'] },
  { id: 'rdylbu',  label: 'Red → Yellow → Blue', category: 'Diverging',
    stops: ['#a50026', '#d73027', '#f46d43', '#fdae61', '#fee090', '#e0f3f8', '#abd9e9', '#74add1', '#4575b4', '#313695'] },
  { id: 'spectral', label: 'Spectral', category: 'Diverging',
    stops: ['#9e0142', '#d53e4f', '#f46d43', '#fdae61', '#fee08b', '#ffffbf', '#e6f598', '#abdda4', '#66c2a5', '#3288bd', '#5e4fa2'] },
  { id: 'rdbu',    label: 'Red ↔ Blue', category: 'Diverging',
    stops: ['#67001f', '#d6604d', '#f7f7f7', '#4393c3', '#053061'] },
  { id: 'rdgy',    label: 'Red ↔ Grey', category: 'Diverging',
    stops: ['#67001f', '#d6604d', '#f4a582', '#ffffff', '#bababa', '#878787', '#1a1a1a'] },
  { id: 'purd',    label: 'Purple → Red', category: 'Diverging',
    stops: ['#f7f4f9', '#d4b9da', '#df65b0', '#dd1c77', '#67001f'] },
  { id: 'piyg',    label: 'Pink ↔ Green', category: 'Diverging',
    stops: ['#8e0152', '#c51b7d', '#de77ae', '#f1b6da', '#fde0ef', '#f7f7f7', '#e6f5d0', '#b8e186', '#7fbc41', '#4d9221', '#276419'] },
  { id: 'prgn',    label: 'Purple ↔ Green', category: 'Diverging',
    stops: ['#40004b', '#762a83', '#9970ab', '#c2a5cf', '#e7d4e8', '#f7f7f7', '#d9f0d3', '#a6dba0', '#5aae61', '#1b7837', '#00441b'] },
  { id: 'brbg',    label: 'Brown ↔ Teal', category: 'Diverging',
    stops: ['#543005', '#8c510a', '#bf812d', '#dfc27d', '#f6e8c3', '#f5f5f5', '#c7eae5', '#80cdc1', '#35978f', '#01665e', '#003c30'] },
  { id: 'coolwarm', label: 'Cool ↔ Warm', category: 'Diverging',
    stops: ['#3b4cc0', '#7693e0', '#bbd0f4', '#dddddd', '#f4c2bb', '#e0826b', '#b40426'] },
];

export function paletteById(id) {
  return CATEGORICAL_PALETTES.find((p) => p.id === id) ?? CATEGORICAL_PALETTES[0];
}

export function rampById(id) {
  return COLOR_RAMPS.find((r) => r.id === id) ?? COLOR_RAMPS[0];
}

// --- discrete-class helpers --------------------------------------------------
// Used when a numeric attribute is binned into N classes (Classified mode of
// the Color range type) so each class needs one solid color. We linearly
// interpolate the ramp to produce the requested count, regardless of how
// many stops the original ramp defines.

function hexBytes(hex) {
  const s = (hex || '').replace('#', '');
  if (s.length === 3) {
    return s.split('').map((c) => parseInt(c + c, 16) || 0);
  }
  return [
    parseInt(s.slice(0, 2), 16) || 0,
    parseInt(s.slice(2, 4), 16) || 0,
    parseInt(s.slice(4, 6), 16) || 0,
  ];
}

function bytesToHex(r, g, b) {
  const t = (n) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${t(r)}${t(g)}${t(b)}`;
}

function lerpHex(a, b, t) {
  const ax = hexBytes(a);
  const bx = hexBytes(b);
  return bytesToHex(
    ax[0] + (bx[0] - ax[0]) * t,
    ax[1] + (bx[1] - ax[1]) * t,
    ax[2] + (bx[2] - ax[2]) * t,
  );
}

// Sample N colors evenly along a ramp's stops. N=1 returns the middle stop;
// N>=2 returns endpoints + interior colors interpolated between adjacent
// stops.
export function sampleRampColors(stops, n) {
  if (!Array.isArray(stops) || stops.length === 0) return [];
  const count = Math.max(1, Math.floor(n));
  if (count === 1) return [stops[Math.floor(stops.length / 2)]];
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const seg = t * (stops.length - 1);
    const idx = Math.min(Math.floor(seg), stops.length - 2);
    const localT = seg - idx;
    out.push(lerpHex(stops[idx], stops[idx + 1], localT));
  }
  return out;
}

// Equal-interval class breaks: returns N-1 internal break points that split
// [min, max] into N equally sized buckets.
export function equalIntervalBreaks(min, max, n) {
  const count = Math.max(2, Math.min(50, Math.floor(n)));
  const span = (max ?? 0) - (min ?? 0);
  const breaks = [];
  for (let i = 1; i < count; i++) breaks.push(min + (span * i) / count);
  return breaks;
}

// Distinct values + numeric min/max for an attribute on a GeoJSON
// FeatureCollection. Used by both the Layer Style panel (to fill the
// Categories/ColorRange UI) and the data-driven default-symbology
// seeder (so the four GLOF reference layers paint correctly the moment
// they're toggled on, before the panel ever opens).
export function summarizeFeaturesAttribute(data, attrName) {
  if (!data?.features || !attrName) {
    return { distinct: [], min: null, max: null };
  }
  const distinct = new Map();
  let min = Infinity;
  let max = -Infinity;
  for (const f of data.features) {
    const v = f.properties?.[attrName];
    if (v == null || v === '') continue;
    // Accept numeric strings — many GeoJSON exporters write numbers as strings.
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n)) {
      if (n < min) min = n;
      if (n > max) max = n;
    }
    const key = String(v);
    distinct.set(key, (distinct.get(key) || 0) + 1);
  }
  return {
    distinct: [...distinct.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({ value, count })),
    min: min === Infinity ? null : min,
    max: max === -Infinity ? null : max,
  };
}
