import { useCallback, useEffect, useState } from 'react';
import LeftSidebar from '@/components/layout/LeftSidebar';
import RightSidebar from '@/components/layout/RightSidebar';
import { GLACIER_LAYER_ID } from '@/config/glacierLayer';
import MapPanel from './MapPanel';
import ChartsRow from './ChartsRow';
import QuickToggles from './QuickToggles';

const TERRAIN_SPEC = { source: 'mapbox-dem', exaggeration: 1.5 };

export default function Dashboard() {
  const [map, setMap] = useState(null);
  const [quickLayers, setQuickLayers] = useState(() => new Set(['terrain']));

  const toggleQuickLayer = useCallback((id) => {
    setQuickLayers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // 3D terrain on/off — re-applied on style.load so basemap swaps don't lose it.
  useEffect(() => {
    if (!map) return;
    const terrainOn = quickLayers.has('terrain');

    const apply = () => {
      if (!map.getSource('mapbox-dem')) return;
      map.setTerrain(terrainOn ? TERRAIN_SPEC : null);
    };

    apply();
    map.on('style.load', apply);
    return () => {
      map.off('style.load', apply);
    };
  }, [map, quickLayers]);

  // Real-time glacier / snow cover overlay (NASA GIBS NDSI, Pakistan-bounded).
  // Driven by the "Glaciers" quick toggle.
  useEffect(() => {
    if (!map) return;
    const visible = quickLayers.has('glaciers');

    const apply = () => {
      if (!map.getLayer(GLACIER_LAYER_ID)) return;
      map.setLayoutProperty(
        GLACIER_LAYER_ID,
        'visibility',
        visible ? 'visible' : 'none',
      );
    };

    apply();
    map.on('style.load', apply);
    return () => {
      map.off('style.load', apply);
    };
  }, [map, quickLayers]);

  return (
    <div className="flex flex-1 min-h-0 gap-3 p-3 lg:p-4 overflow-hidden">
      <LeftSidebar />

      <div className="flex flex-col flex-1 min-w-0 min-h-0 gap-3 overflow-hidden">
        <QuickToggles active={quickLayers} onToggle={toggleQuickLayer} />
        <MapPanel className="flex-1 min-h-0" onMapReady={setMap} />
        <ChartsRow />
      </div>

      <RightSidebar />
    </div>
  );
}
