import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Focus, Minus, Navigation2, Plus } from 'lucide-react';
import { BASEMAPS, mapboxgl } from '@/config/mapbox';
import { classifyState, NODATA_STATE } from '@/config/alertStates';
import { colorFor } from '@/config/parameterColors';
import {
  BASEMAP_OPACITY,
  districtPresetById,
  useMonitoring,
} from '@/contexts/MonitoringContext';
import { useParameter } from '@/contexts/ParameterContext';
import ParameterSelect from '@/components/ui/ParameterSelect';
import { cn } from '@/utils/cn';

const STATIONS_SOURCE = 'monitoring-stations';
const STATIONS_LAYER  = 'monitoring-stations-circle';
const STATIONS_HALO   = 'monitoring-stations-halo';
// Two phase-shifted ring layers that pulse for every Alarm-classified
// station (works for both PMD and NDMA — coloredCollection stamps the
// shared `state` property off whichever classification is active). Same
// pattern as MapPanel; radii shrunk a touch because monitoring cells
// are smaller than the main map and the outer ring would otherwise
// crowd neighbouring dots.
const ALARM_PULSE_LAYERS = [
  'monitoring-alarm-pulse-1',
  'monitoring-alarm-pulse-2',
];
const ALARM_FILTER = ['==', ['get', 'state'], 'alarm'];
const ALARM_PULSE_COLOR    = '#dc2626'; // matches alertStates.alarm.color
const ALARM_PULSE_PERIOD_MS = 2200;
const ALARM_PULSE_MIN_R     = 6;
const ALARM_PULSE_MAX_R     = 22;

// Two phase-shifted yellow ring layers driven by MonitoringContext's
// selectedStations. Filtered to the currently-selected stationId so the
// ripple picks out exactly the dot the operator clicked (or picked in
// the Charts panel row). Mirrors the main map's selection halo colour
// so the two surfaces read as the same interaction.
const SEL_RIPPLE_LAYERS = [
  'monitoring-sel-ripple-1',
  'monitoring-sel-ripple-2',
];
const NO_HIGHLIGHT_FILTER   = ['==', ['get', 'stationId'], -1];
const SEL_RIPPLE_COLOR      = '#fbbf24'; // amber-400, matches MapPanel
const SEL_RIPPLE_PERIOD_MS  = 1800;
const SEL_RIPPLE_MIN_R      = 5;
const SEL_RIPPLE_MAX_R      = 18;

// Exaggeration trimmed from 1.5 (main map default) to 1.0 so the 3D
// effect stays subtle in a small monitoring cell — a pronounced tilt
// would compete with the station dots for attention.
const TERRAIN_SPEC = { source: 'mapbox-dem', exaggeration: 1.0 };

// Districts context — served filtered by province from
// /api/secondary/monitoring-districts. Every cell renders the same
// polygon set below its station dots so the operator can read which
// district a station belongs to at a glance.
const DISTRICTS_SOURCE = 'monitoring-districts';
const DISTRICTS_FILL   = 'monitoring-districts-fill';
const DISTRICTS_LINE   = 'monitoring-districts-line';
const DISTRICTS_LABEL  = 'monitoring-districts-label';
// Fill takes a fraction of the operator's opacity so the polygon
// interior stays subtle while the outline (which reads as the actual
// boundary) tracks the slider value directly.
const DISTRICTS_FILL_OPACITY_RATIO = 0.35;
// Predefined label styling — red text on a yellow halo, matching the
// operational alarm palette so a labelled boundary reads as an alerting
// context. Kept as constants (not configurable) per product spec. Halo
// width 1.5 gives the red text a legible yellow outline against dark
// satellite imagery without swelling into a highlight pill.
const DISTRICTS_LABEL_TEXT_COLOR = '#dc2626';
const DISTRICTS_LABEL_HALO_COLOR = '#fde047';
const DISTRICTS_LABEL_HALO_WIDTH = 1.5;

// Module-level singleton cache so opening the Monitoring surface once
// and switching layouts / parameters doesn't repeatedly hit the
// districts endpoint. Every cell awaits the same promise.
let districtsPromise = null;
function loadDistricts() {
  if (!districtsPromise) {
    districtsPromise = fetch('/api/secondary/monitoring-districts')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .catch((err) => {
        console.warn('[monitoring] districts fetch failed:', err);
        districtsPromise = null; // allow retry on next open
        return null;
      });
  }
  return districtsPromise;
}

// Add-or-refresh the districts source + fill/outline/label layers.
// Called from the initial data effect AND from the style.load handler
// so a basemap swap re-attaches everything. `config` carries the
// operator-driven paint values so a fresh mount picks up whatever the
// panel is currently showing (rather than rendering with a default set
// that then flickers when the reactive update effect catches up).
function ensureDistrictsLayers(map, data, config) {
  if (!data) return;
  if (!map.getSource(DISTRICTS_SOURCE)) {
    map.addSource(DISTRICTS_SOURCE, { type: 'geojson', data });
  } else {
    map.getSource(DISTRICTS_SOURCE).setData(data);
  }
  if (!map.getLayer(DISTRICTS_FILL)) {
    map.addLayer({
      id: DISTRICTS_FILL,
      type: 'fill',
      source: DISTRICTS_SOURCE,
      paint: {
        'fill-color': config.fill,
        'fill-opacity': config.opacity * DISTRICTS_FILL_OPACITY_RATIO,
      },
    });
  }
  if (!map.getLayer(DISTRICTS_LINE)) {
    map.addLayer({
      id: DISTRICTS_LINE,
      type: 'line',
      source: DISTRICTS_SOURCE,
      paint: {
        'line-color': config.line,
        'line-width': config.lineWidth,
        'line-opacity': config.opacity,
      },
    });
  }
  if (!map.getLayer(DISTRICTS_LABEL)) {
    map.addLayer({
      id: DISTRICTS_LABEL,
      type: 'symbol',
      source: DISTRICTS_SOURCE,
      minzoom: 6,
      layout: {
        // Property is already INITCAP-normalised at the SQL layer
        // (see /api/secondary/monitoring-districts), so no client-side
        // casing is needed — display verbatim ("Skardu", not "SKARDU").
        'text-field': ['get', 'district'],
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        // Ramp bumped up a step at every anchor so InitCap labels read
        // clearly at overview zoom (was 10 → 12 → 14, now 11 → 13 → 15).
        'text-size': [
          'interpolate', ['linear'], ['zoom'],
          6, 11, 10, 13, 14, 15,
        ],
        'text-letter-spacing': 0.02,
        'text-allow-overlap': false,
        'visibility': config.labels ? 'visible' : 'none',
      },
      paint: {
        'text-color': DISTRICTS_LABEL_TEXT_COLOR,
        'text-halo-color': DISTRICTS_LABEL_HALO_COLOR,
        'text-halo-width': DISTRICTS_LABEL_HALO_WIDTH,
      },
    });
  }
  applyDistrictsConfig(map, config);
}

// Push the current districts config to the live layers. Split from
// ensure* so a slider drag doesn't tear down and rebuild the layers on
// every frame — this is just paint/layout property mutations. Silent
// on missing layers so it's safe to call before ensure* has run.
function applyDistrictsConfig(map, { fill, line, opacity, lineWidth, labels }) {
  if (map.getLayer(DISTRICTS_FILL)) {
    map.setPaintProperty(DISTRICTS_FILL, 'fill-color', fill);
    map.setPaintProperty(
      DISTRICTS_FILL,
      'fill-opacity',
      opacity * DISTRICTS_FILL_OPACITY_RATIO,
    );
  }
  if (map.getLayer(DISTRICTS_LINE)) {
    map.setPaintProperty(DISTRICTS_LINE, 'line-color', line);
    map.setPaintProperty(DISTRICTS_LINE, 'line-width', lineWidth);
    map.setPaintProperty(DISTRICTS_LINE, 'line-opacity', opacity);
  }
  if (map.getLayer(DISTRICTS_LABEL)) {
    map.setLayoutProperty(
      DISTRICTS_LABEL,
      'visibility',
      labels ? 'visible' : 'none',
    );
  }
}

// Ensure the source + all four dot/halo/pulse layers exist on a map.
// Called on the initial data effect AND on every style.load (basemap
// swap wipes user layers). Idempotent — every branch guards with
// `getSource` / `getLayer` before touching Mapbox.
function ensureStationLayers(map, data) {
  if (!map.getSource(STATIONS_SOURCE)) {
    map.addSource(STATIONS_SOURCE, { type: 'geojson', data });
  } else {
    map.getSource(STATIONS_SOURCE).setData(data);
  }
  if (!map.getLayer(STATIONS_HALO)) {
    map.addLayer({
      id: STATIONS_HALO,
      type: 'circle',
      source: STATIONS_SOURCE,
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          4, 6, 7, 9, 12, 14, 16, 22,
        ],
        'circle-color': ['coalesce', ['get', 'color'], NODATA_STATE.color],
        'circle-opacity': 0.2,
      },
    });
  }
  // Alarm pulse layers — painted BELOW the core dot so the coloured
  // fill (which carries state at a glance) sits on top and the pulse
  // reads as a halo around it. Filter keys off the shared `state`
  // property populated by coloredCollection.
  for (const id of ALARM_PULSE_LAYERS) {
    if (!map.getLayer(id)) {
      map.addLayer({
        id,
        type: 'circle',
        source: STATIONS_SOURCE,
        filter: ALARM_FILTER,
        paint: {
          'circle-radius': ALARM_PULSE_MIN_R,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': ALARM_PULSE_COLOR,
          'circle-stroke-width': 2,
          'circle-stroke-opacity': 0,
        },
      });
    }
  }
  // Selection ripple layers — externally filtered to the selected
  // station id. Painted above the alarm pulse so the yellow halo reads
  // as "you picked THIS one" even if that station is also Alarm.
  for (const id of SEL_RIPPLE_LAYERS) {
    if (!map.getLayer(id)) {
      map.addLayer({
        id,
        type: 'circle',
        source: STATIONS_SOURCE,
        filter: NO_HIGHLIGHT_FILTER,
        paint: {
          'circle-radius': SEL_RIPPLE_MIN_R,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': SEL_RIPPLE_COLOR,
          'circle-stroke-width': 2.5,
          'circle-stroke-opacity': 0,
        },
      });
    }
  }
  if (!map.getLayer(STATIONS_LAYER)) {
    map.addLayer({
      id: STATIONS_LAYER,
      type: 'circle',
      source: STATIONS_SOURCE,
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          4, 3, 7, 4.5, 12, 8, 16, 12,
        ],
        'circle-color': ['coalesce', ['get', 'color'], NODATA_STATE.color],
        'circle-stroke-color': '#0f172a',
        'circle-stroke-width': 0.75,
      },
    });
  }
}

// Set the type-appropriate opacity paint property on a single layer.
// Wrapped in try/catch because some basemap layers carry data-driven
// opacity expressions that reject a plain numeric set; for the slider's
// purposes a silent skip is the right behaviour.
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

function removeStationLayers(map) {
  for (const id of ALARM_PULSE_LAYERS) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const id of SEL_RIPPLE_LAYERS) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getLayer(STATIONS_LAYER)) map.removeLayer(STATIONS_LAYER);
  if (map.getLayer(STATIONS_HALO)) map.removeLayer(STATIONS_HALO);
  if (map.getSource(STATIONS_SOURCE)) map.removeSource(STATIONS_SOURCE);
}

// Single cell in the monitoring grid. Owns its own Mapbox instance and
// a small parameter picker at the top-right. Movement is synced across
// every cell in the grid via MonitoringContext — a `move` event on one
// map broadcasts the new center/zoom/bearing/pitch and every other cell
// applies it (skipping its own frame to avoid feedback).
//
// This map deliberately does NOT reuse MapPanel — its scope is narrower
// (one parameter → one layer, no overlays / rasters / quick-toggles), so
// keeping it self-contained is simpler than gutting MapPanel for every
// feature Monitoring doesn't need.
export default function MonitoringMap({ cellKey }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const {
    view,
    moveEpoch,
    originId,
    broadcastView,
    cellParameters,
    setCellParameter,
    basemap,
    terrain,
    districtsColorId,
    districtsOpacity,
    districtsOutlineWidth,
    districtsLabels,
    earlyWarning,
    earlyWarningFactor,
    selectedStations,
    setSelectedStation,
  } = useMonitoring();
  const { elements } = useParameter();

  // Resolve the current district colour preset + collapse all four
  // pieces of districts state into one config object. Memoised so the
  // downstream effect doesn't re-run just because React handed us a
  // new object reference each render.
  const districtsConfig = useMemo(() => {
    const preset = districtPresetById(districtsColorId);
    return {
      fill: preset.fill,
      line: preset.line,
      opacity: districtsOpacity,
      lineWidth: districtsOutlineWidth,
      labels: districtsLabels,
    };
  }, [districtsColorId, districtsOpacity, districtsOutlineWidth, districtsLabels]);
  // Ref mirror so the style.load handler (bound once at mount) always
  // reads the latest config instead of the value it closed over.
  const districtsConfigRef = useRef(districtsConfig);
  districtsConfigRef.current = districtsConfig;

  const elementName = cellParameters[cellKey] ?? '';
  const accent = elementName ? colorFor(elementName) : '#84cc16';

  // Per-cell station FeatureCollection, fetched off the same
  // /api/parameters endpoint the main dashboard uses. Kept local because
  // ParameterContext.stations is scoped to the *global* selected
  // parameter — we need a separate stream per cell.
  const [stations, setStations] = useState([]);

  useEffect(() => {
    if (!elementName) {
      setStations([]);
      return undefined;
    }
    const ctrl = new AbortController();
    const qs = earlyWarning ? `?earlyFactor=${earlyWarningFactor}` : '';
    fetch(`/api/parameters/${encodeURIComponent(elementName)}/latest${qs}`, {
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        setStations(Array.isArray(data?.features) ? data.features : []);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          console.warn('[monitoring cell]', cellKey, 'fetch failed:', err);
        }
      });
    return () => ctrl.abort();
  }, [elementName, cellKey, earlyWarning, earlyWarningFactor]);

  // Colored FeatureCollection — one dot per station tinted by alert
  // state so a critical station reads at a glance even in a small cell.
  // In NDMA mode the classification comes from the tightened bands
  // (`ourStateId`), falling back to PMD when we haven't captured
  // thresholds for the element yet.
  const coloredCollection = useMemo(() => {
    if (stations.length === 0) return null;
    return {
      type: 'FeatureCollection',
      features: stations.map((f) => {
        const p = f.properties ?? {};
        const effStateId = earlyWarning ? (p.ourStateId ?? p.stateId) : p.stateId;
        const st = classifyState(effStateId, p.lastUpdate);
        return {
          ...f,
          properties: { ...p, state: st.id, color: st.color },
        };
      }),
    };
  }, [stations, earlyWarning]);
  // Ref mirror so the style.load handler (bound once) can pull the
  // current collection without going stale — otherwise a basemap swap
  // wipes the layers and the handler re-adds `null` because it captured
  // `coloredCollection` before any parameter was picked.
  const coloredCollectionRef = useRef(coloredCollection);
  coloredCollectionRef.current = coloredCollection;

  // Fit the map to the current parameter's station extent. Extracted
  // as a callback so the nav-control "focus" button and the auto-fit
  // effect below can share the same code path — invariant: whoever
  // triggers a fit gets the same padding + maxZoom the operator saw
  // when the parameter first loaded. `stations` is closed over via
  // the effect deps, so the callback always reads the latest set.
  //
  // The fit propagates to every other cell via the normal `moveend`
  // → broadcast → follower jumpTo sync (intended — pick one cell to
  // drive, the rest come along).
  const fitToStations = useCallback(() => {
    if (stations.length === 0) return;
    const map = mapRef.current;
    if (!map) return;
    let minLng = Infinity, minLat = Infinity;
    let maxLng = -Infinity, maxLat = -Infinity;
    let count = 0;
    for (const f of stations) {
      const c = f?.geometry?.coordinates;
      if (!Array.isArray(c) || c.length < 2) continue;
      const [lng, lat] = c;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      count += 1;
    }
    if (count === 0) return;
    map.fitBounds(
      [[minLng, minLat], [maxLng, maxLat]],
      { padding: 40, duration: 400, maxZoom: 12 },
    );
  }, [stations]);

  // Auto-fit the first time a new parameter loads. `lastFittedParamRef`
  // gates on the parameter name so a background refresh of the same
  // parameter doesn't re-zoom the operator away from what they're
  // looking at.
  const lastFittedParamRef = useRef(null);
  useEffect(() => {
    if (!elementName) {
      lastFittedParamRef.current = null;
      return;
    }
    if (lastFittedParamRef.current === elementName) return;
    if (stations.length === 0) return;
    lastFittedParamRef.current = elementName;
    fitToStations();
  }, [elementName, stations, fitToStations]);

  // Boot the map once. Style comes from the config panel — every cell
  // in the grid shares the same basemap so the comparison view stays
  // coherent. Later basemap swaps go through a dedicated effect below.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: BASEMAPS[basemap] ?? BASEMAPS.light,
      attributionControl: false,
      projection: 'mercator',
      center: view.center,
      zoom: view.zoom,
      bearing: view.bearing,
      pitch: view.pitch,
    });
    mapRef.current = map;

    // moveend fires on BOTH real user input AND programmatic jumpTo.
    // We use eventData ({ mmSync: true }) to tag every sync-induced
    // jumpTo so its moveend can be filtered out here — otherwise the
    // origin cell's zoom triggers a broadcast, every follower jumps,
    // each follower's jumpTo fires its own moveend, each of THOSE
    // re-broadcasts, and the resulting cascade slows/blocks further
    // user zoom on any cell.
    const onMoveEnd = (e) => {
      if (e?.mmSync) return;
      const c = map.getCenter();
      broadcastView(
        {
          center: [c.lng, c.lat],
          zoom: map.getZoom(),
          bearing: map.getBearing(),
          pitch: map.getPitch(),
        },
        cellKey,
      );
    };
    map.on('moveend', onMoveEnd);

    let resizeRaf = null;
    const ro = new ResizeObserver(() => {
      if (resizeRaf !== null) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        if (mapRef.current) mapRef.current.resize();
      });
    });
    ro.observe(containerRef.current);

    return () => {
      map.off('moveend', onMoveEnd);
      ro.disconnect();
      if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
      map.remove();
      mapRef.current = null;
    };
    // Intentionally empty deps: boot once. Sync + data effects below
    // handle every subsequent change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply broadcast view whenever moveEpoch bumps AND this cell wasn't
  // the origin of that broadcast. `jumpTo` (not `easeTo`) so the sync
  // stays tight even under fast pans. `{ mmSync: true }` eventData
  // tags the resulting moveend so the origin handler filters it out
  // (see onMoveEnd above) — without this the cells ping-pong.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (originId === cellKey) return;
    map.jumpTo(
      {
        center: view.center,
        zoom: view.zoom,
        bearing: view.bearing,
        pitch: view.pitch,
      },
      { mmSync: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveEpoch]);

  // Push the colored collection to the map — create or update the
  // source, ensure every layer exists. Re-runs on basemap swaps (via
  // the style.load effect below) so the dots always survive.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      if (!coloredCollection) {
        removeStationLayers(map);
        return;
      }
      ensureStationLayers(map, coloredCollection);
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [coloredCollection]);

  // Basemap swap — flip the style whenever the config panel changes it.
  // setStyle drops every user source + layer, so the station effect
  // above listens on style.load to re-attach; same trick for the DEM +
  // terrain effect below.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const next = BASEMAPS[basemap];
    if (!next) return;
    // Cheap guard: don't setStyle if we're already on the target style.
    // Mapbox has no getStyle().name field to compare against, so we
    // stash the current key on the map instance instead.
    if (map._mmCurrentBasemap === basemap) return;
    map._mmCurrentBasemap = basemap;
    map.setStyle(next);
  }, [basemap]);

  // Re-apply station dots after a basemap swap wipes the style. Reads
  // the collection through a ref (see coloredCollectionRef above) so
  // this handler always sees the CURRENT data — the previous inline
  // closure captured `null` at mount and never repainted after a swap.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onStyleLoad = () => {
      const data = coloredCollectionRef.current;
      if (!data) return;
      ensureStationLayers(map, data);
    };
    map.on('style.load', onStyleLoad);
    return () => {
      map.off('style.load', onStyleLoad);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Districts layer — always painted under the station dots. Loaded
  // once per session via the module-level singleton (loadDistricts)
  // and re-attached on every style.load so basemap swaps don't drop
  // it. Kept in a ref so the style.load handler always reads the
  // latest data even though it registered once at mount.
  const districtsRef = useRef(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    let cancelled = false;

    loadDistricts().then((data) => {
      if (cancelled || !mapRef.current) return;
      if (!data) return;
      districtsRef.current = data;
      const apply = () =>
        ensureDistrictsLayers(mapRef.current, data, districtsConfigRef.current);
      if (map.isStyleLoaded()) apply();
      else map.once('load', apply);
    });

    const onStyleLoad = () => {
      if (districtsRef.current) {
        ensureDistrictsLayers(map, districtsRef.current, districtsConfigRef.current);
      }
    };
    map.on('style.load', onStyleLoad);
    return () => {
      cancelled = true;
      map.off('style.load', onStyleLoad);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Basemap opacity — pinned to a fixed constant (see BASEMAP_OPACITY
  // in MonitoringContext). Walks every non-monitoring layer in the
  // live style and dims it so overlays (districts + station dots)
  // always sit clearly on top of dense satellite imagery. Re-runs on
  // style.load so a basemap swap doesn't strand a half-opaque previous
  // style. No dep — the value is a module constant.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const OWN_PREFIXES = ['monitoring-'];
    const apply = () => {
      if (!map.isStyleLoaded()) return;
      const style = map.getStyle();
      if (!style?.layers) return;
      for (const layer of style.layers) {
        if (OWN_PREFIXES.some((p) => layer.id.startsWith(p))) continue;
        applyLayerOpacity(map, layer, BASEMAP_OPACITY);
      }
    };
    const onStyleLoad = () => {
      apply();
      map.once('idle', apply);
    };
    apply();
    map.on('style.load', onStyleLoad);
    return () => {
      map.off('style.load', onStyleLoad);
    };
  }, []);

  // Districts config — react to color / opacity / outline / label
  // changes without tearing the layers down. Guards on style.isLoaded
  // (early boot) and no-ops when the layer set hasn't been created
  // yet; the ensure* path picks up the current config on first mount.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.isStyleLoaded()) {
      map.once('load', () => applyDistrictsConfig(map, districtsConfig));
      return;
    }
    applyDistrictsConfig(map, districtsConfig);
  }, [districtsConfig]);

  // 3D terrain toggle. Ensure the DEM source exists (added on every
  // style.load so basemap swaps don't strand it), then flip terrain
  // on/off. Re-applied on style.load for the same reason.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      if (!map.getSource('mapbox-dem')) {
        map.addSource('mapbox-dem', {
          type: 'raster-dem',
          url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
          tileSize: 512,
          maxzoom: 14,
        });
      }
      map.setTerrain(terrain ? TERRAIN_SPEC : null);
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
    map.on('style.load', apply);
    return () => {
      map.off('style.load', apply);
    };
  }, [terrain]);

  // Continuous alarm pulse — animates the two phase-shifted ring
  // layers whenever there's a station collection on the map. The
  // filter (`state === 'alarm'`) makes the layers no-op on cells with
  // no Alarm stations, so this stays cheap (two setPaintProperty calls
  // per frame regardless of station count).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !coloredCollection) return undefined;

    let raf = null;
    const start = performance.now();

    const tick = (now) => {
      const elapsed = now - start;
      ALARM_PULSE_LAYERS.forEach((id, i) => {
        if (!map.getLayer(id)) return;
        const phase =
          ((elapsed + (i * ALARM_PULSE_PERIOD_MS) / 2) % ALARM_PULSE_PERIOD_MS) /
          ALARM_PULSE_PERIOD_MS;
        const radius = ALARM_PULSE_MIN_R + (ALARM_PULSE_MAX_R - ALARM_PULSE_MIN_R) * phase;
        const opacity = 0.85 * (1 - phase);
        map.setPaintProperty(id, 'circle-radius', radius);
        map.setPaintProperty(id, 'circle-stroke-opacity', opacity);
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [coloredCollection]);

  // Click a station dot → sets this cell's selectedStation. Click the
  // same dot again → clears the selection (context handles the toggle
  // to keep the logic in one place). Cursor flips to a pointer over
  // clickable dots so the interaction is discoverable. Mouseenter also
  // spawns a themed Mapbox popup with the station name — kept on a
  // ref so mouseleave (and unmount) can tear it down deterministically.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;

    // One popup instance per cell, reused for every hover so we don't
    // churn DOM. `closeButton: false` because the popup lives only
    // while the cursor is over the dot; `closeOnClick: false` because
    // the click handler above owns click semantics.
    // `offset: 12` leaves just enough gap for the tip triangle to
    // sit between the popup body and the station dot without covering
    // the dot itself.
    const popup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
      className: 'monitoring-hover-popup',
    });

    const onClick = (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties ?? {};
      const stationId = Number(p.stationId);
      if (!Number.isFinite(stationId)) return;
      const c = f.geometry?.coordinates ?? [];
      setSelectedStation(cellKey, {
        stationId,
        stationName: p.stationName ?? `Station ${stationId}`,
        lng: c[0],
        lat: c[1],
      });
      // Fly to the picked station at a zoom that reveals the
      // surrounding districts (not so tight the station is the only
      // thing on screen). The flyTo issues a normal moveend which the
      // sync layer picks up and propagates to every other cell, so
      // clicking a dot in one cell rehomes every map in the grid.
      // `padding` biases the framing slightly so the station sits a
      // bit above centre, leaving room for label context around it.
      if (Array.isArray(c) && c.length >= 2) {
        mapRef.current?.flyTo({
          center: [c[0], c[1]],
          zoom: 9,
          duration: 700,
          essential: true,
          padding: { top: 60, bottom: 60, left: 60, right: 60 },
        });
      }
    };
    const onEnter = (e) => {
      map.getCanvas().style.cursor = 'pointer';
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties ?? {};
      const c = f.geometry?.coordinates?.slice() ?? [];
      if (c.length < 2) return;
      // Escape user-controlled fields — station names are DB-owned but
      // treating them as HTML would still be a papercut waiting to
      // happen (any future name change containing `<` would break).
      const name = String(p.stationName ?? `Station ${p.stationId}`);
      const dotColor = p.color ?? '#94a3b8';
      const escaped = name
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
      popup
        .setLngLat(c)
        .setHTML(
          `<span class="mhp-row"><span class="mhp-dot" style="--mhp-dot:${dotColor}"></span>${escaped}</span>`,
        )
        .addTo(map);
    };
    const onMove = (e) => {
      // Track the cursor as it drags across neighbouring dots so the
      // popup snaps to whichever station is currently under it (rather
      // than sticking to the first one hit).
      if (!popup.isOpen()) return;
      const f = e.features?.[0];
      if (!f) return;
      const c = f.geometry?.coordinates?.slice() ?? [];
      if (c.length >= 2) popup.setLngLat(c);
    };
    const onLeave = () => {
      map.getCanvas().style.cursor = '';
      popup.remove();
    };

    map.on('click', STATIONS_LAYER, onClick);
    map.on('mouseenter', STATIONS_LAYER, onEnter);
    map.on('mousemove', STATIONS_LAYER, onMove);
    map.on('mouseleave', STATIONS_LAYER, onLeave);
    return () => {
      map.off('click', STATIONS_LAYER, onClick);
      map.off('mouseenter', STATIONS_LAYER, onEnter);
      map.off('mousemove', STATIONS_LAYER, onMove);
      map.off('mouseleave', STATIONS_LAYER, onLeave);
      popup.remove();
    };
  }, [cellKey, setSelectedStation]);

  const selectedStation = selectedStations[cellKey];

  // Filter the selection-ripple layers to the currently-selected
  // station id (or nothing when there's no selection). Also re-applied
  // on style.load so basemap swaps don't strand the selection.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const apply = () => {
      const filter =
        selectedStation?.stationId != null
          ? ['==', ['get', 'stationId'], Number(selectedStation.stationId)]
          : NO_HIGHLIGHT_FILTER;
      for (const id of SEL_RIPPLE_LAYERS) {
        if (map.getLayer(id)) map.setFilter(id, filter);
      }
    };
    apply();
    map.on('style.load', apply);
    return () => {
      map.off('style.load', apply);
    };
  }, [selectedStation]);

  // Selection ripple animation — only runs while a station is
  // selected in THIS cell. Same phase-shifted rAF pattern the main map
  // uses; two setPaintProperty calls per frame regardless of station
  // count because the filter narrows the layer to exactly one feature.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedStation) return undefined;
    let raf = null;
    const start = performance.now();
    const tick = (now) => {
      const elapsed = now - start;
      SEL_RIPPLE_LAYERS.forEach((id, i) => {
        if (!map.getLayer(id)) return;
        const phase =
          ((elapsed + (i * SEL_RIPPLE_PERIOD_MS) / 2) % SEL_RIPPLE_PERIOD_MS) /
          SEL_RIPPLE_PERIOD_MS;
        const radius = SEL_RIPPLE_MIN_R + (SEL_RIPPLE_MAX_R - SEL_RIPPLE_MIN_R) * phase;
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

  const handleZoomIn = () => mapRef.current?.zoomIn();
  const handleZoomOut = () => mapRef.current?.zoomOut();
  const handleResetBearing = () =>
    mapRef.current?.easeTo({ bearing: 0, pitch: 0, duration: 300 });

  return (
    <div className="relative w-full h-full overflow-hidden rounded-md border border-day-border dark:border-night-border bg-slate-200 dark:bg-night-bg">
      <div ref={containerRef} className="absolute inset-0" />

      {/* Cell badge — accent-colored letter so operators can call out
          cells by label ("look at cell B"). */}
      <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5">
        <span
          className="inline-flex items-center justify-center h-6 w-6 rounded-full text-[11px] font-bold uppercase text-white shadow-md"
          style={{ backgroundColor: accent }}
        >
          {cellKey.toUpperCase()}
        </span>
        {elementName ? (
          <span
            className="px-1.5 py-0.5 rounded text-[10.5px] font-semibold uppercase tracking-wide text-white shadow-sm"
            style={{ backgroundColor: `${accent}dd` }}
          >
            {elementName}
          </span>
        ) : null}
      </div>

      {/* Parameter picker — top right. Themed dropdown with inline
          filter + coloured accent dots per parameter (see
          ParameterSelect). */}
      <div className="absolute top-2 right-2 z-10 w-[180px]">
        <ParameterSelect
          value={elementName}
          onChange={(name) => setCellParameter(cellKey, name)}
          elements={elements}
          size="sm"
          className="w-full"
        />
      </div>

      {/* Basic controls — zoom in / out / focus-to-extent / reset
          bearing. Focus fits this cell to its parameter's station
          extent, which cascades to every other cell via the normal
          sync path. Buttons are tuned down a touch from the main map's
          nav controls so they don't dominate the small cell chrome. */}
      <div className="absolute bottom-2 right-2 z-10 flex flex-col rounded-md border border-day-border dark:border-night-border bg-white/95 dark:bg-night-surface/95 backdrop-blur-sm shadow-md overflow-hidden">
        <ControlButton onClick={handleZoomIn} label="Zoom in">
          <Plus className="h-3 w-3" />
        </ControlButton>
        <ControlButton onClick={handleZoomOut} label="Zoom out">
          <Minus className="h-3 w-3" />
        </ControlButton>
        <ControlButton
          onClick={fitToStations}
          label={
            elementName
              ? `Focus to ${elementName} stations`
              : 'Focus to parameter extent (select a parameter first)'
          }
          disabled={!elementName || stations.length === 0}
        >
          <Focus className="h-3 w-3" />
        </ControlButton>
        <ControlButton onClick={handleResetBearing} label="Reset north">
          <Navigation2 className="h-3 w-3" />
        </ControlButton>
      </div>

      {/* Placeholder overlay when no parameter is selected. Prompts the
          operator to pick one; disappears the moment they do. */}
      {!elementName ? (
        <div className="absolute inset-0 z-[5] flex items-center justify-center pointer-events-none">
          <span className="px-2 py-1 rounded text-[11px] font-medium text-day-muted dark:text-night-muted bg-white/70 dark:bg-night-surface/70 backdrop-blur-sm">
            Cell {cellKey.toUpperCase()} — pick a parameter above
          </span>
        </div>
      ) : null}
    </div>
  );
}

function ControlButton({ onClick, label, disabled, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        'h-6 w-6 inline-flex items-center justify-center',
        'text-day-text dark:text-night-text',
        'hover:bg-day-bg dark:hover:bg-night-bg transition-colors',
        disabled && 'opacity-40 cursor-not-allowed hover:bg-transparent',
      )}
    >
      {children}
    </button>
  );
}
