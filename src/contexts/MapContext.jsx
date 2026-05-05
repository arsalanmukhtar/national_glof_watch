import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { DEFAULT_MAP_VIEW } from '@/config/mapbox';
import {
  fetchGeoJson,
  regionLayerUrl,
  secondaryLayerUrl,
} from '@/config/layerSources';
import { bboxOfGeoJson, unionBbox } from '@/utils/bbox';

const MapContext = createContext(null);

const FIT_OPTIONS = { padding: 60, duration: 700, maxZoom: 16, essential: true };

// Provider sits high in the tree — MapPanel calls `setMap` once the map
// instance is constructed, after which any descendant can call the zoom
// helpers. While `map` is null (mid-mount, off-canvas etc.) the helpers
// no-op silently rather than throwing, which simplifies button handlers.
export function MapProvider({ children }) {
  const [map, setMap] = useState(null);
  // Mirror so the imperative helpers don't need `map` in their dep array
  // (lets us hand them out as stable refs).
  const mapRef = useRef(null);
  mapRef.current = map;

  // Counter of in-flight overlay fetches. Components that drive the map
  // (MapPanel reconciler, zoomTo helpers) wrap their fetch promises with
  // `trackPromise` so the loader overlay knows when *anything* is pending.
  // A counter — not a boolean — handles concurrent fetches correctly.
  const [pending, setPending] = useState(0);
  const trackPromise = useCallback((promise) => {
    setPending((p) => p + 1);
    Promise.resolve(promise).finally(() => {
      setPending((p) => Math.max(0, p - 1));
    });
    return promise;
  }, []);

  const zoomToBbox = useCallback((bbox, opts) => {
    const m = mapRef.current;
    if (!m || !bbox) return;
    m.fitBounds(
      [
        [bbox[0], bbox[1]],
        [bbox[2], bbox[3]],
      ],
      { ...FIT_OPTIONS, ...opts },
    );
  }, []);

  const zoomToGeoJson = useCallback(
    (data, opts) => zoomToBbox(bboxOfGeoJson(data), opts),
    [zoomToBbox],
  );

  // Region/secondary layers may not be on-screen yet — fetch the file (the
  // shared cache makes this instant on second hit) and zoom to its extent.
  const zoomToRegionLayer = useCallback(
    async (regionId, layerKey) => {
      const url = regionLayerUrl(regionId, layerKey);
      if (!url) return;
      try {
        const data = await trackPromise(fetchGeoJson(url));
        zoomToGeoJson(data);
      } catch (err) {
        console.warn(`zoomToRegionLayer ${regionId}/${layerKey}:`, err);
      }
    },
    [zoomToGeoJson, trackPromise],
  );

  // Risk zones are split into low/medium/high files. Combine bboxes so the
  // user gets the full extent of the regional risk footprint regardless of
  // which subset is currently visible.
  const zoomToRegionRiskZones = useCallback(
    async (regionId) => {
      const urls = ['risk:low', 'risk:medium', 'risk:high']
        .map((k) => regionLayerUrl(regionId, k))
        .filter(Boolean);
      if (urls.length === 0) return;
      try {
        const datasets = await trackPromise(
          Promise.all(urls.map((u) => fetchGeoJson(u).catch(() => null))),
        );
        const combined = datasets.reduce(
          (acc, d) => unionBbox(acc, bboxOfGeoJson(d)),
          null,
        );
        zoomToBbox(combined);
      } catch (err) {
        console.warn(`zoomToRegionRiskZones ${regionId}:`, err);
      }
    },
    [zoomToBbox, trackPromise],
  );

  const zoomToSecondaryLayer = useCallback(
    async (layerId) => {
      const url = secondaryLayerUrl(layerId);
      if (!url) return;
      try {
        const data = await trackPromise(fetchGeoJson(url));
        zoomToGeoJson(data);
      } catch (err) {
        console.warn(`zoomToSecondaryLayer ${layerId}:`, err);
      }
    },
    [zoomToGeoJson, trackPromise],
  );

  const resetView = useCallback(() => {
    const m = mapRef.current;
    if (!m) return;
    m.flyTo({ ...DEFAULT_MAP_VIEW, duration: 700, essential: true });
  }, []);

  const value = useMemo(
    () => ({
      map,
      setMap,
      zoomToBbox,
      zoomToGeoJson,
      zoomToRegionLayer,
      zoomToRegionRiskZones,
      zoomToSecondaryLayer,
      resetView,
      isLoading: pending > 0,
      trackPromise,
    }),
    [
      map,
      zoomToBbox,
      zoomToGeoJson,
      zoomToRegionLayer,
      zoomToRegionRiskZones,
      zoomToSecondaryLayer,
      resetView,
      pending,
      trackPromise,
    ],
  );

  return <MapContext.Provider value={value}>{children}</MapContext.Provider>;
}

export function useMapView() {
  const ctx = useContext(MapContext);
  if (!ctx) {
    throw new Error('useMapView must be used inside MapProvider');
  }
  return ctx;
}
