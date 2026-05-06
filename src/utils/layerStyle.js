import { parseRegionLayerId } from '@/contexts/RegionLayersContext';
import { DEFAULT_STYLES } from '@/contexts/SecondaryContext';
import { regionLayerColor } from '@/config/layerSources';
import { rampById } from '@/utils/stylePalettes';

// ---------------------------------------------------------------------------
// Defaults — `effectiveStyle()` composes layered base → region tint → user
// overrides, while `paintExprsFor()` translates that style into the actual
// Mapbox paint expressions (including data-driven and zoom-driven variants).
// ---------------------------------------------------------------------------

const TYPE_DEFAULTS = {
  type: 'simple', // simple | categories | colorRange | sizeRange | heatmap
  // Categories
  colorBy: null,
  categories: [], // [{ value, color }]
  showOther: true,
  otherColor: '#cbd5e1',
  catPaletteId: 'felt',
  // Color range
  rangeBy: null,
  rampId: 'rdylgn',
  rampReversed: false,
  rangeMin: null, // computed from data when null
  rangeMax: null,
  // Size range
  sizeBy: null,
  sizeMin: 2,
  sizeMax: 16,
  // Heatmap
  heatRadius: 24,
  heatIntensity: 1,
  // Zoom-driven overrides — { propName: { z1, v1, z2, v2 } }
  zoom: {},
  // Label
  label: {
    enabled: false,
    by: null,
    size: 12,
    color: '#0f172a',
    haloColor: '#ffffff',
    haloWidth: 1.5,
    style: 'medium', // medium | bold | italic
  },
};

export function effectiveStyle(id, geometry, override) {
  const base = {
    ...TYPE_DEFAULTS,
    ...(DEFAULT_STYLES[geometry] ?? DEFAULT_STYLES.polygon),
  };
  if (typeof id === 'string' && id.includes('::')) {
    const { layerKey } = parseRegionLayerId(id);
    const tint = regionLayerColor(layerKey);
    if (geometry === 'line') {
      base.color = tint;
    } else {
      base.fillColor = tint;
      base.strokeColor = tint;
    }
    if (layerKey === 'faultline') base.dashed = true;
  }
  // Deep-merge label so user-set partials don't wipe defaults.
  const merged = { ...base, ...(override ?? {}) };
  merged.label = { ...base.label, ...((override && override.label) || {}) };
  merged.zoom = { ...base.zoom, ...((override && override.zoom) || {}) };
  return merged;
}

// ---------------------------------------------------------------------------
// Expression builders
// ---------------------------------------------------------------------------

// Wrap a value in an `interpolate(linear, zoom, ...)` expression when the
// caller has zoom-driven this property; otherwise return the literal.
function zoomedOrLiteral(style, propKey, fallback) {
  const z = style.zoom?.[propKey];
  if (z && Number.isFinite(z.z1) && Number.isFinite(z.z2)) {
    return [
      'interpolate',
      ['linear'],
      ['zoom'],
      z.z1, z.v1,
      z.z2, z.v2,
    ];
  }
  return fallback;
}

function categoriesExpr(style, fallback) {
  if (!style.colorBy || !Array.isArray(style.categories) || style.categories.length === 0) {
    return fallback;
  }
  const match = ['match', ['to-string', ['get', style.colorBy]]];
  for (const c of style.categories) {
    match.push(String(c.value), c.color);
  }
  match.push(style.showOther ? style.otherColor : 'rgba(0,0,0,0)');
  return match;
}

function colorRangeExpr(style, fallback) {
  if (!style.rangeBy || style.rangeMin == null || style.rangeMax == null) return fallback;
  const ramp = rampById(style.rampId);
  const stops = style.rampReversed ? [...ramp.stops].reverse() : ramp.stops;
  const expr = ['interpolate', ['linear'], ['to-number', ['get', style.rangeBy]]];
  const span = style.rangeMax - style.rangeMin || 1;
  stops.forEach((s, i) => {
    const t = i / (stops.length - 1);
    expr.push(style.rangeMin + t * span, s);
  });
  return expr;
}

function sizeRangeExpr(style, fallback) {
  if (!style.sizeBy || style.rangeMin == null || style.rangeMax == null) return fallback;
  return [
    'interpolate',
    ['linear'],
    ['to-number', ['get', style.sizeBy]],
    style.rangeMin, style.sizeMin,
    style.rangeMax, style.sizeMax,
  ];
}

// Compute the Mapbox paint object for the given geometry. Returns `null` for
// the heatmap branch — caller should switch to a heatmap layer instead. The
// label paint is returned as a separate field; MapPanel adds a symbol layer
// when `label.enabled`.
export function paintExprsFor(style, geometry) {
  if (geometry === 'point' && style.type === 'heatmap') {
    return {
      kind: 'heatmap',
      paint: {
        'heatmap-radius': zoomedOrLiteral(style, 'heatRadius', style.heatRadius ?? 24),
        'heatmap-intensity': style.heatIntensity ?? 1,
        'heatmap-opacity': style.fillOpacity ?? 0.85,
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0,    'rgba(0,0,255,0)',
          0.2,  'rgba(0,255,255,0.5)',
          0.4,  'rgba(0,255,0,0.7)',
          0.6,  'rgba(255,255,0,0.85)',
          0.8,  'rgba(255,128,0,0.95)',
          1,    'rgba(255,0,0,1)',
        ],
      },
    };
  }

  // Build the "color" value used by Simple, with overrides for Categories /
  // Color range. Size has its own override path below.
  if (geometry === 'point') {
    let circleColor = style.fillColor ?? '#16a085';
    if (style.type === 'categories') circleColor = categoriesExpr(style, circleColor);
    else if (style.type === 'colorRange') circleColor = colorRangeExpr(style, circleColor);

    let radius = zoomedOrLiteral(style, 'radius', style.radius ?? 6);
    if (style.type === 'sizeRange') radius = sizeRangeExpr(style, radius);

    return {
      kind: 'circle',
      paint: {
        'circle-radius': radius,
        'circle-color': circleColor,
        'circle-opacity': zoomedOrLiteral(style, 'fillOpacity', style.fillOpacity ?? 0.85),
        'circle-stroke-color': style.strokeColor ?? '#0f7560',
        'circle-stroke-width': zoomedOrLiteral(style, 'strokeWidth', style.strokeWidth ?? 1.5),
        'circle-stroke-opacity': style.strokeOpacity ?? 1,
      },
    };
  }

  if (geometry === 'line') {
    let color = style.color ?? '#16a085';
    if (style.type === 'categories') color = categoriesExpr(style, color);
    else if (style.type === 'colorRange') color = colorRangeExpr(style, color);

    let width = zoomedOrLiteral(style, 'width', style.width ?? 2);
    if (style.type === 'sizeRange') width = sizeRangeExpr(style, width);

    return {
      kind: 'line',
      paint: {
        'line-color': color,
        'line-width': width,
        'line-opacity': zoomedOrLiteral(style, 'opacity', style.opacity ?? 1),
        'line-dasharray': style.dashed ? [2, 2] : null,
      },
    };
  }

  // polygon
  let fillColor = style.fillColor ?? '#16a085';
  if (style.type === 'categories') fillColor = categoriesExpr(style, fillColor);
  else if (style.type === 'colorRange') fillColor = colorRangeExpr(style, fillColor);

  return {
    kind: 'polygon',
    paint: {
      'fill-color': fillColor,
      'fill-opacity': zoomedOrLiteral(style, 'fillOpacity', style.fillOpacity ?? 0.3),
    },
    strokePaint: {
      'line-color': style.strokeColor ?? '#0f7560',
      'line-width': zoomedOrLiteral(style, 'strokeWidth', style.strokeWidth ?? 1.5),
      'line-opacity': style.strokeOpacity ?? 1,
    },
  };
}

// Symbol/label paint for a layer that has labels enabled.
export function labelLayoutAndPaint(style) {
  if (!style.label?.enabled || !style.label.by) return null;
  const fontWeight = style.label.style === 'bold' ? 'Bold' : 'Regular';
  return {
    layout: {
      'text-field': ['to-string', ['get', style.label.by]],
      'text-size': zoomedOrLiteral({ zoom: { labelSize: style.zoom?.labelSize } }, 'labelSize', style.label.size ?? 12),
      'text-font': [`Open Sans ${fontWeight}`, 'Arial Unicode MS Regular'],
      'text-anchor': 'top',
      'text-offset': [0, 0.6],
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': style.label.color ?? '#0f172a',
      'text-halo-color': style.label.haloColor ?? '#ffffff',
      'text-halo-width': style.label.haloWidth ?? 1.5,
    },
  };
}
