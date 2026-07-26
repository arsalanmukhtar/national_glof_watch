import shp from 'shpjs';
import { strFromU8, unzipSync } from 'fflate';

// Shared client-side loader for spatial file uploads. Accepts
//   • .geojson / .json  → parsed as JSON
//   • .zip              → treated as a shapefile bundle via shpjs
//   • .kml              → parsed via DOMParser, converted inline
//   • .kmz              → unzipped via fflate, inner .kml converted
// Returns a normalised FeatureCollection with a stable `kind` tag
// telling the caller which format the file was, so panels can render
// a "geojson" vs "shapefile" vs "kml" / "kmz" chip without re-parsing.

export async function readSpatialFile(file) {
  const name = file.name || 'upload';
  const ext = (name.split('.').pop() || '').toLowerCase();

  if (ext === 'geojson' || ext === 'json') {
    const text = await file.text();
    const raw = JSON.parse(text);
    return { fc: normaliseToFC(raw), kind: 'geojson', name };
  }

  if (ext === 'zip') {
    const buf = await file.arrayBuffer();
    const raw = await shp(buf);
    return { fc: normaliseToFC(raw), kind: 'shapefile', name };
  }

  if (ext === 'kml') {
    const text = await file.text();
    return { fc: kmlToFeatureCollection(text), kind: 'kml', name };
  }

  if (ext === 'kmz') {
    // KMZ = zipped KML bundle. Google Earth writes the primary layer
    // as `doc.kml` at the root; tolerate any `.kml` entry so exports
    // from other tools (QGIS, ArcGIS) still work.
    const buf = new Uint8Array(await file.arrayBuffer());
    const entries = unzipSync(buf);
    const kmlKey = Object.keys(entries).find((k) => k.toLowerCase().endsWith('.kml'));
    if (!kmlKey) throw new Error('KMZ archive contains no .kml file inside.');
    const text = strFromU8(entries[kmlKey]);
    return { fc: kmlToFeatureCollection(text), kind: 'kmz', name };
  }

  throw new Error(`Unsupported file type: .${ext}. Use .geojson, .json, .zip (shapefile), .kml, or .kmz.`);
}

// Any input that could be a Feature, a FeatureCollection, or an
// array-of-FeatureCollections (shpjs returns the last shape when a
// zip contains multiple layers) is coerced to a single FC.
function normaliseToFC(raw) {
  if (Array.isArray(raw)) {
    const features = raw.flatMap((r) => (r?.features ?? []));
    return { type: 'FeatureCollection', features };
  }
  if (raw?.type === 'FeatureCollection') return raw;
  if (raw?.type === 'Feature') return { type: 'FeatureCollection', features: [raw] };
  throw new Error('Input JSON is not a Feature or FeatureCollection.');
}

// ---------------------------------------------------------------------------
// KML → GeoJSON — minimal in-file converter. Covers Point, LineString,
// Polygon (with holes), and MultiGeometry inside a <Placemark>. Extended
// data + Placemark <name>/<description> land as feature properties.
// Not a full KML implementation — no NetworkLink, no Style parsing, no
// GX extensions. Sufficient for hand-drawn flypath + lake layers.
// ---------------------------------------------------------------------------

function kmlToFeatureCollection(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) throw new Error('KML failed to parse — invalid XML.');
  const placemarks = Array.from(doc.getElementsByTagName('Placemark'));
  const features = [];
  for (const pm of placemarks) {
    const props = readPlacemarkProps(pm);
    // A Placemark can hold multiple geometry children; flatten them
    // into individual features so downstream renderers see one
    // geometry per feature (Mapbox handles single-geom features
    // much more predictably than MultiGeometry).
    const geoms = readGeometries(pm);
    for (const geom of geoms) {
      features.push({ type: 'Feature', properties: props, geometry: geom });
    }
  }
  return { type: 'FeatureCollection', features };
}

function readPlacemarkProps(pm) {
  const props = {};
  const nameEl = pm.getElementsByTagName('name')[0];
  const descEl = pm.getElementsByTagName('description')[0];
  if (nameEl?.textContent) props.name = nameEl.textContent.trim();
  if (descEl?.textContent) props.description = descEl.textContent.trim();
  const dataNodes = pm.getElementsByTagName('SimpleData');
  for (const n of dataNodes) {
    const key = n.getAttribute('name');
    if (key) props[key] = n.textContent?.trim() ?? '';
  }
  const valueNodes = pm.getElementsByTagName('Data');
  for (const n of valueNodes) {
    const key = n.getAttribute('name');
    const v = n.getElementsByTagName('value')[0]?.textContent?.trim();
    if (key) props[key] = v ?? '';
  }
  return props;
}

function readGeometries(root) {
  const out = [];
  for (const point of root.getElementsByTagName('Point')) {
    const coords = parseCoords(point.getElementsByTagName('coordinates')[0]?.textContent);
    if (coords[0]) out.push({ type: 'Point', coordinates: coords[0] });
  }
  for (const line of root.getElementsByTagName('LineString')) {
    const coords = parseCoords(line.getElementsByTagName('coordinates')[0]?.textContent);
    if (coords.length >= 2) out.push({ type: 'LineString', coordinates: coords });
  }
  for (const poly of root.getElementsByTagName('Polygon')) {
    const outer = poly.getElementsByTagName('outerBoundaryIs')[0]
      ?.getElementsByTagName('LinearRing')[0]
      ?.getElementsByTagName('coordinates')[0]?.textContent;
    const outerCoords = parseCoords(outer);
    if (outerCoords.length < 3) continue;
    const rings = [outerCoords];
    for (const inner of poly.getElementsByTagName('innerBoundaryIs')) {
      const innerText = inner.getElementsByTagName('LinearRing')[0]
        ?.getElementsByTagName('coordinates')[0]?.textContent;
      const innerCoords = parseCoords(innerText);
      if (innerCoords.length >= 3) rings.push(innerCoords);
    }
    out.push({ type: 'Polygon', coordinates: rings });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Length helpers — walk every LineString / MultiLineString feature in
// a FeatureCollection and sum haversine distances between consecutive
// vertices. Points and polygons contribute 0. Used by the panel to
// show a route's total length under its filename.
// ---------------------------------------------------------------------------

const EARTH_RADIUS_METERS = 6_371_000;

function haversineMeters(a, b) {
  if (!a || !b) return 0;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2
          + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

function sumLinePath(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    total += haversineMeters(coords[i], coords[i + 1]);
  }
  return total;
}

export function featureCollectionLengthMeters(fc) {
  if (!fc?.features?.length) return 0;
  let total = 0;
  for (const f of fc.features) {
    const g = f?.geometry;
    if (!g) continue;
    if (g.type === 'LineString') {
      total += sumLinePath(g.coordinates);
    } else if (g.type === 'MultiLineString') {
      for (const part of g.coordinates ?? []) total += sumLinePath(part);
    }
  }
  return total;
}

// Human-friendly length label:
//   • < 1 000 m         → "245 m"
//   • ≥ 1 000, < 10 km  → "1.2 km"  (one decimal)
//   • ≥ 10 km           → "15 km"   (rounded, no decimal)
export function formatLength(meters) {
  if (!Number.isFinite(meters) || meters <= 0) return null;
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

function parseCoords(text) {
  if (!text) return [];
  return text
    .trim()
    .split(/\s+/)
    .map((tuple) => tuple.split(',').map(Number).slice(0, 3))
    .filter((c) => c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]));
}
