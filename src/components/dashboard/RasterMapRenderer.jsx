import { useEffect, useRef } from 'react';
import { useMapView } from '@/contexts/MapContext';
import { useRasters } from '@/contexts/RasterContext';
import { fetchAndDecodeRaster } from '@/utils/rasterRender';

// ---------------------------------------------------------------------------
// RasterMapRenderer — bridges `RasterContext.groups` and Mapbox.
//
// One Mapbox `image` source + `raster` layer per visible group. The
// active frame's filename governs which raster ends up in the source;
// switching frames triggers a fresh decode + `setCoordinates` /
// `updateImage`. Hidden groups have their layer's `visibility` flipped
// to `none` (cheaper than tearing down + re-adding when the user toggles
// quickly).
//
// Decode cache is keyed by filename so toggling between two recently
// rendered frames is instant (no re-fetch, no re-decode).
// ---------------------------------------------------------------------------

const SOURCE_PREFIX = 'raster-group-src-';
const LAYER_PREFIX  = 'raster-group-lyr-';

export default function RasterMapRenderer() {
  const { map } = useMapView();
  const { groups } = useRasters();

  // Per-group reconciliation state. Lives in a ref so it survives
  // re-renders without leaking into the React render cycle.
  //
  // shape: Map<groupId, {
  //   currentFrame:  string | null,   // filename currently on the map
  //   inFlightFrame: string | null,   // one we're decoding right now
  //   visible:       boolean,
  // }>
  const groupStateRef = useRef(new Map());

  // filename → decoded payload cache. LRU-ish: bounded by
  // CACHE_LIMIT to keep memory under control if a user scrubs through a
  // long temporal series.
  const decodeCacheRef = useRef(new Map());
  const CACHE_LIMIT = 12;

  useEffect(() => {
    if (!map) return;
    let cancelled = false;

    const cacheGet = (name) => {
      const cache = decodeCacheRef.current;
      if (!cache.has(name)) return null;
      // Move to end → most recently used
      const v = cache.get(name);
      cache.delete(name);
      cache.set(name, v);
      return v;
    };
    const cacheSet = (name, value) => {
      const cache = decodeCacheRef.current;
      cache.set(name, value);
      while (cache.size > CACHE_LIMIT) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
      }
    };

    const ensureSourceLayer = (groupId, payload) => {
      const sourceId = SOURCE_PREFIX + groupId;
      const layerId  = LAYER_PREFIX  + groupId;
      const exists = map.getSource(sourceId);
      if (exists) {
        // updateImage may not exist on older versions of mapbox-gl; fall
        // back to a remove + re-add cycle.
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
            },
          });
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

    const reconcile = async () => {
      // 1. Drop renderer-side state for groups that no longer exist.
      const liveIds = new Set(groups.map((g) => g.id));
      for (const id of [...groupStateRef.current.keys()]) {
        if (!liveIds.has(id)) removeGroup(id);
      }

      // 2. For each group, ensure the right frame is on the map.
      for (const g of groups) {
        const layer = g.layers[g.activeIndex] ?? g.layers[0];
        if (!layer) continue;
        const desired = layer.name;

        const state =
          groupStateRef.current.get(g.id) ?? {
            currentFrame: null,
            inFlightFrame: null,
            visible: g.visible,
          };

        // Toggle visibility cheaply — no decode needed.
        if (state.visible !== g.visible && state.currentFrame === desired) {
          setVisible(g.id, g.visible);
          state.visible = g.visible;
          groupStateRef.current.set(g.id, state);
          continue;
        }
        if (!g.visible && state.currentFrame === desired) {
          setVisible(g.id, false);
          state.visible = false;
          groupStateRef.current.set(g.id, state);
          continue;
        }

        // Already showing the right frame? Just ensure visibility is right.
        if (state.currentFrame === desired) {
          setVisible(g.id, g.visible);
          state.visible = g.visible;
          groupStateRef.current.set(g.id, state);
          continue;
        }

        // Already loading this frame? Skip — the in-flight request will
        // finish and reconcile then.
        if (state.inFlightFrame === desired) {
          continue;
        }

        state.inFlightFrame = desired;
        groupStateRef.current.set(g.id, state);

        try {
          let payload = cacheGet(desired);
          if (!payload) {
            payload = await fetchAndDecodeRaster(desired);
            cacheSet(desired, payload);
          }
          if (cancelled) return;
          // Group might've been removed mid-decode.
          if (!groupStateRef.current.has(g.id) && state.currentFrame == null) {
            // recreate state record
          }
          ensureSourceLayer(g.id, payload);
          setVisible(g.id, g.visible);
          state.currentFrame = desired;
          state.inFlightFrame = null;
          state.visible = g.visible;
          groupStateRef.current.set(g.id, state);
        } catch (err) {
          // Surface the error so the user can see WHY it didn't render.
          // Don't tear down state — let them retry by toggling.
          console.warn(
            `Raster render failed for "${desired}": ${err.message}`,
          );
          state.inFlightFrame = null;
          groupStateRef.current.set(g.id, state);
        }
      }
    };

    reconcile();
    return () => {
      cancelled = true;
    };
  }, [map, groups]);

  // Tear everything down on unmount (e.g. navigating away from the
  // dashboard) so we don't leave orphaned sources behind.
  useEffect(() => {
    if (!map) return undefined;
    // Snapshot the ref so the cleanup closure doesn't read a possibly-
    // stale `current` (the lint rule's concern).
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
