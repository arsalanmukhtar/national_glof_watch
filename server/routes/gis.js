// PMD GIS layer proxy. The four GLOF reference layers (districts, basins,
// lakes, valleys) are served from the same private-CA host as the station
// readings — we re-use the `undici` insecure dispatcher pattern, scoped to
// these requests only. Adds:
//   * In-memory cache so repeated layer toggles don't re-hit upstream
//   * Stale-cache fallback when upstream is unreachable
//   * Coordinate-precision reduction for the lakes layer (heavy polygons)
//   * Long Cache-Control so the browser holds the response too

import express from 'express';
import { Agent, fetch as undiciFetch } from 'undici';

const PMD_GIS_URLS = {
  glof_districts: 'https://115.186.56.181/ews/gis/Glof_districts.json',
  glof_basins:    'https://115.186.56.181/ews/gis/Combine_Basin.json',
  glof_lakes:     'https://115.186.56.181/ews/gis/na_lakes.json',
  glof_valley:    'https://115.186.56.181/ews/gis/Comb_Valley.json',
};

const insecureDispatcher = new Agent({
  connect: { rejectUnauthorized: false },
});

// Reference data changes rarely. A long TTL lets the second toggle of any
// layer be instant; a server restart re-fetches.
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const cache = new Map(); // key -> { fetchedAt, body }

// Recursively snap a coordinate (or coord array) to N decimal places.
// PMD's na_lakes.json carries 12+ decimals — overkill for web display
// (~1 nm precision) and the bytes add up across thousands of polygon
// vertices. 5 decimals = ~1 m at the equator, well below pixel-level
// fidelity at any sane zoom.
function snapCoords(coord, precision) {
  if (typeof coord[0] === 'number') {
    return [
      Number(coord[0].toFixed(precision)),
      Number(coord[1].toFixed(precision)),
    ];
  }
  return coord.map((c) => snapCoords(c, precision));
}

function compactGeometry(geom, precision) {
  if (!geom?.coordinates) return geom;
  return { ...geom, coordinates: snapCoords(geom.coordinates, precision) };
}

function compactFeatureCollection(fc, precision) {
  if (!fc?.features) return fc;
  return {
    ...fc,
    features: fc.features.map((f) => ({
      ...f,
      geometry: compactGeometry(f.geometry, precision),
    })),
  };
}

export const gisRouter = express.Router();

// GET /api/gis/:layer — proxy + cache one of the four PMD GIS layers.
gisRouter.get('/:layer', async (req, res) => {
  const { layer } = req.params;
  const url = PMD_GIS_URLS[layer];
  if (!url) {
    return res.status(404).json({ error: `Unknown GIS layer: ${layer}` });
  }

  const now = Date.now();
  const cached = cache.get(layer);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    res.set('Cache-Control', 'public, max-age=3600');
    res.set('X-Cache', 'HIT');
    return res.json(cached.body);
  }

  try {
    const upstream = await undiciFetch(url, {
      dispatcher: insecureDispatcher,
      headers: { Accept: 'application/json' },
    });
    if (!upstream.ok) {
      throw new Error(`upstream ${upstream.status} ${upstream.statusText}`);
    }
    const json = await upstream.json();
    // Lakes is the heavy layer — strip excess coordinate precision before
    // caching + sending. Other layers pass through unchanged so we don't
    // touch their geometry needlessly.
    const body = layer === 'glof_lakes' ? compactFeatureCollection(json, 5) : json;
    cache.set(layer, { fetchedAt: now, body });
    res.set('Cache-Control', 'public, max-age=3600');
    res.set('X-Cache', 'MISS');
    return res.json(body);
  } catch (err) {
    console.error(`GET /api/gis/${layer} failed:`, err.message);
    // Serve stale cache rather than fail closed if PMD goes away.
    if (cached) {
      res.set('Cache-Control', 'public, max-age=60');
      res.set('X-Cache', 'STALE');
      return res.json(cached.body);
    }
    return res
      .status(502)
      .json({ error: 'Upstream fetch failed', detail: err.message });
  }
});
