import { createContext, useCallback, useContext, useMemo, useState } from 'react';

// Owns the visible-layer set for the per-region accordion in LayerMenu.
// Layer ids are composed `${regionId}::${layerKey}` where layerKey is
// one of: lake, river, glacier, faultline, building, school, road, or
// `risk:low|medium|high`. Composite ids keep the API uniform — MapPanel
// just iterates the Set and renders whatever's in it.
export function regionLayerId(regionId, layerKey) {
  return `${regionId}::${layerKey}`;
}

export function parseRegionLayerId(id) {
  const [regionId, layerKey] = id.split('::');
  return { regionId, layerKey };
}

const RegionLayersContext = createContext(null);

export function RegionLayersProvider({ children }) {
  const [visibleLayers, setVisibleLayers] = useState(() => new Set());

  const toggleLayer = useCallback((regionId, layerKey) => {
    const id = regionLayerId(regionId, layerKey);
    setVisibleLayers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const isLayerVisible = useCallback(
    (regionId, layerKey) => visibleLayers.has(regionLayerId(regionId, layerKey)),
    [visibleLayers],
  );

  const value = useMemo(
    () => ({ visibleLayers, toggleLayer, isLayerVisible }),
    [visibleLayers, toggleLayer, isLayerVisible],
  );

  return (
    <RegionLayersContext.Provider value={value}>
      {children}
    </RegionLayersContext.Provider>
  );
}

export function useRegionLayers() {
  const ctx = useContext(RegionLayersContext);
  if (!ctx) {
    throw new Error('useRegionLayers must be used inside RegionLayersProvider');
  }
  return ctx;
}
