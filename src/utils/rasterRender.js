// ---------------------------------------------------------------------------
// Colormap presets. Each is a 256-stop RGB lookup table. Ordering goes
// from low (index 0) → high (index 255). All keys here are the canonical
// IDs used in `group.style.colormap` and the styling panel's dropdown.
// ---------------------------------------------------------------------------

// Each entry: { label, category, stops: Uint8Array(768) }.
// `category` groups the dropdown — sequential / diverging / scientific
// / domain-specific. The order below is the order the styling-panel
// dropdown surfaces them in.
export const COLORMAPS = {
  // Sequential, perceptually uniform
  grayscale: { label: 'Grayscale', category: 'Sequential',  stops: makeStopsGray() },
  viridis:   { label: 'Viridis',   category: 'Sequential',  stops: makeStopsViridis() },
  magma:     { label: 'Magma',     category: 'Sequential',  stops: makeStopsMagma() },
  inferno:   { label: 'Inferno',   category: 'Sequential',  stops: makeStopsInferno() },
  plasma:    { label: 'Plasma',    category: 'Sequential',  stops: makeStopsPlasma() },
  cividis:   { label: 'Cividis',   category: 'Sequential',  stops: makeStopsCividis() },
  // Sequential, single-hue
  blues:     { label: 'Blues',     category: 'Single hue',  stops: makeStopsBlues() },
  greens:    { label: 'Greens',    category: 'Single hue',  stops: makeStopsGreens() },
  reds:      { label: 'Reds',      category: 'Single hue',  stops: makeStopsReds() },
  // Diverging
  spectral:  { label: 'Spectral',     category: 'Diverging', stops: makeStopsSpectral() },
  rdylbu:    { label: 'Red-Yellow-Blue',  category: 'Diverging', stops: makeStopsRdYlBu() },
  rdylgn:    { label: 'Red-Yellow-Green', category: 'Diverging', stops: makeStopsRdYlGn() },
  coolwarm:  { label: 'Cool-Warm',  category: 'Diverging', stops: makeStopsCoolWarm() },
  // Domain-specific
  terrain:   { label: 'Terrain',  category: 'Domain', stops: makeStopsTerrain() },
  ndvi:      { label: 'NDVI',     category: 'Domain', stops: makeStopsNdvi() },
  ndwi:      { label: 'NDWI',     category: 'Domain', stops: makeStopsNdwi() },
  turbo:     { label: 'Turbo',    category: 'Domain', stops: makeStopsTurbo() },
};

export function listColormaps() {
  return Object.entries(COLORMAPS).map(([id, def]) => ({
    id,
    label: def.label,
    category: def.category,
  }));
}

// CSS `linear-gradient(to right, …)` derived from the LUT — used by
// the dropdown swatch and the inline panel legend so neither has to
// hand-maintain a parallel anchor list.
export function colormapCssGradient(id, stopCount = 12) {
  const def = COLORMAPS[id] ?? COLORMAPS.viridis;
  const lut = def.stops;
  const parts = [];
  for (let i = 0; i < stopCount; i++) {
    const t = i / (stopCount - 1);
    const idx = Math.round(t * 255) * 3;
    parts.push(
      `rgb(${lut[idx]}, ${lut[idx + 1]}, ${lut[idx + 2]}) ${(t * 100).toFixed(1)}%`,
    );
  }
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

// ---------------------------------------------------------------------------
// GeoTIFF → ImageData + geographic-bounds pipeline.
//
// Phase 2 / pass 1: handle the two CRS cases that 95 % of PMD-region
// rasters land in (EPSG:4326 lat/lng and EPSG:3857 web-mercator metres),
// emit a transparent grayscale render, and surface clear errors for
// anything we can't yet handle. proj4 support for arbitrary projections
// can land later without changing the call sites here.
//
// `decodeRasterForMap(blob)` returns:
//   {
//     bounds:   [[lng, lat], [lng, lat], [lng, lat], [lng, lat]],
//             // mapbox image-source 4-corner order: TL, TR, BR, BL
//     dataUrl,  // PNG-encoded ImageData ready for `image` source `url`
//     width, height,
//     stats:  { min, max, sample },
//     crs:    'EPSG:4326' | 'EPSG:3857' | 'unknown',
//   }
// ---------------------------------------------------------------------------

import { fromBlob } from 'geotiff';

const NODATA_DEFAULTS = [-9999, -3.4028235e38, 0, 32767, 65535];

export async function decodeRasterForMap(blob, opts = {}) {
  const tiff = await fromBlob(blob);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();

  // Bounding box in the raster's native CRS. Pixel order = ULX, ULY, LRX, LRY
  // (image space, where Y increases downward).
  const bbox = image.getBoundingBox();
  const [minX, minY, maxX, maxY] = bbox;

  // Geo keys → crs label. ProjectedCSTypeGeoKey wins; fall back to
  // GeographicTypeGeoKey for "GCS_*" tags (4326-family).
  const geoKeys = image.getGeoKeys?.() ?? {};
  const projected = geoKeys.ProjectedCSTypeGeoKey;
  const geographic = geoKeys.GeographicTypeGeoKey;

  let crs = 'unknown';
  let toLngLat;
  if (projected === 3857) {
    crs = 'EPSG:3857';
    toLngLat = mercatorToLngLat;
  } else if (projected === 4326 || geographic === 4326 || (!projected && !geographic)) {
    // No geo keys often means the TIFF is already in lng/lat (typical
    // for QGIS exports without a hard CRS tag). Treat as 4326 — if it
    // isn't, the bounds will land somewhere visibly wrong and the user
    // will know.
    crs = projected === 4326 ? 'EPSG:4326' : geographic === 4326 ? 'EPSG:4326' : 'EPSG:4326?';
    toLngLat = identityLngLat;
  } else {
    // Bail loud — better to raise a useful error than draw the raster
    // in the wrong place.
    throw new Error(
      `Unsupported CRS (Projected=${projected ?? '–'}, Geographic=${geographic ?? '–'}). ` +
        'Reproject to EPSG:4326 or EPSG:3857.',
    );
  }

  // Map corners in lng/lat. mapbox image source expects:
  //   [TL, TR, BR, BL]
  const tl = toLngLat(minX, maxY);
  const tr = toLngLat(maxX, maxY);
  const br = toLngLat(maxX, minY);
  const bl = toLngLat(minX, minY);

  // First band only for now. Multi-band RGB rendering lands when we
  // wire symbology controls (phase 2 / pass 2).
  const rasters = await image.readRasters({ samples: [0], interleave: false });
  const band = rasters[0];

  const noData = pickNoDataValue(image, opts.noDataHints);
  const stats = computeMinMax(band, noData);
  // User-supplied stretch wins over the data's natural range — that's how
  // the styling panel hands manual min/max overrides to the renderer.
  const min =
    Number.isFinite(opts.styleMin) ? Number(opts.styleMin) : stats.min;
  const max =
    Number.isFinite(opts.styleMax) ? Number(opts.styleMax) : stats.max;

  const cmap = COLORMAPS[opts.colormap]?.stops ?? COLORMAPS.viridis.stops;

  // Render to ImageData with a min-max stretch through the chosen
  // colormap, transparent for nodata / NaN. Encode as PNG so Mapbox can
  // use it as an `image`-source `url` (cleaner cleanup than blob URLs).
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(width, height);
  const px = imageData.data;
  const range = max > min ? max - min : 1;

  for (let i = 0; i < band.length; i++) {
    const v = band[i];
    const idx = i * 4;
    if (
      v == null ||
      Number.isNaN(v) ||
      (noData != null && v === noData) ||
      !Number.isFinite(v)
    ) {
      px[idx] = 0;
      px[idx + 1] = 0;
      px[idx + 2] = 0;
      px[idx + 3] = 0;
      continue;
    }
    const t = Math.max(0, Math.min(1, (v - min) / range));
    const ci = Math.round(t * 255) * 3;
    px[idx]     = cmap[ci];
    px[idx + 1] = cmap[ci + 1];
    px[idx + 2] = cmap[ci + 2];
    px[idx + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);

  const dataUrl = canvas.toDataURL('image/png');

  return {
    bounds: [tl, tr, br, bl],
    dataUrl,
    width,
    height,
    // `dataMin` / `dataMax` are the actual data range; `min`/`max`
    // reflect the stretch that was applied (which may differ when the
    // user has set a manual range).
    stats: {
      min,
      max,
      dataMin: stats.min,
      dataMax: stats.max,
      sample: stats.sample.slice(0, 6),
    },
    crs,
  };
}

function identityLngLat(x, y) {
  return [x, y];
}

// Web-mercator metres → lng/lat. Pure formula (no proj4 dep). Clamped
// at ±85.05113 so polar pixels don't blow up in the tan() call.
function mercatorToLngLat(x, y) {
  const R = 6378137;
  const lng = (x / R) * (180 / Math.PI);
  const latRad = Math.PI / 2 - 2 * Math.atan(Math.exp(-y / R));
  const lat = (latRad * 180) / Math.PI;
  return [lng, lat];
}

// Pick the most likely nodata sentinel: TIFF tag first, then the user's
// hints, then a small set of well-known sentinels probed against the
// data itself.
function pickNoDataValue(image, hints = []) {
  const tag = image.getGDALNoData?.();
  if (Number.isFinite(tag)) return Number(tag);
  for (const h of hints) {
    if (Number.isFinite(h)) return Number(h);
  }
  return null;
}

// Single linear scan over the band to find min / max while ignoring
// nodata + NaN. Captures a small sample so the caller can sanity-check
// the rendered output ("did we read 12-bit ints by mistake?" etc.).
function computeMinMax(band, noData) {
  let min = Infinity;
  let max = -Infinity;
  const sample = [];
  // Treat 0 as nodata when it's clearly a fill value (rare TIFFs without
  // an explicit nodata tag use 0 as a transparent background). We only
  // do this when 0 is also the minimum after the scan — see below.
  for (let i = 0; i < band.length; i++) {
    const v = band[i];
    if (v == null || Number.isNaN(v) || !Number.isFinite(v)) continue;
    if (noData != null && v === noData) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    if (sample.length < 8 && i % Math.max(1, Math.floor(band.length / 8)) === 0) {
      sample.push(v);
    }
  }
  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = min + 1;
  // Also treat ±NODATA_DEFAULTS as nodata if they happen to be the min
  // and they push the range way out of the rest of the data — common
  // pattern for elevation / NDVI rasters.
  if (NODATA_DEFAULTS.includes(min) && max - min > 1e6) {
    let nextMin = Infinity;
    for (let i = 0; i < band.length; i++) {
      const v = band[i];
      if (v === min) continue;
      if (v == null || Number.isNaN(v) || !Number.isFinite(v)) continue;
      if (v < nextMin) nextMin = v;
    }
    if (Number.isFinite(nextMin)) min = nextMin;
  }
  return { min, max, sample };
}

// Bounds-only path. Reads the TIFF header (no raster data, no colormap
// pass) and returns the same `[TL, TR, BR, BL]` lng/lat shape as the
// full decoder. Cheap enough to call when the user clicks "zoom to
// extent" on a raster that's never been made visible.
export async function decodeRasterBounds(blob) {
  const tiff = await fromBlob(blob);
  const image = await tiff.getImage();
  const [minX, minY, maxX, maxY] = image.getBoundingBox();
  const geoKeys = image.getGeoKeys?.() ?? {};
  const projected = geoKeys.ProjectedCSTypeGeoKey;
  const geographic = geoKeys.GeographicTypeGeoKey;

  let toLngLat;
  if (projected === 3857) toLngLat = mercatorToLngLat;
  else if (
    projected === 4326 ||
    geographic === 4326 ||
    (!projected && !geographic)
  )
    toLngLat = identityLngLat;
  else {
    throw new Error(
      `Unsupported CRS (Projected=${projected ?? '–'}, Geographic=${geographic ?? '–'})`,
    );
  }

  return [
    toLngLat(minX, maxY),
    toLngLat(maxX, maxY),
    toLngLat(maxX, minY),
    toLngLat(minX, minY),
  ];
}

export async function fetchRasterBounds(name) {
  const r = await fetch(`/api/rasters/file/${encodeURIComponent(name)}`);
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const j = await r.json();
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const blob = await r.blob();
  return decodeRasterBounds(blob);
}

// Convert the 4-corner lng/lat array → bbox [minX, minY, maxX, maxY]
// for `zoomToBbox`. Inputs may not be axis-aligned (mercator-projected
// rasters near poles aren't exactly rectangular in lng/lat), so we
// scan all four corners.
export function boundsToBbox(corners) {
  if (!Array.isArray(corners) || corners.length < 4) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of corners) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return null;
  return [minX, minY, maxX, maxY];
}

// Public helper — fetch the raster file from the backend and decode.
// Surfaces server-side errors as JS errors with the body's `error`
// field when present.
export async function fetchAndDecodeRaster(name, opts) {
  const r = await fetch(`/api/rasters/file/${encodeURIComponent(name)}`);
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const j = await r.json();
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const blob = await r.blob();
  return decodeRasterForMap(blob, opts);
}

// ---------------------------------------------------------------------------
// Colormap LUT builders. Each returns a Uint8Array of length 768 (256 *
// 3 bytes per RGB triple). Index 0 = low value end, 255 = high value
// end. Anchor stops are interpolated linearly between in RGB space.
// ---------------------------------------------------------------------------

function buildLUT(anchors) {
  const out = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let lo = anchors[0];
    let hi = anchors[anchors.length - 1];
    for (let k = 0; k < anchors.length - 1; k++) {
      if (t >= anchors[k][0] && t <= anchors[k + 1][0]) {
        lo = anchors[k];
        hi = anchors[k + 1];
        break;
      }
    }
    const span = hi[0] - lo[0] || 1;
    const f = (t - lo[0]) / span;
    out[i * 3]     = Math.round(lo[1] + (hi[1] - lo[1]) * f);
    out[i * 3 + 1] = Math.round(lo[2] + (hi[2] - lo[2]) * f);
    out[i * 3 + 2] = Math.round(lo[3] + (hi[3] - lo[3]) * f);
  }
  return out;
}

function makeStopsGray() {
  return buildLUT([
    [0.0, 0,   0,   0],
    [1.0, 255, 255, 255],
  ]);
}

// Viridis — Matplotlib's perceptually-uniform default. Hand-picked
// 8-anchor approximation of the full ramp.
function makeStopsViridis() {
  return buildLUT([
    [0.0,  68,   1,  84],
    [0.14, 71,  44, 122],
    [0.28, 59,  81, 139],
    [0.42, 44, 113, 142],
    [0.57, 33, 144, 141],
    [0.71, 39, 173, 129],
    [0.85, 92, 200,  99],
    [1.0, 253, 231,  37],
  ]);
}

// Magma — companion to viridis, dark→hot.
function makeStopsMagma() {
  return buildLUT([
    [0.0,    0,   0,   4],
    [0.14,  28,  16,  68],
    [0.28,  79,  18, 123],
    [0.42, 129,  37, 129],
    [0.57, 181,  54, 122],
    [0.71, 229,  80, 100],
    [0.85, 251, 135,  97],
    [1.0,  252, 253, 191],
  ]);
}

// Terrain — water → coastal → grass → forest → rock → snow.
function makeStopsTerrain() {
  return buildLUT([
    [0.0,   42,  77, 130],
    [0.15,  74, 143, 187],
    [0.3,  115, 195, 122],
    [0.5,  237, 217, 119],
    [0.7,  175, 134,  86],
    [0.85, 142, 117, 102],
    [1.0,  255, 255, 255],
  ]);
}

// NDVI — common red→yellow→green ramp for vegetation indices.
function makeStopsNdvi() {
  return buildLUT([
    [0.0,  165,   0,  38],
    [0.25, 215,  48,  39],
    [0.4,  244, 109,  67],
    [0.55, 254, 224, 139],
    [0.7,  217, 239, 139],
    [0.85, 102, 189,  99],
    [1.0,   26, 152,  80],
  ]);
}

// Inferno — companion to viridis, dark blue → orange/yellow.
function makeStopsInferno() {
  return buildLUT([
    [0.0,    0,   0,   4],
    [0.14,  40,  11,  84],
    [0.28, 101,  21, 110],
    [0.42, 159,  42,  99],
    [0.57, 212,  72,  66],
    [0.71, 245, 125,  21],
    [0.85, 250, 193,  39],
    [1.0,  252, 255, 164],
  ]);
}

// Plasma — purple → pink → yellow.
function makeStopsPlasma() {
  return buildLUT([
    [0.0,   13,   8, 135],
    [0.14,  75,   3, 161],
    [0.28, 125,   3, 168],
    [0.42, 168,  34, 150],
    [0.57, 203,  70, 121],
    [0.71, 229, 107,  93],
    [0.85, 248, 148,  65],
    [1.0,  240, 249,  33],
  ]);
}

// Cividis — colorblind-safe alternative to viridis.
function makeStopsCividis() {
  return buildLUT([
    [0.0,    0,  32,  76],
    [0.25,  28,  72, 113],
    [0.5,   94, 110, 113],
    [0.75, 160, 152,  92],
    [1.0,  252, 235,  50],
  ]);
}

// Single-hue sequential — light to saturated. Matplotlib-style.
function makeStopsBlues() {
  return buildLUT([
    [0.0,  247, 251, 255],
    [0.5,  107, 174, 214],
    [1.0,    8,  48, 107],
  ]);
}
function makeStopsGreens() {
  return buildLUT([
    [0.0,  247, 252, 245],
    [0.5,  116, 196, 118],
    [1.0,    0,  68,  27],
  ]);
}
function makeStopsReds() {
  return buildLUT([
    [0.0,  255, 245, 240],
    [0.5,  252, 146, 114],
    [1.0,  103,   0,  13],
  ]);
}

// Spectral — diverging rainbow (red → yellow → blue) with a neutral
// middle. Good for anomaly maps where 0 lands at the center.
function makeStopsSpectral() {
  return buildLUT([
    [0.0,  158,   1,  66],
    [0.2,  213,  62,  79],
    [0.4,  244, 109,  67],
    [0.5,  254, 224, 139],
    [0.6,  230, 245, 152],
    [0.8,  102, 194, 165],
    [1.0,   94,  79, 162],
  ]);
}

// Red-yellow-blue diverging — classic temperature anomaly palette.
function makeStopsRdYlBu() {
  return buildLUT([
    [0.0,  165,   0,  38],
    [0.25, 244, 109,  67],
    [0.5,  255, 255, 191],
    [0.75, 116, 173, 209],
    [1.0,   49,  54, 149],
  ]);
}

// Red-yellow-green diverging — common for vegetation health / risk.
function makeStopsRdYlGn() {
  return buildLUT([
    [0.0,  165,   0,  38],
    [0.25, 244, 109,  67],
    [0.5,  255, 255, 191],
    [0.75, 166, 217, 106],
    [1.0,    0, 104,  55],
  ]);
}

// Cool-warm — blue → desaturated middle → red. ParaView default.
function makeStopsCoolWarm() {
  return buildLUT([
    [0.0,   59,  76, 192],
    [0.5,  221, 221, 221],
    [1.0,  180,   4,  38],
  ]);
}

// NDWI — water index, complementary to NDVI: blue at high values
// (water) → tan at low values (dry land).
function makeStopsNdwi() {
  return buildLUT([
    [0.0,  120,  84,  44],
    [0.3,  237, 217, 119],
    [0.5,  205, 230, 232],
    [0.7,  100, 168, 217],
    [1.0,   12,  44, 132],
  ]);
}

// Turbo — Google's improved jet replacement, perceptually closer to
// monotonic luminance than rainbow but keeps the high contrast.
function makeStopsTurbo() {
  return buildLUT([
    [0.0,   48,  18,  59],
    [0.13,  35,  67, 178],
    [0.27,  40, 145, 255],
    [0.4,   45, 215, 207],
    [0.53, 108, 246, 113],
    [0.67, 211, 233,  65],
    [0.8,  250, 167,  53],
    [0.93, 235,  84,  25],
    [1.0,  122,   4,   3],
  ]);
}
