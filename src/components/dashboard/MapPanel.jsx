import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
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
  regionLayerGeometry,
  regionLayerUrl,
  secondaryLayerUrl,
} from '@/config/layerSources';
import { useParameter } from '@/contexts/ParameterContext';
import {
  parseRegionLayerId,
  useRegionLayers,
} from '@/contexts/RegionLayersContext';
import { useSecondary } from '@/contexts/SecondaryContext';
import {
  effectiveStyle,
  labelLayoutAndPaint,
  paintExprsFor,
} from '@/utils/layerStyle';
import { useMapView } from '@/contexts/MapContext';
import BasemapSwitcher from './BasemapSwitcher';
import MapControls from './MapControls';
import MapGeocoder from './MapGeocoder';
import MapLegend from './MapLegend';
import RasterMapRenderer from './RasterMapRenderer';
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
    dbLayers,
  } = useSecondary();
  const { setMap, trackPromise, isLoading, focusedFeature } = useMapView();
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
      const geometry = regionLayerGeometry(layerKey);
      list.push({
        key: `region:${id}`,
        url,
        data: null,
        geometry,
        style: effectiveStyle(id, geometry, secondaryStyles[id]),
      });
    }

    for (const id of secondaryVisible) {
      const layer = secondaryLayers.find((l) => l.id === id);
      if (!layer) continue; // uploads handled separately below
      const url = secondaryLayerUrl(id);
      if (!url) continue;
      list.push({
        key: `secondary:${id}`,
        url,
        data: null,
        geometry: layer.geometry,
        style: effectiveStyle(id, layer.geometry, secondaryStyles[id]),
      });
    }

    for (const upload of uploads) {
      if (!secondaryVisible.has(upload.id)) continue;
      const geometry = upload.geometry || 'polygon';
      list.push({
        key: `upload:${upload.id}`,
        url: null,
        data: upload.data,
        geometry,
        style: effectiveStyle(upload.id, geometry, secondaryStyles[upload.id]),
      });
    }

    for (const dbLayer of dbLayers) {
      if (!secondaryVisible.has(dbLayer.id)) continue;
      const geometry = dbLayer.geometry || 'polygon';
      list.push({
        key: `db:${dbLayer.id}`,
        url: null,
        data: dbLayer.data,
        geometry,
        style: effectiveStyle(dbLayer.id, geometry, secondaryStyles[dbLayer.id]),
      });
    }

    return list;
  }, [regionVisible, secondaryLayers, secondaryVisible, secondaryStyles, uploads, dbLayers]);

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
        if (layer.id.startsWith(FOCUS_PREFIX)) continue;
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

      // Resolve every overlay's data in parallel and wrap the whole batch
      // in a single trackPromise so the loader stays continuous instead
      // of blinking between sequential fetches.
      const resolved = await trackPromise(
        Promise.all(
          desired.map(async (o) => {
            try {
              const data = o.data ?? (await fetchGeoJson(o.url));
              return data ? { o, data } : null;
            } catch (err) {
              console.warn(`Overlay ${o.key} failed to load:`, err);
              return null;
            }
          }),
        ),
      );
      if (cancelled || !mapRef.current) return;

      for (const entry of resolved) {
        if (!entry) continue;
        const geometry = detectGeometry(entry.data) || entry.o.geometry;
        ensureOverlay(map, entry.o.key, geometry, entry.data, entry.o.style);
        tracked.add(entry.o.key);
      }
    };

    apply();
    return () => {
      cancelled = true;
    };
  }, [desiredOverlays, trackPromise]);

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
      const resolved = await trackPromise(
        Promise.all(
          desired.map(async (o) => {
            try {
              const data = o.data ?? (await fetchGeoJson(o.url));
              return data ? { o, data } : null;
            } catch (err) {
              console.warn(`Overlay ${o.key} re-apply failed:`, err);
              return null;
            }
          }),
        ),
      );
      if (!mapRef.current) return;
      for (const entry of resolved) {
        if (!entry) continue;
        const geometry = detectGeometry(entry.data) || entry.o.geometry;
        ensureOverlay(map, entry.o.key, geometry, entry.data, entry.o.style);
        map._renderedOverlays.add(entry.o.key);
      }
    };

    map.on('style.load', onStyleLoad);
    return () => {
      map.off('style.load', onStyleLoad);
    };
  }, [trackPromise]);

  // Render the focused feature as an extra layer on top of the regular
  // overlays. Source updates with the feature's geometry; layers are
  // (re-)created on every style.load so a basemap swap doesn't drop
  // the highlight. Cleared by passing `null` to setFocusedFeature.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      if (!map.isStyleLoaded()) return;
      if (focusedFeature?.geometry) {
        applyFocusOverlay(map, focusedFeature);
      } else {
        removeFocusOverlay(map);
      }
    };

    apply();
    map.on('style.load', apply);
    return () => {
      map.off('style.load', apply);
    };
  }, [focusedFeature]);

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
        <RasterMapRenderer />
        <AnimatePresence>
          {isLoading ? (
            <motion.div
              key="map-loader"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              role="status"
              aria-label="Loading map data"
              className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 backdrop-blur-sm pointer-events-auto"
            >
              <span className="map-loader" aria-hidden />
            </motion.div>
          ) : null}
        </AnimatePresence>
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

function overlayLabelId(key) {
  return `overlay:${key}:label`;
}

function overlayHeatmapId(key) {
  return `overlay:${key}:heatmap`;
}

// Drop one or more layer ids if present. Mapbox's removeLayer throws when
// the id doesn't exist, so callers can pass freely.
function dropLayers(map, ...layerIds) {
  for (const id of layerIds) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
}

// Replace a layer entirely (used when layer type changes — e.g. circle ↔
// heatmap, or when a paint expression's structure changes meaningfully).
// Mapbox can hot-swap most paint properties via setPaintProperty, but a
// type change isn't one of them.
function setLayer(map, spec, beforeId) {
  if (map.getLayer(spec.id)) map.removeLayer(spec.id);
  map.addLayer(spec, beforeId);
}

function applyPaintProps(map, layerId, paint) {
  for (const [k, v] of Object.entries(paint)) {
    try {
      // line-dasharray rejects null on some Mapbox versions — skip when
      // we explicitly don't want a dash.
      if (k === 'line-dasharray' && v == null) continue;
      map.setPaintProperty(layerId, k, v);
    } catch (err) {
      console.warn(`setPaintProperty failed for ${layerId} / ${k}:`, err);
    }
  }
}

function ensureOverlay(map, key, geometry, data, style) {
  const ids = overlayIds(key);
  const labelId = overlayLabelId(key);
  const heatId = overlayHeatmapId(key);

  // Source: create or update with new data.
  const source = map.getSource(ids.source);
  if (source) {
    source.setData(data);
  } else {
    map.addSource(ids.source, { type: 'geojson', data });
  }

  const beforeId = overlayBeforeId(map);
  const exprs = paintExprsFor(style, geometry);

  // Heatmap path — only valid for points; replaces the circle layer.
  if (exprs.kind === 'heatmap') {
    dropLayers(map, ids.fill, ids.line, ids.circle);
    setLayer(
      map,
      { id: heatId, type: 'heatmap', source: ids.source, paint: exprs.paint },
      beforeId,
    );
  } else if (geometry === 'point') {
    dropLayers(map, ids.fill, heatId);
    if (!map.getLayer(ids.circle)) {
      map.addLayer(
        { id: ids.circle, type: 'circle', source: ids.source, paint: exprs.paint },
        beforeId,
      );
    } else {
      applyPaintProps(map, ids.circle, exprs.paint);
    }
  } else if (geometry === 'line') {
    dropLayers(map, ids.fill, ids.circle, heatId);
    if (!map.getLayer(ids.line)) {
      map.addLayer(
        { id: ids.line, type: 'line', source: ids.source, paint: exprs.paint },
        beforeId,
      );
    } else {
      applyPaintProps(map, ids.line, exprs.paint);
    }
  } else {
    // polygon — fill + stroke
    dropLayers(map, ids.circle, heatId);
    if (!map.getLayer(ids.fill)) {
      map.addLayer(
        { id: ids.fill, type: 'fill', source: ids.source, paint: exprs.paint },
        beforeId,
      );
    } else {
      applyPaintProps(map, ids.fill, exprs.paint);
    }
    if (!map.getLayer(ids.line)) {
      map.addLayer(
        { id: ids.line, type: 'line', source: ids.source, paint: exprs.strokePaint },
        beforeId,
      );
    } else {
      applyPaintProps(map, ids.line, exprs.strokePaint);
    }
  }

  // Optional label/symbol layer — added on top, removed when disabled.
  const lab = labelLayoutAndPaint(style);
  if (lab) {
    if (map.getLayer(labelId)) map.removeLayer(labelId);
    map.addLayer({
      id: labelId,
      type: 'symbol',
      source: ids.source,
      layout: lab.layout,
      paint: lab.paint,
    });
  } else if (map.getLayer(labelId)) {
    map.removeLayer(labelId);
  }
}

function removeOverlay(map, key) {
  const ids = overlayIds(key);
  dropLayers(
    map,
    ids.fill,
    ids.line,
    ids.circle,
    overlayLabelId(key),
    overlayHeatmapId(key),
  );
  if (map.getSource(ids.source)) map.removeSource(ids.source);
}

// ---------------------------------------------------------------------------
// Focused-feature highlight — a separate source/layer triple that draws
// just the actively-selected feature in a bright accent color, above
// every other overlay so it stays visible regardless of basemap.
// ---------------------------------------------------------------------------

const FOCUS_PREFIX = 'focus:';
const FOCUS_SOURCE = `${FOCUS_PREFIX}source`;
const FOCUS_FILL_LAYER = `${FOCUS_PREFIX}fill`;
const FOCUS_LINE_LAYER = `${FOCUS_PREFIX}line`;
const FOCUS_CIRCLE_LAYER = `${FOCUS_PREFIX}circle`;
const FOCUS_COLOR = '#fbbf24'; // amber-400 — same accent the station ripple uses

function applyFocusOverlay(map, feature) {
  const data = {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: feature.geometry, properties: {} }],
  };

  const src = map.getSource(FOCUS_SOURCE);
  if (src) {
    src.setData(data);
  } else {
    map.addSource(FOCUS_SOURCE, { type: 'geojson', data });
  }

  // Insert above everything else — the highlight is the user's
  // current attention so it shouldn't be hidden by other overlays.
  if (!map.getLayer(FOCUS_FILL_LAYER)) {
    map.addLayer({
      id: FOCUS_FILL_LAYER,
      type: 'fill',
      source: FOCUS_SOURCE,
      filter: ['==', '$type', 'Polygon'],
      paint: {
        'fill-color': FOCUS_COLOR,
        'fill-opacity': 0.25,
      },
    });
  }
  if (!map.getLayer(FOCUS_LINE_LAYER)) {
    map.addLayer({
      id: FOCUS_LINE_LAYER,
      type: 'line',
      source: FOCUS_SOURCE,
      filter: ['!=', '$type', 'Point'],
      paint: {
        'line-color': FOCUS_COLOR,
        'line-width': 3,
        'line-opacity': 1,
      },
    });
  }
  if (!map.getLayer(FOCUS_CIRCLE_LAYER)) {
    map.addLayer({
      id: FOCUS_CIRCLE_LAYER,
      type: 'circle',
      source: FOCUS_SOURCE,
      filter: ['==', '$type', 'Point'],
      paint: {
        'circle-radius': 9,
        'circle-color': FOCUS_COLOR,
        'circle-opacity': 0.9,
        'circle-stroke-color': '#0f172a',
        'circle-stroke-width': 2,
      },
    });
  }
}

function removeFocusOverlay(map) {
  for (const id of [FOCUS_FILL_LAYER, FOCUS_LINE_LAYER, FOCUS_CIRCLE_LAYER]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(FOCUS_SOURCE)) map.removeSource(FOCUS_SOURCE);
}
