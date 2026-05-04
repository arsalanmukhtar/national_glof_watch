import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { mapboxgl, BASEMAPS, DEFAULT_MAP_VIEW } from '@/config/mapbox';
import {
  GLACIER_LAYER_ID,
  GLACIER_SOURCE_ID,
  glacierLayerSpec,
  glacierSourceSpec,
} from '@/config/glacierLayer';
import { colorFor } from '@/config/parameterColors';
import { useParameter } from '@/contexts/ParameterContext';
import BasemapSwitcher from './BasemapSwitcher';
import MapControls from './MapControls';
import StationDetailPanel from './StationDetailPanel';
import { cn } from '@/utils/cn';

const DEFAULT_BASEMAP = 'satellite';
const STATIONS_SOURCE = 'parameter-stations';
const STATIONS_LAYER = 'parameter-stations-circle';
const STATIONS_HALO_LAYER = 'parameter-stations-halo';

export default function MapPanel({ className, onMapReady }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [basemap, setBasemap] = useState(DEFAULT_BASEMAP);
  const [mapInstance, setMapInstance] = useState(null);
  const { selected, setSelectedStation } = useParameter();
  // Latest fetched FeatureCollection for the active parameter — kept in a ref
  // so the style.load handler can re-add it after a basemap swap without
  // triggering a re-fetch.
  const stationsDataRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: BASEMAPS[DEFAULT_BASEMAP],
      attributionControl: false,
      ...DEFAULT_MAP_VIEW,
    });
    mapRef.current = map;
    setMapInstance(map);

    map.addControl(new mapboxgl.ScaleControl({ unit: 'metric' }), 'bottom-right');

    // Re-register sources/layers on every style swap (Mapbox wipes them).
    // Visibility (terrain on/off, glacier overlay on/off) is owned by Dashboard.
    map.on('style.load', () => {
      if (!map.getSource('mapbox-dem')) {
        map.addSource('mapbox-dem', {
          type: 'raster-dem',
          url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
          tileSize: 512,
          maxzoom: 14,
        });
      }

      if (!map.getSource(GLACIER_SOURCE_ID)) {
        map.addSource(GLACIER_SOURCE_ID, glacierSourceSpec);
      }
      if (!map.getLayer(GLACIER_LAYER_ID)) {
        // Insert below the first symbol (label) layer so place names stay readable.
        const firstSymbolId = map
          .getStyle()
          .layers.find((l) => l.type === 'symbol')?.id;
        map.addLayer(glacierLayerSpec, firstSymbolId);
      }
    });

    // Mapbox doesn't auto-resize. Coalesce ResizeObserver bursts into one
    // map.resize() per animation frame so panel/sidebar transitions stay smooth.
    let resizeRaf = null;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeRaf !== null) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        if (mapRef.current) mapRef.current.resize();
      });
    });
    resizeObserver.observe(containerRef.current);

    if (onMapReady) onMapReady(map);

    return () => {
      if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      setMapInstance(null);
    };
  }, [onMapReady]);

  // Fetch stations from the DB-backed endpoint whenever the active parameter
  // changes; clear the layer when nothing is selected.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!selected) {
      stationsDataRef.current = null;
      removeStationLayers(map);
      return;
    }

    let cancelled = false;
    const url = `/api/parameters/${encodeURIComponent(selected)}/latest`;

    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (cancelled) return;
        stationsDataRef.current = data;
        applyStationLayers(map, data, selected);
      })
      .catch((err) => {
        if (!cancelled) console.error('[map] stations fetch failed:', err);
      });

    return () => {
      cancelled = true;
    };
  }, [selected]);

  // Re-apply the station layer after every style swap (Mapbox wipes layers
  // on setStyle). Also wires the click handler on the circle layer.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const onStyleLoad = () => {
      const data = stationsDataRef.current;
      if (data && selected) applyStationLayers(map, data, selected);
    };

    const onStationClick = (e) => {
      const f = e.features?.[0];
      if (!f) return;
      setSelectedStation({
        ...f.properties,
        lng: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
      });
    };

    const onEnter = () => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const onLeave = () => {
      map.getCanvas().style.cursor = '';
    };

    map.on('style.load', onStyleLoad);
    map.on('click', STATIONS_LAYER, onStationClick);
    map.on('mouseenter', STATIONS_LAYER, onEnter);
    map.on('mouseleave', STATIONS_LAYER, onLeave);

    return () => {
      map.off('style.load', onStyleLoad);
      map.off('click', STATIONS_LAYER, onStationClick);
      map.off('mouseenter', STATIONS_LAYER, onEnter);
      map.off('mouseleave', STATIONS_LAYER, onLeave);
    };
  }, [selected, setSelectedStation]);

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
      <div className="relative flex-1 min-h-0 bg-slate-200 dark:bg-night-bg">
        <div ref={containerRef} className="absolute inset-0" />
        <BasemapSwitcher current={basemap} onChange={changeBasemap} />
        <MapControls map={mapInstance} fullscreenTarget={containerRef.current} />
        <StationDetailPanel />
      </div>
    </motion.div>
  );
}

function applyStationLayers(map, data, element) {
  const color = colorFor(element);

  if (!map.getSource(STATIONS_SOURCE)) {
    map.addSource(STATIONS_SOURCE, { type: 'geojson', data });
  } else {
    map.getSource(STATIONS_SOURCE).setData(data);
  }

  if (!map.getLayer(STATIONS_HALO_LAYER)) {
    map.addLayer({
      id: STATIONS_HALO_LAYER,
      type: 'circle',
      source: STATIONS_SOURCE,
      paint: {
        'circle-radius': 10,
        'circle-color': color,
        'circle-opacity': 0.18,
        'circle-stroke-width': 0,
      },
    });
  } else {
    map.setPaintProperty(STATIONS_HALO_LAYER, 'circle-color', color);
  }

  if (!map.getLayer(STATIONS_LAYER)) {
    map.addLayer({
      id: STATIONS_LAYER,
      type: 'circle',
      source: STATIONS_SOURCE,
      paint: {
        'circle-radius': 5,
        'circle-color': color,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
      },
    });
  } else {
    map.setPaintProperty(STATIONS_LAYER, 'circle-color', color);
  }
}

function removeStationLayers(map) {
  if (map.getLayer(STATIONS_LAYER)) map.removeLayer(STATIONS_LAYER);
  if (map.getLayer(STATIONS_HALO_LAYER)) map.removeLayer(STATIONS_HALO_LAYER);
  if (map.getSource(STATIONS_SOURCE)) map.removeSource(STATIONS_SOURCE);
}
