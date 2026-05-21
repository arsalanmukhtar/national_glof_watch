import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CircleDot,
  Database,
  Download,
  FileUp,
  Loader2,
  MapPin,
  Radio,
  Shapes,
  Slash,
  Square,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { useParameter } from '@/contexts/ParameterContext';
import { useRegionLayers, parseRegionLayerId } from '@/contexts/RegionLayersContext';
import { useSecondary } from '@/contexts/SecondaryContext';
import {
  regionLayerUrl,
  regionLayerGeometry,
  secondaryLayerUrl,
  fetchGeoJson,
} from '@/config/layerSources';
import {
  EXPORT_FORMATS,
  EXPORT_CRS,
  collectFieldNames,
  pickFields,
  reprojectFeatureCollection,
  toGeoJson,
  toCsv,
  toKml,
  buildShapefileFiles,
  buildZip,
  triggerDownload,
  safeFileName,
} from '@/utils/layerExport';
import { cn } from '@/utils/cn';

// --- Section identity — each layer group reads as visually distinct. ------
const SECTIONS = {
  pmd: {
    title: 'PMD Parameters',
    blurb: 'Live weather-station element on the map',
    icon: Radio,
    accent: '#84cc16',
    headTint: 'bg-[#84cc16]/10',
    ring: 'border-[#84cc16]/35',
  },
  primary: {
    title: 'Primary Layers',
    blurb: 'Per-region GIS layers toggled on',
    icon: MapPin,
    accent: '#3b82f6',
    headTint: 'bg-blue-500/10',
    ring: 'border-blue-500/35',
  },
  secondary: {
    title: 'Secondary Layers',
    blurb: 'Reference, uploaded & database layers on the map',
    icon: Shapes,
    accent: '#8b5cf6',
    headTint: 'bg-violet-500/10',
    ring: 'border-violet-500/35',
  },
};

const REGION_LAYER_NAMES = {
  lake: 'Lake',
  river: 'River',
  glacier: 'Glacier',
  faultline: 'Faultline',
  building: 'Buildings',
  school: 'Schools',
  road: 'Roads',
  'risk:low': 'Risk Zones · Low',
  'risk:medium': 'Risk Zones · Medium',
  'risk:high': 'Risk Zones · High',
};

const prettyRegion = (id) =>
  String(id)
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

function GeomGlyph({ geometry }) {
  const Icon =
    geometry === 'point' ? CircleDot : geometry === 'line' ? Slash : Square;
  return <Icon className="h-3 w-3 shrink-0" aria-hidden />;
}

export default function ExportLayersModal({ open, onClose }) {
  const { selected: pmdElement, stations } = useParameter();
  const { visibleLayers: regionVisible } = useRegionLayers();
  const {
    layers: secondaryCatalog,
    visibleLayers: secVisible,
    uploads,
    dbLayers,
  } = useSecondary();

  // --- Build the catalog of exportable layers from what's on the map. ----
  const allLayers = useMemo(() => {
    const list = [];

    if (pmdElement && stations?.length) {
      list.push({
        id: `pmd|${pmdElement}`,
        section: 'pmd',
        label: pmdElement,
        sublabel: `${stations.length} stations`,
        geometry: 'point',
        getData: async () => ({ type: 'FeatureCollection', features: stations }),
      });
    }

    for (const rid of regionVisible) {
      const { regionId, layerKey } = parseRegionLayerId(rid);
      list.push({
        id: `primary|${rid}`,
        section: 'primary',
        label: `${prettyRegion(regionId)} · ${REGION_LAYER_NAMES[layerKey] || layerKey}`,
        sublabel: prettyRegion(regionId),
        geometry: regionLayerGeometry(layerKey),
        getData: async () => fetchGeoJson(regionLayerUrl(regionId, layerKey)),
      });
    }

    for (const l of secondaryCatalog) {
      if (!secVisible.has(l.id)) continue;
      list.push({
        id: `secondary|${l.id}`,
        section: 'secondary',
        label: l.label,
        sublabel: 'Reference layer',
        geometry: l.geometry,
        getData: async () => {
          const url = secondaryLayerUrl(l.id);
          if (!url) throw new Error('No data endpoint for this layer');
          return fetchGeoJson(url);
        },
      });
    }
    for (const u of uploads) {
      if (!secVisible.has(u.id)) continue;
      list.push({
        id: `upload|${u.id}`,
        section: 'secondary',
        label: u.label,
        sublabel: 'Uploaded file',
        geometry: u.geometry,
        getData: async () => u.data,
      });
    }
    for (const d of dbLayers) {
      if (!secVisible.has(d.id)) continue;
      list.push({
        id: `db|${d.id}`,
        section: 'secondary',
        label: d.label,
        sublabel: 'Database table',
        geometry: d.geometry,
        getData: async () => d.data,
      });
    }
    return list;
  }, [pmdElement, stations, regionVisible, secondaryCatalog, secVisible, uploads, dbLayers]);

  const layersBySection = useMemo(
    () => ({
      pmd: allLayers.filter((l) => l.section === 'pmd'),
      primary: allLayers.filter((l) => l.section === 'primary'),
      secondary: allLayers.filter((l) => l.section === 'secondary'),
    }),
    [allLayers],
  );

  // --- State ------------------------------------------------------------
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [format, setFormat] = useState('geojson');
  const [crs, setCrs] = useState('EPSG:4326');
  const [excludedFields, setExcludedFields] = useState(() => new Set());
  const [dataById, setDataById] = useState({});
  const [loadingIds, setLoadingIds] = useState(() => new Set());
  const [errorById, setErrorById] = useState({});
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState(null); // { type:'error'|'success', text }
  const dataRef = useRef({});

  // Reset everything each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setSelectedIds(new Set());
    setFormat('geojson');
    setCrs('EPSG:4326');
    setExcludedFields(new Set());
    setDataById({});
    setLoadingIds(new Set());
    setErrorById({});
    setExporting(false);
    setStatus(null);
    dataRef.current = {};
  }, [open]);

  // Fetch + cache one layer's GeoJSON.
  const ensureData = useCallback(async (layer) => {
    if (dataRef.current[layer.id]) return dataRef.current[layer.id];
    setLoadingIds((s) => new Set(s).add(layer.id));
    setErrorById((e) => {
      if (!(layer.id in e)) return e;
      const next = { ...e };
      delete next[layer.id];
      return next;
    });
    try {
      const raw = await layer.getData();
      const fc =
        raw && raw.type === 'FeatureCollection'
          ? raw
          : { type: 'FeatureCollection', features: raw?.features || [] };
      dataRef.current[layer.id] = fc;
      setDataById((d) => ({ ...d, [layer.id]: fc }));
      return fc;
    } catch (err) {
      setErrorById((e) => ({ ...e, [layer.id]: err?.message || 'Failed to load' }));
      return null;
    } finally {
      setLoadingIds((s) => {
        const next = new Set(s);
        next.delete(layer.id);
        return next;
      });
    }
  }, []);

  const toggleLayer = useCallback(
    (layer) => {
      setStatus(null);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(layer.id)) next.delete(layer.id);
        else {
          next.add(layer.id);
          ensureData(layer);
        }
        return next;
      });
    },
    [ensureData],
  );

  const selectedLayers = useMemo(
    () => allLayers.filter((l) => selectedIds.has(l.id)),
    [allLayers, selectedIds],
  );

  // Field union across all selected + loaded layers.
  const fieldNames = useMemo(() => {
    const fcs = selectedLayers.map((l) => dataById[l.id]).filter(Boolean);
    return collectFieldNames(fcs);
  }, [selectedLayers, dataById]);

  const activeFields = useMemo(
    () => fieldNames.filter((f) => !excludedFields.has(f)),
    [fieldNames, excludedFields],
  );

  const totalFeatures = useMemo(
    () =>
      selectedLayers.reduce(
        (n, l) => n + (dataById[l.id]?.features?.length || 0),
        0,
      ),
    [selectedLayers, dataById],
  );

  const anyLoading = selectedLayers.some((l) => loadingIds.has(l.id));
  const formatMeta = EXPORT_FORMATS.find((f) => f.id === format);
  const crsLocked = format === 'kml';
  const effectiveCrs = crsLocked ? 'EPSG:4326' : crs;

  // --- Export -----------------------------------------------------------
  const handleExport = async () => {
    if (!selectedLayers.length || exporting) return;
    setExporting(true);
    setStatus(null);
    try {
      const loaded = [];
      for (const layer of selectedLayers) {
        const fc = dataRef.current[layer.id] || (await ensureData(layer));
        if (!fc) throw new Error(`Could not load “${layer.label}”`);
        loaded.push({ layer, fc });
      }

      const targetCrs = format === 'kml' ? 'EPSG:4326' : crs;
      const entries = [];
      const usedNames = new Set();
      const uniqueName = (base, ext) => {
        let name = `${base}.${ext}`;
        let n = 2;
        while (usedNames.has(name)) name = `${base}_${n++}.${ext}`;
        usedNames.add(name);
        return name;
      };

      for (const { layer, fc } of loaded) {
        const layerFields = collectFieldNames([fc]).filter(
          (f) => !excludedFields.has(f),
        );
        let prepared = pickFields(fc, layerFields);
        prepared = reprojectFeatureCollection(prepared, targetCrs);
        const base = safeFileName(layer.label);

        if (format === 'geojson') {
          entries.push({
            name: uniqueName(base, 'geojson'),
            data: toGeoJson(prepared, targetCrs),
            kind: 'geojson',
          });
        } else if (format === 'csv') {
          entries.push({
            name: uniqueName(base, 'csv'),
            data: toCsv(prepared, layerFields),
            kind: 'csv',
          });
        } else if (format === 'kml') {
          entries.push({
            name: uniqueName(base, 'kml'),
            data: toKml(prepared, layerFields, layer.label),
            kind: 'kml',
          });
        } else if (format === 'shp') {
          const shpBase = uniqueName(base, 'shp').replace(/\.shp$/, '');
          entries.push(
            ...buildShapefileFiles(prepared, layerFields, targetCrs, shpBase),
          );
        }
      }

      if (format === 'shp') {
        const zipName =
          loaded.length === 1
            ? `${safeFileName(loaded[0].layer.label)}.zip`
            : 'glof-shapefiles.zip';
        triggerDownload(zipName, buildZip(entries), 'zip');
      } else if (entries.length === 1) {
        triggerDownload(entries[0].name, entries[0].data, entries[0].kind);
      } else {
        triggerDownload('glof-layers-export.zip', buildZip(entries), 'zip');
      }

      setStatus({
        type: 'success',
        text: `Exported ${loaded.length} layer${loaded.length === 1 ? '' : 's'} as ${formatMeta.label}.`,
      });
    } catch (err) {
      setStatus({ type: 'error', text: err?.message || 'Export failed' });
    } finally {
      setExporting(false);
    }
  };

  // --- Render -----------------------------------------------------------
  const footer = (
    <div className="flex items-center gap-3">
      <div className="min-w-0 text-[12px]">
        {status ? (
          <span
            className={cn(
              'inline-flex items-center gap-1.5 font-medium',
              status.type === 'error'
                ? 'text-red-600 dark:text-red-300'
                : 'text-[#4d7c0f] dark:text-[#a3e635]',
            )}
          >
            {status.type === 'error' ? (
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="truncate">{status.text}</span>
          </span>
        ) : (
          <span className="text-day-muted dark:text-night-muted">
            {selectedLayers.length === 0
              ? 'No layers selected'
              : `${selectedLayers.length} layer${selectedLayers.length === 1 ? '' : 's'} · ${
                  anyLoading ? '…' : totalFeatures.toLocaleString()
                } features`}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        disabled={exporting}
        className="btn-light btn-md ml-auto"
      >
        Close
      </button>
      <button
        type="button"
        onClick={handleExport}
        disabled={exporting || selectedLayers.length === 0 || anyLoading}
        className="btn-primary btn-md inline-flex items-center gap-1.5"
      >
        {exporting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
        Export {formatMeta?.label}
      </button>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={exporting ? () => {} : onClose}
      title="Export Layers"
      size="xl"
      footer={footer}
    >
      <div className="flex items-start gap-2 text-[13px] text-day-muted dark:text-night-muted mb-3">
        <FileUp className="h-4 w-4 shrink-0 mt-0.5 text-[#84cc16]" />
        <span>
          Export the layers currently on the map to a vector file. Pick layers
          on the left, then choose a format, coordinate system and fields on
          the right.
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-3">
        {/* ---- Left: layer sections ---- */}
        <div className="flex flex-col gap-2.5">
          {Object.keys(SECTIONS).map((key) => {
            const meta = SECTIONS[key];
            const Icon = meta.icon;
            const layers = layersBySection[key];
            return (
              <div
                key={key}
                className={cn(
                  'rounded-lg border overflow-hidden',
                  meta.ring,
                )}
              >
                <div
                  className={cn(
                    'flex items-center gap-2 px-3 py-2',
                    meta.headTint,
                  )}
                >
                  <span
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                    style={{ backgroundColor: `${meta.accent}22` }}
                  >
                    <Icon className="h-3.5 w-3.5" style={{ color: meta.accent }} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-day-text dark:text-night-text leading-tight">
                      {meta.title}
                    </div>
                    <div className="text-[10.5px] text-day-muted dark:text-night-muted leading-tight">
                      {meta.blurb}
                    </div>
                  </div>
                  <span
                    className="ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold tabular-nums"
                    style={{ backgroundColor: `${meta.accent}22`, color: meta.accent }}
                  >
                    {layers.length}
                  </span>
                </div>

                <div className="p-1.5">
                  {layers.length === 0 ? (
                    <p className="px-2 py-2.5 text-[12px] text-day-muted dark:text-night-muted">
                      No {meta.title.toLowerCase()} on the map.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {layers.map((layer) => {
                        const checked = selectedIds.has(layer.id);
                        const loading = loadingIds.has(layer.id);
                        const error = errorById[layer.id];
                        const count = dataById[layer.id]?.features?.length;
                        return (
                          <button
                            key={layer.id}
                            type="button"
                            onClick={() => toggleLayer(layer)}
                            className={cn(
                              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                              checked
                                ? 'bg-day-bg dark:bg-night-bg'
                                : 'hover:bg-day-bg dark:hover:bg-night-bg',
                            )}
                          >
                            <span
                              className={cn(
                                'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                                checked
                                  ? 'border-transparent'
                                  : 'border-day-border dark:border-night-border',
                              )}
                              style={
                                checked
                                  ? { backgroundColor: meta.accent }
                                  : undefined
                              }
                            >
                              {checked && (
                                <CheckCircle2
                                  className="h-3 w-3 text-white"
                                  strokeWidth={3}
                                />
                              )}
                            </span>
                            <span
                              className="shrink-0"
                              style={{ color: meta.accent }}
                            >
                              <GeomGlyph geometry={layer.geometry} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[12.5px] font-medium text-day-text dark:text-night-text">
                                {layer.label}
                              </span>
                              {error && (
                                <span className="block truncate text-[10.5px] text-red-600 dark:text-red-300">
                                  {error}
                                </span>
                              )}
                            </span>
                            {loading ? (
                              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-day-muted dark:text-night-muted" />
                            ) : error ? (
                              <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
                            ) : count != null ? (
                              <span className="shrink-0 text-[10.5px] tabular-nums text-day-muted dark:text-night-muted">
                                {count.toLocaleString()}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ---- Right: export options ---- */}
        <div className="flex flex-col gap-3 rounded-lg border border-day-border dark:border-night-border p-3">
          {/* Format */}
          <div>
            <h4 className="label-base mb-1.5">Format</h4>
            <div className="grid grid-cols-2 gap-1.5">
              {EXPORT_FORMATS.map((f) => {
                const on = format === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      setFormat(f.id);
                      setStatus(null);
                    }}
                    className={cn(
                      'rounded-md border px-2 py-1.5 text-left transition-colors',
                      on
                        ? 'border-[#84cc16] bg-[#84cc16]/10'
                        : 'border-day-border dark:border-night-border hover:bg-day-bg dark:hover:bg-night-bg',
                    )}
                  >
                    <div
                      className={cn(
                        'text-[12.5px] font-semibold',
                        on
                          ? 'text-[#4d7c0f] dark:text-[#a3e635]'
                          : 'text-day-text dark:text-night-text',
                      )}
                    >
                      {f.label}
                    </div>
                    <div className="text-[10px] leading-tight text-day-muted dark:text-night-muted">
                      {f.desc}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* CRS */}
          <div>
            <h4 className="label-base mb-1.5">Coordinate system</h4>
            <div className="flex flex-col gap-1">
              {EXPORT_CRS.map((c) => {
                const on = effectiveCrs === c.id;
                const disabled = crsLocked && c.id !== 'EPSG:4326';
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => setCrs(c.id)}
                    className={cn(
                      'flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors',
                      disabled && 'opacity-40 cursor-not-allowed',
                      on
                        ? 'border-[#84cc16] bg-[#84cc16]/10'
                        : 'border-day-border dark:border-night-border hover:bg-day-bg dark:hover:bg-night-bg',
                    )}
                  >
                    <span
                      className={cn(
                        'inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border',
                        on
                          ? 'border-[#84cc16]'
                          : 'border-day-border dark:border-night-border',
                      )}
                    >
                      {on && (
                        <span className="h-1.5 w-1.5 rounded-full bg-[#84cc16]" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-medium text-day-text dark:text-night-text">
                        {c.label}{' '}
                        <span className="text-day-muted dark:text-night-muted font-normal">
                          {c.code}
                        </span>
                      </span>
                      <span className="block text-[10px] leading-tight text-day-muted dark:text-night-muted">
                        {c.desc}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            {crsLocked && (
              <p className="mt-1 text-[10.5px] text-day-muted dark:text-night-muted">
                KML is locked to WGS 84 by the format specification.
              </p>
            )}
          </div>

          {/* Fields */}
          <div className="min-h-0">
            <div className="flex items-center gap-2 mb-1.5">
              <h4 className="label-base">
                Fields{' '}
                {fieldNames.length > 0 && (
                  <span className="text-day-muted dark:text-night-muted">
                    ({activeFields.length}/{fieldNames.length})
                  </span>
                )}
              </h4>
              {fieldNames.length > 0 && (
                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setExcludedFields(new Set())}
                    className="text-[10.5px] font-medium text-[#4d7c0f] dark:text-[#a3e635] hover:underline"
                  >
                    All
                  </button>
                  <span className="text-day-border dark:text-night-border">·</span>
                  <button
                    type="button"
                    onClick={() => setExcludedFields(new Set(fieldNames))}
                    className="text-[10.5px] font-medium text-day-muted dark:text-night-muted hover:underline"
                  >
                    None
                  </button>
                </div>
              )}
            </div>
            {fieldNames.length === 0 ? (
              <p className="rounded-md border border-dashed border-day-border dark:border-night-border px-2 py-3 text-center text-[11.5px] text-day-muted dark:text-night-muted">
                Select layers to choose fields.
              </p>
            ) : (
              <div className="max-h-40 overflow-y-auto rounded-md border border-day-border dark:border-night-border p-1">
                {fieldNames.map((f) => {
                  const on = !excludedFields.has(f);
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() =>
                        setExcludedFields((prev) => {
                          const next = new Set(prev);
                          if (next.has(f)) next.delete(f);
                          else next.add(f);
                          return next;
                        })
                      }
                      className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-day-bg dark:hover:bg-night-bg"
                    >
                      <span
                        className={cn(
                          'inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border',
                          on
                            ? 'bg-[#84cc16] border-[#84cc16]'
                            : 'border-day-border dark:border-night-border',
                        )}
                      >
                        {on && (
                          <CheckCircle2
                            className="h-2.5 w-2.5 text-[#1a2e05]"
                            strokeWidth={3.5}
                          />
                        )}
                      </span>
                      <span className="truncate text-[11.5px] text-day-text dark:text-night-text">
                        {f}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <p className="mt-1 inline-flex items-center gap-1 text-[10.5px] text-day-muted dark:text-night-muted">
              <Database className="h-3 w-3" />
              Geometry is always included.
            </p>
          </div>
        </div>
      </div>
    </Modal>
  );
}
