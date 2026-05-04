import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { mapboxgl, BASEMAPS, DEFAULT_MAP_VIEW } from '@/config/mapbox';
import BasemapSwitcher from './BasemapSwitcher';
import { cn } from '@/utils/cn';

const DEFAULT_BASEMAP = 'satellite';

export default function MapPanel({ className, onMapReady }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [basemap, setBasemap] = useState(DEFAULT_BASEMAP);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: BASEMAPS[DEFAULT_BASEMAP],
      attributionControl: false,
      ...DEFAULT_MAP_VIEW,
    });
    mapRef.current = map;

    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(
      new mapboxgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showUserHeading: true,
      }),
      'top-right',
    );
    map.addControl(new mapboxgl.FullscreenControl(), 'top-right');
    map.addControl(new mapboxgl.ScaleControl({ unit: 'metric' }), 'bottom-right');

    // Re-add the DEM source on every style swap; terrain on/off is owned by Dashboard.
    map.on('style.load', () => {
      if (!map.getSource('mapbox-dem')) {
        map.addSource('mapbox-dem', {
          type: 'raster-dem',
          url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
          tileSize: 512,
          maxzoom: 14,
        });
      }
    });

    // Mapbox doesn't auto-resize; observe the container so panel toggles,
    // sidebar collapses, and window resizes all trigger a redraw.
    const resizeObserver = new ResizeObserver(() => {
      map.resize();
    });
    resizeObserver.observe(containerRef.current);

    if (onMapReady) onMapReady(map);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [onMapReady]);

  const changeBasemap = (key) => {
    const map = mapRef.current;
    if (!map || basemap === key || !BASEMAPS[key]) return;
    map.setStyle(BASEMAPS[key]);
    setBasemap(key);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={cn('card-base overflow-hidden flex flex-col min-h-0', className)}
    >
      <div className="relative flex-1 min-h-0">
        <div ref={containerRef} className="absolute inset-0" />
        <BasemapSwitcher current={basemap} onChange={changeBasemap} />
      </div>
    </motion.div>
  );
}
