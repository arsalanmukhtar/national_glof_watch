// ---------------------------------------------------------------------------
// Client-side geospatial analysis primitives.
//
// Everything here runs in the browser against already-loaded data — the
// decoded raster band the renderer keeps on RasterContext and the
// FeatureCollections cached by the layer-sources fetcher. No round-trips.
//
// Current operations:
//   * zonalStatistics — sum / mean / min / max / median / count of raster
//     pixel values that fall inside one or more polygons.
//
// The polygon mask uses a ray-casting point-in-polygon test, which is
// O(pixels × polygon-vertices). For the population case (a global pop
// raster clipped to Pakistan ≈ 700k pixels and a glacier polygon with
// a few hundred rings × a few thousand vertices) it runs in well under
// a second on a modern laptop. The implementation is allocation-free in
// the hot loop so JIT'd numbers stay in arrays.
// ---------------------------------------------------------------------------

// ---------- bbox + bounds ---------------------------------------------------

export function bboxOfGeometry(geom) {
  if (!geom) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (coords, depth) => {
    if (depth === 1) {
      // ring: [[x,y], [x,y], ...]
      for (const [x, y] of coords) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    } else {
      for (const c of coords) visit(c, depth - 1);
    }
  };
  switch (geom.type) {
    case 'Polygon':         visit(geom.coordinates, 2); break;
    case 'MultiPolygon':    visit(geom.coordinates, 3); break;
    case 'LineString':      visit(geom.coordinates, 1); break;
    case 'MultiLineString': visit(geom.coordinates, 2); break;
    case 'Point':           {
      const [x, y] = geom.coordinates;
      return [x, y, x, y];
    }
    case 'MultiPoint':      visit(geom.coordinates, 1); break;
    default: return null;
  }
  if (!Number.isFinite(minX)) return null;
  return [minX, minY, maxX, maxY];
}

export function bboxOfFeatureCollection(fc) {
  if (!fc?.features?.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of fc.features) {
    const b = bboxOfGeometry(f.geometry);
    if (!b) continue;
    if (b[0] < minX) minX = b[0];
    if (b[1] < minY) minY = b[1];
    if (b[2] > maxX) maxX = b[2];
    if (b[3] > maxY) maxY = b[3];
  }
  if (!Number.isFinite(minX)) return null;
  return [minX, minY, maxX, maxY];
}

export function bboxesOverlap(a, b) {
  if (!a || !b) return false;
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

// ---------- point-in-polygon -----------------------------------------------

// Ray-casting test for a single ring. Treats the ring as closed —
// callers don't need to duplicate the first vertex at the end.
function ringContains(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-30) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// Polygon (with optional holes): point is inside the outer ring AND
// outside every hole.
function polygonContains(coordinates, x, y) {
  if (!coordinates?.length) return false;
  if (!ringContains(coordinates[0], x, y)) return false;
  for (let i = 1; i < coordinates.length; i++) {
    if (ringContains(coordinates[i], x, y)) return false;
  }
  return true;
}

// Test a point against any geometry. Returns true if the point is
// inside the geometry (or any sub-polygon for MultiPolygon).
export function geometryContainsPoint(geom, x, y) {
  if (!geom) return false;
  switch (geom.type) {
    case 'Polygon':
      return polygonContains(geom.coordinates, x, y);
    case 'MultiPolygon':
      for (const poly of geom.coordinates) {
        if (polygonContains(poly, x, y)) return true;
      }
      return false;
    default:
      return false;
  }
}

// Pre-flatten all polygons across a FeatureCollection into a single
// list of rings + a quick bbox per polygon so the inner loop can skip
// polygons whose bbox doesn't cover the pixel's column band. Speeds up
// the zonal-stats loop dramatically when many polygons are tiny relative
// to the raster extent.
function flattenPolygonsWithBbox(fc) {
  const polys = [];
  const pushPoly = (rings) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of rings[0]) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    polys.push({ rings, bbox: [minX, minY, maxX, maxY] });
  };
  const features = fc?.features ?? (fc?.type === 'Feature' ? [fc] : []);
  for (const f of features) {
    const g = f?.geometry;
    if (!g) continue;
    if (g.type === 'Polygon') {
      pushPoly(g.coordinates);
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates) pushPoly(poly);
    }
  }
  return polys;
}

// ---------- raster ---------------------------------------------------------

// Decoded payload (from RasterContext.getGroupDecoded) carries the 4
// corner bounds rather than a single axis-aligned bbox. For the
// north-up rasters the renderer baked, corners are [tl, tr, br, bl]
// where tl=[west, north], br=[east, south]. Extract a bbox we can
// iterate in pixel space.
function axisAlignedBoundsFrom(decoded) {
  if (!decoded?.bounds || decoded.bounds.length < 4) return null;
  const [tl, , br] = decoded.bounds;
  if (!Array.isArray(tl) || !Array.isArray(br)) return null;
  const [west, north] = tl;
  const [east, south] = br;
  if (![west, north, east, south].every(Number.isFinite)) return null;
  return { west, north, east, south };
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// ---------- zonal statistics -----------------------------------------------

/**
 * Compute summary statistics of raster pixel values that fall inside
 * the given polygon mask.
 *
 * @param {object} decoded — RasterContext.getGroupDecoded(groupId) payload.
 *   Must carry { band, width, height, bounds, noData, layerName }.
 * @param {object} mask — GeoJSON FeatureCollection / Feature / Geometry
 *   containing Polygon / MultiPolygon. Coordinates assumed in EPSG:4326,
 *   same CRS as the raster.
 * @param {object} opts
 *   - sampleCap: max pixels to retain for median (default 4_000_000;
 *     the rest still count toward sum/count/min/max).
 *
 * @returns {object}
 *   {
 *     count, sum, mean, min, max, std, median,
 *     p10, p25, p75, p90,                       // distribution quartiles
 *     coveredPixels, totalPixels, coveragePct,
 *     polygonBbox, rasterBbox,
 *     elapsedMs,
 *   }
 */
export function zonalStatistics(decoded, mask, opts = {}) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const sampleCap = opts.sampleCap ?? 4_000_000;

  const aab = axisAlignedBoundsFrom(decoded);
  if (!aab) throw new Error('Raster bounds missing or non-axis-aligned.');
  const { band, width, height, noData } = decoded;
  if (!band || !width || !height) {
    throw new Error('Raster band/dims missing — toggle the layer on first.');
  }

  // Normalise mask → FeatureCollection so the flattener has one path.
  let fc;
  if (mask?.type === 'FeatureCollection') fc = mask;
  else if (mask?.type === 'Feature') fc = { type: 'FeatureCollection', features: [mask] };
  else if (mask?.type) fc = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: mask, properties: {} }] };
  else throw new Error('Mask is not GeoJSON.');

  const polys = flattenPolygonsWithBbox(fc);
  if (polys.length === 0) {
    throw new Error('Mask contains no polygons (only Polygon / MultiPolygon are supported).');
  }
  const maskBbox = bboxOfFeatureCollection(fc);

  // Pixel grid → lon/lat mapping. The bounds array gives the *outer*
  // corners; pixel centers are offset by half a pixel inward.
  const dx = (aab.east - aab.west) / width;
  const dy = (aab.south - aab.north) / height; // negative — y decreases as row increases
  const lonOfCol = (col) => aab.west + (col + 0.5) * dx;
  const latOfRow = (row) => aab.north + (row + 0.5) * dy;

  // Column / row span that actually intersects the mask's bbox — outside
  // this rectangle no pixel can be inside any polygon. Saves the inner
  // loop from millions of bbox-miss point tests.
  const c0 = Math.max(0, Math.floor((maskBbox[0] - aab.west) / dx));
  const c1 = Math.min(width - 1, Math.ceil((maskBbox[2] - aab.west) / dx));
  const r0 = Math.max(0, Math.floor((aab.north - maskBbox[3]) / -dy));
  const r1 = Math.min(height - 1, Math.ceil((aab.north - maskBbox[1]) / -dy));

  let count = 0;
  let sum = 0;
  let sumSq = 0;
  let minVal = Infinity;
  let maxVal = -Infinity;
  // Keep raw values for percentile / median up to sampleCap.
  const samples = new Float64Array(Math.min(sampleCap, (c1 - c0 + 1) * (r1 - r0 + 1)));
  let sampleN = 0;

  for (let row = r0; row <= r1; row++) {
    const lat = latOfRow(row);
    // pre-filter polygons by Y-band
    const candidates = polys.filter(
      (p) => lat >= p.bbox[1] && lat <= p.bbox[3],
    );
    if (!candidates.length) continue;
    const rowOffset = row * width;
    for (let col = c0; col <= c1; col++) {
      const lon = lonOfCol(col);
      // Check candidates whose X-band covers the pixel.
      let inside = false;
      for (let p = 0; p < candidates.length; p++) {
        const poly = candidates[p];
        if (lon < poly.bbox[0] || lon > poly.bbox[2]) continue;
        if (!ringContains(poly.rings[0], lon, lat)) continue;
        // Check holes (if any).
        let inHole = false;
        for (let h = 1; h < poly.rings.length; h++) {
          if (ringContains(poly.rings[h], lon, lat)) { inHole = true; break; }
        }
        if (!inHole) { inside = true; break; }
      }
      if (!inside) continue;
      const v = band[rowOffset + col];
      if (
        v == null ||
        !Number.isFinite(v) ||
        (noData != null && v === noData)
      ) continue;
      count++;
      sum += v;
      sumSq += v * v;
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
      if (sampleN < samples.length) samples[sampleN++] = v;
    }
  }

  const mean = count > 0 ? sum / count : null;
  const variance = count > 1 ? (sumSq - (sum * sum) / count) / (count - 1) : 0;
  const std = count > 1 ? Math.sqrt(Math.max(0, variance)) : 0;

  // Median + percentiles from the sampled values. Sort once.
  let median = null, p10 = null, p25 = null, p75 = null, p90 = null;
  if (sampleN > 0) {
    const sortable = samples.slice(0, sampleN);
    sortable.sort();
    median = quantile(sortable, 0.5);
    p10 = quantile(sortable, 0.10);
    p25 = quantile(sortable, 0.25);
    p75 = quantile(sortable, 0.75);
    p90 = quantile(sortable, 0.90);
  }

  const totalPixels = (c1 - c0 + 1) * (r1 - r0 + 1);
  const coveragePct = totalPixels > 0 ? (count / totalPixels) * 100 : 0;
  const elapsedMs = Math.round(
    (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0,
  );

  return {
    count,
    sum,
    mean,
    min: count > 0 ? minVal : null,
    max: count > 0 ? maxVal : null,
    std,
    median,
    p10, p25, p75, p90,
    coveredPixels: count,
    totalPixels: width * height,
    coveragePct,
    polygonBbox: maskBbox,
    rasterBbox: [aab.west, aab.south, aab.east, aab.north],
    elapsedMs,
  };
}

// ---------- formatting -----------------------------------------------------

export function formatStatNumber(v, decimals = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(decimals)} B`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(decimals)} M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(decimals)} K`;
  return v.toFixed(decimals);
}

export function formatIntegerWithCommas(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return Math.round(v).toLocaleString('en-US');
}

// ---------- feature selection ---------------------------------------------

// Internal — does any vertex of a single mask polygon lie inside the
// given outer ring (with optional holes)? Sufficient when paired with
// the symmetric "any feature vertex in any mask" check to catch every
// intersection short of exotic edge-only-crossings.
function vertexInAnyMaskPoly(x, y, maskPolys) {
  for (let i = 0; i < maskPolys.length; i++) {
    const mp = maskPolys[i];
    if (x < mp.bbox[0] || x > mp.bbox[2]) continue;
    if (y < mp.bbox[1] || y > mp.bbox[3]) continue;
    if (!ringContains(mp.rings[0], x, y)) continue;
    let inHole = false;
    for (let h = 1; h < mp.rings.length; h++) {
      if (ringContains(mp.rings[h], x, y)) { inHole = true; break; }
    }
    if (!inHole) return true;
  }
  return false;
}

function featurePolygonRings(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  return [];
}

/**
 * Pick features from `layerFC` whose geometry intersects any polygon in
 * `maskFC`. Intended for "select-by-lasso": the user drags a rectangle
 * or draws a polygon over the map; this returns the subset of the
 * underlying polygon layer that overlaps that lasso.
 *
 * Uses a bbox-overlap pre-filter, then "any-vertex-of-either-inside-the-other"
 * — handles fully contained / partially overlapping cases and is fast
 * enough for thousands of features. Edge-only-crossings (no vertex of
 * either polygon falls inside the other) are not detected — vanishingly
 * rare for typical glacial-lake / glacier features against a drawn AOI.
 */
export function selectFeaturesByMask(layerFC, maskFC) {
  const empty = { type: 'FeatureCollection', features: [] };
  if (!layerFC?.features?.length || !maskFC?.features?.length) return empty;
  const maskPolys = flattenPolygonsWithBbox(maskFC);
  if (!maskPolys.length) return empty;
  const maskBbox = bboxOfFeatureCollection(maskFC);

  const out = [];
  for (const feature of layerFC.features) {
    const g = feature?.geometry;
    if (!g) continue;
    const fb = bboxOfGeometry(g);
    if (!fb || !bboxesOverlap(fb, maskBbox)) continue;

    const rings = featurePolygonRings(g);
    if (!rings.length) continue;

    let hit = false;

    // 1. Any vertex of the feature inside any mask polygon?
    outer: for (const poly of rings) {
      for (const [x, y] of poly[0]) {
        if (vertexInAnyMaskPoly(x, y, maskPolys)) { hit = true; break outer; }
      }
    }

    // 2. Any vertex of any mask polygon inside this feature?
    if (!hit) {
      outer2: for (const poly of rings) {
        for (const mp of maskPolys) {
          for (const [mx, my] of mp.rings[0]) {
            if (polygonContains(poly, mx, my)) { hit = true; break outer2; }
          }
        }
      }
    }

    if (hit) out.push(feature);
  }
  return { type: 'FeatureCollection', features: out };
}

// Build a single-feature FeatureCollection from a polygon ring of
// [lng, lat] pairs. Used by the rectangle / polygon draw tools as the
// AOI mask passed to zonalStatistics.
export function ringToFeatureCollection(ring, properties = {}) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  // Auto-close the ring.
  const first = ring[0];
  const last = ring[ring.length - 1];
  const closed = (first[0] === last[0] && first[1] === last[1])
    ? ring
    : [...ring, first];
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties,
        geometry: {
          type: 'Polygon',
          coordinates: [closed],
        },
      },
    ],
  };
}
