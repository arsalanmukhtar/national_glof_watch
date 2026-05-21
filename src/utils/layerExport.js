// Client-side vector layer export.
//
// Takes in-memory GeoJSON FeatureCollections (every layer the dashboard
// can show is available as GeoJSON) and writes them out as GeoJSON, CSV,
// KML or Esri Shapefile — with optional CRS reprojection and per-field
// selection. Everything runs in the browser; no new dependencies beyond
// proj4 (already used elsewhere) and the small binary writers below.

import proj4 from 'proj4';

// proj4 ships 4326 + 3857; register UTM 43N (covers northern Pakistan).
proj4.defs(
  'EPSG:32643',
  '+proj=utm +zone=43 +datum=WGS84 +units=m +no_defs +type=crs',
);

// ---------------------------------------------------------------------------
// Public catalogs — drive the modal's option lists.
// ---------------------------------------------------------------------------
export const EXPORT_FORMATS = [
  { id: 'geojson', label: 'GeoJSON', ext: 'geojson', desc: 'RFC 7946 — universal vector format' },
  { id: 'csv',     label: 'CSV',     ext: 'csv',     desc: 'Attributes + WKT geometry column' },
  { id: 'kml',     label: 'KML',     ext: 'kml',     desc: 'Google Earth — always WGS 84' },
  { id: 'shp',     label: 'Shapefile', ext: 'zip',   desc: 'Esri Shapefile set, zipped' },
];

export const EXPORT_CRS = [
  { id: 'EPSG:4326',  label: 'WGS 84',        code: 'EPSG:4326',  desc: 'Geographic lat/long — native' },
  { id: 'EPSG:3857',  label: 'Web Mercator',  code: 'EPSG:3857',  desc: 'Projected metres — web maps' },
  { id: 'EPSG:32643', label: 'UTM Zone 43N',  code: 'EPSG:32643', desc: 'Projected metres — N. Pakistan' },
];

// .prj WKT strings, keyed by EPSG id.
const PRJ_WKT = {
  'EPSG:4326':
    'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]',
  'EPSG:3857':
    'PROJCS["WGS_1984_Web_Mercator_Auxiliary_Sphere",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Mercator_Auxiliary_Sphere"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",0.0],PARAMETER["Standard_Parallel_1",0.0],PARAMETER["Auxiliary_Sphere_Type",0.0],UNIT["Meter",1.0]]',
  'EPSG:32643':
    'PROJCS["WGS_1984_UTM_Zone_43N",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",75.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]',
};

// ---------------------------------------------------------------------------
// Reprojection
// ---------------------------------------------------------------------------
function mapCoords(coords, fn) {
  if (coords == null) return coords;
  if (typeof coords[0] === 'number') return fn(coords);
  return coords.map((c) => mapCoords(c, fn));
}

// Returns a new FeatureCollection with every coordinate reprojected from
// WGS 84 to `toCrs`. A no-op when the target is already 4326.
export function reprojectFeatureCollection(fc, toCrs) {
  if (!toCrs || toCrs === 'EPSG:4326') return fc;
  const fwd = (xy) => {
    const [x, y] = proj4('EPSG:4326', toCrs, [xy[0], xy[1]]);
    return [x, y];
  };
  return {
    ...fc,
    features: (fc.features || []).map((f) => ({
      ...f,
      geometry:
        f.geometry && f.geometry.coordinates
          ? { ...f.geometry, coordinates: mapCoords(f.geometry.coordinates, fwd) }
          : f.geometry,
    })),
  };
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------
// Union of every property key across one or more FeatureCollections,
// in first-seen order.
export function collectFieldNames(collections) {
  const seen = new Set();
  const out = [];
  for (const fc of collections) {
    for (const f of fc?.features || []) {
      for (const k of Object.keys(f?.properties || {})) {
        if (!seen.has(k)) {
          seen.add(k);
          out.push(k);
        }
      }
    }
  }
  return out;
}

// Returns a copy of `fc` keeping only the chosen property keys.
export function pickFields(fc, fields) {
  const keep = new Set(fields);
  return {
    ...fc,
    features: (fc.features || []).map((f) => {
      const props = {};
      for (const k of keep) {
        if (f?.properties && k in f.properties) props[k] = f.properties[k];
      }
      return { ...f, properties: props };
    }),
  };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const utf8 = new TextEncoder();

export function safeFileName(name) {
  return (
    String(name || 'layer')
      .replace(/[^a-z0-9._-]+/gi, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80) || 'layer'
  );
}

function cellToString(v) {
  if (v == null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function xmlEscape(s) {
  return cellToString(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// First feature with a usable geometry decides the layer's bucket.
function classifyGeometry(fc) {
  for (const f of fc?.features || []) {
    const t = f?.geometry?.type || '';
    if (t.includes('Point')) return 'point';
    if (t.includes('LineString')) return 'line';
    if (t.includes('Polygon')) return 'polygon';
  }
  return 'point';
}

// ---------------------------------------------------------------------------
// WKT (for the CSV geometry column)
// ---------------------------------------------------------------------------
const pair = (c) => `${c[0]} ${c[1]}`;
const ring = (r) => r.map(pair).join(', ');

function geometryToWkt(geom) {
  if (!geom || !geom.coordinates) return '';
  const c = geom.coordinates;
  switch (geom.type) {
    case 'Point':
      return `POINT (${pair(c)})`;
    case 'MultiPoint':
      return `MULTIPOINT (${c.map(pair).join(', ')})`;
    case 'LineString':
      return `LINESTRING (${ring(c)})`;
    case 'MultiLineString':
      return `MULTILINESTRING (${c.map((l) => `(${ring(l)})`).join(', ')})`;
    case 'Polygon':
      return `POLYGON (${c.map((r) => `(${ring(r)})`).join(', ')})`;
    case 'MultiPolygon':
      return `MULTIPOLYGON (${c
        .map((p) => `(${p.map((r) => `(${ring(r)})`).join(', ')})`)
        .join(', ')})`;
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// GeoJSON
// ---------------------------------------------------------------------------
export function toGeoJson(fc, crs) {
  const out = { type: 'FeatureCollection', features: fc.features || [] };
  // RFC 7946 is 4326-only; for a projected export attach the legacy CRS
  // member so GDAL / QGIS still pick up the right coordinate system.
  if (crs && crs !== 'EPSG:4326') {
    out.crs = {
      type: 'name',
      properties: { name: `urn:ogc:def:crs:${crs.replace(':', '::')}` },
    };
  }
  return utf8.encode(JSON.stringify(out, null, 2));
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
function csvCell(v) {
  const s = cellToString(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(fc, fields) {
  const header = [...fields, 'WKT'].map(csvCell).join(',');
  const lines = [header];
  for (const f of fc.features || []) {
    const props = f?.properties || {};
    const row = fields.map((k) => csvCell(props[k]));
    row.push(csvCell(geometryToWkt(f?.geometry)));
    lines.push(row.join(','));
  }
  return utf8.encode(lines.join('\r\n'));
}

// ---------------------------------------------------------------------------
// KML  (always WGS 84 — the format mandates it)
// ---------------------------------------------------------------------------
const kmlCoords = (r) => r.map((c) => `${c[0]},${c[1]}`).join(' ');

function kmlGeometry(geom) {
  if (!geom || !geom.coordinates) return '';
  const c = geom.coordinates;
  const poly = (rings) =>
    `<Polygon><outerBoundaryIs><LinearRing><coordinates>${kmlCoords(
      rings[0],
    )}</coordinates></LinearRing></outerBoundaryIs>${rings
      .slice(1)
      .map(
        (h) =>
          `<innerBoundaryIs><LinearRing><coordinates>${kmlCoords(
            h,
          )}</coordinates></LinearRing></innerBoundaryIs>`,
      )
      .join('')}</Polygon>`;
  switch (geom.type) {
    case 'Point':
      return `<Point><coordinates>${c[0]},${c[1]}</coordinates></Point>`;
    case 'MultiPoint':
      return `<MultiGeometry>${c
        .map((p) => `<Point><coordinates>${p[0]},${p[1]}</coordinates></Point>`)
        .join('')}</MultiGeometry>`;
    case 'LineString':
      return `<LineString><coordinates>${kmlCoords(c)}</coordinates></LineString>`;
    case 'MultiLineString':
      return `<MultiGeometry>${c
        .map(
          (l) =>
            `<LineString><coordinates>${kmlCoords(l)}</coordinates></LineString>`,
        )
        .join('')}</MultiGeometry>`;
    case 'Polygon':
      return poly(c);
    case 'MultiPolygon':
      return `<MultiGeometry>${c.map(poly).join('')}</MultiGeometry>`;
    default:
      return '';
  }
}

const NAME_KEYS = ['name', 'Name', 'NAME', 'title', 'label', 'stationName', 'station_name'];

export function toKml(fc, fields, layerName) {
  const placemarks = (fc.features || [])
    .map((f, i) => {
      const props = f?.properties || {};
      const nameKey = NAME_KEYS.find((k) => props[k] != null);
      const name = nameKey ? cellToString(props[nameKey]) : `Feature ${i + 1}`;
      const data = fields
        .filter((k) => k in props)
        .map(
          (k) =>
            `<Data name="${xmlEscape(k)}"><value>${xmlEscape(
              props[k],
            )}</value></Data>`,
        )
        .join('');
      return `<Placemark><name>${xmlEscape(
        name,
      )}</name><ExtendedData>${data}</ExtendedData>${kmlGeometry(
        f?.geometry,
      )}</Placemark>`;
    })
    .join('\n');
  return utf8.encode(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>` +
      `<name>${xmlEscape(layerName || 'Export')}</name>\n${placemarks}\n` +
      `</Document></kml>`,
  );
}

// ---------------------------------------------------------------------------
// Shapefile
// ---------------------------------------------------------------------------
// Growable little/big-endian byte writer.
class ByteWriter {
  constructor(size = 65536) {
    this.buf = new Uint8Array(size);
    this.view = new DataView(this.buf.buffer);
    this.pos = 0;
  }
  _ensure(n) {
    if (this.pos + n <= this.buf.length) return;
    let next = this.buf.length * 2;
    while (next < this.pos + n) next *= 2;
    const grown = new Uint8Array(next);
    grown.set(this.buf);
    this.buf = grown;
    this.view = new DataView(grown.buffer);
  }
  u8(v) { this._ensure(1); this.view.setUint8(this.pos, v); this.pos += 1; }
  i32LE(v) { this._ensure(4); this.view.setInt32(this.pos, v, true); this.pos += 4; }
  i32BE(v) { this._ensure(4); this.view.setInt32(this.pos, v, false); this.pos += 4; }
  f64LE(v) { this._ensure(8); this.view.setFloat64(this.pos, v, true); this.pos += 8; }
  bytes(arr) { this._ensure(arr.length); this.buf.set(arr, this.pos); this.pos += arr.length; }
  result() { return this.buf.slice(0, this.pos); }
}

const ringSignedArea = (r) => {
  let a = 0;
  for (let i = 0; i < r.length - 1; i++) {
    a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
  }
  return a / 2; // > 0 = counter-clockwise
};

function closeRing(r) {
  if (r.length < 2) return r;
  const f = r[0];
  const l = r[r.length - 1];
  return f[0] === l[0] && f[1] === l[1] ? r : [...r, f];
}

// Orient a polygon ring: outer must be clockwise, holes counter-clockwise.
function orientRing(r, wantClockwise) {
  const closed = closeRing(r);
  const isCw = ringSignedArea(closed) < 0;
  return isCw === wantClockwise ? closed : [...closed].reverse();
}

// Reduce any feature geometry to shapefile parts for the layer's bucket.
// `point`  -> { x, y } | null
// `line`   -> [[ [x,y]… ]…] (parts, never closed)
// `polygon`-> [[ [x,y]… ]…] (rings, closed + oriented)
function shapeParts(geom, bucket) {
  if (!geom || !geom.coordinates) return null;
  const c = geom.coordinates;
  if (bucket === 'point') {
    if (geom.type === 'Point') return { x: c[0], y: c[1] };
    if (geom.type === 'MultiPoint' && c.length) return { x: c[0][0], y: c[0][1] };
    return null;
  }
  if (bucket === 'line') {
    if (geom.type === 'LineString') return [c];
    if (geom.type === 'MultiLineString') return c;
    return null;
  }
  // polygon
  const fixPoly = (rings) =>
    rings.map((r, i) => orientRing(r, i === 0));
  if (geom.type === 'Polygon') return fixPoly(c);
  if (geom.type === 'MultiPolygon') return c.flatMap(fixPoly);
  return null;
}

function partsBbox(parts) {
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  for (const part of parts) {
    for (const [x, y] of part) {
      if (x < xmin) xmin = x;
      if (y < ymin) ymin = y;
      if (x > xmax) xmax = x;
      if (y > ymax) ymax = y;
    }
  }
  return [xmin, ymin, xmax, ymax];
}

// 100-byte .shp / .shx header.
function writeShapeHeader(w, fileWords, shapeType, bbox) {
  w.i32BE(9994);
  for (let i = 0; i < 5; i++) w.i32BE(0);
  w.i32BE(fileWords);
  w.i32LE(1000);
  w.i32LE(shapeType);
  w.f64LE(bbox[0]); w.f64LE(bbox[1]); w.f64LE(bbox[2]); w.f64LE(bbox[3]);
  for (let i = 0; i < 4; i++) w.f64LE(0); // z/m min-max
}

// Builds .shp + .shx for one layer.
function buildShpShx(fc, bucket) {
  const shapeType = bucket === 'point' ? 1 : bucket === 'line' ? 3 : 5;
  let bbox = [Infinity, Infinity, -Infinity, -Infinity];
  const records = []; // { content: Uint8Array }

  for (const f of fc.features || []) {
    const parts = shapeParts(f?.geometry, bucket);
    const rec = new ByteWriter(256);
    if (!parts || (Array.isArray(parts) && parts.length === 0)) {
      rec.i32LE(0); // null shape
    } else if (bucket === 'point') {
      rec.i32LE(1);
      rec.f64LE(parts.x);
      rec.f64LE(parts.y);
      bbox = [
        Math.min(bbox[0], parts.x), Math.min(bbox[1], parts.y),
        Math.max(bbox[2], parts.x), Math.max(bbox[3], parts.y),
      ];
    } else {
      const b = partsBbox(parts);
      bbox = [
        Math.min(bbox[0], b[0]), Math.min(bbox[1], b[1]),
        Math.max(bbox[2], b[2]), Math.max(bbox[3], b[3]),
      ];
      const numPoints = parts.reduce((n, p) => n + p.length, 0);
      rec.i32LE(shapeType);
      rec.f64LE(b[0]); rec.f64LE(b[1]); rec.f64LE(b[2]); rec.f64LE(b[3]);
      rec.i32LE(parts.length);
      rec.i32LE(numPoints);
      let acc = 0;
      for (const p of parts) { rec.i32LE(acc); acc += p.length; }
      for (const p of parts) for (const [x, y] of p) { rec.f64LE(x); rec.f64LE(y); }
    }
    records.push(rec.result());
  }

  if (!Number.isFinite(bbox[0])) bbox = [0, 0, 0, 0];

  // .shp
  const shpBodyBytes = records.reduce((n, r) => n + 8 + r.length, 0);
  const shp = new ByteWriter(100 + shpBodyBytes);
  writeShapeHeader(shp, (100 + shpBodyBytes) / 2, shapeType, bbox);
  const offsets = [];
  let offset = 100;
  records.forEach((content, i) => {
    offsets.push(offset);
    shp.i32BE(i + 1);
    shp.i32BE(content.length / 2);
    shp.bytes(content);
    offset += 8 + content.length;
  });

  // .shx
  const shx = new ByteWriter(100 + records.length * 8);
  writeShapeHeader(shx, (100 + records.length * 8) / 2, shapeType, bbox);
  records.forEach((content, i) => {
    shx.i32BE(offsets[i] / 2);
    shx.i32BE(content.length / 2);
  });

  return { shp: shp.result(), shx: shx.result() };
}

// dBASE field plan + per-value formatting.
function planDbfField(name, values) {
  let allNumeric = true;
  let hasValue = false;
  for (const v of values) {
    if (v == null || v === '') continue;
    hasValue = true;
    const ok =
      (typeof v === 'number' && Number.isFinite(v)) ||
      (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));
    if (!ok) { allNumeric = false; break; }
  }
  if (allNumeric && hasValue) {
    let decimals = 0;
    for (const v of values) {
      if (v == null || v === '') continue;
      const s = String(Number(v));
      const dot = s.indexOf('.');
      if (dot >= 0) decimals = Math.max(decimals, s.length - dot - 1);
    }
    decimals = Math.min(decimals, 12);
    let width = 1;
    for (const v of values) {
      if (v == null || v === '') continue;
      width = Math.max(width, Number(v).toFixed(decimals).length);
    }
    if (width <= 19) return { name, type: 'N', width, decimals };
  }
  let width = 1;
  for (const v of values) {
    if (v == null) continue;
    width = Math.max(width, utf8.encode(cellToString(v)).length);
  }
  return { name, type: 'C', width: Math.min(Math.max(width, 1), 254), decimals: 0 };
}

// Unique, ≤10-char ASCII dBASE field name.
function dbfName(raw, used) {
  let base = String(raw).replace(/[^A-Za-z0-9_]/g, '_').slice(0, 10) || 'FIELD';
  let name = base;
  let n = 1;
  while (used.has(name)) {
    const suffix = String(n++);
    name = base.slice(0, 10 - suffix.length) + suffix;
  }
  used.add(name);
  return name;
}

function buildDbf(fc, fields) {
  const features = fc.features || [];
  const used = new Set();
  const plan = fields.map((f) => {
    const values = features.map((ft) => ft?.properties?.[f]);
    const p = planDbfField(f, values);
    return { ...p, src: f, dbfName: dbfName(f, used) };
  });

  const headerLength = 32 + 32 * plan.length + 1;
  const recordLength = 1 + plan.reduce((n, p) => n + p.width, 0);
  const now = new Date();

  const w = new ByteWriter(headerLength + recordLength * features.length + 1);
  w.u8(0x03);
  w.u8(now.getFullYear() - 1900);
  w.u8(now.getMonth() + 1);
  w.u8(now.getDate());
  w.view.setInt32(w.pos, features.length, true); w.pos += 4;
  w.view.setInt16(w.pos, headerLength, true); w.pos += 2;
  w.view.setInt16(w.pos, recordLength, true); w.pos += 2;
  for (let i = 0; i < 20; i++) w.u8(0);

  for (const p of plan) {
    const nameBytes = new Uint8Array(11);
    nameBytes.set(utf8.encode(p.dbfName).slice(0, 10));
    w.bytes(nameBytes);
    w.u8(p.type.charCodeAt(0));
    w.i32LE(0); // field data address (ignored)
    w.u8(p.width);
    w.u8(p.decimals);
    for (let i = 0; i < 14; i++) w.u8(0);
  }
  w.u8(0x0d); // header terminator

  const padRight = (bytes, width) => {
    const out = new Uint8Array(width).fill(0x20);
    out.set(bytes.slice(0, width));
    return out;
  };
  const padLeft = (str, width) => {
    const s = str.length > width ? str.slice(0, width) : str;
    const out = new Uint8Array(width).fill(0x20);
    out.set(utf8.encode(s), width - s.length);
    return out;
  };

  for (const ft of features) {
    w.u8(0x20); // record not deleted
    for (const p of plan) {
      const v = ft?.properties?.[p.src];
      if (p.type === 'N') {
        const s = v == null || v === '' ? '' : Number(v).toFixed(p.decimals);
        w.bytes(padLeft(s, p.width));
      } else {
        const enc = v == null ? new Uint8Array(0) : utf8.encode(cellToString(v));
        w.bytes(padRight(enc, p.width));
      }
    }
  }
  w.u8(0x1a); // EOF
  return w.result();
}

// Returns the file entries for one layer's shapefile set.
export function buildShapefileFiles(fc, fields, crs, baseName) {
  const bucket = classifyGeometry(fc);
  const { shp, shx } = buildShpShx(fc, bucket);
  const dbf = buildDbf(fc, fields);
  const prj = utf8.encode(PRJ_WKT[crs] || PRJ_WKT['EPSG:4326']);
  const name = safeFileName(baseName);
  return [
    { name: `${name}.shp`, data: shp },
    { name: `${name}.shx`, data: shx },
    { name: `${name}.dbf`, data: dbf },
    { name: `${name}.prj`, data: prj },
    { name: `${name}.cpg`, data: utf8.encode('UTF-8') },
  ];
}

// ---------------------------------------------------------------------------
// ZIP  (store method — no compression; fine for these payload sizes)
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// entries: [{ name, data: Uint8Array }] -> Uint8Array of a .zip
export function buildZip(entries) {
  const now = new Date();
  const dosTime =
    (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate =
    ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  const local = new ByteWriter(1 << 16);
  const central = [];
  const records = entries.map((e) => ({
    nameBytes: utf8.encode(e.name),
    data: e.data,
    crc: crc32(e.data),
    offset: 0,
  }));

  for (const r of records) {
    r.offset = local.pos;
    local.i32LE(0x04034b50); // local file header sig
    local.view.setUint16(local.pos, 20, true); local.pos += 2; // version
    local.view.setUint16(local.pos, 0, true); local.pos += 2;  // flags
    local.view.setUint16(local.pos, 0, true); local.pos += 2;  // method = store
    local.view.setUint16(local.pos, dosTime, true); local.pos += 2;
    local.view.setUint16(local.pos, dosDate, true); local.pos += 2;
    local.i32LE(r.crc);
    local.i32LE(r.data.length); // compressed size
    local.i32LE(r.data.length); // uncompressed size
    local.view.setUint16(local.pos, r.nameBytes.length, true); local.pos += 2;
    local.view.setUint16(local.pos, 0, true); local.pos += 2; // extra len
    local.bytes(r.nameBytes);
    local.bytes(r.data);
  }

  const cd = new ByteWriter(1 << 14);
  for (const r of records) {
    cd.i32LE(0x02014b50); // central dir header sig
    cd.view.setUint16(cd.pos, 20, true); cd.pos += 2; // version made by
    cd.view.setUint16(cd.pos, 20, true); cd.pos += 2; // version needed
    cd.view.setUint16(cd.pos, 0, true); cd.pos += 2;  // flags
    cd.view.setUint16(cd.pos, 0, true); cd.pos += 2;  // method
    cd.view.setUint16(cd.pos, dosTime, true); cd.pos += 2;
    cd.view.setUint16(cd.pos, dosDate, true); cd.pos += 2;
    cd.i32LE(r.crc);
    cd.i32LE(r.data.length);
    cd.i32LE(r.data.length);
    cd.view.setUint16(cd.pos, r.nameBytes.length, true); cd.pos += 2;
    cd.view.setUint16(cd.pos, 0, true); cd.pos += 2; // extra
    cd.view.setUint16(cd.pos, 0, true); cd.pos += 2; // comment
    cd.view.setUint16(cd.pos, 0, true); cd.pos += 2; // disk number
    cd.view.setUint16(cd.pos, 0, true); cd.pos += 2; // internal attrs
    cd.i32LE(0); // external attrs
    cd.i32LE(r.offset);
    cd.bytes(r.nameBytes);
  }
  central.push(cd.result());

  const cdBytes = central[0];
  const out = new ByteWriter(local.pos + cdBytes.length + 22);
  out.bytes(local.result());
  const cdOffset = out.pos;
  out.bytes(cdBytes);
  out.i32LE(0x06054b50); // end of central directory sig
  out.view.setUint16(out.pos, 0, true); out.pos += 2; // disk
  out.view.setUint16(out.pos, 0, true); out.pos += 2; // cd start disk
  out.view.setUint16(out.pos, records.length, true); out.pos += 2;
  out.view.setUint16(out.pos, records.length, true); out.pos += 2;
  out.i32LE(cdBytes.length);
  out.i32LE(cdOffset);
  out.view.setUint16(out.pos, 0, true); out.pos += 2; // comment len
  return out.result();
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------
const MIME = {
  geojson: 'application/geo+json',
  csv: 'text/csv;charset=utf-8',
  kml: 'application/vnd.google-earth.kml+xml',
  zip: 'application/zip',
};

export function triggerDownload(filename, data, kind) {
  const blob = new Blob([data], { type: MIME[kind] || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
