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
import {
  detectGeometry,
  fetchGeoJson,
  regionLayerColor,
  regionLayerGeometry,
  regionLayerUrl,
  secondaryLayerUrl,
} from '@/config/layerSources';
import { useParameter } from '@/contexts/ParameterContext';
import {
  parseRegionLayerId,
  useRegionLayers,
} from '@/contexts/RegionLayersContext';
import {
  DEFAULT_STYLES as SECONDARY_DEFAULT_STYLES,
  useSecondary,
} from '@/contexts/SecondaryContext';
import { useMapView } from '@/contexts/MapContext';
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

// Layer ids we own — skipped when the basemap-opacity slider iterates the
// style. Anything else in `map.getStyle().layers` is treated as basemap.
const CUSTOM_LAYER_IDS = new Set([
  GLACIER_LAYER_ID,
  STATIONS_HALO_LAYER,
  STATIONS_LAYER,
  ...STATIONS_RIPPLE_LAYERS,
]);

// Ripple animation tuning. Two phase-shifted layers cycle radius outward
// while fading opacity, producing a radar-pulse effect on the selected dot.
const RIPPLE_PERIOD_MS = 1800;
const RIPPLE_MIN_R = 6;
const RIPPLE_MAX_R = 22;

export default function MapPanel({ className, onMapReady }) {
  const containerRef = useRef(null);
  // Wraps the map canvas + every overlay (geocoder, legend, table, controls);
  // this is what fullscreen targets so the overlays come along.
  const wrapperRef = useRef(null);
  const mapRef = useRef(null);
  const [basemap, setBasemap] = useState(DEFAULT_BASEMAP);
  const [basemapOpacity, setBasemapOpacity] = useState(1);
  const [mapInstance, setMapInstance] = useState(null);
  const {
    selected,
    stations,
    selectedStation,
    setSelectedStation,
    disabledBinColors,
    toggleBin,
  } = useParameter();
  const { visibleLayers: regionVisible } = useRegionLayers();
  const {
    layers: secondaryLayers,
    visibleLayers: secondaryVisible,
    styles: secondaryStyles,
    uploads,
  } = useSecondary();
  const { setMap } = useMapView();
  // Ref mirror so style.load handlers + applyStationLayers can read the
  // current disabled set without re-creating callbacks on every change.
  const disabledBinColorsRef = useRef(disabledBinColors);
  disabledBinColorsRef.current = disabledBinColors;

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

  // Desired overlay layers — flat list combining region accordion picks,
  // secondary panel toggles, and uploaded files. MapPanel reconciles this
  // against the live Mapbox layers in a useEffect below; the per-overlay
  // shape is normalized so a single render path can handle all three
  // sources (`paint` carries whatever the geometry-specific layer needs).
  const desiredOverlays = useMemo(() => {
    const list = [];

    for (const id of regionVisible) {
      const { regionId, layerKey } = parseRegionLayerId(id);
      const url = regionLayerUrl(regionId, layerKey);
      if (!url) continue;
      const color = regionLayerColor(layerKey);
      list.push({
        key: `region:${id}`,
        url,
        data: null,
        geometry: regionLayerGeometry(layerKey),
        paint: {
          color,
          width: 2,
          opacity: 1,
          dashed: layerKey === 'faultline',
          fillColor: color,
          fillOpacity: 0.3,
          strokeColor: color,
          strokeWidth: 1.5,
          strokeOpacity: 1,
          radius: 5,
        },
      });
    }

    for (const id of secondaryVisible) {
      const layer = secondaryLayers.find((l) => l.id === id);
      if (!layer) continue; // uploads handled separately below
      const url = secondaryLayerUrl(id);
      if (!url) continue;
      const style =
        secondaryStyles[id] ?? SECONDARY_DEFAULT_STYLES[layer.geometry];
      list.push({
        key: `secondary:${id}`,
        url,
        data: null,
        geometry: layer.geometry,
        paint: style,
      });
    }

    for (const upload of uploads) {
      if (!secondaryVisible.has(upload.id)) continue;
      const geometry = upload.geometry || 'polygon';
      const style =
        secondaryStyles[upload.id] ?? SECONDARY_DEFAULT_STYLES[geometry];
      list.push({
        key: `upload:${upload.id}`,
        url: null,
        data: upload.data,
        geometry,
        paint: style,
      });
    }

    return list;
  }, [regionVisible, secondaryLayers, secondaryVisible, secondaryStyles, uploads]);

  // Mirror so the style.load handler can re-apply overlays on basemap swap
  // without re-creating the listener on every visibility change.
  const desiredOverlaysRef = useRef(desiredOverlays);
  desiredOverlaysRef.current = desiredOverlays;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: BASEMAPS[DEFAULT_BASEMAP],
      attributionControl: false,
      // Start flat — Mapbox 3.x defaults to globe, but the rest of the
      // dashboard (regional layers, legend overlays) reads better on
      // Mercator. The user can flip to globe via the projection toggle.
      projection: 'mercator',
      ...DEFAULT_MAP_VIEW,
    });
    mapRef.current = map;
    setMapInstance(map);
    setMap(map);

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
      setMap(null);
    };
  }, [onMapReady, setMap]);

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
      // Re-apply the bin filter after layers are re-created on style swap.
      const filter = binFilter(disabledBinColorsRef.current);
      for (const layerId of [STATIONS_LAYER, STATIONS_HALO_LAYER]) {
        if (map.getLayer(layerId)) map.setFilter(layerId, filter);
      }
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

  // Push the legend's disabled-bin set as a Mapbox filter on the dot + halo
  // layers. Re-applied on style.load via the stations-style.load handler
  // (which reads from disabledBinColorsRef).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const filter = binFilter(disabledBinColors);
    for (const layerId of [STATIONS_LAYER, STATIONS_HALO_LAYER]) {
      if (map.getLayer(layerId)) map.setFilter(layerId, filter);
    }
  }, [disabledBinColors]);

  // Apply basemap-opacity by iterating the live style's layers and tweaking
  // each layer's type-appropriate opacity paint property. Custom layers
  // we own (stations, glacier overlay) are skipped so the data stays at
  // full opacity regardless of the slider. We re-apply on `style.load`
  // (basemap swap) AND on the first `idle` after that, because Mapbox
  // can fire style.load while some layers are still being wired up — at
  // that moment iterating the style misses or stomps the half-loaded set.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      if (!map.isStyleLoaded()) return;
      const style = map.getStyle();
      if (!style?.layers) return;
      for (const layer of style.layers) {
        if (CUSTOM_LAYER_IDS.has(layer.id)) continue;
        // Skip user-overlay layers (region, secondary, uploads) — they
        // share the basemap stack but should stay full-opacity regardless
        // of the slider, just like the parameter station dots.
        if (layer.id.startsWith(OVERLAY_PREFIX)) continue;
        applyLayerOpacity(map, layer, basemapOpacity);
      }
    };

    const onStyleLoad = () => {
      apply();
      // Catch the case where some layers settle after style.load.
      map.once('idle', apply);
    };

    apply();
    map.on('style.load', onStyleLoad);
    return () => {
      map.off('style.load', onStyleLoad);
    };
  }, [basemapOpacity]);

  // Reconcile overlays whenever the desired list changes. Async because
  // region + secondary layers fetch their GeoJSON on demand (cached after
  // first hit). Layers that go away are torn down imperatively; new ones
  // are added via ensureOverlay.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;

    const apply = async () => {
      if (!map.isStyleLoaded()) {
        // Skip — the style.load handler below will catch us up.
        return;
      }
      const desired = desiredOverlaysRef.current;
      const desiredKeys = new Set(desired.map((o) => o.key));
      const tracked = (map._renderedOverlays ||= new Set());

      for (const key of [...tracked]) {
        if (!desiredKeys.has(key)) {
          removeOverlay(map, key);
          tracked.delete(key);
        }
      }

      for (const o of desired) {
        try {
          const data = o.data ?? (await fetchGeoJson(o.url));
          if (cancelled || !data || !mapRef.current) return;
          // Re-detect geometry from the actual file when the per-key hint
          // disagrees with the data — handles e.g. risk zones loaded from
          // line-string sources rather than polygons.
          const geometry = detectGeometry(data) || o.geometry;
          ensureOverlay(map, o.key, geometry, data, o.paint);
          tracked.add(o.key);
        } catch (err) {
          // Don't block the rest of the batch on a single 404 / parse fail.
          console.warn(`Overlay ${o.key} failed to load:`, err);
        }
      }
    };

    apply();
    return () => {
      cancelled = true;
    };
  }, [desiredOverlays]);

  // Re-apply every overlay after a basemap swap (Mapbox wipes user layers
  // on setStyle). The cached fetches make this near-instant.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const onStyleLoad = async () => {
      // Style was just replaced — Mapbox dropped our sources/layers, so
      // forget what we tracked. We'll re-add from scratch.
      map._renderedOverlays = new Set();
      const desired = desiredOverlaysRef.current;
      for (const o of desired) {
        try {
          const data = o.data ?? (await fetchGeoJson(o.url));
          if (!data || !mapRef.current) return;
          const geometry = detectGeometry(data) || o.geometry;
          ensureOverlay(map, o.key, geometry, data, o.paint);
          map._renderedOverlays.add(o.key);
        } catch (err) {
          console.warn(`Overlay ${o.key} re-apply failed:`, err);
        }
      }
    };

    map.on('style.load', onStyleLoad);
    return () => {
      map.off('style.load', onStyleLoad);
    };
  }, []);

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
      <div
        ref={wrapperRef}
        className="relative flex-1 min-h-0 bg-slate-200 dark:bg-night-bg"
      >
        <div ref={containerRef} className="absolute inset-0" />
        <BasemapSwitcher
          current={basemap}
          onChange={changeBasemap}
          opacity={basemapOpacity}
          onOpacityChange={setBasemapOpacity}
        />
        <MapGeocoder map={mapInstance} />
        <MapControls map={mapInstance} fullscreenTarget={wrapperRef.current} />
        <MapLegend
          disabledBinColors={disabledBinColors}
          onToggleBin={toggleBin}
        />
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
          4, 8.75,
          7, 12.5,
          12, 20,
          16, 30,
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
          4, 4.375,
          7, 6.25,
          12, 11.25,
          16, 17.5,
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

// Set the type-appropriate opacity paint property on a single layer.
// Wrapped in try/catch because some Mapbox layers carry data-driven
// opacity expressions that error on a plain numeric set; for the slider's
// purposes a silent skip is fine.
function applyLayerOpacity(map, layer, opacity) {
  const set = (prop) => {
    try {
      map.setPaintProperty(layer.id, prop, opacity);
    } catch {
      /* ignore — non-applicable property or expression conflict */
    }
  };
  switch (layer.type) {
    case 'background':     set('background-opacity');      break;
    case 'fill':           set('fill-opacity');            break;
    case 'line':           set('line-opacity');            break;
    case 'symbol':         set('text-opacity'); set('icon-opacity'); break;
    case 'raster':         set('raster-opacity');          break;
    case 'circle':         set('circle-opacity'); set('circle-stroke-opacity'); break;
    case 'fill-extrusion': set('fill-extrusion-opacity');  break;
    case 'heatmap':        set('heatmap-opacity');         break;
    case 'hillshade':      set('hillshade-opacity');       break;
    default: break;
  }
}

// Build a Mapbox filter expression that excludes features whose computed
// `color` property is in the disabled set. Returns null (no filter) when
// nothing is disabled.
function binFilter(disabledBinColors) {
  if (!disabledBinColors || disabledBinColors.size === 0) return null;
  return [
    '!',
    ['in', ['get', 'color'], ['literal', [...disabledBinColors]]],
  ];
}

function removeStationLayers(map) {
  for (const id of STATIONS_RIPPLE_LAYERS) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getLayer(STATIONS_LAYER)) map.removeLayer(STATIONS_LAYER);
  if (map.getLayer(STATIONS_HALO_LAYER)) map.removeLayer(STATIONS_HALO_LAYER);
  if (map.getSource(STATIONS_SOURCE)) map.removeSource(STATIONS_SOURCE);
}

// ---------------------------------------------------------------------------
// Overlay layer helpers — used for region accordion picks, secondary panel
// toggles, and uploaded GeoJSON/shp files. Each overlay owns one source
// and 1-2 layers depending on geometry. Layer ids are namespaced so the
// reconciler can find and remove them by key without scanning the style.
// ---------------------------------------------------------------------------

const OVERLAY_PREFIX = 'overlay:';

function overlayIds(key) {
  return {
    source: `${OVERLAY_PREFIX}${key}`,
    fill:   `${OVERLAY_PREFIX}${key}:fill`,
    line:   `${OVERLAY_PREFIX}${key}:line`,
    circle: `${OVERLAY_PREFIX}${key}:circle`,
  };
}

// Where to insert overlay layers — below the station halo so dots stay
// visually on top. Falls back to undefined (top of stack) if stations
// aren't on the map yet.
function overlayBeforeId(map) {
  return map.getLayer(STATIONS_HALO_LAYER) ? STATIONS_HALO_LAYER : undefined;
}

function ensureOverlay(map, key, geometry, data, paint) {
  const ids = overlayIds(key);

  // Source: create or update with new data.
  const source = map.getSource(ids.source);
  if (source) {
    source.setData(data);
  } else {
    map.addSource(ids.source, { type: 'geojson', data });
  }

  const beforeId = overlayBeforeId(map);

  if (geometry === 'polygon') {
    if (!map.getLayer(ids.fill)) {
      map.addLayer(
        {
          id: ids.fill,
          type: 'fill',
          source: ids.source,
          paint: {
            'fill-color': paint.fillColor ?? '#16a085',
            'fill-opacity': paint.fillOpacity ?? 0.3,
          },
        },
        beforeId,
      );
    } else {
      map.setPaintProperty(ids.fill, 'fill-color', paint.fillColor ?? '#16a085');
      map.setPaintProperty(ids.fill, 'fill-opacity', paint.fillOpacity ?? 0.3);
    }
    if (!map.getLayer(ids.line)) {
      map.addLayer(
        {
          id: ids.line,
          type: 'line',
          source: ids.source,
          paint: {
            'line-color': paint.strokeColor ?? '#0f7560',
            'line-width': paint.strokeWidth ?? 1.5,
            'line-opacity': paint.strokeOpacity ?? 1,
          },
        },
        beforeId,
      );
    } else {
      map.setPaintProperty(ids.line, 'line-color', paint.strokeColor ?? '#0f7560');
      map.setPaintProperty(ids.line, 'line-width', paint.strokeWidth ?? 1.5);
      map.setPaintProperty(ids.line, 'line-opacity', paint.strokeOpacity ?? 1);
    }
  } else if (geometry === 'line') {
    const dasharray = paint.dashed ? [2, 2] : null;
    if (!map.getLayer(ids.line)) {
      map.addLayer(
        {
          id: ids.line,
          type: 'line',
          source: ids.source,
          paint: {
            'line-color': paint.color ?? '#16a085',
            'line-width': paint.width ?? 2,
            'line-opacity': paint.opacity ?? 1,
            ...(dasharray ? { 'line-dasharray': dasharray } : {}),
          },
        },
        beforeId,
      );
    } else {
      map.setPaintProperty(ids.line, 'line-color', paint.color ?? '#16a085');
      map.setPaintProperty(ids.line, 'line-width', paint.width ?? 2);
      map.setPaintProperty(ids.line, 'line-opacity', paint.opacity ?? 1);
      try {
        map.setPaintProperty(ids.line, 'line-dasharray', dasharray ?? null);
      } catch {
        /* some Mapbox versions reject null — ignore */
      }
    }
  } else if (geometry === 'point') {
    if (!map.getLayer(ids.circle)) {
      map.addLayer(
        {
          id: ids.circle,
          type: 'circle',
          source: ids.source,
          paint: {
            'circle-radius': paint.radius ?? 6,
            'circle-color': paint.fillColor ?? '#16a085',
            'circle-opacity': paint.fillOpacity ?? 0.85,
            'circle-stroke-color': paint.strokeColor ?? '#0f7560',
            'circle-stroke-width': paint.strokeWidth ?? 1.5,
            'circle-stroke-opacity': paint.strokeOpacity ?? 1,
          },
        },
        beforeId,
      );
    } else {
      map.setPaintProperty(ids.circle, 'circle-radius', paint.radius ?? 6);
      map.setPaintProperty(ids.circle, 'circle-color', paint.fillColor ?? '#16a085');
      map.setPaintProperty(ids.circle, 'circle-opacity', paint.fillOpacity ?? 0.85);
      map.setPaintProperty(ids.circle, 'circle-stroke-color', paint.strokeColor ?? '#0f7560');
      map.setPaintProperty(ids.circle, 'circle-stroke-width', paint.strokeWidth ?? 1.5);
      map.setPaintProperty(ids.circle, 'circle-stroke-opacity', paint.strokeOpacity ?? 1);
    }
  }
}

function removeOverlay(map, key) {
  const ids = overlayIds(key);
  for (const layerId of [ids.fill, ids.line, ids.circle]) {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
  }
  if (map.getSource(ids.source)) map.removeSource(ids.source);
}
