import express from 'express';
import { pool } from '../lib/db.js';
import { GEOMETRY_STATS_SQL } from './region.js';

// Layers in the `secondary` schema that the dashboard's left sidebar can
// render. Whitelisted by name because the layer id is interpolated into
// the SQL — anything outside this set is rejected before query time so
// path params can't smuggle DDL or alternate schemas in.
const ALLOWED_LAYERS = new Set([
  'national_boundary',
  'provincial_boundary',
  'akah_infrastructure',
  'akah_hazard_exposure',
  'akah_sensors',
  'all_stations',
  'damaged_stations',
  'bri_ff_china_sensors',
  'gmrc_wapda_stations',
  'glacial_lakes',
  'settlements',
  'cell_towers',
  'vulnerable_lakes_2026',
  'vulnerable_melting_glaciers_2026',
  'vulnerable_melting_points_2026',
  'vulnerable_sites_2026',
]);

export const secondaryRouter = express.Router();

// GET /api/secondary/sensor-counts
// Aggregate roster sizes for the four sensor networks surfaced in the
// Stations legend. PMD comes from the public `stations` table; the
// partner inventories live in their `secondary.*` tables. Returned as
// one row so the client can render the legend with a single round-trip.
// Declared BEFORE /:layer so the path segment isn't swallowed by the
// generic FeatureCollection route below.
secondaryRouter.get('/sensor-counts', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM stations)                          AS pmd,
        (SELECT COUNT(*)::int FROM secondary.akah_sensors)            AS akah_sensors,
        (SELECT COUNT(*)::int FROM secondary.bri_ff_china_sensors)    AS bri_ff_china_sensors,
        (SELECT COUNT(*)::int FROM secondary.gmrc_wapda_stations)     AS gmrc_wapda_stations
    `);
    res.set('Cache-Control', 'public, max-age=300');
    res.json(rows[0] ?? {});
  } catch (err) {
    console.error('GET /api/secondary/sensor-counts failed:', err);
    res.status(500).json({ error: 'Query failed', detail: err.message });
  }
});

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
  // every other column as a property and strips the geometry copy. The
  // GEOMETRY_STATS_SQL fragment then merges in derived area / length /
  // perimeter fields with explicit unit suffixes (`area_km2`,
  // `length_m`, …) so the client can render them with proper labels.
  const sql = `
    SELECT json_build_object(
      'type', 'FeatureCollection',
      'features', COALESCE(json_agg(
        json_build_object(
          'type', 'Feature',
          'geometry', ST_AsGeoJSON(geom)::json,
          'properties', (to_jsonb(t) - 'geom') || ${GEOMETRY_STATS_SQL}
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
