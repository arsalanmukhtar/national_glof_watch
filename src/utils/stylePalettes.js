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
    id: 'dark2',
    label: 'Dark 2',
    colors: [
      '#1b9e77', '#d95f02', '#7570b3', '#e7298a', '#66a61e',
      '#e6ab02', '#a6761d', '#666666',
    ],
  },
];

// Sequential / diverging color ramps — each defines stops (0..1) so the
// renderer can interpolate against an attribute's normalized value.
export const COLOR_RAMPS = [
  { id: 'rdylgn',  label: 'Red → Yellow → Green',
    stops: ['#d73027', '#fc8d59', '#fee08b', '#d9ef8b', '#91cf60', '#1a9850'] },
  { id: 'viridis', label: 'Viridis',
    stops: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'] },
  { id: 'magma',   label: 'Magma',
    stops: ['#000004', '#3b0f70', '#8c2981', '#de4968', '#fe9f6d', '#fcfdbf'] },
  { id: 'blues',   label: 'Blues',
    stops: ['#f7fbff', '#c6dbef', '#6baed6', '#2171b5', '#08306b'] },
  { id: 'reds',    label: 'Reds',
    stops: ['#fff5f0', '#fcbba1', '#fb6a4a', '#cb181d', '#67000d'] },
  { id: 'greens',  label: 'Greens',
    stops: ['#f7fcf5', '#c7e9c0', '#74c476', '#238b45', '#00441b'] },
  { id: 'rdbu',    label: 'Red ↔ Blue',
    stops: ['#67001f', '#d6604d', '#f7f7f7', '#4393c3', '#053061'] },
  { id: 'purd',    label: 'Purple → Red',
    stops: ['#f7f4f9', '#d4b9da', '#df65b0', '#dd1c77', '#67001f'] },
];

export function paletteById(id) {
  return CATEGORICAL_PALETTES.find((p) => p.id === id) ?? CATEGORICAL_PALETTES[0];
}

export function rampById(id) {
  return COLOR_RAMPS.find((r) => r.id === id) ?? COLOR_RAMPS[0];
}
