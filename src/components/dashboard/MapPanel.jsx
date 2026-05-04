import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { mapboxgl, BASEMAPS, DEFAULT_MAP_VIEW } from '@/config/mapbox';
import {
  GLACIER_LAYER_ID,
  GLACIER_SOURCE_ID,
  glacierLayerSpec,
  glacierSourceSpec,
} from '@/config/glacierLayer';
import { colorForReading, STALE_COLOR } from '@/config/parameterLegends';
import { useParameter } from '@/contexts/ParameterContext';
import BasemapSwitcher from './BasemapSwitcher';
import MapControls from './MapControls';
import MapGeocoder from './MapGeocoder';
import MapLegend from './MapLegend';
import StationsTable from './StationsTable';
import { cn } from '@/utils/cn';

const DEFAULT_BASEMAP = 'satellite';
const STATIONS_SOURCE = 'parameter-stations';
const STATIONS_LAYER = 'parameter-stations-circle';
const STATIONS_HALO_LAYER = 'parameter-stations-halo';
const STATIONS_RIPPLE_LAYERS = [
  'parameter-stations-ripple-1',
  'parameter-stations-ripple-2',
];
const NO_HIGHLIGHT_FILTER = ['==', ['get', 'stationId'], -1];

// Ripple animation tuning. Two phase-shifted layers cycle radius outward
// while fading opacity, producing a radar-pulse effect on the selected dot.
const RIPPLE_PERIOD_MS = 1800;
const RIPPLE_MIN_R = 6;
const RIPPLE_MAX_R = 22;

export default function MapPanel({ className, onMapReady }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [basemap, setBasemap] = useState(DEFAULT_BASEMAP);
  const [mapInstance, setMapInstance] = useState(null);
  const { selected, stations, selectedStation, setSelectedStation } = useParameter();

  // Build a colored FeatureCollection from the raw context features.
  // Each feature gets a `color` property derived from its value/lastUpdate
  // — Mapbox reads it via ['get', 'color'] in the circle paint spec.
  const coloredCollection = useMemo(() => {
    if (!selected || stations.length === 0) return null;
    return {
      type: 'FeatureCollection',
      features: stations.map((f) => ({
        ...f,
        properties: {
          ...f.properties,
          color: colorForReading(
            selected,
            f.properties?.value,
            f.properties?.lastUpdate,
          ),
        },
      })),
    };
  }, [selected, stations]);
  const collectionRef = useRef(coloredCollection);
  collectionRef.current = coloredCollection;

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
        const firstSymbolId = map
          .getStyle()
          .layers.find((l) => l.type === 'symbol')?.id;
        map.addLayer(glacierLayerSpec, firstSymbolId);
      }
    });

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

  // Push the colored FeatureCollection to the map when it changes; clear
  // the layer when no parameter is selected.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!coloredCollection) {
      removeStationLayers(map);
      return;
    }
    applyStationLayers(map, coloredCollection);
  }, [coloredCollection]);

  // Re-apply on style swap (Mapbox wipes layers on setStyle), and wire the
  // click + cursor handlers for the circle layer.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const onStyleLoad = () => {
      const data = collectionRef.current;
      if (data) applyStationLayers(map, data);
    };

    const onStationClick = (e) => {
      const f = e.features?.[0];
      if (!f) return;
      // Toggle: clicking the same dot twice clears the selection.
      setSelectedStation((prev) =>
        prev?.stationId === f.properties.stationId
          ? null
          : {
              ...f.properties,
              lng: f.geometry.coordinates[0],
              lat: f.geometry.coordinates[1],
            },
      );
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
  }, [setSelectedStation]);

  // Drive both the fly-to and the ripple layers' filter from the
  // currently-selected station. Selecting null clears the highlight.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      const filter =
        selectedStation?.stationId != null
          ? ['==', ['get', 'stationId'], Number(selectedStation.stationId)]
          : NO_HIGHLIGHT_FILTER;
      for (const id of STATIONS_RIPPLE_LAYERS) {
        if (map.getLayer(id)) map.setFilter(id, filter);
      }
    };

    apply();
    map.on('style.load', apply);
    return () => {
      map.off('style.load', apply);
    };
  }, [selectedStation]);

  // Animate the ripple layers via requestAnimationFrame while a station
  // is selected. Two layers run 50% out of phase so a new wave starts as
  // the previous one finishes fading — gives a continuous radar pulse.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedStation) return;

    let raf = null;
    const start = performance.now();

    const tick = (now) => {
      const elapsed = now - start;
      STATIONS_RIPPLE_LAYERS.forEach((id, i) => {
        if (!map.getLayer(id)) return;
        const phase = ((elapsed + (i * RIPPLE_PERIOD_MS) / 2) % RIPPLE_PERIOD_MS) / RIPPLE_PERIOD_MS;
        const radius = RIPPLE_MIN_R + (RIPPLE_MAX_R - RIPPLE_MIN_R) * phase;
        const opacity = 0.9 * (1 - phase);
        map.setPaintProperty(id, 'circle-radius', radius);
        map.setPaintProperty(id, 'circle-stroke-opacity', opacity);
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [selectedStation]);

  // Fly to the highlighted station whenever one is picked.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedStation) return;
    const { lng, lat } = selectedStation;
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      map.flyTo({
        center: [lng, lat],
        zoom: Math.max(map.getZoom(), 10),
        essential: true,
      });
    }
  }, [selectedStation]);

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
        <MapGeocoder map={mapInstance} />
        <MapControls map={mapInstance} fullscreenTarget={containerRef.current} />
        <MapLegend />
        <StationsTable />
      </div>
    </motion.div>
  );
}

function applyStationLayers(map, data) {
  if (!map.getSource(STATIONS_SOURCE)) {
    map.addSource(STATIONS_SOURCE, { type: 'geojson', data });
  } else {
    map.getSource(STATIONS_SOURCE).setData(data);
  }

  // Soft halo behind each circle, color-matched to the bin. Radius scales
  // with zoom so the dots stay legible when zoomed out and don't bloat
  // when zoomed in.
  if (!map.getLayer(STATIONS_HALO_LAYER)) {
    map.addLayer({
      id: STATIONS_HALO_LAYER,
      type: 'circle',
      source: STATIONS_SOURCE,
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          4, 7,
          7, 10,
          12, 16,
          16, 24,
        ],
        'circle-color': ['coalesce', ['get', 'color'], STALE_COLOR],
        'circle-opacity': 0.18,
        'circle-stroke-width': 0,
      },
    });
  }

  // Crisp filled circle on top with a dark hairline so even white "0 mm"
  // reads against light basemaps. Radius interpolated with zoom.
  if (!map.getLayer(STATIONS_LAYER)) {
    map.addLayer({
      id: STATIONS_LAYER,
      type: 'circle',
      source: STATIONS_SOURCE,
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          4, 3.5,
          7, 5,
          12, 9,
          16, 14,
        ],
        'circle-color': ['coalesce', ['get', 'color'], STALE_COLOR],
        'circle-stroke-color': '#0f172a',
        'circle-stroke-width': 1,
      },
    });
  }

  // Animated ripple rings for the selected station. Filter is set
  // externally (see the selectedStation effect); the rAF loop drives
  // the radius + opacity each frame.
  for (const id of STATIONS_RIPPLE_LAYERS) {
    if (!map.getLayer(id)) {
      map.addLayer({
        id,
        type: 'circle',
        source: STATIONS_SOURCE,
        filter: NO_HIGHLIGHT_FILTER,
        paint: {
          'circle-radius': RIPPLE_MIN_R,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': '#fbbf24',
          'circle-stroke-width': 3,
          'circle-stroke-opacity': 0,
        },
      });
    }
  }
}

function removeStationLayers(map) {
  for (const id of STATIONS_RIPPLE_LAYERS) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getLayer(STATIONS_LAYER)) map.removeLayer(STATIONS_LAYER);
  if (map.getLayer(STATIONS_HALO_LAYER)) map.removeLayer(STATIONS_HALO_LAYER);
  if (map.getSource(STATIONS_SOURCE)) map.removeSource(STATIONS_SOURCE);
}
