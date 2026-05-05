import express from 'express';
import pg from 'pg';
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

// Validate the request body without side effects so input errors can
// return a clean JSON 400 BEFORE we switch into stream-mode. Once the
// stream-mode response headers are flushed we lose the ability to send
// a normal error status, so this guard pays off in clearer client UX.
function validatePayload(body) {
  if (!body || typeof body !== 'object') {
    throw new Error('Empty request body — JSON parser may have rejected the payload');
  }
  const { schema, table, crs, columns, geojson } = body;
  ensureIdent(schema, 'schema');
  ensureIdent(table, 'table');
  const srid = Number(crs);
  if (!Number.isInteger(srid) || srid <= 0) {
    throw new Error(`Invalid CRS: ${JSON.stringify(crs)}`);
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
  return { schema, table, srid, columns, features };
}

// POST /api/upload/import
//
// Streams a sequence of newline-delimited `data: {...}` events while
// importing the supplied GeoJSON FeatureCollection into a fresh
// `schema.table` in PostGIS. The client renders these as progress
// updates. Wraps the work in a transaction so a failure mid-import
// leaves no partial table behind.
uploadRouter.post('/import', async (req, res) => {
  // 1. Validate input first — fail with a normal JSON 400 so the
  //    client's `!res.ok` branch reads a meaningful body. Anything that
  //    survives validation moves to streaming mode below.
  let parsed;
  try {
    parsed = validatePayload(req.body);
  } catch (err) {
    console.error('[upload/import] validation failed:', err.message);
    return res.status(400).json({ error: err.message });
  }
  const { schema, table, srid, columns, features } = parsed;

  // 2. Switch to streaming response. Anything below this line that
  //    throws gets streamed back to the client as `data: {error: ...}`.
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Some proxies (and Express's compression middleware) buffer
    // chunked responses; this header opts out so progress lands live.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  // Guarded write — once the client (or proxy) closes the connection,
  // res.write throws ERR_STREAM_DESTROYED. Swallow it: there's no point
  // bubbling it back into our catch when the consumer is already gone.
  // The import itself runs to completion regardless of whether the
  // client is still listening — the DB transaction is the source of
  // truth, and the user's intent was "import this file." If their tab
  // closed mid-progress, the rows still land and a future browse of
  // the table will reflect them.
  const send = (data) => {
    if (res.writableEnded || res.destroyed) return;
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (err) {
      console.warn('[upload/import] write after close:', err.code ?? err.message);
    }
  };

  let client;
  try {
    const total = features.length;
    send({ progress: 0, inserted: 0, total });

    client = await pool.connect();

    // Hard-fail early with a clear message if PostGIS isn't available
    // — without it ST_GeomFromGeoJSON throws an opaque "function does
    // not exist" partway through, after the table is already created.
    const ext = await client.query(
      "SELECT extname FROM pg_extension WHERE extname = 'postgis'",
    );
    if (ext.rowCount === 0) {
      throw new Error(
        'PostGIS is not installed in this database. Run `CREATE EXTENSION postgis;` as a superuser, then retry.',
      );
    }

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
    let skipped = 0;

    for (let i = 0; i < total; i += BATCH) {
      const batch = features.slice(i, i + BATCH);
      const valuesClauses = [];
      const params = [];
      for (const f of batch) {
        const props = f?.properties ?? {};
        const geom = f?.geometry;
        // Skip features with no geometry rather than blowing up the
        // whole transaction. Postgres `geometry` columns accept NULL,
        // but the upstream shapefile shouldn't be carrying nulls — log
        // them and move on so a single bad row doesn't kill 5800.
        if (!geom) {
          skipped += 1;
          continue;
        }
        const colValues = columns.map((c) => coerce(props[c.source], c.type));
        const geomJson = JSON.stringify(geom);

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

      // Whole batch was nulls? Skip the empty INSERT.
      if (valuesClauses.length > 0) {
        const insertSql =
          `INSERT INTO ${quoteIdent(schema)}.${quoteIdent(table)} ` +
          `(${targetCols}, geom) VALUES ${valuesClauses.join(', ')}`;
        await client.query(insertSql, params);
        inserted += valuesClauses.length;
      }
      send({
        progress: (i + batch.length) / total,
        inserted,
        skipped,
        total,
      });
    }

    // Build the GiST spatial index *after* the bulk load completes —
    // creating it before would slow every batch down (each row triggers
    // an index update). Doing it post-insert is the standard pattern
    // recommended in the PostGIS docs for fresh imports.
    send({
      progress: 1,
      inserted,
      skipped,
      total,
      stage: 'indexing',
    });
    const indexName = `${table}_geom_gix`;
    await client.query(
      `CREATE INDEX ${quoteIdent(indexName)} ` +
        `ON ${quoteIdent(schema)}.${quoteIdent(table)} USING GIST (geom)`,
    );
    // ANALYZE primes the planner so the very next spatial query
    // benefits from realistic row-count + bbox statistics rather than
    // the empty defaults from CREATE TABLE.
    await client.query(`ANALYZE ${quoteIdent(schema)}.${quoteIdent(table)}`);

    await client.query('COMMIT');
    send({
      done: true,
      inserted,
      skipped,
      total,
      schema,
      table,
      index: indexName,
    });
  } catch (err) {
    // Stack traces are gold for diagnosing pg/postgis failures — log
    // the full thing on the server, but only ship the human-readable
    // message + Postgres error code (if any) to the client.
    console.error('[upload/import] failed:', err.stack ?? err);
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore — already failed */
      }
    }
    const detail = err.code ? `${err.message} (pg ${err.code})` : err.message;
    send({ error: detail ?? String(err) });
  } finally {
    if (client) client.release();
    if (!res.writableEnded) res.end();
  }
});

// ---------------------------------------------------------------------------
// POST /api/upload/from-db
//
// Pull a spatial table from another PostgreSQL/PostGIS server (anywhere
// reachable from the backend — LAN, public IP, localhost on a different
// port) and copy it into the local DB with a GIST spatial index. The
// remote credentials are used once for the duration of the request and
// never persisted.
// ---------------------------------------------------------------------------

// Coarse Postgres type → our allowed importer type. Anything we don't
// recognize falls through to `text` so the import never blocks on an
// exotic type.
function pgTypeForImport(udtName, dataType) {
  const t = String(udtName ?? '').toLowerCase();
  const d = String(dataType ?? '').toLowerCase();
  if (['int2', 'int4', 'int8', 'bigint', 'smallint', 'integer'].includes(t)) {
    return 'integer';
  }
  if (
    ['float4', 'float8', 'numeric', 'real'].includes(t) ||
    d === 'double precision' ||
    d === 'numeric' ||
    d === 'real'
  ) {
    return 'double precision';
  }
  if (t === 'bool' || d === 'boolean') return 'boolean';
  if (d === 'date') return 'date';
  if (d.startsWith('timestamp')) return 'timestamp';
  if (t === 'jsonb' || t === 'json') return 'jsonb';
  return 'text';
}

function validateFromDbPayload(body) {
  if (!body || typeof body !== 'object') {
    throw new Error('Empty request body');
  }
  const { source, target } = body;
  if (!source || typeof source !== 'object') throw new Error('Missing source connection');
  if (!target || typeof target !== 'object') throw new Error('Missing target table info');

  // Connection params — cannot whitelist hosts (the whole point is
  // arbitrary remotes), but the rest are sanity-checked.
  const host = String(source.host ?? '').trim();
  if (!host) throw new Error('Source host is required');
  const port = Number(source.port ?? 5432);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid source port: ${source.port}`);
  }
  const database = String(source.database ?? '').trim();
  if (!database) throw new Error('Source database is required');
  const user = String(source.user ?? '').trim();
  if (!user) throw new Error('Source user is required');
  const password = source.password == null ? '' : String(source.password);

  // Schema/table identifiers go straight into SQL as quoted idents on
  // BOTH sides — strict regex check is mandatory.
  ensureIdent(source.schema ?? 'public', 'source schema');
  ensureIdent(source.table, 'source table');
  ensureIdent(target.schema, 'target schema');
  ensureIdent(target.table, 'target table');

  return {
    source: {
      host,
      port,
      database,
      user,
      password,
      ssl: !!source.ssl,
      schema: source.schema ?? 'public',
      table: source.table,
    },
    target: {
      schema: target.schema,
      table: target.table,
    },
  };
}

uploadRouter.post('/from-db', async (req, res) => {
  let parsed;
  try {
    parsed = validateFromDbPayload(req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const { source, target } = parsed;

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  const send = (data) => {
    if (res.writableEnded || res.destroyed) return;
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (err) {
      console.warn('[upload/from-db] write after close:', err.code ?? err.message);
    }
  };

  let remote;
  let local;
  try {
    send({ stage: 'connecting', progress: 0 });

    // 1. Connect to the remote — short connect timeout so a bad host
    //    doesn't hang the request for minutes.
    remote = new pg.Client({
      host: source.host,
      port: source.port,
      database: source.database,
      user: source.user,
      password: source.password,
      ssl: source.ssl ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 8000,
      statement_timeout: 60_000,
    });
    await remote.connect();

    // 2. Discover the geometry column + SRID via geometry_columns.
    //    PostGIS populates this view automatically; rejecting a table
    //    with no entry there means we don't even try to import non-
    //    spatial tables (which the rest of the pipeline can't handle).
    const geomMeta = await remote.query(
      `SELECT f_geometry_column AS col, srid, type
         FROM geometry_columns
        WHERE f_table_schema = $1 AND f_table_name = $2
        LIMIT 1`,
      [source.schema, source.table],
    );
    if (geomMeta.rowCount === 0) {
      throw new Error(
        `Table ${source.schema}.${source.table} has no entry in geometry_columns — is it a PostGIS table?`,
      );
    }
    const geomCol = geomMeta.rows[0].col;
    const srcSrid = Number(geomMeta.rows[0].srid) || 4326;
    ensureIdent(geomCol, 'remote geom column');

    // 3. Discover non-geom column metadata to faithfully recreate
    //    types on the local side.
    const colMeta = await remote.query(
      `SELECT column_name, data_type, udt_name
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position`,
      [source.schema, source.table],
    );
    const propCols = colMeta.rows
      .filter((c) => c.column_name !== geomCol)
      .map((c) => ({
        name: c.column_name,
        type: pgTypeForImport(c.udt_name, c.data_type),
      }));

    // 4. Total row count for the progress bar.
    const countRes = await remote.query(
      `SELECT COUNT(*)::int AS n
         FROM ${quoteIdent(source.schema)}.${quoteIdent(source.table)}`,
    );
    const total = countRes.rows[0]?.n ?? 0;
    if (total === 0) {
      throw new Error('Source table is empty');
    }

    send({ stage: 'preparing', progress: 0, total });

    // 5. Local target table: drop-and-recreate inside a transaction.
    local = await pool.connect();
    const ext = await local.query(
      "SELECT 1 FROM pg_extension WHERE extname = 'postgis'",
    );
    if (ext.rowCount === 0) {
      throw new Error(
        'PostGIS is not installed in this database. Run `CREATE EXTENSION postgis;` and retry.',
      );
    }
    await local.query('BEGIN');
    await local.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(target.schema)}`);
    await local.query(
      `DROP TABLE IF EXISTS ${quoteIdent(target.schema)}.${quoteIdent(target.table)}`,
    );

    const colDefs = propCols
      .map((c) => `${quoteIdent(c.name)} ${c.type}`)
      .join(', ');
    const createSql = `
      CREATE TABLE ${quoteIdent(target.schema)}.${quoteIdent(target.table)} (
        id SERIAL PRIMARY KEY,
        ${colDefs ? `${colDefs},` : ''}
        geom geometry(Geometry, ${srcSrid})
      )
    `;
    await local.query(createSql);

    // 6. Read all rows in one shot — fine for the < ~100k row tables
    //    typical here. ST_AsGeoJSON keeps the geom transport
    //    JSON-friendly so we can plug it into ST_GeomFromGeoJSON on
    //    the local side without dragging WKB across the wire.
    const propColIdents = propCols.map((c) => quoteIdent(c.name));
    const selectCols = [
      ...propColIdents,
      `ST_AsGeoJSON(${quoteIdent(geomCol)}) AS __geom__`,
    ].join(', ');
    const rowsRes = await remote.query(
      `SELECT ${selectCols}
         FROM ${quoteIdent(source.schema)}.${quoteIdent(source.table)}`,
    );

    // 7. Batch-insert into local. Same parameter-binding pattern as
    //    /import; geom comes through ST_GeomFromGeoJSON to the same SRID.
    const targetCols = propColIdents.join(', ');
    let inserted = 0;
    let skipped = 0;
    const rows = rowsRes.rows;

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const valuesClauses = [];
      const params = [];
      for (const row of batch) {
        const geomJson = row.__geom__;
        if (!geomJson) {
          skipped += 1;
          continue;
        }
        const colValues = propCols.map((c) => coerce(row[c.name], c.type));
        const start = params.length + 1;
        const colPlaceholders = colValues
          .map((_, idx) => `$${start + idx}`)
          .join(', ');
        const geomIdx = start + colValues.length;
        valuesClauses.push(
          `(${colPlaceholders}${colPlaceholders ? ', ' : ''}` +
            `ST_SetSRID(ST_GeomFromGeoJSON($${geomIdx}), ${srcSrid}))`,
        );
        params.push(...colValues, geomJson);
      }
      if (valuesClauses.length > 0) {
        const insertSql =
          `INSERT INTO ${quoteIdent(target.schema)}.${quoteIdent(target.table)} ` +
          `(${targetCols ? `${targetCols}, ` : ''}geom) VALUES ${valuesClauses.join(', ')}`;
        await local.query(insertSql, params);
        inserted += valuesClauses.length;
      }
      send({
        progress: (i + batch.length) / rows.length,
        inserted,
        skipped,
        total,
      });
    }

    // 8. Spatial index + ANALYZE — same post-load pattern as /import.
    send({ progress: 1, inserted, skipped, total, stage: 'indexing' });
    const indexName = `${target.table}_geom_gix`;
    await local.query(
      `CREATE INDEX ${quoteIdent(indexName)} ` +
        `ON ${quoteIdent(target.schema)}.${quoteIdent(target.table)} USING GIST (geom)`,
    );
    await local.query(
      `ANALYZE ${quoteIdent(target.schema)}.${quoteIdent(target.table)}`,
    );
    await local.query('COMMIT');

    send({
      done: true,
      inserted,
      skipped,
      total,
      schema: target.schema,
      table: target.table,
      index: indexName,
      srid: srcSrid,
    });
  } catch (err) {
    if (local) {
      try {
        await local.query('ROLLBACK');
      } catch {
        /* ignore */
      }
    }
    // Strip the password from anything we log — pg sometimes embeds
    // connection info in error messages.
    const safeMsg = String(err?.message ?? err).replace(
      /password=[^\s]*/gi,
      'password=***',
    );
    console.error('[upload/from-db] failed:', err.stack ?? err);
    const detail = err.code ? `${safeMsg} (pg ${err.code})` : safeMsg;
    send({ error: detail });
  } finally {
    if (local) local.release();
    if (remote) {
      remote.end().catch(() => {
        /* already closed / never opened */
      });
    }
    if (!res.writableEnded) res.end();
  }
});
