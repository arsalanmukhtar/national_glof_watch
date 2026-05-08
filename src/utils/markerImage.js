// ---------------------------------------------------------------------------
// Marker image generation — turns a layer's marker style spec into a
// rasterised image suitable for `map.addImage()`. Caches by spec hash
// so flipping a marker between two colours doesn't regenerate the
// image on every paint pass.
//
// Output composition:
//   • shape ('circle' | 'square') drawn first as the background, using
//     the layer's fillColor + strokeColor + strokeWidth.
//   • icon SVG (from src/config/markerIcons.js) drawn over it.
//   • when shape === 'none', only the icon is drawn — its strokes
//     pick up fillColor so single-colour pictograms look right.
// ---------------------------------------------------------------------------

import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { findIcon } from '@/config/markerIcons';

// Pixel size of the generated PNG. The marker's `radius` style field
// drives the FINAL on-map size via `icon-size`-style scaling — but
// since we set `icon-size: 1` in layerStyle.js, the canvas pixel size
// is what shows up. So we make the canvas (radius * 2 + padding) px,
// at devicePixelRatio for retina sharpness.
//
// A small padding around the shape lets the stroke breathe without
// clipping at the edges.
const PADDING = 2;
const MIN_SIZE = 12;

// LRU-bounded cache. Keys are the deterministic spec strings produced
// by `markerSpecKey`. We hold up to N images in memory at once;
// regenerating is cheap (sub-millisecond) but recomputing on every
// repaint would still be wasteful and would re-trigger Mapbox's
// addImage path each time.
const CACHE_LIMIT = 64;
const cache = new Map();

function cacheGet(key) {
  if (!cache.has(key)) return null;
  const v = cache.get(key);
  cache.delete(key);
  cache.set(key, v); // bump to most-recent
  return v;
}

function cacheSet(key, value) {
  cache.set(key, value);
  while (cache.size > CACHE_LIMIT) {
    const first = cache.keys().next().value;
    cache.delete(first);
  }
}

// Stable string built from every input that affects the rendered
// pixels. Two layers with the same spec share the same image id, so
// Mapbox only allocates one texture.
export function markerSpecKey({
  shape,
  iconId,
  fillColor,
  strokeColor,
  strokeWidth,
  backgroundColor,
  size,
  dpr,
}) {
  return [
    shape || 'none',
    iconId || '_',
    fillColor || '_',
    strokeColor || '_',
    strokeWidth ?? 1.5,
    backgroundColor || '_',
    size,
    dpr,
  ].join('|');
}

// Build the marker SVG as a string.
//
// Three cases — colour semantics:
//   • shape === 'none': bare icon. `fillColor` paints the icon's
//     stroke; `strokeColor` is rendered as a halo by drawing the same
//     icon paths *underneath* with a wider stroke. So the user's
//     stroke field actually does something visible (matching what they
//     expect from the screenshot — pink cars with a green outline).
//   • shape === 'circle' | 'square': background uses
//     `backgroundColor` (defaults to fillColor for back-compat with
//     pre-marker rasters) with `strokeColor` as its border. The icon
//     itself sits on top at ~60 % of the inner box, stroked in
//     `fillColor` so it contrasts the chosen background.
//
// SVG inheritance gotcha: when we extract lucide's children and
// re-host them in our wrapper SVG, the parent <svg stroke="…"> is
// gone — so the paths inside need to inherit from the <g> we put
// them in. That's why the icon group always sets stroke / fill /
// stroke-width / linecaps explicitly: without them the paths would
// fall back to the browser default (black stroke).

// Case-insensitive equality on hex colours, normalising the leading
// '#' so '#ABC123' and 'ABC123' compare equal.
function sameColor(a, b) {
  if (!a || !b) return false;
  return String(a).replace(/^#/, '').toLowerCase() ===
    String(b).replace(/^#/, '').toLowerCase();
}

// Pick black or white for an icon overlay based on the bg's perceived
// luminance (YIQ approximation). Used when the user hasn't picked a
// distinct bg vs. fillColor — without this the icon stroke == bg fill
// and the glyph disappears.
function autoContrastFor(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#ffffff';
  const yiq = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
  return yiq >= 128 ? '#000000' : '#ffffff';
}

function buildMarkerSvg({
  shape,
  iconId,
  fillColor,
  strokeColor,
  strokeWidth,
  backgroundColor,
  size,
}) {
  const sw = Math.max(0, Number(strokeWidth) || 0);
  const half = size / 2;
  // Inner box that the shape fills, leaving room for the stroke.
  const inner = size - sw - PADDING * 2;
  const innerHalf = inner / 2;

  // Icon goes inside the shape at ~62% of inner box. When there's no
  // shape, the icon takes the whole canvas (minus padding).
  const iconBox =
    shape && shape !== 'none' ? Math.max(8, inner * 0.62) : inner;

  const icon = findIcon(iconId);
  let iconChildren = '';
  if (icon) {
    const raw = renderToStaticMarkup(
      createElement(icon.Component, {
        size: 24,
        // Component-level props are mostly thrown away — we set the
        // real attributes on the wrapping <g> below for inheritance,
        // since extracting children strips the lucide root <svg>.
        stroke: 'currentColor',
        strokeWidth: 2,
        fill: 'none',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
    );
    const match = raw.match(/<svg[^>]*>([\s\S]*)<\/svg>/i);
    iconChildren = match ? match[1] : '';
  }

  const iconScale = iconBox / 24;
  const iconOffsetX = (size - iconBox) / 2;
  const iconOffsetY = (size - iconBox) / 2;
  const iconTransform = `translate(${iconOffsetX} ${iconOffsetY}) scale(${iconScale})`;

  let shapeMarkup = '';
  let iconStrokeColor = fillColor;
  let halo = '';

  if (shape === 'circle' || shape === 'square') {
    const bg = backgroundColor || fillColor;
    // When the user hasn't picked a background distinct from the fill,
    // the icon would be invisible (same colour rendered on the same
    // colour). Auto-contrast picks black or white based on the bg's
    // perceived luminance so the icon is always legible. Only kicks
    // in when bg === fillColor — if the user picked a different bg
    // colour, we trust them and use the fillColor as-is.
    if (sameColor(bg, fillColor)) {
      iconStrokeColor = autoContrastFor(bg);
    }
    if (shape === 'circle') {
      shapeMarkup = `<circle cx="${half}" cy="${half}" r="${innerHalf}" fill="${bg}" stroke="${strokeColor}" stroke-width="${sw}"/>`;
    } else {
      const x = (size - inner) / 2;
      shapeMarkup = `<rect x="${x}" y="${x}" width="${inner}" height="${inner}" rx="${inner * 0.18}" fill="${bg}" stroke="${strokeColor}" stroke-width="${sw}"/>`;
    }
  } else if (iconChildren && sw > 0) {
    // shape === 'none': render a halo by stamping the icon paths
    // underneath the main icon with a wider stroke in `strokeColor`.
    // Halo width = the user's stroke width on each side of the icon's
    // natural 2px stroke. When sw is 0, no halo is drawn (the user
    // explicitly turned the outline off).
    //
    // The halo is drawn in the icon's 24×24 coordinate space which
    // gets scaled by `iconScale` on the way to output px — so we
    // inverse-scale the requested px width to keep the on-screen
    // halo the same thickness regardless of icon size.
    const haloIconSpace = 2 + (sw * 2) / Math.max(0.0001, iconScale);
    halo =
      `<g transform="${iconTransform}" ` +
      `stroke="${strokeColor}" stroke-width="${haloIconSpace}" ` +
      `fill="none" stroke-linecap="round" stroke-linejoin="round">` +
      iconChildren +
      `</g>`;
  }

  const iconGroup = iconChildren
    ? `<g transform="${iconTransform}" ` +
      `stroke="${iconStrokeColor}" stroke-width="2" fill="none" ` +
      `stroke-linecap="round" stroke-linejoin="round">` +
      iconChildren +
      `</g>`
    : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    shapeMarkup +
    halo +
    iconGroup +
    `</svg>`
  );
}

// Convert an SVG string to an ImageBitmap that `map.addImage()` can
// take. Browsers accept HTMLImageElement too, but ImageBitmap avoids
// the implicit GC + decode lifecycle.
async function svgToImageBitmap(svg, pxWidth, pxHeight) {
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    // Render into an OffscreenCanvas so we get an ImageBitmap-like
    // ImageData payload at our desired pixel dimensions (DPR-aware).
    const canvas = document.createElement('canvas');
    canvas.width = pxWidth;
    canvas.height = pxHeight;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, pxWidth, pxHeight);
    return ctx.getImageData(0, 0, pxWidth, pxHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Public entry point. Returns `{ key, imageData, pixelRatio, width, height }`
// — `pixelRatio` is what map.addImage wants alongside the raw bitmap so
// retina screens render the icon sharp.
export async function buildMarkerImage(spec) {
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  // Total CSS px footprint of the marker — driven by the layer's radius
  // (which the caller passes in `spec.size`). Add padding so the
  // outer stroke isn't clipped at the canvas edge.
  const cssSize = Math.max(MIN_SIZE, Number(spec.size) * 2 + PADDING * 2);
  const pxSize = Math.round(cssSize * dpr);

  const key = markerSpecKey({ ...spec, size: cssSize, dpr });
  const cached = cacheGet(key);
  if (cached) return cached;

  const svg = buildMarkerSvg({
    shape: spec.shape || 'none',
    iconId: spec.iconId || null,
    fillColor: spec.fillColor || '#16a085',
    strokeColor: spec.strokeColor || '#0f7560',
    strokeWidth: spec.strokeWidth ?? 1.5,
    // backgroundColor only matters when a shape is set; the SVG
    // builder falls back to fillColor when null so the legacy
    // "background = fill" behaviour stays the default for users who
    // haven't explicitly picked a separate bg.
    backgroundColor: spec.backgroundColor || null,
    size: cssSize,
  });

  const imageData = await svgToImageBitmap(svg, pxSize, pxSize);
  const result = {
    key,
    imageData,
    pixelRatio: dpr,
    width: pxSize,
    height: pxSize,
  };
  cacheSet(key, result);
  return result;
}
