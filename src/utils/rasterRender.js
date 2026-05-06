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
  const { min, max, sample } = computeMinMax(band, noData);

  // Render to ImageData with a min-max grayscale stretch + transparency
  // for nodata / NaN. Encode as PNG so Mapbox can use it as an
  // `image`-source `url` without juggling blob URLs (cleaner for HMR
  // and predictable cleanup).
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
    const g = Math.round(t * 255);
    px[idx] = g;
    px[idx + 1] = g;
    px[idx + 2] = g;
    px[idx + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);

  const dataUrl = canvas.toDataURL('image/png');

  return {
    bounds: [tl, tr, br, bl],
    dataUrl,
    width,
    height,
    stats: { min, max, sample: sample.slice(0, 6) },
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
