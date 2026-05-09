import express from 'express';
import { pool } from '../lib/db.js';

// Regional layer router. Each region (badswat, chatiboi, …) keeps one
// table per logical layer (lake, river, risk:high, …) under a schema
// named after the layer category. The (region, layerKey) → (schema,
// table) mapping below is the single place that knows the naming
// convention; the rest of the file just glues it to PostGIS.
//
// Sibling pattern: server/routes/secondary.js handles cross-region
// reference layers (national boundary, AKAH infrastructure, etc.) via
// /api/secondary/:layer. server/routes/gis.js proxies four live PMD
// layers via /api/gis/:layer. Together those three routers cover every
// non-parameter map layer the dashboard renders.

// layerKey is whatever the LayerMenu emits — `lake`, `river`, `glacier`,
// `faultline`, `building`, `school`, `road`, or one of `risk:low`,
// `risk:medium`, `risk:high`. The risk levels share the `risk_zones`
// schema and only differ by the per-region table suffix.
const LAYER_KEY_TO_TABLE = {
  lake:          { schema: 'lakes',      suffix: 'lakes' },
  river:         { schema: 'rivers',     suffix: 'river' },
  glacier:       { schema: 'glaciers',   suffix: 'glacier' },
  faultline:     { schema: 'faultlines', suffix: 'faultline' },
  building:      { schema: 'buildings',  suffix: 'buildings' },
  school:        { schema: 'schools',    suffix: 'schools' },
  road:          { schema: 'roads',      suffix: 'roads' },
  'risk:high':   { schema: 'risk_zones', suffix: 'high_risk_zone' },
  'risk:medium': { schema: 'risk_zones', suffix: 'medium_risk_zone' },
  'risk:low':    { schema: 'risk_zones', suffix: 'low_risk_zone' },
};

// Region names get interpolated into a table identifier, so they have
// to be validated tightly. Lowercase letters, digits, underscores; must
// start with a letter. Anything else 400s before the SQL is built.
const REGION_RE = /^[a-z][a-z0-9_]*$/;

export const regionRouter = express.Router();

// GET /api/region/:region/:layerKey
//   :region   — e.g. "badswat", "pindoru_chaat"
//   :layerKey — one of the keys in LAYER_KEY_TO_TABLE
//
// Returns a GeoJSON FeatureCollection. Missing tables (e.g. chatiboi
// has no risk:low file) resolve to an empty FC with 200, not 404 — the
// frontend treats absence as "nothing to draw" and the LayerMenu has
// no way to know in advance which tables exist per region.
regionRouter.get('/:region/:layerKey', async (req, res) => {
  const { region } = req.params;
  // Express doesn't decode `:` in path segments by default, so risk:high
  // arrives intact. Decode explicitly in case clients ever encode it.
  const layerKey = decodeURIComponent(req.params.layerKey);

  if (!REGION_RE.test(region)) {
    return res.status(400).json({ error: `Invalid region: ${region}` });
  }
  const mapping = LAYER_KEY_TO_TABLE[layerKey];
  if (!mapping) {
    return res.status(400).json({ error: `Invalid layerKey: ${layerKey}` });
  }

  const { schema, suffix } = mapping;
  const tableName = `${region}_${suffix}`;
  const qualified = `${schema}.${tableName}`;

  // Cheap existence probe: to_regclass returns NULL for unknown
  // schema.table without raising, so we don't need a try/catch around
  // a relation-not-found error from the main query.
  const probe = await pool.query('SELECT to_regclass($1) AS rel', [qualified]);
  if (!probe.rows[0]?.rel) {
    res.set('Cache-Control', 'public, max-age=300');
    return res.json({ type: 'FeatureCollection', features: [] });
  }

  // Identifiers are validated above, so direct interpolation is safe.
  // ogr2ogr loads these tables with `-lco GEOMETRY_NAME=geom`, matching
  // the convention secondary.js relies on. `to_jsonb(t) - 'geom'`
  // strips the geometry copy from the properties bag.
  const sql = `
    SELECT json_build_object(
      'type', 'FeatureCollection',
      'features', COALESCE(json_agg(
        json_build_object(
          'type', 'Feature',
          'geometry', ST_AsGeoJSON(geom)::json,
          'properties', to_jsonb(t) - 'geom'
        )
      ), '[]'::json)
    ) AS fc
    FROM "${schema}"."${tableName}" t
  `;

  try {
    const { rows } = await pool.query(sql);
    res.set('Cache-Control', 'public, max-age=300');
    res.json(rows[0]?.fc ?? { type: 'FeatureCollection', features: [] });
  } catch (err) {
    console.error(`GET /api/region/${region}/${layerKey} failed:`, err);
    res.status(500).json({ error: 'Query failed', detail: err.message });
  }
});
