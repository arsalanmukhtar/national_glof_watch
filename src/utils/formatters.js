const numberFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
});

const compactFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return numberFormatter.format(value);
}

export function formatCompact(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return compactFormatter.format(value);
}

export function formatArea(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${numberFormatter.format(value)} m²`;
}

export function formatVolume(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${numberFormatter.format(value)} m³`;
}

export function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${numberFormatter.format(value)}%`;
}
