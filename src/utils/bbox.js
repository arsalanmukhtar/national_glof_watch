// Recursive coordinate walker — handles every GeoJSON geometry type
// (Point, LineString, Polygon, Multi*, GeometryCollection) without case
// analysis since they all bottom out in `[lng, lat]` pairs.
function walkCoords(coords, onPair) {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    onPair(coords[0], coords[1]);
    return;
  }
  for (const child of coords) walkCoords(child, onPair);
}

// Compute the [west, south, east, north] bbox of a GeoJSON object. Returns
// null when the object has no usable coordinates so callers can skip
// fitBounds rather than throwing.
export function bboxOfGeoJson(geojson) {
  if (!geojson) return null;

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  const visit = (lng, lat) => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  };

  const visitGeom = (geom) => {
    if (!geom) return;
    if (geom.type === 'GeometryCollection') {
      for (const g of geom.geometries ?? []) visitGeom(g);
      return;
    }
    walkCoords(geom.coordinates, visit);
  };

  if (geojson.type === 'FeatureCollection') {
    for (const f of geojson.features ?? []) visitGeom(f?.geometry);
  } else if (geojson.type === 'Feature') {
    visitGeom(geojson.geometry);
  } else if (geojson.type) {
    visitGeom(geojson);
  }

  if (minLng === Infinity) return null;
  return [minLng, minLat, maxLng, maxLat];
}

// Expand a bbox to enclose another. Either argument may be null.
export function unionBbox(a, b) {
  if (!a) return b;
  if (!b) return a;
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[2], b[2]),
    Math.max(a[3], b[3]),
  ];
}
