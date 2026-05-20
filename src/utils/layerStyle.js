import { parseRegionLayerId } from '@/contexts/RegionLayersContext';
import { DEFAULT_STYLES } from '@/contexts/SecondaryContext';
import { regionLayerColor } from '@/config/layerSources';
import { LAYER_DEFAULT_SYMBOLOGY } from '@/config/layerDefaultSymbology';
import {
  equalIntervalBreaks,
  rampById,
  sampleRampColors,
} from '@/utils/stylePalettes';

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
  // 'continuous' = smooth interpolate over the ramp.
  // 'classified' = bin into N equal-interval classes and emit a `step`
  // expression so each class paints as a solid swatch (graduated style).
  classMode: 'continuous',
  classCount: 5,
  // Size range
  sizeBy: null,
  sizeMin: 2,
  sizeMax: 16,
  // Heatmap
  heatRadius: 24,
  heatIntensity: 1,
  // Zoom-driven overrides — { propName: { z1, v1, z2, v2 } }
  zoom: {},
  // Marker symbology (point geometry). When shape !== 'none' or icon
  // is set, MapPanel renders this layer as a `symbol` with a generated
  // PNG instead of the default `circle` paint.
  marker: { shape: 'none', icon: null, backgroundColor: null },
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
  // Layer-id-keyed default symbology — applied AFTER the region tint
  // but BEFORE the user override, so e.g. GLOF Districts ship with a
  // colorRange + Area_km2 + slate stroke unless the user has changed
  // any of those manually.
  if (typeof id === 'string' && LAYER_DEFAULT_SYMBOLOGY[id]) {
    Object.assign(base, LAYER_DEFAULT_SYMBOLOGY[id]);
  }
  // Deep-merge label so user-set partials don't wipe defaults.
  const merged = { ...base, ...(override ?? {}) };
  merged.label = { ...base.label, ...((override && override.label) || {}) };
  merged.zoom = { ...base.zoom, ...((override && override.zoom) || {}) };
  merged.marker = { ...base.marker, ...((override && override.marker) || {}) };
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
  const input = ['to-number', ['get', style.rangeBy]];

  // Classified — emit a `step` expression with N solid colors and N-1
  // internal breaks. Mapbox `step` semantics:
  //   value <  breaks[0]                     → defaultColor (colors[0])
  //   value >= breaks[i] && < breaks[i+1]    → colors[i+1]
  //   value >= breaks[N-2]                   → colors[N-1]
  if (style.classMode === 'classified') {
    const n = Math.max(2, Math.min(10, Math.floor(style.classCount) || 5));
    const breaks = equalIntervalBreaks(style.rangeMin, style.rangeMax, n);
    const colors = sampleRampColors(stops, n);
    const expr = ['step', input, colors[0]];
    for (let i = 0; i < breaks.length; i++) {
      expr.push(breaks[i], colors[i + 1]);
    }
    return expr;
  }

  // Continuous — smooth interpolate across the ramp's full stop list.
  const expr = ['interpolate', ['linear'], input];
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
    // Build the density gradient from the user's selected ramp. The first
    // stop is forced transparent so empty / very-low-density pixels don't
    // paint solid color over the basemap.
    const ramp = rampById(style.rampId);
    const stops = style.rampReversed ? [...ramp.stops].reverse() : ramp.stops;
    const heatColor = ['interpolate', ['linear'], ['heatmap-density']];
    // Mapbox's heatmap-color parser rejects hex8 (#RRGGBBAA), so emit
    // rgba() for the transparent first stop instead.
    stops.forEach((c, i) => {
      const t = stops.length === 1 ? 1 : i / (stops.length - 1);
      if (i === 0) {
        const s = c.replace('#', '');
        const r = parseInt(s.slice(0, 2), 16) || 0;
        const g = parseInt(s.slice(2, 4), 16) || 0;
        const b = parseInt(s.slice(4, 6), 16) || 0;
        heatColor.push(t, `rgba(${r},${g},${b},0)`);
      } else {
        heatColor.push(t, c);
      }
    });
    return {
      kind: 'heatmap',
      paint: {
        'heatmap-radius': zoomedOrLiteral(style, 'heatRadius', style.heatRadius ?? 24),
        'heatmap-intensity': style.heatIntensity ?? 1,
        'heatmap-opacity': style.fillOpacity ?? 0.85,
        'heatmap-color': heatColor,
      },
    };
  }

  // Build the "color" value used by Simple, with overrides for Categories /
  // Color range. Size has its own override path below.
  if (geometry === 'point') {
    let circleColor = style.fillColor ?? '#84cc16';
    if (style.type === 'categories') circleColor = categoriesExpr(style, circleColor);
    else if (style.type === 'colorRange') circleColor = colorRangeExpr(style, circleColor);

    let radius = zoomedOrLiteral(style, 'radius', style.radius ?? 6);
    if (style.type === 'sizeRange') radius = sizeRangeExpr(style, radius);

    // Marker mode: shape is a circle/square or an icon was picked. The
    // caller (MapPanel) is responsible for actually generating the
    // image and registering it via map.addImage — we just describe the
    // intent here and surface the image id.
    const marker = style.marker ?? {};
    const useMarker =
      (marker.shape && marker.shape !== 'none') || !!marker.icon;
    if (useMarker) {
      // Default: diameter (and square side) sized off the same
      // `radius` field the simple-circle path uses.
      const baseRadius = style.radius ?? 6;
      let imageRadius = baseRadius;
      let iconSize = 1;

      // Zoom-driven size — for circle layers `circle-radius` accepts a
      // pixel-valued zoom interpolation directly. Symbols can't:
      // `icon-size` is a multiplier of the embedded image's native
      // pixel dims. So we build the PNG at the LARGER of the two
      // zoom-driven sizes (so it never has to be scaled up beyond
      // its native resolution) and emit a normalised interpolation
      // for `icon-size` that goes between v1/max and v2/max.
      const z = style.zoom?.radius;
      if (
        z &&
        Number.isFinite(z.z1) && Number.isFinite(z.v1) &&
        Number.isFinite(z.z2) && Number.isFinite(z.v2)
      ) {
        const maxR = Math.max(z.v1, z.v2);
        if (maxR > 0) {
          imageRadius = maxR;
          iconSize = [
            'interpolate', ['linear'], ['zoom'],
            z.z1, z.v1 / maxR,
            z.z2, z.v2 / maxR,
          ];
        }
      }

      return {
        kind: 'symbol',
        // Surfaced for the renderer so it knows what radius to pass
        // into the marker image builder. Icon-image is filled in
        // there after addImage resolves.
        imageRadius,
        layout: {
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-size': iconSize,
        },
        paint: {
          'icon-opacity': zoomedOrLiteral(style, 'fillOpacity', style.fillOpacity ?? 1),
        },
      };
    }

    return {
      kind: 'circle',
      paint: {
        'circle-radius': radius,
        'circle-color': circleColor,
        'circle-opacity': zoomedOrLiteral(style, 'fillOpacity', style.fillOpacity ?? 0.85),
        'circle-stroke-color': style.strokeColor ?? '#4d7c0f',
        'circle-stroke-width': zoomedOrLiteral(style, 'strokeWidth', style.strokeWidth ?? 1.5),
        'circle-stroke-opacity': style.strokeOpacity ?? 1,
      },
    };
  }

  if (geometry === 'line') {
    let color = style.color ?? '#84cc16';
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
  let fillColor = style.fillColor ?? '#84cc16';
  if (style.type === 'categories') fillColor = categoriesExpr(style, fillColor);
  else if (style.type === 'colorRange') fillColor = colorRangeExpr(style, fillColor);

  return {
    kind: 'polygon',
    paint: {
      'fill-color': fillColor,
      'fill-opacity': zoomedOrLiteral(style, 'fillOpacity', style.fillOpacity ?? 0.3),
    },
    strokePaint: {
      'line-color': style.strokeColor ?? '#4d7c0f',
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
