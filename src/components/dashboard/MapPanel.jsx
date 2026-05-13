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
import { SECONDARY_LAYERS, useSecondary } from '@/contexts/SecondaryContext';
import { useAttributeTables } from '@/contexts/AttributeTablesContext';
import { useRasters } from '@/contexts/RasterContext';
import {
  effectiveStyle,
  labelLayoutAndPaint,
  paintExprsFor,
} from '@/utils/layerStyle';
import {
  LAYER_DEFAULT_SYMBOLOGY,
} from '@/config/layerDefaultSymbology';
import {
  paletteById,
  summarizeFeaturesAttribute,
} from '@/utils/stylePalettes';
import { buildMarkerImage } from '@/utils/markerImage';
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

// Cap on auto-seeded categories. Many polygon attributes (e.g. unique
// elevations on glof_lakes) have hundreds of distinct values; we keep
// the top-N most frequent so the legend stays scannable.
const DEFAULT_CATEGORY_LIMIT = 12;

// Compute a `setLayerStyle(...)` partial that seeds `categories` (for
// categories-mode defaults) or `rangeMin`/`rangeMax` (for colorRange
// defaults) from a freshly fetched FeatureCollection. Returns null when
// the user override already carries the seeded fields, when the
// configured attribute isn't present, or when the layer's default
// symbology doesn't need data to render.
function computeDefaultSymbologySeed(def, data, override) {
  if (def.type === 'categories') {
    if (!def.colorBy) return null;
    if (Array.isArray(override?.categories) && override.categories.length > 0) {
      return null; // already seeded (or user-curated)
    }
    const summary = summarizeFeaturesAttribute(data, def.colorBy);
    if (!summary.distinct.length) return null;
    const palette = paletteById(def.catPaletteId).colors;
    const top = summary.distinct.slice(0, DEFAULT_CATEGORY_LIMIT);
    return {
      categories: top.map((d, i) => ({
        value: d.value,
        color: palette[i % palette.length],
      })),
    };
  }
  if (def.type === 'colorRange') {
    if (!def.rangeBy) return null;
    if (override?.rangeMin != null && override?.rangeMax != null) return null;
    const s = summarizeFeaturesAttribute(data, def.rangeBy);
    if (s.min == null || s.max == null) return null;
    return { rangeMin: s.min, rangeMax: s.max };
  }
  return null;
}

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
    setLayerStyle,
    uploads,
    dbLayers,
  } = useSecondary();
  const { setMap, trackPromise, isLoading, focusedFeature } = useMapView();
  const { setSelectedFeature } = useAttributeTables();
  const { pickRasterValueAt, isLngLatOverAnyRaster } = useRasters();
  // Refs so the map-event handlers (registered once) can read the
  // current raster lookup functions without re-binding on every render.
  const pickRasterValueAtRef = useRef(pickRasterValueAt);
  pickRasterValueAtRef.current = pickRasterValueAt;
  const isLngLatOverAnyRasterRef = useRef(isLngLatOverAnyRaster);
  isLngLatOverAnyRasterRef.current = isLngLatOverAnyRaster;
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
  // Same pattern for the persisted style overrides — the style.load
  // handler needs to read the latest seeded values without being torn
  // down/recreated every time the user tweaks a layer's style.
  const secondaryStylesRef = useRef(secondaryStyles);
  secondaryStylesRef.current = secondaryStyles;

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
      // Feature Details is populated by the map-wide handler below
      // (which queries stations + overlays together and applies the
      // Point > Line > Polygon priority) — keeping the two paths in one
      // place avoids polygon overlays clobbering a station click.
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

  // Map-wide click handler that powers the Feature Details tab.
  //
  // Mapbox events for layer-scoped handlers fire only for that one layer;
  // we want a single handler that catches ANY overlay (region / secondary
  // / upload / db) the user clicks regardless of which sub-layer
  // (`:fill`, `:line`, `:circle`, `:symbol`) caught the hit. So we listen
  // map-wide and use queryRenderedFeatures with a layer filter built at
  // event time — that way newly added overlays are picked up without
  // re-binding.
  //
  // We deliberately do NOT switch the chart tab here — the user opens
  // the "Feature Details" tab themselves. A click just refreshes the
  // selected feature in context.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const onMapClick = (e) => {
      // Build the candidate layer list from the live style. Anything
      // namespaced `overlay:…` is fair game; the auxiliary `:label` and
      // `:heatmap` sub-layers don't carry the source feature in a useful
      // shape, so skip them — the matching `:fill`/`:line`/`:circle`/
      // `:symbol` co-layer will surface the same feature.
      const style = map.getStyle();
      if (!style?.layers) return;
      const overlayLayerIds = style.layers
        .map((l) => l.id)
        .filter(
          (id) =>
            id.startsWith(OVERLAY_PREFIX) &&
            !id.endsWith(':label') &&
            !id.endsWith(':heatmap'),
        );

      // Include the PMD parameter-station layer in the priority pool so
      // a station drawn on top of a polygon still wins for Feature
      // Details. The station layer ID isn't `overlay:`-prefixed so it
      // wouldn't be picked up by the filter above.
      const queryLayers = [...overlayLayerIds];
      if (map.getLayer(STATIONS_LAYER)) queryLayers.push(STATIONS_LAYER);

      if (queryLayers.length > 0) {
        const hits = map.queryRenderedFeatures(e.point, {
          layers: queryLayers,
        });

        // Geometry priority: Point > Line > Polygon. When multiple
        // overlays are toggled on, the topmost point still beats any
        // line / polygon under the cursor — matches what the user
        // expects when they tap a dot drawn over a basin polygon.
        const bestHit = pickByGeometryPriority(hits);

        if (bestHit) {
          // PMD station hit — separate kind + accent + toggle so the
          // Feature Details tab clears when the same station is
          // clicked twice (matching `selectedStation`'s toggle).
          if (bestHit.layer.id === STATIONS_LAYER) {
            const stationId = bestHit.properties.stationId;
            const overlayKey = `station:${stationId}`;
            setSelectedFeature((prev) =>
              prev?.overlayKey === overlayKey
                ? null
                : {
                    feature: {
                      type: 'Feature',
                      geometry: bestHit.geometry,
                      properties: { ...bestHit.properties },
                      id: stationId,
                    },
                    kind: 'station',
                    overlayKey,
                    label:
                      bestHit.properties.stationName ||
                      `Station #${stationId}`,
                    sublabel:
                      bestHit.properties.element || 'PMD Station',
                    accentColor: '#16a085',
                  },
            );
            return;
          }

          const parsed = parseOverlayLayerId(bestHit.layer.id);
          if (!parsed) return;
          const meta = describeOverlay(
            parsed,
            secondaryLayers,
            secondaryStyles,
          );
          setSelectedFeature({
            feature: {
              type: 'Feature',
              geometry: bestHit.geometry,
              properties: { ...bestHit.properties },
              id: bestHit.id,
            },
            kind: parsed.kind,
            overlayKey: parsed.overlayKey,
            label: meta.label,
            sublabel: meta.sublabel,
            accentColor: meta.accentColor,
          });
          return;
        }
      }

      // No overlay under the click — try raster pixel lookup. The ref
      // dereference picks up the freshest function (re-bound when the
      // raster `groups` array changes) without re-registering the
      // listener every time.
      const rasterHit = pickRasterValueAtRef.current?.(e.lngLat);
      if (!rasterHit) return;
      setSelectedFeature(buildRasterFeatureSpec(rasterHit));
    };

    map.on('click', onMapClick);
    return () => {
      map.off('click', onMapClick);
    };
  }, [setSelectedFeature, secondaryLayers, secondaryStyles]);

  // Hover cursor — flip to a pointer whenever the cursor sits over
  // anything clickable (overlay feature, station dot, raster pixel).
  // Mouseenter/mouseleave on a single layer is the lighter-weight
  // approach when you know the layers up front, but our layer set
  // changes at runtime, so a `mousemove` handler with a
  // queryRenderedFeatures probe is simpler and adapts automatically.
  // The work per event is bounded by the layers filter — fast in
  // practice on the dashboard's layer counts.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const onMove = (e) => {
      const style = map.getStyle();
      if (!style?.layers) return;
      const probeLayers = style.layers
        .map((l) => l.id)
        .filter(
          (id) =>
            id === STATIONS_LAYER ||
            id === STATIONS_HALO_LAYER ||
            (id.startsWith(OVERLAY_PREFIX) &&
              !id.endsWith(':label') &&
              !id.endsWith(':heatmap')),
        );
      let isOver = false;
      if (probeLayers.length > 0) {
        const hits = map.queryRenderedFeatures(e.point, {
          layers: probeLayers,
        });
        if (hits.length > 0) isOver = true;
      }
      if (!isOver) {
        // Raster bounds-only check (cheap — no per-pixel sampling).
        // Acceptable to set pointer over raster nodata regions; a click
        // there is a no-op rather than wrong behaviour.
        isOver = !!isLngLatOverAnyRasterRef.current?.(e.lngLat);
      }
      const canvas = map.getCanvas();
      const desired = isOver ? 'pointer' : '';
      if (canvas.style.cursor !== desired) {
        canvas.style.cursor = desired;
      }
    };

    map.on('mousemove', onMove);
    return () => {
      map.off('mousemove', onMove);
    };
  }, []);

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

        // Data-driven seed for layers with default symbology
        // configured (currently the four GLOF reference layers). Done
        // INLINE — before calling ensureOverlay — so the first paint
        // already carries the seeded categories / rangeMin / rangeMax
        // instead of waiting for the next render cycle. Without this,
        // the layer painted with the bare base style on the first
        // toggle and only got its categorical colors after a toggle
        // off + on, because the re-render path that picked up the
        // seeded override fired after Mapbox had already committed
        // the first paint.
        //
        // `setLayerStyle` still runs to persist the seed on the
        // SecondaryContext store so subsequent toggles + the style
        // panel start from the populated values. Both calls are
        // idempotent thanks to `computeDefaultSymbologySeed`'s
        // already-seeded check.
        let style = entry.o.style;
        if (entry.o.key.startsWith('secondary:')) {
          const layerId = entry.o.key.slice('secondary:'.length);
          const def = LAYER_DEFAULT_SYMBOLOGY[layerId];
          if (def) {
            const partial = computeDefaultSymbologySeed(
              def,
              entry.data,
              secondaryStyles[layerId],
            );
            if (partial) {
              style = { ...style, ...partial };
              setLayerStyle(layerId, partial);
            }
          }
        }

        ensureOverlay(map, entry.o.key, geometry, entry.data, style);
        tracked.add(entry.o.key);
      }
    };

    apply();
    return () => {
      cancelled = true;
    };
  }, [desiredOverlays, trackPromise, secondaryStyles, setLayerStyle]);

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
        // Mirror the inline-seed pattern from the reconcile effect so
        // basemap swaps that happen before the override has been
        // persisted still paint with the right symbology on the first
        // re-apply. setLayerStyle here also flushes the override into
        // the context for any future toggles.
        let style = entry.o.style;
        if (entry.o.key.startsWith('secondary:')) {
          const layerId = entry.o.key.slice('secondary:'.length);
          const def = LAYER_DEFAULT_SYMBOLOGY[layerId];
          if (def) {
            const partial = computeDefaultSymbologySeed(
              def,
              entry.data,
              secondaryStylesRef.current?.[layerId],
            );
            if (partial) {
              style = { ...style, ...partial };
              setLayerStyle(layerId, partial);
            }
          }
        }
        ensureOverlay(map, entry.o.key, geometry, entry.data, style);
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

// Pick the highest-priority hit from a Mapbox queryRenderedFeatures
// result: Point > Line > Polygon. Within a bucket, preserves the
// original (top-down) ordering so the topmost feature of the same
// geometry type still wins. Returning early on the first point match
// avoids walking the whole list when a point is already the winner.
function pickByGeometryPriority(hits) {
  if (!hits || hits.length === 0) return null;
  let firstLine = null;
  let firstPolygon = null;
  for (const h of hits) {
    const t = h.geometry?.type;
    if (t === 'Point' || t === 'MultiPoint') return h;
    if (!firstLine && (t === 'LineString' || t === 'MultiLineString')) {
      firstLine = h;
    } else if (
      !firstPolygon &&
      (t === 'Polygon' || t === 'MultiPolygon')
    ) {
      firstPolygon = h;
    }
  }
  return firstLine || firstPolygon || null;
}

// Parse a Mapbox overlay layer id (`overlay:region:badswat::lake:fill`)
// back into the source descriptor we composed in `desiredOverlays`.
// Returns null when the id isn't ours so the click handler can ignore it
// silently (e.g. a basemap label layer that happens to share the prefix).
function parseOverlayLayerId(layerId) {
  if (!layerId?.startsWith(OVERLAY_PREFIX)) return null;
  // Strip the geometry suffix added by overlayIds(). `risk:high` keys
  // contain a `:` themselves so we can't just split on `:` — we anchor
  // on the known suffix list instead.
  const suffix = ['fill', 'line', 'circle', 'symbol', 'label', 'heatmap'].find(
    (s) => layerId.endsWith(`:${s}`),
  );
  const trimmed = suffix ? layerId.slice(0, -(suffix.length + 1)) : layerId;
  const overlayKey = trimmed.slice(OVERLAY_PREFIX.length);
  if (overlayKey.startsWith('region:')) {
    const inner = overlayKey.slice('region:'.length);
    // RegionLayersContext composes `${regionId}::${layerKey}` so split
    // on the doubled colon — keeps `risk:high` etc. intact.
    const sep = inner.indexOf('::');
    if (sep < 0) return null;
    const regionId = inner.slice(0, sep);
    const layerKey = inner.slice(sep + 2);
    return { kind: 'region', overlayKey, regionId, layerKey };
  }
  if (overlayKey.startsWith('secondary:')) {
    return { kind: 'secondary', overlayKey, secondaryId: overlayKey.slice('secondary:'.length) };
  }
  if (overlayKey.startsWith('upload:')) {
    return { kind: 'upload', overlayKey, uploadId: overlayKey.slice('upload:'.length) };
  }
  if (overlayKey.startsWith('db:')) {
    return { kind: 'db', overlayKey, dbId: overlayKey.slice('db:'.length) };
  }
  return null;
}

// Map a region layerKey ("lake", "risk:high", …) to the user-facing label
// shown in LayerMenu. Single source of truth duplicated here to avoid an
// import cycle from the Feature Details panel back into LayerMenu.
const REGION_LAYER_KEY_LABELS = {
  lake:          'Lake',
  river:         'River',
  glacier:       'Glacier',
  faultline:     'Faultline',
  building:      'Buildings',
  school:        'Schools',
  road:          'Roads',
  'risk:low':    'Low Risk Zone',
  'risk:medium': 'Medium Risk Zone',
  'risk:high':   'High Risk Zone',
};

// `pindoru_chaat` → `Pindoru Chaat`. Used as a graceful fallback when a
// region id doesn't match any known label list.
function humanizeId(id) {
  return String(id)
    .split('_')
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

// Build the (label, sublabel, accentColor) triple the Feature Details
// panel needs from a parsed overlay descriptor + the live secondary
// metadata. Keeps the click handler pure / context-agnostic.
function describeOverlay(parsed, secondaryLayers, secondaryStyles) {
  if (parsed.kind === 'region') {
    const regionLabel = humanizeId(parsed.regionId);
    const layerLabel =
      REGION_LAYER_KEY_LABELS[parsed.layerKey] ?? humanizeId(parsed.layerKey);
    return {
      label:       `${regionLabel} · ${layerLabel}`,
      sublabel:    KIND_GEOMETRY_LABEL[regionLayerGeometry(parsed.layerKey)] ?? null,
      accentColor: regionLayerColor(parsed.layerKey),
    };
  }
  if (parsed.kind === 'secondary') {
    const def = SECONDARY_LAYERS.find((l) => l.id === parsed.secondaryId);
    const accent = secondaryStyles?.[parsed.secondaryId]?.fillColor
      ?? secondaryStyles?.[parsed.secondaryId]?.strokeColor
      ?? '#16a085';
    return {
      label:       def?.label ?? humanizeId(parsed.secondaryId),
      sublabel:    def?.geometry ? KIND_GEOMETRY_LABEL[def.geometry] ?? null : null,
      accentColor: accent,
    };
  }
  if (parsed.kind === 'upload' || parsed.kind === 'db') {
    const id = parsed.uploadId ?? parsed.dbId;
    const meta = secondaryLayers?.find?.((l) => l.id === id);
    return {
      label:       meta?.label ?? humanizeId(id),
      sublabel:    meta?.geometry ? KIND_GEOMETRY_LABEL[meta.geometry] ?? null : null,
      accentColor: secondaryStyles?.[id]?.fillColor ?? '#16a085',
    };
  }
  return { label: 'Feature', sublabel: null, accentColor: '#16a085' };
}

const KIND_GEOMETRY_LABEL = {
  point:   'Point',
  line:    'Line',
  polygon: 'Polygon',
};

// Translate a raster pixel hit (from RasterContext.pickRasterValueAt)
// into the same `{kind, label, feature, …}` shape the FeatureDetails
// panel consumes. Built outside the component so it can be unit-
// tested / extended without dragging in render dependencies.
function buildRasterFeatureSpec(hit) {
  const properties = {
    Group:        hit.groupName,
    File:         hit.layerName,
    Mode:         hit.mode === 'classified' ? 'Classified' : 'Continuous',
    Value:        hit.value,
    Longitude:    hit.lng,
    Latitude:     hit.lat,
    'Pixel column': hit.col,
    'Pixel row':    hit.row,
  };
  if (hit.mode === 'classified' && hit.matchedClass) {
    if (hit.matchedClass.label) {
      properties['Class label'] = hit.matchedClass.label;
    }
    if (hit.matchedClass.color) {
      properties['Class colour'] = hit.matchedClass.color;
    }
  } else if (hit.mode === 'continuous' && hit.colormap) {
    properties.Colormap = hit.colormap;
  }
  // Accent: matched class colour wins for classified rasters so the
  // header bar lines up with the legend; continuous mode gets the
  // brand teal as a neutral default (we don't have a colormap → solid
  // colour helper plumbed in here).
  const accentColor =
    (hit.mode === 'classified' && hit.matchedClass?.color) || '#16a085';
  return {
    feature: {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [hit.lng, hit.lat] },
      properties,
    },
    kind: 'raster',
    overlayKey: `raster:${hit.groupId}`,
    label: hit.groupName,
    sublabel: hit.mode === 'classified' ? 'Classified pixel' : 'Continuous pixel',
    accentColor,
  };
}

function overlayIds(key) {
  return {
    source: `${OVERLAY_PREFIX}${key}`,
    fill:   `${OVERLAY_PREFIX}${key}:fill`,
    line:   `${OVERLAY_PREFIX}${key}:line`,
    circle: `${OVERLAY_PREFIX}${key}:circle`,
    // Symbol layer used when the user has configured a marker icon /
    // shape on a point layer. The image registered under the same key
    // is reused as the layer's `icon-image`.
    symbol: `${OVERLAY_PREFIX}${key}:symbol`,
  };
}

// Per-map registry of which marker image id is currently active for
// each overlay key. Lets us swap to a fresh id on every spec change
// (so Mapbox re-evaluates `icon-image` and re-renders) while still
// freeing the previous texture as soon as the swap completes — no
// orphan images accumulating across icon edits.
const markerImageRegistry = new WeakMap();

function getMarkerRegistry(map) {
  let reg = markerImageRegistry.get(map);
  if (!reg) {
    reg = new Map();
    markerImageRegistry.set(map, reg);
  }
  return reg;
}

function clearMarkerRegistryFor(map, key) {
  const reg = markerImageRegistry.get(map);
  if (reg) reg.delete(key);
}

// Per-overlay-key epoch counter — bumped on every ensureOverlay call
// that re-kicks the marker build. Async builds capture the epoch at
// start and bail at the apply step if a newer one has fired, so a
// slow stale build (e.g. an earlier radius value during a drag) can't
// flip the layer back to the old size after a newer drag finished.
const markerEpochRegistry = new WeakMap();

function bumpMarkerEpoch(map, key) {
  let reg = markerEpochRegistry.get(map);
  if (!reg) {
    reg = new Map();
    markerEpochRegistry.set(map, reg);
  }
  const next = (reg.get(key) ?? 0) + 1;
  reg.set(key, next);
  return next;
}

function currentMarkerEpoch(map, key) {
  return markerEpochRegistry.get(map)?.get(key) ?? 0;
}

// Async helper: builds a marker PNG from the layer's style spec and
// registers it on the map under a *spec-derived* image id. Resolves
// with the image id so the caller can use it as `icon-image` on a
// symbol layer.
//
// Spec-derived (rather than constant per layer) is the critical bit:
// when the user picks a new icon, the spec hash changes → a new
// image id gets registered → `setLayoutProperty('icon-image', newId)`
// is a real change Mapbox honours → the layer redraws on the next
// frame. With a constant id the call was a no-op and the layer kept
// rendering the previous texture until a basemap swap forced a
// full re-add.
async function ensureMarkerImage(map, key, style, imageRadius) {
  const marker = style?.marker ?? {};
  const spec = {
    shape: marker.shape || 'none',
    iconId: marker.icon || null,
    fillColor: style?.fillColor || '#16a085',
    strokeColor: style?.strokeColor || '#0f7560',
    strokeWidth: style?.strokeWidth ?? 1.5,
    backgroundColor: marker.backgroundColor || null,
    // When the layer's size is zoom-driven, the caller passes the
    // *larger* of the two zoom endpoints here — Mapbox's `icon-size`
    // can scale the image down but scaling it up beyond its native
    // resolution looks blurry, so we always rasterise at the high
    // end of the range.
    size: Number.isFinite(imageRadius) ? imageRadius : style?.radius ?? 6,
  };
  const built = await buildMarkerImage(spec);
  // Encode the spec hash into the image id so each unique combo gets
  // its own Mapbox image. `|` isn't reserved but `_` reads cleaner.
  const imageId = `${OVERLAY_PREFIX}${key}:marker:${built.key.replace(/\|/g, '_')}`;
  if (!map.hasImage(imageId)) {
    map.addImage(imageId, built.imageData, { pixelRatio: built.pixelRatio });
  }
  return imageId;
}

// Promote the supplied image id to the "current" one for `key` and
// drop whatever was previous. Caller should run this *after* the
// symbol layer's `icon-image` has been pointed at the new id, so the
// layer never references a removed image.
function commitMarkerImage(map, key, imageId) {
  const reg = getMarkerRegistry(map);
  const prev = reg.get(key);
  if (prev && prev !== imageId && map.hasImage(prev)) {
    map.removeImage(prev);
  }
  reg.set(key, imageId);
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
    dropLayers(map, ids.fill, ids.line, ids.circle, ids.symbol);
    setLayer(
      map,
      { id: heatId, type: 'heatmap', source: ids.source, paint: exprs.paint },
      beforeId,
    );
  } else if (geometry === 'point' && exprs.kind === 'symbol') {
    // Marker mode — register the generated PNG, then add (or update) a
    // symbol layer pointed at it. The image build is async so we kick
    // off in the background and apply paint props eagerly so opacity
    // changes still feel snappy.
    dropLayers(map, ids.fill, ids.circle, heatId);
    // Claim an epoch for this build so a slower in-flight build from a
    // previous drag tick can't override us when it finishes. Without
    // this, dragging the radius slider made the symbol flip back and
    // forth as out-of-order builds settled.
    const myEpoch = bumpMarkerEpoch(map, key);
    (async () => {
      try {
        const imageId = await ensureMarkerImage(map, key, style, exprs.imageRadius);
        // Bail if this build has been superseded by a newer ensureOverlay
        // call. The image is already registered on the map (we did
        // map.addImage inside ensureMarkerImage); leaving it cached is
        // fine — the next successful commit will drop the previous one.
        if (currentMarkerEpoch(map, key) !== myEpoch) return;
        // Layer might have been torn down between the await and now —
        // bail if so. (Style swap, layer toggle off, etc.)
        if (!map.getSource(ids.source)) return;
        const layout = { ...exprs.layout, 'icon-image': imageId };
        if (!map.getLayer(ids.symbol)) {
          map.addLayer(
            {
              id: ids.symbol,
              type: 'symbol',
              source: ids.source,
              layout,
              paint: exprs.paint,
            },
            beforeId,
          );
        } else {
          // Each spec change yields a new image id, so this is a real
          // layout change Mapbox honours — the icon picker no longer
          // requires a basemap swap to reflect the user's choice.
          // We push EVERY layout key (not just icon-image) so changes
          // to icon-size — including zoom-driven interpolations — also
          // take effect without re-creating the layer.
          for (const [k, v] of Object.entries(layout)) {
            try {
              map.setLayoutProperty(ids.symbol, k, v);
            } catch (err) {
              console.warn(`setLayoutProperty failed for ${ids.symbol} / ${k}:`, err);
            }
          }
          applyPaintProps(map, ids.symbol, exprs.paint);
        }
        // Layer is now pointing at the new id — safe to drop the
        // previous texture and update the registry.
        commitMarkerImage(map, key, imageId);
      } catch (err) {
        console.warn(`Marker image build failed for "${key}":`, err);
      }
    })();
  } else if (geometry === 'point') {
    dropLayers(map, ids.fill, ids.symbol, heatId);
    if (!map.getLayer(ids.circle)) {
      map.addLayer(
        { id: ids.circle, type: 'circle', source: ids.source, paint: exprs.paint },
        beforeId,
      );
    } else {
      applyPaintProps(map, ids.circle, exprs.paint);
    }
  } else if (geometry === 'line') {
    dropLayers(map, ids.fill, ids.circle, ids.symbol, heatId);
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
    dropLayers(map, ids.circle, ids.symbol, heatId);
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
    ids.symbol,
    overlayLabelId(key),
    overlayHeatmapId(key),
  );
  if (map.getSource(ids.source)) map.removeSource(ids.source);
  // Drop the layer's currently-registered marker image so the
  // texture doesn't outlive the layer it was generated for.
  const reg = markerImageRegistry.get(map);
  const imageId = reg?.get(key);
  if (imageId && map.hasImage(imageId)) map.removeImage(imageId);
  clearMarkerRegistryFor(map, key);
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
