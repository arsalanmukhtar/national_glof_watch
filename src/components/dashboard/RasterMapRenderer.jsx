import { useEffect, useRef, useState } from 'react';
import { useMapView } from '@/contexts/MapContext';
import { useRasters } from '@/contexts/RasterContext';
import { boundsToBbox, fetchAndDecodeRaster } from '@/utils/rasterRender';

// ---------------------------------------------------------------------------
// RasterMapRenderer — bridges `RasterContext.groups` and Mapbox.
//
// One Mapbox `image` source + `raster` layer per visible group. The
// active frame's filename + symbology hash governs which decoded image
// ends up in the source; switching frames or changing the colormap /
// stretch triggers a fresh decode + `updateImage`. Hidden groups have
// their layer's `visibility` flipped to `none` (cheaper than tearing
// down + re-adding when the user toggles quickly).
//
// Decode cache key includes the symbology so toggling between two
// colormaps re-uses an earlier render rather than re-decoding the TIFF.
// Opacity is applied as `raster-opacity` paint — no decode needed.
// ---------------------------------------------------------------------------

const SOURCE_PREFIX = 'raster-group-src-';
const LAYER_PREFIX  = 'raster-group-lyr-';

// What goes into the cache key. Anything that affects decoded pixels
// must be here; anything we can update via paint properties must NOT.
function symbologyKey(style) {
  if (!style) return '|';
  const auto = style.autoStretch !== false;
  const min = auto ? 'auto' : style.min ?? 'auto';
  const max = auto ? 'auto' : style.max ?? 'auto';
  return `${style.colormap || 'viridis'}|${min}|${max}`;
}

function frameKey(name, style) {
  return `${name}|${symbologyKey(style)}`;
}

// Cheap deep-equal for the 4-corner bounds shape. Avoids repeatedly
// firing setLayerBounds with the same value (which would otherwise
// retrigger the reconcile effect).
function sameBounds(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const av = a[i];
    const bv = b[i];
    if (!av || !bv) return false;
    if (av[0] !== bv[0] || av[1] !== bv[1]) return false;
  }
  return true;
}

export default function RasterMapRenderer() {
  const { map, zoomToBbox } = useMapView();
  const { groups, setGroupDataStats, setLayerBounds, setGroupError } = useRasters();
  // Tracks groups we've already framed once so the auto-fit only fires
  // on the first successful decode — subsequent renders (frame swap,
  // colormap change, opacity tweak) leave the user's pan/zoom alone.
  const autoZoomedRef = useRef(new Set());

  // Per-group reconciliation state. Lives in a ref so it survives
  // re-renders without leaking into the React render cycle.
  //
  // shape: Map<groupId, {
  //   currentKey:   string | null,  // frameKey on the map right now
  //   inFlightKey:  string | null,  // one we're decoding
  //   visible:      boolean,
  //   opacity:      number,         // last applied opacity
  // }>
  const groupStateRef = useRef(new Map());

  // frameKey → decoded payload cache. LRU-ish: bounded by
  // CACHE_LIMIT to keep memory under control if a user scrubs through a
  // long temporal series or toggles between several colormaps.
  const decodeCacheRef = useRef(new Map());
  const CACHE_LIMIT = 12;

  // Mapbox wipes every custom source + layer when the basemap swaps
  // (`map.setStyle()` → fires `style.load`). The reconciliation state
  // ref still claims those sources are present, so without resetting it
  // the rasters silently disappear. Bumping this counter on every
  // style.load forces the reconcile effect to re-run with empty
  // bookkeeping → it re-adds everything from scratch.
  const [styleEpoch, setStyleEpoch] = useState(0);
  useEffect(() => {
    if (!map) return undefined;
    const onStyleLoad = () => {
      groupStateRef.current.clear();
      setStyleEpoch((e) => e + 1);
    };
    map.on('style.load', onStyleLoad);
    return () => {
      map.off('style.load', onStyleLoad);
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;
    let cancelled = false;

    const cacheGet = (key) => {
      const cache = decodeCacheRef.current;
      if (!cache.has(key)) return null;
      // Move to end → most recently used.
      const v = cache.get(key);
      cache.delete(key);
      cache.set(key, v);
      return v;
    };
    const cacheSet = (key, value) => {
      const cache = decodeCacheRef.current;
      cache.set(key, value);
      while (cache.size > CACHE_LIMIT) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
      }
    };

    const ensureSourceLayer = (groupId, payload, opacity) => {
      const sourceId = SOURCE_PREFIX + groupId;
      const layerId  = LAYER_PREFIX  + groupId;
      const exists = map.getSource(sourceId);
      if (exists) {
        if (typeof exists.updateImage === 'function') {
          exists.updateImage({
            url: payload.dataUrl,
            coordinates: payload.bounds,
          });
        } else {
          if (map.getLayer(layerId)) map.removeLayer(layerId);
          map.removeSource(sourceId);
          map.addSource(sourceId, {
            type: 'image',
            url: payload.dataUrl,
            coordinates: payload.bounds,
          });
          map.addLayer({
            id: layerId,
            type: 'raster',
            source: sourceId,
            paint: {
              'raster-resampling': 'nearest',
              'raster-fade-duration': 0,
              'raster-opacity': opacity,
            },
          });
        }
        if (map.getLayer(layerId)) {
          map.setPaintProperty(layerId, 'raster-opacity', opacity);
        }
        return;
      }
      map.addSource(sourceId, {
        type: 'image',
        url: payload.dataUrl,
        coordinates: payload.bounds,
      });
      map.addLayer({
        id: layerId,
        type: 'raster',
        source: sourceId,
        paint: {
          'raster-resampling': 'nearest',
          'raster-fade-duration': 0,
          'raster-opacity': opacity,
        },
      });
    };

    const removeGroup = (groupId) => {
      const sourceId = SOURCE_PREFIX + groupId;
      const layerId  = LAYER_PREFIX  + groupId;
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      groupStateRef.current.delete(groupId);
    };

    const setVisible = (groupId, visible) => {
      const layerId = LAYER_PREFIX + groupId;
      if (!map.getLayer(layerId)) return;
      map.setLayoutProperty(
        layerId,
        'visibility',
        visible ? 'visible' : 'none',
      );
    };

    const setOpacity = (groupId, opacity) => {
      const layerId = LAYER_PREFIX + groupId;
      if (!map.getLayer(layerId)) return;
      map.setPaintProperty(layerId, 'raster-opacity', opacity);
    };

    const reconcile = async () => {
      // 1. Drop renderer-side state for groups that no longer exist.
      const liveIds = new Set(groups.map((g) => g.id));
      for (const id of [...groupStateRef.current.keys()]) {
        if (!liveIds.has(id)) removeGroup(id);
      }

      // 2. For each group, ensure the right frame + symbology is on the map.
      for (const g of groups) {
        const layer = g.layers[g.activeIndex] ?? g.layers[0];
        if (!layer) continue;
        const desiredKey = frameKey(layer.name, g.style);
        const opacity = g.style?.opacity ?? 1;
        const auto = g.style?.autoStretch !== false;

        const state =
          groupStateRef.current.get(g.id) ?? {
            currentKey: null,
            inFlightKey: null,
            visible: g.visible,
            opacity,
          };

        // Cheap path — same frame + symbology, just visibility / opacity changed.
        if (state.currentKey === desiredKey) {
          if (state.visible !== g.visible) {
            setVisible(g.id, g.visible);
            state.visible = g.visible;
          }
          if (state.opacity !== opacity) {
            setOpacity(g.id, opacity);
            state.opacity = opacity;
          }
          groupStateRef.current.set(g.id, state);
          continue;
        }

        // Already loading this exact key? Let the in-flight settle.
        if (state.inFlightKey === desiredKey) continue;

        state.inFlightKey = desiredKey;
        groupStateRef.current.set(g.id, state);

        try {
          let payload = cacheGet(desiredKey);
          if (!payload) {
            payload = await fetchAndDecodeRaster(layer.name, {
              colormap: g.style?.colormap,
              styleMin: auto ? null : g.style?.min,
              styleMax: auto ? null : g.style?.max,
            });
            cacheSet(desiredKey, payload);
          }
          if (cancelled) return;
          ensureSourceLayer(g.id, payload, opacity);
          setVisible(g.id, g.visible);
          state.currentKey = desiredKey;
          state.inFlightKey = null;
          state.visible = g.visible;
          state.opacity = opacity;
          groupStateRef.current.set(g.id, state);
          // Surface the actual data range to the styling panel so the
          // manual min/max inputs can pre-fill with sensible numbers.
          if (
            payload.stats &&
            (g.dataStats?.dataMin !== payload.stats.dataMin ||
              g.dataStats?.dataMax !== payload.stats.dataMax)
          ) {
            setGroupDataStats(g.id, {
              dataMin: payload.stats.dataMin,
              dataMax: payload.stats.dataMax,
            });
          }
          // Cache the layer's bounds so the zoom-to-extent button can
          // fly straight there without re-fetching the TIFF.
          if (payload.bounds && !sameBounds(layer.bounds, payload.bounds)) {
            setLayerBounds(g.id, layer.name, payload.bounds);
          }
          // First successful decode for this group → fly the map to
          // the raster's footprint so it's actually visible. Skips on
          // every later decode (frame change, restyle) so we don't
          // hijack the user's view.
          if (!autoZoomedRef.current.has(g.id) && payload.bounds) {
            const bbox = boundsToBbox(payload.bounds);
            if (bbox) {
              autoZoomedRef.current.add(g.id);
              zoomToBbox(bbox);
            }
          }
          // Decode succeeded — clear any stale error from a previous
          // failed attempt (e.g. user reuploaded the file with a
          // supported CRS).
          setGroupError(g.id, null);
        } catch (err) {
          console.warn(
            `Raster render failed for "${layer.name}": ${err.message}`,
          );
          setGroupError(g.id, err.message || 'Decode failed');
          state.inFlightKey = null;
          groupStateRef.current.set(g.id, state);
        }
      }
    };

    reconcile();
    return () => {
      cancelled = true;
    };
  }, [map, groups, setGroupDataStats, setLayerBounds, setGroupError, zoomToBbox, styleEpoch]);

  // Forget the auto-zoom guard for any group that's been removed so
  // re-adding the same file (e.g. user re-uploaded) re-frames it.
  useEffect(() => {
    const liveIds = new Set(groups.map((g) => g.id));
    for (const id of [...autoZoomedRef.current]) {
      if (!liveIds.has(id)) autoZoomedRef.current.delete(id);
    }
  }, [groups]);

  // Tear everything down on unmount (e.g. navigating away from the
  // dashboard) so we don't leave orphaned sources behind.
  useEffect(() => {
    if (!map) return undefined;
    const stateMap = groupStateRef.current;
    return () => {
      for (const id of [...stateMap.keys()]) {
        const sourceId = SOURCE_PREFIX + id;
        const layerId  = LAYER_PREFIX  + id;
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      }
      stateMap.clear();
    };
  }, [map]);

  return null;
}
