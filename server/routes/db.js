import express from 'express';
import { pool } from '../lib/db.js';

// PostGIS `geometry_columns.type` values we accept. Anything else (curves,
// triangles, TIN, etc.) is rejected up-front because the rendering pipeline
// only handles point/line/polygon families.
const ALLOWED_GEOM_TYPES = [
  'POINT', 'MULTIPOINT',
  'LINESTRING', 'MULTILINESTRING',
  'POLYGON', 'MULTIPOLYGON',
  'GEOMETRY', // catch-all when the column is declared without a subtype
];

// Schemas that are server-internals and should never appear in the picker.
// Users only care about their own schemas + the conventional `public`.
const HIDDEN_SCHEMAS = new Set([
  'pg_catalog', 'information_schema', 'pg_toast', 'topology', 'tiger',
  'tiger_data',
]);

// Validate a Postgres identifier. We interpolate schema/table names into
// SQL with double-quoting, so anything containing a quote / backslash /
// non-ident character is rejected outright. Length cap = PG default 63.
function safeIdent(name) {
  if (!name || typeof name !== 'string' || name.length > 63) return false;
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

// Map the verbose PostGIS type onto a 3-bucket label the frontend uses.
function bucketGeomType(t) {
  if (!t) return 'polygon';
  const T = String(t).toUpperCase();
  if (T.includes('POINT'))  return 'point';
  if (T.includes('LINE'))   return 'line';
  if (T.includes('POLYGON')) return 'polygon';
  return 'polygon';
}

export const dbRouter = express.Router();

// GET /api/db/schemas — schemas that have at least one spatial table.
dbRouter.get('/schemas', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT f_table_schema AS schema, COUNT(*)::int AS table_count
         FROM geometry_columns
        WHERE type = ANY($1)
        GROUP BY f_table_schema
        ORDER BY f_table_schema`,
      [ALLOWED_GEOM_TYPES],
    );
    const schemas = rows.filter((r) => !HIDDEN_SCHEMAS.has(r.schema));
    res.json({ schemas });
  } catch (err) {
    console.error('[db.schemas] failed:', err);
    res.status(500).json({ error: 'Query failed', detail: err.message });
  }
});

// GET /api/db/schemas/:schema/tables — spatial tables inside one schema.
// Includes geometry type bucket + feature count so the picker can show a
// meaningful summary line per table.
dbRouter.get('/schemas/:schema/tables', async (req, res) => {
  const { schema } = req.params;
  if (!safeIdent(schema)) {
    return res.status(400).json({ error: 'Invalid schema name' });
  }
  try {
    const meta = await pool.query(
      `SELECT f_table_name AS table,
              f_geometry_column AS geom_col,
              type,
              srid
         FROM geometry_columns
        WHERE f_table_schema = $1 AND type = ANY($2)
        ORDER BY f_table_name`,
      [schema, ALLOWED_GEOM_TYPES],
    );

    // Row counts — each in its own try/catch so a single permission error
    // doesn't blow up the whole listing. If COUNT fails we just hand back
    // null and let the UI render "—" for that row.
    const tables = [];
    for (const r of meta.rows) {
      let count = null;
      if (safeIdent(r.table)) {
        try {
          const c = await pool.query(
            `SELECT COUNT(*)::int AS n FROM "${schema}"."${r.table}"`,
          );
          count = c.rows[0]?.n ?? 0;
        } catch (err) {
          console.warn(`[db.tables] count failed for ${schema}.${r.table}:`, err.message);
        }
      }
      tables.push({
        table: r.table,
        geomCol: r.geom_col,
        type: r.type,
        bucket: bucketGeomType(r.type),
        srid: Number(r.srid) || 4326,
        count,
      });
    }

    res.json({ tables });
  } catch (err) {
    console.error(`[db.tables] failed for schema=${schema}:`, err);
    res.status(500).json({ error: 'Query failed', detail: err.message });
  }
});

// GET /api/db/table/:schema/:table — full spatial table as GeoJSON. Geom
// is reprojected to 4326 on the server so the client never has to think
// about CRS for layers loaded this way.
dbRouter.get('/table/:schema/:table', async (req, res) => {
  const { schema, table } = req.params;
  if (!safeIdent(schema) || !safeIdent(table)) {
    return res.status(400).json({ error: 'Invalid schema/table name' });
  }
  try {
    const meta = await pool.query(
      `SELECT f_geometry_column AS geom_col
         FROM geometry_columns
        WHERE f_table_schema = $1 AND f_table_name = $2
        LIMIT 1`,
      [schema, table],
    );
    if (meta.rowCount === 0) {
      return res.status(404).json({
        error: `${schema}.${table} not found in geometry_columns`,
      });
    }
    const geomCol = meta.rows[0].geom_col;
    if (!safeIdent(geomCol)) {
      return res.status(500).json({ error: 'Bad geom column name' });
    }

    // ST_Transform(..., 4326) is a no-op when the column is already 4326
    // — cheap enough to keep unconditionally so the client doesn't have
    // to special-case CRS handling.
    const sql = `
      SELECT json_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(json_agg(
          json_build_object(
            'type', 'Feature',
            'geometry', ST_AsGeoJSON(ST_Transform(t."${geomCol}", 4326))::json,
            'properties', to_jsonb(t) - '${geomCol}'
          )
        ), '[]'::json)
      ) AS fc
      FROM "${schema}"."${table}" t
      WHERE t."${geomCol}" IS NOT NULL
    `;
    const { rows } = await pool.query(sql);
    res.set('Cache-Control', 'public, max-age=120');
    res.json(rows[0]?.fc ?? { type: 'FeatureCollection', features: [] });
  } catch (err) {
    console.error(`[db.table] failed for ${schema}.${table}:`, err);
    res.status(500).json({ error: 'Query failed', detail: err.message });
  }
});
