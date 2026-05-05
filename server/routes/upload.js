import express from 'express';
import { pool } from '../lib/db.js';

export const uploadRouter = express.Router();

// Strict identifier check — only lowercase alphanumerics + underscore,
// no leading digit. Anything else is rejected before reaching SQL.
// The client tries to pre-sanitize but the server is the only authority.
const IDENT_RE = /^[a-z_][a-z0-9_]*$/;
function ensureIdent(s, label) {
  if (!IDENT_RE.test(String(s ?? ''))) {
    throw new Error(`Invalid ${label}: ${JSON.stringify(s)}`);
  }
  return s;
}
function quoteIdent(s) {
  return `"${String(s).replace(/"/g, '""')}"`;
}

// Postgres types the importer accepts. Anything outside this set is
// rejected so an attacker can't sneak DDL via the type field.
const ALLOWED_TYPES = new Set([
  'text',
  'integer',
  'double precision',
  'boolean',
  'date',
  'timestamp',
  'jsonb',
]);

// Coerce a JSON value into something Postgres can accept for the
// requested column type. Returning null lets pg use its NULL placeholder.
function coerce(v, type) {
  if (v === null || v === undefined) return null;
  switch (type) {
    case 'integer': {
      const n = Number(v);
      return Number.isFinite(n) ? Math.trunc(n) : null;
    }
    case 'double precision': {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    case 'boolean': {
      if (typeof v === 'boolean') return v;
      if (typeof v === 'number') return v !== 0;
      if (typeof v === 'string') return /^(true|t|1|yes|y)$/i.test(v);
      return Boolean(v);
    }
    case 'jsonb':
      return typeof v === 'string' ? v : JSON.stringify(v);
    case 'date':
    case 'timestamp':
    case 'text':
    default:
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
}

// Insertion batch size. 200 features × ~10 columns = 2000 placeholders
// per query — well under Postgres' 65k bound parameter limit and small
// enough that progress updates feel live.
const BATCH = 200;

// POST /api/upload/import
//
// Streams a sequence of newline-delimited `data: {...}` events while
// importing the supplied GeoJSON FeatureCollection into a fresh
// `schema.table` in PostGIS. The client renders these as progress
// updates. Wraps the work in a transaction so a failure mid-import
// leaves no partial table behind.
uploadRouter.post('/import', async (req, res) => {
  // Stream from the start — the client uses fetch().body.getReader()
  // and parses the same `data: ...\n\n` framing as SSE.
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Some proxies (and Express's compression middleware) buffer
    // chunked responses; this header opts out so progress lands live.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const send = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let client;
  try {
    const { schema, table, crs, columns, geojson } = req.body ?? {};

    ensureIdent(schema, 'schema');
    ensureIdent(table, 'table');
    const srid = Number(crs);
    if (!Number.isInteger(srid) || srid <= 0) {
      throw new Error(`Invalid CRS: ${crs}`);
    }
    if (!Array.isArray(columns) || columns.length === 0) {
      throw new Error('No columns selected');
    }
    for (const c of columns) {
      ensureIdent(c.target, 'column target');
      if (!ALLOWED_TYPES.has(c.type)) {
        throw new Error(`Disallowed column type: ${c.type}`);
      }
    }
    const features = Array.isArray(geojson?.features) ? geojson.features : null;
    if (!features || features.length === 0) {
      throw new Error('Empty or invalid GeoJSON payload');
    }

    const total = features.length;
    send({ progress: 0, inserted: 0, total });

    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)}`);
    await client.query(
      `DROP TABLE IF EXISTS ${quoteIdent(schema)}.${quoteIdent(table)}`,
    );

    const colDefs = columns
      .map((c) => `${quoteIdent(c.target)} ${c.type}`)
      .join(', ');
    const createSql = `
      CREATE TABLE ${quoteIdent(schema)}.${quoteIdent(table)} (
        id SERIAL PRIMARY KEY,
        ${colDefs},
        geom geometry(Geometry, ${srid})
      )
    `;
    await client.query(createSql);

    const targetCols = columns.map((c) => quoteIdent(c.target)).join(', ');
    let inserted = 0;
    for (let i = 0; i < total; i += BATCH) {
      const batch = features.slice(i, i + BATCH);
      const valuesClauses = [];
      const params = [];
      for (const f of batch) {
        const props = f?.properties ?? {};
        const colValues = columns.map((c) => coerce(props[c.source], c.type));
        const geomJson = f?.geometry ? JSON.stringify(f.geometry) : null;

        const start = params.length + 1;
        const colPlaceholders = colValues
          .map((_, idx) => `$${start + idx}`)
          .join(', ');
        const geomIdx = start + colValues.length;
        valuesClauses.push(
          `(${colPlaceholders}, ` +
            `ST_SetSRID(ST_GeomFromGeoJSON($${geomIdx}), ${srid}))`,
        );
        params.push(...colValues, geomJson);
      }
      const insertSql =
        `INSERT INTO ${quoteIdent(schema)}.${quoteIdent(table)} ` +
        `(${targetCols}, geom) VALUES ${valuesClauses.join(', ')}`;
      await client.query(insertSql, params);
      inserted += batch.length;
      send({ progress: inserted / total, inserted, total });
    }

    await client.query('COMMIT');
    send({ done: true, inserted, total, schema, table });
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore — already failed */
      }
    }
    console.error('[upload/import] failed:', err);
    send({ error: err.message ?? String(err) });
  } finally {
    if (client) client.release();
    res.end();
  }
});
