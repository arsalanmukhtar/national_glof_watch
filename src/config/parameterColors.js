// Shared per-parameter color palette. Used by ParametersPanel chip styling
// and the map's station circle layer so the two stay visually in sync.
export const PARAMETER_COLORS = {
  'Air Temperature': '#f97316',          // orange-500
  'Total Rain': '#3b82f6',               // blue-500
  'Water Level': '#06b6d4',              // cyan-500
  'Compact GAS State (WPs)': '#8b5cf6',  // violet-500
  'Istantaneous Flow': '#10b981',        // emerald-500
};

export const DEFAULT_PARAMETER_COLOR = '#84cc16';

export function colorFor(element) {
  return PARAMETER_COLORS[element] ?? DEFAULT_PARAMETER_COLOR;
}
