import express from 'express';
import { pool } from '../lib/db.js';

// Layers in the `secondary` schema that the dashboard's left sidebar can
// render. Whitelisted by name because the layer id is interpolated into
// the SQL — anything outside this set is rejected before query time so
// path params can't smuggle DDL or alternate schemas in.
const ALLOWED_LAYERS = new Set([
  'national_boundary',
  'provincial_boundary',
  'district_boundary',
  'akah_infrastructure',
  'akah_hazard_exposure',
  'all_stations',
  'glacial_lakes',
  'settlements',
  'cell_towers',
]);

export const secondaryRouter = express.Router();

// GET /api/secondary/:layer
// Returns a GeoJSON FeatureCollection assembled inside Postgres. The
// FeatureCollection is shaped on the server so the client can pipe the
// response straight into Mapbox without any reshaping.
secondaryRouter.get('/:layer', async (req, res) => {
  const { layer } = req.params;
  if (!ALLOWED_LAYERS.has(layer)) {
    return res.status(404).json({ error: `Unknown layer: ${layer}` });
  }

  // ogr2ogr loaded these tables with `-lco GEOMETRY_NAME=geom`, so the
  // geometry column is consistently `geom`. `to_jsonb(t) - 'geom'` keeps
  // every other column as a property and strips the geometry copy.
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
    FROM secondary.${layer} t
  `;

  try {
    const { rows } = await pool.query(sql);
    // Encourage caching by clients/proxies — the underlying PostGIS rows
    // change rarely and a manual reload is fine when they do.
    res.set('Cache-Control', 'public, max-age=300');
    res.json(rows[0]?.fc ?? { type: 'FeatureCollection', features: [] });
  } catch (err) {
    console.error(`GET /api/secondary/${layer} failed:`, err);
    res.status(500).json({ error: 'Query failed', detail: err.message });
  }
});
