import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Listbox, Popover, Switch, Transition } from '@headlessui/react';
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  Circle,
  CircleDot,
  Image as ImageIcon,
  Layers as LayersIcon,
  Pipette,
  Plus,
  RotateCcw,
  Slash,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  CATEGORIES as MARKER_CATEGORIES,
  EMOJI_CATEGORIES,
  resolveMarkerIcon,
} from '@/config/markerIcons';
import {
  parseRegionLayerId,
  useRegionLayers,
} from '@/contexts/RegionLayersContext';
import { useSecondary } from '@/contexts/SecondaryContext';
import { useRasters } from '@/contexts/RasterContext';
import TruncateLabel from '@/components/ui/TruncateLabel';
import { fetchGeoJson, regionLayerGeometry, regionLayerUrl, secondaryLayerUrl } from '@/config/layerSources';
import { effectiveStyle } from '@/utils/layerStyle';
import { colormapCssGradient, listColormaps } from '@/utils/rasterRender';
import {
  CATEGORICAL_PALETTES,
  COLOR_RAMPS,
  paletteById,
  rampById,
  sampleRampColors,
} from '@/utils/stylePalettes';
import { cn } from '@/utils/cn';

// ===========================================================================
// Layer-name helpers
// ===========================================================================

const REGION_LAYER_LABELS = {
  lake: 'Lake', river: 'River', glacier: 'Glacier', faultline: 'Faultline',
  building: 'Buildings', school: 'Schools', road: 'Roads',
  'risk:low': 'Risk · Low', 'risk:medium': 'Risk · Medium', 'risk:high': 'Risk · High',
};

function regionPretty(id) {
  return id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ===========================================================================
// Layer registry
// ===========================================================================

function useLayerRegistry() {
  const { visibleLayers: regionVisible } = useRegionLayers();
  const {
    layers: secondaryLayers,
    visibleLayers: secondaryVisible,
    uploads,
    dbLayers,
  } = useSecondary();
  const { groups: rasterGroups } = useRasters();

  return useMemo(() => {
    const groups = [];

    const regions = [];
    for (const id of regionVisible) {
      const { regionId, layerKey } = parseRegionLayerId(id);
      regions.push({
        id,
        group: 'Regions',
        regionLabel: regionPretty(regionId),
        layerLabel: REGION_LAYER_LABELS[layerKey] ?? layerKey,
        geometry: regionLayerGeometry(layerKey),
        visible: true,
      });
    }
    if (regions.length) groups.push({ name: 'Regions', items: regions });

    if (secondaryLayers.length) {
      groups.push({
        name: 'Secondary',
        items: secondaryLayers.map((l) => ({
          id: l.id,
          group: 'Secondary',
          regionLabel: null,
          layerLabel: l.label,
          geometry: l.geometry,
          visible: secondaryVisible.has(l.id),
        })),
      });
    }

    if (uploads.length) {
      groups.push({
        name: 'Uploads',
        items: uploads.map((u) => ({
          id: u.id,
          group: 'Uploads',
          regionLabel: null,
          layerLabel: u.label,
          geometry: u.geometry || 'polygon',
          visible: secondaryVisible.has(u.id),
        })),
      });
    }

    if (dbLayers.length) {
      groups.push({
        name: 'Database',
        items: dbLayers.map((l) => ({
          id: l.id,
          group: 'Database',
          regionLabel: l.schema || null,
          layerLabel: l.table || l.label,
          geometry: l.geometry || 'polygon',
          visible: secondaryVisible.has(l.id),
        })),
      });
    }

    if (rasterGroups.length) {
      groups.push({
        name: 'Rasters',
        items: rasterGroups.map((g) => ({
          id: g.id,
          group: 'Rasters',
          regionLabel: g.kind === 'temporal' ? 'Temporal' : 'Single',
          layerLabel: g.name,
          geometry: 'raster',
          visible: g.visible,
        })),
      });
    }

    return groups;
  }, [regionVisible, secondaryLayers, secondaryVisible, uploads, dbLayers, rasterGroups]);
}

function flatten(groups) {
  return groups.flatMap((g) => g.items);
}

// ===========================================================================
// Layer data — fetches the selected layer's GeoJSON (cached) and reports
// its feature properties. Categories / Color range / Size range modes need
// this so the user can pick attributes off the live data.
// ===========================================================================

function useLayerData(item) {
  const { uploads, dbLayers } = useSecondary();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!item) {
      setData(null);
      return;
    }
    let cancelled = false;
    if (item.group === 'Uploads') {
      const u = uploads.find((up) => up.id === item.id);
      setData(u?.data ?? null);
      return () => {};
    }
    if (item.group === 'Database') {
      // DB layers are already fetched at load time and cached on the
      // SecondaryContext entry — no extra round-trip needed.
      const l = dbLayers.find((d) => d.id === item.id);
      setData(l?.data ?? null);
      return () => {};
    }
    let url = null;
    if (item.group === 'Regions') {
      const { regionId, layerKey } = parseRegionLayerId(item.id);
      url = regionLayerUrl(regionId, layerKey);
    } else if (item.group === 'Secondary') {
      url = secondaryLayerUrl(item.id);
    }
    if (!url) {
      setData(null);
      return () => {};
    }
    setLoading(true);
    fetchGeoJson(url)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item, uploads, dbLayers]);

  // Derive: list of attributes + per-attribute summary (numeric/categorical)
  const attrs = useMemo(() => {
    if (!data?.features?.length) return [];
    // Inspect up to first 200 features to keep this snappy on large layers.
    const sample = data.features.slice(0, 200);
    const props = new Map();
    for (const f of sample) {
      const p = f.properties || {};
      for (const [k, v] of Object.entries(p)) {
        if (!props.has(k)) props.set(k, { name: k, values: [], numericCount: 0, totalNonNull: 0 });
        const entry = props.get(k);
        if (entry.values.length < 6 && v != null && v !== '' && entry.values.indexOf(v) === -1) {
          entry.values.push(v);
        }
        if (v == null || v === '') continue;
        entry.totalNonNull += 1;
        // Treat numeric strings ("1234", "35.71") as numeric — many GeoJSON
        // exporters write numbers as strings.
        const n = typeof v === 'number' ? v : Number(v);
        if (Number.isFinite(n)) entry.numericCount += 1;
      }
    }
    return [...props.values()].map((e) => ({
      name: e.name,
      sample: e.values,
      kind:
        e.totalNonNull > 0 && e.numericCount / e.totalNonNull >= 0.8
          ? 'numeric'
          : 'categorical',
    }));
  }, [data]);

  return { data, attrs, loading };
}

// Distinct values + numeric min/max for a chosen attribute.
function summarizeAttribute(data, attrName) {
  if (!data?.features || !attrName) return { distinct: [], min: null, max: null };
  const distinct = new Map();
  let min = Infinity;
  let max = -Infinity;
  for (const f of data.features) {
    const v = f.properties?.[attrName];
    if (v == null || v === '') continue;
    // Accept numeric strings — many GeoJSON exporters write numbers as strings.
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n)) {
      if (n < min) min = n;
      if (n > max) max = n;
    }
    const key = String(v);
    distinct.set(key, (distinct.get(key) || 0) + 1);
  }
  return {
    distinct: [...distinct.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({ value, count })),
    min: min === Infinity ? null : min,
    max: max === -Infinity ? null : max,
  };
}

// ===========================================================================
// Color helpers — hex ↔ HSV conversions for the picker.
// ===========================================================================

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function hexToRgb(hex) {
  const s = (hex || '').replace('#', '');
  if (s.length === 3) {
    const [r, g, b] = s.split('').map((c) => parseInt(c + c, 16));
    return { r: r || 0, g: g || 0, b: b || 0, a: 1 };
  }
  if (s.length === 8) {
    return {
      r: parseInt(s.slice(0, 2), 16) || 0,
      g: parseInt(s.slice(2, 4), 16) || 0,
      b: parseInt(s.slice(4, 6), 16) || 0,
      a: (parseInt(s.slice(6, 8), 16) || 0) / 255,
    };
  }
  // Treat anything else as 6-char (or fall back to 0).
  return {
    r: parseInt(s.slice(0, 2), 16) || 0,
    g: parseInt(s.slice(2, 4), 16) || 0,
    b: parseInt(s.slice(4, 6), 16) || 0,
    a: 1,
  };
}

function rgbToHex(r, g, b, a = 1) {
  const t = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  if (a >= 1) return `#${t(r)}${t(g)}${t(b)}`;
  return `#${t(r)}${t(g)}${t(b)}${t(a * 255)}`;
}

function rgbToHsv(r, g, b) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const mx = Math.max(rn, gn, bn);
  const mn = Math.min(rn, gn, bn);
  const d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === rn) h = ((gn - bn) / d) % 6;
    else if (mx === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = mx ? d / mx : 0;
  return { h, s, v: mx };
}

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else              { r = c; b = x; }
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

function isHex(v) {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v || '');
}

// ===========================================================================
// Felt-style color picker — HSL square + hue slider + preset rows
// ===========================================================================

const PRESET_ROWS = [
  ['#1f6f5c', '#5b8b3a', '#7eb539', '#65a30d', '#0f766e', '#0e7490', '#1d4ed8'],
  ['#22d3ee', '#93c5fd', '#a78bfa', '#c084fc', '#f472b6', '#dc2626', '#f97316'],
  ['#facc15', '#fde047', '#92400e', '#7c2d12', '#0f172a', '#475569', '#cbd5e1', '#ffffff', 'transparent'],
];

// Visual tile shown for the literal value `'transparent'` in any swatch
// grid — the same checker pattern used by ColorButton's trigger so the
// language is consistent across the dashboard. Mapbox accepts the CSS
// keyword `'transparent'` directly as a paint colour, so picking this
// swatch lets users zero out a fill or stroke without having to rely
// on opacity sliders.
const SWATCH_CHECKER_STYLE = {
  backgroundImage: 'repeating-conic-gradient(#cbd5e1 0% 25%, #ffffff 0% 50%)',
  backgroundSize: '6px 6px',
};

function swatchBgStyle(c) {
  if (c === 'transparent') return SWATCH_CHECKER_STYLE;
  return { backgroundColor: c };
}

function ColorButton({ value, onChange, ariaLabel, allowNone = false }) {
  return (
    <Popover className="relative">
      {({ close }) => (
        <>
          <Popover.Button
            className={cn(
              'group flex items-center gap-1.5 rounded-md',
              'border border-day-border dark:border-night-border',
              'bg-white dark:bg-night-bg',
              'pl-1 pr-1.5 py-1 text-[12px] tabular-nums',
              'hover:border-[#84cc16]/60 transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-[#84cc16]/40',
            )}
            aria-label={ariaLabel}
          >
            {value ? (
              <>
                <span
                  className="relative h-4 w-4 rounded-sm border border-black/10 dark:border-white/10 overflow-hidden"
                  style={{
                    background:
                      'repeating-conic-gradient(#cbd5e1 0% 25%, #ffffff 0% 50%) 0 0 / 6px 6px',
                  }}
                >
                  <span className="absolute inset-0" style={{ backgroundColor: value }} />
                </span>
                <span className="text-day-text dark:text-night-text">{value.toUpperCase()}</span>
              </>
            ) : (
              <>
                <span className="h-4 w-4 rounded-sm border border-day-border dark:border-night-border bg-[linear-gradient(45deg,transparent_45%,#ef4444_45%,#ef4444_55%,transparent_55%)]" />
                <span className="text-day-muted dark:text-night-muted">None</span>
              </>
            )}
            <ChevronDown className="h-3 w-3 text-day-muted dark:text-night-muted" />
          </Popover.Button>
          <Transition
            as={Fragment}
            enter="transition ease-out duration-100"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="transition ease-in duration-75"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <Popover.Panel
              anchor={{ to: 'bottom end', gap: 6 }}
              className={cn(
                'z-[100] w-[260px] rounded-lg p-3',
                'bg-white dark:bg-night-surface',
                'border border-day-border dark:border-night-border shadow-xl',
              )}
            >
              <FullColorPicker
                value={value || '#cccccc'}
                onChange={onChange}
                allowNone={allowNone}
                onClear={() => { onChange(null); close(); }}
              />
            </Popover.Panel>
          </Transition>
        </>
      )}
    </Popover>
  );
}

function FullColorPicker({ value, onChange, allowNone, onClear }) {
  // Strip any hex8 alpha down to hex6 — opacity is owned by the layer's
  // dedicated Opacity field, not by the color picker. The literal
  // `'transparent'` token is preserved as-is so it doesn't get sliced
  // into a meaningless 'transpa' string; downstream code keys off
  // value6 being empty to skip HSV/hex re-derivation.
  const value6 = value === 'transparent' ? '' : (value || '').slice(0, 7);
  const rgb = hexToRgb(value6);
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  const [h, setH] = useState(hsv.h);
  const [s, setS] = useState(hsv.s);
  const [v, setV] = useState(hsv.v);
  const [hex, setHex] = useState(value6);

  // Re-sync when external value changes (e.g. preset click via grid).
  useEffect(() => {
    if (value6 && value6.toLowerCase() !== hex.toLowerCase()) {
      const r = hexToRgb(value6);
      const o = rgbToHsv(r.r, r.g, r.b);
      setH(o.h); setS(o.s); setV(o.v);
      setHex(value6);
    }
  }, [value6]); // eslint-disable-line react-hooks/exhaustive-deps

  const emit = (h_, s_, v_) => {
    const { r, g, b } = hsvToRgb(h_, s_, v_);
    const next = rgbToHex(r, g, b);
    setHex(next);
    onChange(next);
  };

  // SV square drag
  const svRef = useRef(null);
  const draggingSv = useRef(false);
  const onSvPos = (e) => {
    const rect = svRef.current.getBoundingClientRect();
    const x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((e.clientY - rect.top) / rect.height, 0, 1);
    const ns = x;
    const nv = 1 - y;
    setS(ns); setV(nv);
    emit(h, ns, nv);
  };
  const onSvMouseDown = (e) => {
    draggingSv.current = true;
    onSvPos(e);
    const move = (ev) => draggingSv.current && onSvPos(ev);
    const up = () => {
      draggingSv.current = false;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const eyedrop = async () => {
    if (typeof window.EyeDropper === 'undefined') return;
    try {
      const ed = new window.EyeDropper();
      const res = await ed.open();
      onChange(res.sRGBHex);
    } catch { /* canceled */ }
  };

  const pickPreset = (c) => {
    onChange(c);
  };

  return (
    <div className="flex flex-col gap-2.5">
      {/* Preset rows */}
      <div className="flex flex-col gap-1">
        {PRESET_ROWS.map((row, i) => (
          <div key={i} className="flex gap-1">
            {i === 0 && allowNone && (
              <button
                type="button"
                onClick={onClear}
                className="h-5 w-7 rounded-sm border border-day-border dark:border-night-border text-[10px] font-medium text-day-muted dark:text-night-muted hover:border-[#84cc16]"
              >
                None
              </button>
            )}
            {row.map((c) => {
              const isActive =
                c === 'transparent'
                  ? value === 'transparent'
                  : value6.toLowerCase() === c.toLowerCase();
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => pickPreset(c)}
                  aria-label={c === 'transparent' ? 'Transparent' : c}
                  title={c === 'transparent' ? 'Transparent' : c}
                  className={cn(
                    'h-5 w-5 rounded-sm border transition-transform hover:scale-110 overflow-hidden',
                    isActive
                      ? 'border-[#84cc16] ring-2 ring-[#84cc16]/30'
                      : 'border-black/10 dark:border-white/10',
                  )}
                  style={swatchBgStyle(c)}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Hex */}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={hex}
          onChange={(e) => {
            const v_ = e.target.value;
            setHex(v_);
            if (isHex(v_)) onChange(v_.slice(0, 7));
          }}
          spellCheck={false}
          className={cn(
            'flex-1 rounded-md px-2 py-1 text-[12px] tabular-nums uppercase',
            'bg-day-bg dark:bg-night-bg',
            'border border-day-border dark:border-night-border',
            'text-day-text dark:text-night-text',
            'focus:outline-none focus:ring-2 focus:ring-[#84cc16]/40',
          )}
        />
        <span className="text-[12px] text-day-muted dark:text-night-muted">Hex</span>
      </div>

      {/* SV square */}
      <div
        ref={svRef}
        onMouseDown={onSvMouseDown}
        className="relative h-32 w-full rounded-md overflow-hidden cursor-crosshair"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${h},100%,50%))`,
        }}
      >
        <span
          className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
          style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%` }}
        />
      </div>

      {/* Hue slider + eyedropper */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={eyedrop}
          title="Pick color from page"
          className="h-6 w-6 inline-flex items-center justify-center rounded text-day-muted dark:text-night-muted hover:bg-day-bg dark:hover:bg-night-bg"
        >
          <Pipette className="h-3.5 w-3.5" />
        </button>
        <input
          type="range"
          min={0}
          max={360}
          value={h}
          onChange={(e) => {
            const nh = Number(e.target.value);
            setH(nh);
            emit(nh, s, v);
          }}
          className="flex-1 h-2 rounded-full appearance-none cursor-pointer"
          style={{
            background:
              'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
          }}
        />
      </div>
    </div>
  );
}

// ===========================================================================
// Other primitives
// ===========================================================================

function NumberSlider({ value, onChange, min, max, step = 1, format = (v) => v }) {
  return (
    <div className="flex items-center gap-2 flex-1 min-w-0">
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1 rounded-full appearance-none bg-day-border dark:bg-night-border accent-[#84cc16] cursor-pointer"
      />
      <span className="w-12 text-right tabular-nums text-[12px] text-day-text dark:text-night-text">
        {format(value)}
      </span>
    </div>
  );
}

function GeometryGlyph({ geometry, className }) {
  const Icon =
    geometry === 'point'
      ? CircleDot
      : geometry === 'line'
        ? Slash
        : geometry === 'raster'
          ? LayersIcon
          : Square;
  return <Icon className={className} aria-hidden />;
}

function Section({ title, children, action }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-day-text dark:text-night-text">{title}</span>
        {action ? <div className="ml-auto">{action}</div> : null}
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function Field({ label, children, action }) {
  return (
    <div className="grid grid-cols-[68px_1fr_auto] items-center gap-2">
      <span className="text-[12px] text-day-muted dark:text-night-muted capitalize">{label}</span>
      <div className="flex items-center gap-2 min-w-0">{children}</div>
      <div>{action ?? null}</div>
    </div>
  );
}

// Dropdown — small generic Listbox wrapper used for type/attribute pickers.
function Dropdown({ value, onChange, options, renderOption, renderTrigger, width = 'w-full' }) {
  return (
    <Listbox value={value ?? ''} onChange={onChange}>
      <div className={cn('relative', width)}>
        <Listbox.Button
          className={cn(
            'group flex w-full items-center gap-1.5 rounded-md',
            'border border-day-border dark:border-night-border',
            'bg-white dark:bg-night-bg',
            'px-2 py-1 text-left text-[12px]',
            'hover:border-[#84cc16]/60 transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-[#84cc16]/40',
          )}
        >
          <span className="flex-1 min-w-0 truncate">{renderTrigger(options.find((o) => o.id === value) ?? options[0])}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-day-muted dark:text-night-muted" />
        </Listbox.Button>
        <Transition as={Fragment} leave="transition ease-in duration-100" leaveFrom="opacity-100" leaveTo="opacity-0">
          <Listbox.Options
            anchor={{ to: 'bottom start', gap: 4 }}
            className={cn(
              // `!` makes the cap survive the anchor's inline max-height —
              // see the LayerSelector below for the full rationale.
              'z-[100] !max-h-64 w-[var(--button-width)] overflow-y-auto rounded-md py-1',
              'bg-white dark:bg-night-surface',
              'border border-day-border dark:border-night-border shadow-lg text-[12px] focus:outline-none',
            )}
          >
            {options.map((opt) => (
              <Listbox.Option
                key={opt.id}
                value={opt.id}
                className={({ active }) =>
                  cn(
                    'flex items-center gap-2 px-2 py-1 cursor-pointer select-none',
                    active ? 'bg-[#84cc16]/10' : '',
                  )
                }
              >
                {({ selected }) => (
                  <>
                    <span className="flex-1 min-w-0 truncate">{renderOption(opt)}</span>
                    {selected && <Check className="h-3 w-3 text-[#84cc16]" />}
                  </>
                )}
              </Listbox.Option>
            ))}
          </Listbox.Options>
        </Transition>
      </div>
    </Listbox>
  );
}

// ===========================================================================
// Type dropdown (top-level)
// ===========================================================================

const TYPE_OPTIONS = [
  { id: 'simple',     label: 'Simple',      hint: 'One paint for everything' },
  { id: 'categories', label: 'Categories',  hint: 'Color by attribute value' },
  { id: 'colorRange', label: 'Color range', hint: 'Color by numeric attribute' },
  { id: 'sizeRange',  label: 'Size range',  hint: 'Size by numeric attribute' },
  { id: 'heatmap',    label: 'Heatmap',     hint: 'Density over points', pointOnly: true },
];

function TypeDot({ type }) {
  const palette = {
    simple:    ['#84cc16', '#84cc16', '#84cc16'],
    categories:['#dc2626', '#facc15', '#3b82f6'],
    colorRange:['#fee08b', '#f97316', '#dc2626'],
    sizeRange: ['#84cc16', '#84cc16', '#84cc16'],
    heatmap:   ['#22c55e', '#facc15', '#dc2626'],
  }[type] || ['#84cc16'];
  return (
    <span className="inline-flex items-center gap-0.5">
      {palette.map((c, i) => (
        <span key={i} className={cn('inline-block h-1.5 w-1.5 rounded-full', i === 1 && 'h-2 w-2')} style={{ backgroundColor: c }} />
      ))}
    </span>
  );
}

function TypeDropdown({ geometry, value, onChange }) {
  const options = TYPE_OPTIONS.filter((o) => !o.pointOnly || geometry === 'point');
  return (
    <Dropdown
      value={value}
      onChange={onChange}
      options={options}
      renderTrigger={(opt) => (
        <span className="flex items-center gap-1.5">
          <TypeDot type={opt.id} />
          {opt.label}
        </span>
      )}
      renderOption={(opt) => (
        <span className="flex items-center gap-1.5">
          <TypeDot type={opt.id} />
          {opt.label}
        </span>
      )}
    />
  );
}

// ===========================================================================
// Zoom-styling toggle — adds an interpolate-by-zoom envelope around a
// numeric paint property. Click expands a popover with a felt-like dual-
// anchor slider that lets the user click an anchor and tweak its value.
// ===========================================================================

const ZOOM_MIN = 0;
const ZOOM_MAX = 22;

function ZoomConfigBody({ value, onChange, onDeactivate, min, max, step, format }) {
  const [active, setActive] = useState(1); // 1 → A (low zoom), 2 → B (high zoom)
  const trackRef = useRef(null);
  const z = active === 1 ? value.z1 : value.z2;
  const v = active === 1 ? value.v1 : value.v2;

  // Constraints — A's zoom must stay <= B's zoom AND A's value must stay
  // <= B's value (with one `step` between them so the interpolate is
  // strictly increasing — i.e., the user can't sneak the high anchor's
  // value below the low anchor's value).
  const setZ = (nz) => {
    const clamped = clamp(nz, ZOOM_MIN, ZOOM_MAX);
    if (active === 1) {
      onChange({ ...value, z1: Math.min(clamped, value.z2) });
    } else {
      onChange({ ...value, z2: Math.max(clamped, value.z1) });
    }
  };
  const setV = (nv) => {
    if (active === 1) {
      // A's value can't exceed B's value − step
      const cap = Math.max(min, value.v2 - step);
      onChange({ ...value, v1: clamp(nv, min, cap) });
    } else {
      // B's value can't drop below A's value + step
      const floor = Math.min(max, value.v1 + step);
      onChange({ ...value, v2: clamp(nv, floor, max) });
    }
  };

  // Active value's effective slider min/max — disables sliding past the
  // partner anchor's value.
  const valueMin = active === 1 ? min : Math.min(max, value.v1 + step);
  const valueMax = active === 1 ? Math.max(min, value.v2 - step) : max;

  // Drag handler — clicking or dragging the track re-positions the active
  // anchor's zoom. Snaps to 0.5 zoom increments, same granularity as the
  // value slider.
  const onTrackPointerDown = (e) => {
    if (!trackRef.current) return;
    e.preventDefault();
    const update = (clientX) => {
      const rect = trackRef.current.getBoundingClientRect();
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      const raw = ZOOM_MIN + ratio * (ZOOM_MAX - ZOOM_MIN);
      setZ(Math.round(raw * 2) / 2);
    };
    update(e.clientX);
    const move = (ev) => update(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Visual preview — two dots sized proportionally to v1/v2.
  const maxDot = 18;
  const minDot = 4;
  const span = Math.max(0.001, max - min);
  const sizeAt = (val) => minDot + ((val - min) / span) * (maxDot - minDot);

  const pos = (zoom) =>
    `${((zoom - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)) * 100}%`;

  // Anchor bar — small vertical bar instead of a circle, to match the
  // tick-style markers shown in Felt's UI.
  const Bar = ({ isActive, onSelect, label }) => (
    <button
      type="button"
      onClick={onSelect}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={label}
      className={cn(
        'absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center',
        'cursor-pointer',
      )}
    >
      <span
        className={cn(
          'block w-1 rounded-sm transition-all',
          isActive
            ? 'h-5 bg-[#84cc16] shadow-[0_0_0_3px_rgba(132,204,22,0.18)]'
            : 'h-4 bg-[#84cc16]/60 hover:bg-[#84cc16]',
        )}
      />
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center">
        <span className="text-[12px] font-semibold">Zoom-driven</span>
        <button
          type="button"
          onClick={onDeactivate}
          className="ml-auto text-[11px] text-day-muted dark:text-night-muted hover:text-red-500"
        >
          Remove
        </button>
      </div>

      {/* Visual preview */}
      <div className="flex items-end justify-between px-1 pb-2 border-b border-day-border/60 dark:border-night-border/60">
        <div className="flex flex-col items-center gap-1">
          <span
            className="rounded-full bg-[#84cc16]"
            style={{ width: sizeAt(value.v1), height: sizeAt(value.v1) }}
          />
          <span className="text-[11px] tabular-nums text-day-muted dark:text-night-muted">
            {format(value.v1)}
          </span>
        </div>
        <div className="flex-1 mx-2 mb-1.5 h-px bg-gradient-to-r from-[#84cc16]/30 via-[#84cc16]/30 to-[#84cc16]/30" />
        <div className="flex flex-col items-center gap-1">
          <span
            className="rounded-full bg-[#84cc16]"
            style={{ width: sizeAt(value.v2), height: sizeAt(value.v2) }}
          />
          <span className="text-[11px] tabular-nums text-day-muted dark:text-night-muted">
            {format(value.v2)}
          </span>
        </div>
      </div>

      {/* Zoom range track — click or drag to re-position the active anchor */}
      <div>
        <div className="flex items-center justify-between mb-1 text-[11px] text-day-muted dark:text-night-muted">
          <span>z {ZOOM_MIN}</span>
          <span>Zoom range</span>
          <span>z {ZOOM_MAX}</span>
        </div>
        <div
          ref={trackRef}
          onPointerDown={onTrackPointerDown}
          className="relative h-7 cursor-pointer select-none"
        >
          {/* track */}
          <span className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-day-border dark:bg-night-border" />
          {/* active range */}
          <span
            className="pointer-events-none absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-[#84cc16]/50"
            style={{ left: pos(value.z1), right: `calc(100% - ${pos(value.z2)})` }}
          />
          {/* anchor A */}
          <span style={{ left: pos(value.z1), position: 'absolute', top: '50%', transform: 'translate(-50%, -50%)' }}>
            <Bar isActive={active === 1} onSelect={() => setActive(1)} label="Edit anchor A" />
          </span>
          {/* anchor B */}
          <span style={{ left: pos(value.z2), position: 'absolute', top: '50%', transform: 'translate(-50%, -50%)' }}>
            <Bar isActive={active === 2} onSelect={() => setActive(2)} label="Edit anchor B" />
          </span>
        </div>
        {/* Anchor zoom labels under the track */}
        <div className="relative h-3 mt-0.5">
          <span
            className={cn(
              'absolute -translate-x-1/2 text-[10px] tabular-nums',
              active === 1 ? 'text-[#84cc16] font-semibold' : 'text-day-muted dark:text-night-muted',
            )}
            style={{ left: pos(value.z1) }}
          >
            {value.z1}
          </span>
          <span
            className={cn(
              'absolute -translate-x-1/2 text-[10px] tabular-nums',
              active === 2 ? 'text-[#84cc16] font-semibold' : 'text-day-muted dark:text-night-muted',
            )}
            style={{ left: pos(value.z2) }}
          >
            {value.z2}
          </span>
        </div>
      </div>

      {/* Selected anchor config */}
      <div className="rounded-md bg-day-bg/60 dark:bg-night-bg/60 px-2.5 py-2">
        <div className="mb-1.5 flex items-center gap-1">
          <span className="text-[11px] font-semibold text-[#84cc16]">
            Styling zoom {z}
          </span>
          <span className="ml-auto text-[11px] text-day-muted dark:text-night-muted">
            anchor {active === 1 ? 'A' : 'B'}
          </span>
        </div>
        <label className="flex items-center gap-2">
          <span className="w-10 text-[11px] text-day-muted dark:text-night-muted">Zoom</span>
          <input
            type="range"
            min={active === 1 ? ZOOM_MIN : value.z1}
            max={active === 1 ? value.z2 : ZOOM_MAX}
            step={0.5}
            value={z}
            onChange={(e) => setZ(Number(e.target.value))}
            className="flex-1 h-1 rounded-full appearance-none bg-day-border dark:bg-night-border accent-[#84cc16] cursor-pointer"
          />
          <span className="w-8 text-right tabular-nums text-[12px]">{z}</span>
        </label>
        <label className="mt-1.5 flex items-center gap-2">
          <span className="w-10 text-[11px] text-day-muted dark:text-night-muted">Value</span>
          <input
            type="range"
            min={valueMin}
            max={valueMax}
            step={step}
            value={v}
            onChange={(e) => setV(Number(e.target.value))}
            className="flex-1 h-1 rounded-full appearance-none bg-day-border dark:bg-night-border accent-[#84cc16] cursor-pointer"
          />
          <span className="w-12 text-right tabular-nums text-[12px]">{format(v)}</span>
        </label>
      </div>
    </div>
  );
}

function ZoomToggle({ active, value, onActivate, onDeactivate, onChange, min, max, step = 0.5, format = (v) => v }) {
  return (
    <Popover className="relative">
      {() => (
        <>
          <Popover.Button
            onClick={(e) => {
              if (!active) { e.preventDefault(); onActivate(); }
            }}
            title={active ? 'Zoom styling on' : 'Add zoom styling'}
            className={cn(
              'inline-flex h-6 w-6 items-center justify-center rounded',
              'border border-day-border dark:border-night-border',
              active
                ? 'bg-[#84cc16]/15 text-[#84cc16] border-[#84cc16]/40'
                : 'text-day-muted dark:text-night-muted hover:text-[#84cc16]',
            )}
          >
            <ArrowLeftRight className="h-3 w-3" />
          </Popover.Button>
          {active && (
            <Transition as={Fragment} enter="transition ease-out duration-100"
              enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100">
              <Popover.Panel
                anchor={{ to: 'bottom end', gap: 6 }}
                className={cn(
                  'z-[100] w-[280px] rounded-lg p-3',
                  'bg-white dark:bg-night-surface',
                  'border border-day-border dark:border-night-border shadow-xl',
                )}
              >
                <ZoomConfigBody
                  value={value}
                  onChange={onChange}
                  onDeactivate={onDeactivate}
                  min={min}
                  max={max}
                  step={step}
                  format={format}
                />
              </Popover.Panel>
            </Transition>
          )}
        </>
      )}
    </Popover>
  );
}

// ===========================================================================
// Categories editor — palette swatch + per-category color list popover.
// ===========================================================================

function CategoricalPaletteSwatch({ paletteId, onChange }) {
  const palette = paletteById(paletteId);
  return (
    <Popover className="relative flex-1">
      {() => (
        <>
          <Popover.Button
            className={cn(
              'flex w-full items-center gap-1 rounded-md',
              'border border-day-border dark:border-night-border',
              'bg-white dark:bg-night-bg',
              'px-1 py-1 text-[12px]',
              'hover:border-[#84cc16]/60 transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-[#84cc16]/40',
            )}
          >
            <div className="flex flex-1 h-4 overflow-hidden rounded-sm">
              {palette.colors.map((c) => (
                <span key={c} className="flex-1" style={{ backgroundColor: c }} />
              ))}
            </div>
            <ChevronDown className="h-3 w-3 text-day-muted dark:text-night-muted" />
          </Popover.Button>
          <Transition as={Fragment} enter="transition ease-out duration-100"
            enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100">
            <Popover.Panel
              anchor={{ to: 'bottom end', gap: 6 }}
              className={cn(
                'z-[100] w-[320px] max-h-[420px] overflow-y-auto rounded-lg p-2',
                'bg-white dark:bg-night-surface',
                'border border-day-border dark:border-night-border shadow-xl',
              )}
            >
              <div className="flex flex-col gap-1">
                {CATEGORICAL_PALETTES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onChange(p.id)}
                    className={cn(
                      'flex items-center gap-2 rounded p-1 text-left transition-colors',
                      p.id === paletteId ? 'bg-[#84cc16]/10' : 'hover:bg-day-bg dark:hover:bg-night-bg',
                    )}
                  >
                    {/* Bar widened, label forced single-line — same fix
                        as the ramp swatch so neither popover wraps. */}
                    <div className="flex h-4 w-28 shrink-0 overflow-hidden rounded-sm">
                      {p.colors.map((c) => (
                        <span key={c} className="flex-1" style={{ backgroundColor: c }} />
                      ))}
                    </div>
                    <span className="text-[13px] whitespace-nowrap min-w-0 truncate">
                      {p.label}
                    </span>
                  </button>
                ))}
              </div>
            </Popover.Panel>
          </Transition>
        </>
      )}
    </Popover>
  );
}

function CategoryList({ categories, otherColor, showOther, onChange }) {
  return (
    <div className="rounded-md border border-day-border dark:border-night-border bg-day-bg/40 dark:bg-night-bg/40 p-2">
      <div className="flex items-center gap-2 pb-1.5 mb-1.5 border-b border-day-border/60 dark:border-night-border/60">
        <span className="text-[12px] font-semibold">Set categories</span>
        <label className="ml-auto inline-flex items-center gap-1 text-[11px] text-day-muted dark:text-night-muted cursor-pointer">
          <span>Show other</span>
          <Switch
            checked={showOther}
            onChange={(v) => onChange({ showOther: v })}
            className={cn(
              'relative inline-flex h-3.5 w-7 items-center rounded-full transition-colors',
              showOther ? 'bg-[#84cc16]' : 'bg-day-border dark:bg-night-border',
            )}
          >
            <span
              className={cn(
                'inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform',
                showOther ? 'translate-x-3.5' : 'translate-x-0.5',
              )}
            />
          </Switch>
        </label>
      </div>
      <div className="flex flex-col gap-1 max-h-48 overflow-y-auto pr-1">
        {categories.map((c, i) => (
          <div key={`${c.value}:${i}`} className="flex items-center gap-1.5">
            <ColorButton
              value={c.color}
              onChange={(nc) => {
                const next = categories.map((x, j) => (j === i ? { ...x, color: nc } : x));
                onChange({ categories: next });
              }}
              ariaLabel={`Color for ${c.value}`}
            />
            <span className="flex-1 truncate text-[12px]">{c.value}</span>
          </div>
        ))}
        {showOther && (
          <div className="flex items-center gap-1.5 mt-1 pt-1.5 border-t border-day-border/60 dark:border-night-border/60">
            <ColorButton
              value={otherColor}
              onChange={(nc) => onChange({ otherColor: nc })}
              ariaLabel="Other color"
            />
            <span className="flex-1 text-[12px] text-day-muted dark:text-night-muted">Other</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Color-range ramp swatch
// ===========================================================================

function RampSwatch({ rampId, reversed, classCount, onChangeRamp, onToggleReverse }) {
  const ramp = rampById(rampId);
  const stops = reversed ? [...ramp.stops].reverse() : ramp.stops;
  const discrete = Number.isFinite(classCount) && classCount >= 2;
  const discreteColors = discrete ? sampleRampColors(stops, classCount) : null;
  return (
    <Popover className="relative flex-1">
      {() => (
        <>
          <Popover.Button
            className={cn(
              'flex w-full items-center gap-1 rounded-md',
              'border border-day-border dark:border-night-border',
              'bg-white dark:bg-night-bg',
              'px-1 py-1 text-[12px]',
              'hover:border-[#84cc16]/60 transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-[#84cc16]/40',
            )}
          >
            {discrete ? (
              <div className="flex flex-1 h-4 overflow-hidden rounded-sm">
                {discreteColors.map((c, i) => (
                  <span key={`${c}:${i}`} className="flex-1" style={{ backgroundColor: c }} />
                ))}
              </div>
            ) : (
              <div
                className="flex-1 h-4 rounded-sm"
                style={{ background: `linear-gradient(to right, ${stops.join(', ')})` }}
              />
            )}
            <ChevronDown className="h-3 w-3 text-day-muted dark:text-night-muted" />
          </Popover.Button>
          <Transition as={Fragment} enter="transition ease-out duration-100"
            enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100">
            <Popover.Panel
              anchor={{ to: 'bottom end', gap: 6 }}
              className={cn(
                'z-[100] w-[320px] max-h-[420px] overflow-y-auto rounded-lg p-2',
                'bg-white dark:bg-night-surface',
                'border border-day-border dark:border-night-border shadow-xl',
              )}
            >
              <div className="flex flex-col gap-1">
                {(() => {
                  // Group by `category` (Sequential / Single hue / Multi-hue
                  // / Diverging) so a long ramp list stays scannable. Falls
                  // through to a single "Other" group for entries without
                  // an explicit category.
                  const groups = [];
                  const idx = new Map();
                  for (const r of COLOR_RAMPS) {
                    const cat = r.category || 'Other';
                    if (!idx.has(cat)) {
                      idx.set(cat, groups.length);
                      groups.push({ category: cat, items: [] });
                    }
                    groups[idx.get(cat)].items.push(r);
                  }
                  return groups.map((g) => (
                    <div key={g.category} className="flex flex-col">
                      <div className="px-1 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-day-muted dark:text-night-muted">
                        {g.category}
                      </div>
                      {g.items.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => onChangeRamp(r.id)}
                          className={cn(
                            'flex items-center gap-2 rounded p-1 text-left transition-colors',
                            r.id === rampId ? 'bg-[#84cc16]/10' : 'hover:bg-day-bg dark:hover:bg-night-bg',
                          )}
                        >
                          {/* Bar widened + label single-line — earlier
                              "Red → Yellow → Green" wrapped because the
                              row was too narrow. `whitespace-nowrap` is
                              the alignment fix; min-w-0 + truncate keeps
                              future long labels from overflowing. */}
                          <div
                            className="h-4 w-28 shrink-0 rounded-sm"
                            style={{ background: `linear-gradient(to right, ${r.stops.join(', ')})` }}
                          />
                          <span className="text-[13px] whitespace-nowrap min-w-0 truncate">
                            {r.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  ));
                })()}
                <button
                  type="button"
                  onClick={onToggleReverse}
                  className="mt-1 inline-flex items-center justify-center gap-1.5 rounded border border-day-border dark:border-night-border px-2 py-1 text-[13px] text-day-text dark:text-night-text hover:bg-day-bg dark:hover:bg-night-bg"
                >
                  <ArrowLeftRight className="h-3 w-3" /> Reverse colors
                </button>
              </div>
            </Popover.Panel>
          </Transition>
        </>
      )}
    </Popover>
  );
}

// ===========================================================================
// Attribute picker
// ===========================================================================

function AttributePicker({ attrs, value, onChange, filter = 'any' }) {
  const filtered = attrs.filter((a) => filter === 'any' || a.kind === filter);
  const opts = filtered.length
    ? filtered.map((a) => ({ id: a.name, name: a.name, sample: a.sample }))
    : [{ id: '', name: '— no attributes —', sample: [] }];
  return (
    <Dropdown
      value={value}
      onChange={(v) => onChange(v || null)}
      options={opts}
      renderTrigger={(opt) => <span className="truncate">{opt?.name || 'Select attribute'}</span>}
      renderOption={(opt) => (
        <span className="flex flex-col">
          <span className="text-[12px]">{opt.name}</span>
          {opt.sample?.length ? (
            <span className="text-[10px] text-day-muted dark:text-night-muted truncate">
              {opt.sample.slice(0, 4).join(', ')}
            </span>
          ) : null}
        </span>
      )}
    />
  );
}

// ===========================================================================
// Layer selector (top of panel)
// ===========================================================================

function LayerSelector({ groups, selectedId, onSelect }) {
  const flat = flatten(groups);
  const selected = flat.find((l) => l.id === selectedId) ?? null;
  return (
    <Listbox value={selectedId ?? ''} onChange={onSelect}>
      <div className="relative">
        <Listbox.Button
          className={cn(
            'group flex w-full items-center gap-2 rounded-md',
            'border border-day-border dark:border-night-border',
            'bg-white dark:bg-night-bg',
            'px-2.5 py-1.5 text-left text-[13px]',
            'hover:border-[#84cc16]/60 transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-[#84cc16]/40',
          )}
        >
          {selected ? (
            <>
              <GeometryGlyph geometry={selected.geometry} className="h-3.5 w-3.5 shrink-0 text-[#84cc16]" />
              <span className="flex-1 min-w-0">
                <TruncateLabel
                  text={
                    selected.regionLabel
                      ? `${selected.regionLabel} · ${selected.layerLabel}`
                      : selected.layerLabel
                  }
                />
              </span>
            </>
          ) : (
            <>
              <LayersIcon className="h-3.5 w-3.5 shrink-0 text-day-muted dark:text-night-muted" />
              <span className="flex-1 text-day-muted dark:text-night-muted">
                {flat.length === 0 ? 'No layers loaded' : 'Select a layer…'}
              </span>
            </>
          )}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-day-muted dark:text-night-muted group-hover:text-[#84cc16] transition-colors" />
        </Listbox.Button>
        <Transition as={Fragment} leave="transition ease-in duration-100" leaveFrom="opacity-100" leaveTo="opacity-0">
          <Listbox.Options
            anchor={{ to: 'bottom start', gap: 4 }}
            // Headless UI's `anchor` sets an inline `max-height` to "all
            // remaining viewport space below the trigger." With 20+ layers
            // that's tall enough to spill off-screen at small windows.
            // The `!` modifier promotes our cap to `!important` so it
            // beats the inline style. Same pattern is used on the second
            // Listbox below.
            className={cn(
              'z-[100] box-border !max-h-72 w-[var(--button-width)] max-w-[var(--button-width)]',
              'overflow-y-auto overflow-x-hidden rounded-md py-1',
              'bg-white dark:bg-night-surface',
              'border border-day-border dark:border-night-border shadow-lg focus:outline-none text-[13px]',
            )}
          >
            {groups.length === 0 ? (
              <div className="px-3 py-2 text-day-muted dark:text-night-muted">
                No layers available — toggle a layer on first.
              </div>
            ) : groups.map((g) => (
              <div key={g.name} className="min-w-0">
                <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-day-muted dark:text-night-muted truncate">
                  {g.name}
                </div>
                {g.items.map((item) => (
                  <Listbox.Option
                    key={item.id}
                    value={item.id}
                    className={({ active, selected }) =>
                      cn(
                        'flex items-center gap-2 px-2.5 py-1.5 cursor-pointer select-none min-w-0',
                        // Selected row carries a persistent light-lime
                        // wash so the user can see which layer the
                        // panel is editing without a trailing tick.
                        // Keyboard/hover `active` is a fainter wash and
                        // only shows when the row isn't the selected one.
                        selected
                          ? 'bg-[#a3e635]/20'
                          : active
                            ? 'bg-[#84cc16]/10'
                            : '',
                      )
                    }
                  >
                    {() => (
                      <>
                        <GeometryGlyph
                          geometry={item.geometry}
                          className={cn('h-3 w-3 shrink-0',
                            item.visible ? 'text-[#84cc16]' : 'text-day-muted dark:text-night-muted')}
                        />
                        <span className="flex-1 min-w-0">
                          <TruncateLabel
                            text={
                              item.regionLabel
                                ? `${item.regionLabel} · ${item.layerLabel}`
                                : item.layerLabel
                            }
                          />
                        </span>
                        {/* Visibility tag: lime "visible" pill when the
                            layer is currently on, muted "hidden" pill
                            otherwise. Both stay shrink-0 so a long
                            layer label truncates against them rather
                            than pushing them off the row. */}
                        <span
                          className={cn(
                            'shrink-0 text-[10px] font-semibold uppercase tracking-wider',
                            item.visible
                              ? 'text-[#a3e635]'
                              : 'text-day-muted/70 dark:text-night-muted/70',
                          )}
                        >
                          {item.visible ? 'visible' : 'hidden'}
                        </span>
                      </>
                    )}
                  </Listbox.Option>
                ))}
              </div>
            ))}
          </Listbox.Options>
        </Transition>
      </div>
    </Listbox>
  );
}

// ===========================================================================
// Raster style form — colormap + opacity + min/max stretch.
// ===========================================================================

function RasterStyleForm({ groups, selectedId, onSelect }) {
  const { groups: rasterGroups, setGroupStyle } = useRasters();
  const group = rasterGroups.find((g) => g.id === selectedId);
  if (!group) {
    // Selected layer was a raster but is no longer present — surface a
    // soft state instead of crashing the panel.
    return (
      <div className="flex flex-col h-full -mx-3 -my-3">
        <div className="flex-1 min-h-0 overflow-y-auto px-3 pt-3 pb-3 flex flex-col gap-2.5">
          <LayerSelector groups={groups} selectedId={selectedId} onSelect={onSelect} />
        </div>
      </div>
    );
  }

  const style = group.style ?? {};
  const setStyle = (partial) => setGroupStyle(group.id, partial);
  const colormaps = listColormaps();
  const auto = style.autoStretch !== false;
  const dataMin = group.dataStats?.dataMin;
  const dataMax = group.dataStats?.dataMax;
  const uniqueValues = group.dataStats?.uniqueValues ?? null;
  const mode = style.mode === 'classified' ? 'classified' : 'continuous';
  // Pre-fill manual inputs from the data range if user-provided values
  // aren't set yet (typical when toggling auto → manual).
  const minVal = style.min ?? (Number.isFinite(dataMin) ? dataMin : '');
  const maxVal = style.max ?? (Number.isFinite(dataMax) ? dataMax : '');

  // Switching to classified pre-fills the class list from the data's
  // unique values (using a categorical palette) the first time, so
  // the user sees immediate feedback instead of an empty editor.
  // Subsequent toggles back-and-forth preserve whatever the user has
  // already authored.
  const switchToClassified = () => {
    let classes = Array.isArray(style.classes) ? style.classes : [];
    if (classes.length === 0 && Array.isArray(uniqueValues) && uniqueValues.length > 0) {
      const palette = paletteById('set2')?.colors ?? ['#66c2a5', '#fc8d62', '#8da0cb', '#e78ac3', '#a6d854'];
      classes = uniqueValues.map((v, i) => ({
        value: v,
        color: palette[i % palette.length],
      }));
    }
    setStyle({ mode: 'classified', classes });
  };

  return (
    <div className="flex flex-col h-full -mx-3 -my-3">
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pt-3 pb-3 flex flex-col gap-3.5">
        <LayerSelector groups={groups} selectedId={selectedId} onSelect={onSelect} />

        <Section title="Mode">
          <div className="inline-flex w-full rounded-md border border-day-border dark:border-night-border overflow-hidden">
            <button
              type="button"
              onClick={() => setStyle({ mode: 'continuous' })}
              className={cn(
                'flex-1 px-2 py-1 text-[12px] transition-colors',
                mode === 'continuous'
                  ? 'bg-[#84cc16] text-[#1a2e05]'
                  : 'text-day-muted dark:text-night-muted hover:bg-day-bg dark:hover:bg-night-bg',
              )}
            >
              Continuous
            </button>
            <button
              type="button"
              onClick={switchToClassified}
              className={cn(
                'flex-1 px-2 py-1 text-[12px] transition-colors border-l border-day-border dark:border-night-border',
                mode === 'classified'
                  ? 'bg-[#84cc16] text-[#1a2e05]'
                  : 'text-day-muted dark:text-night-muted hover:bg-day-bg dark:hover:bg-night-bg',
              )}
            >
              Classified
            </button>
          </div>
          <p className="text-[11px] text-day-muted dark:text-night-muted px-1">
            {mode === 'classified'
              ? 'Discrete value → colour lookup. Best for reclassified rasters (risk levels, land cover, hazard zones).'
              : 'Min/max stretch through a colour ramp. Best for continuous data (temperature, elevation, NDVI).'}
          </p>
        </Section>

        {mode === 'continuous' ? (
          <>
            <Section title="Colormap">
              <Field label="Preset">
                <ColormapDropdown
                  options={colormaps}
                  value={style.colormap || 'viridis'}
                  onChange={(id) => setStyle({ colormap: id })}
                />
              </Field>
            </Section>

            <Section title="Range">
              <Field label="Stretch">
                <div className="inline-flex w-full rounded-md border border-day-border dark:border-night-border overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setStyle({ autoStretch: true })}
                    className={cn(
                      'flex-1 px-2 py-1 text-[12px] transition-colors',
                      auto
                        ? 'bg-[#84cc16] text-[#1a2e05]'
                        : 'text-day-muted dark:text-night-muted hover:bg-day-bg dark:hover:bg-night-bg',
                    )}
                  >
                    Auto
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setStyle({
                        autoStretch: false,
                        min: Number.isFinite(dataMin) ? dataMin : 0,
                        max: Number.isFinite(dataMax) ? dataMax : 1,
                      })
                    }
                    className={cn(
                      'flex-1 px-2 py-1 text-[12px] transition-colors border-l border-day-border dark:border-night-border',
                      !auto
                        ? 'bg-[#84cc16] text-[#1a2e05]'
                        : 'text-day-muted dark:text-night-muted hover:bg-day-bg dark:hover:bg-night-bg',
                    )}
                  >
                    Manual
                  </button>
                </div>
              </Field>
              <Field label="Min">
                <input
                  type="number"
                  value={auto ? '' : minVal}
                  placeholder={Number.isFinite(dataMin) ? String(dataMin) : '—'}
                  disabled={auto}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setStyle({ min: Number.isFinite(n) ? n : null });
                  }}
                  className="w-full rounded-md border border-day-border dark:border-night-border bg-day-bg dark:bg-night-bg text-[12px] px-2 py-1 text-day-text dark:text-night-text disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#84cc16]/40"
                />
              </Field>
              <Field label="Max">
                <input
                  type="number"
                  value={auto ? '' : maxVal}
                  placeholder={Number.isFinite(dataMax) ? String(dataMax) : '—'}
                  disabled={auto}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setStyle({ max: Number.isFinite(n) ? n : null });
                  }}
                  className="w-full rounded-md border border-day-border dark:border-night-border bg-day-bg dark:bg-night-bg text-[12px] px-2 py-1 text-day-text dark:text-night-text disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#84cc16]/40"
                />
              </Field>
              {auto && (Number.isFinite(dataMin) || Number.isFinite(dataMax)) ? (
                <p className="text-[11px] text-day-muted dark:text-night-muted px-1">
                  Auto stretch ·{' '}
                  <span className="tabular-nums text-day-text dark:text-night-text">
                    {Number.isFinite(dataMin) ? niceNumber(dataMin) : '—'}
                  </span>{' '}
                  →{' '}
                  <span className="tabular-nums text-day-text dark:text-night-text">
                    {Number.isFinite(dataMax) ? niceNumber(dataMax) : '—'}
                  </span>
                </p>
              ) : null}
            </Section>
          </>
        ) : (
          <ClassifiedEditor
            classes={Array.isArray(style.classes) ? style.classes : []}
            uniqueValues={uniqueValues}
            onChange={(classes) => setStyle({ classes })}
          />
        )}

        <Section title="No data">
          <NoDataEditor
            color={style.noDataColor ?? null}
            opacity={style.noDataOpacity ?? 1}
            onChange={(partial) => setStyle(partial)}
          />
        </Section>

        <Section title="Appearance">
          <Field label="Opacity">
            <NumberSlider
              value={style.opacity ?? 1}
              onChange={(v) => setStyle({ opacity: v })}
              min={0}
              max={1}
              step={0.05}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </Field>
        </Section>
      </div>

      <div className="shrink-0 flex items-center justify-between border-t border-day-border dark:border-night-border bg-white dark:bg-night-surface px-3 py-2.5">
        <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] text-day-muted dark:text-night-muted">
          <GeometryGlyph geometry="raster" className="h-3 w-3 text-[#84cc16]" />
          raster {group.kind === 'temporal' ? 'series' : 'layer'}
        </span>
        <button
          type="button"
          onClick={() =>
            setGroupStyle(group.id, {
              mode: 'continuous',
              colormap: 'viridis',
              opacity: 1,
              autoStretch: true,
              min: null,
              max: null,
              classes: [],
              noDataColor: null,
              noDataOpacity: 1,
            })
          }
          className="inline-flex items-center gap-1 text-[12px] text-day-muted dark:text-night-muted hover:text-[#84cc16] transition-colors"
        >
          <RotateCcw className="h-3 w-3" />
          Reset
        </button>
      </div>
    </div>
  );
}

// Curated palette for the custom colour picker's preset grid. Hand-
// picked to cover the workflows the dashboard actually sees (risk /
// hazard levels in saturated reds-to-greens, terrain / land cover in
// earth tones, plus a row of greys for masks and outlines). The
// colours are laid out in a 12-wide grid so the popover stays compact.
const PICKER_PRESETS = [
  // Saturated hues — risk / hazard / classification colours
  '#dc2626', '#ea580c', '#d97706', '#ca8a04', '#65a30d', '#16a34a',
  '#0891b2', '#0284c7', '#2563eb', '#7c3aed', '#c026d3', '#db2777',
  // Pastel / lighter variants for layered overlays
  '#fca5a5', '#fdba74', '#fcd34d', '#fde68a', '#bef264', '#86efac',
  '#67e8f9', '#7dd3fc', '#93c5fd', '#c4b5fd', '#f0abfc', '#f9a8d4',
  // Earth tones / land cover-ish
  '#78350f', '#92400e', '#854d0e', '#3f6212', '#166534', '#115e59',
  // Greyscale ramp — black through white in even steps, plus a
  // transparent slot rendered as a checker pattern. The literal
  // `'transparent'` is a valid Mapbox paint colour, so picking this
  // swatch zeroes out a fill or stroke without touching the layer's
  // opacity slider.
  '#000000', '#1f2937', '#4b5563', '#9ca3af', '#e5e7eb', '#ffffff',
  'transparent',
];

const HEX_REGEX = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;

// Compact, Popover-anchored colour swatch + picker. The swatch button
// itself is the same h-6 w-7 footprint the native `<input type="color">`
// produced, so existing row layouts don't shift. Clicking it opens a
// portal'd panel with a HEX input auto-focused for keyboard entry plus
// a preset grid for one-click selection. The HEX input commits on
// every valid 3- or 6-char hex; partially-typed values stay local
// without firing onChange so the parent layer's cache doesn't churn
// on every keystroke.
function ColorSwatch({ value, onChange, ariaLabel = 'Pick colour' }) {
  const safeValue = value || '#000000';
  const [hexInput, setHexInput] = useState(safeValue);
  // Sync local input when the value changes externally (e.g. user
  // picked a swatch, or some other code path edited the colour).
  useEffect(() => {
    setHexInput(safeValue);
  }, [safeValue]);

  const commitHex = (raw) => {
    const m = HEX_REGEX.exec(String(raw).trim());
    if (!m) return;
    let hex = m[1];
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    onChange(`#${hex.toLowerCase()}`);
  };

  return (
    <Popover className="relative">
      <Popover.Button
        type="button"
        aria-label={ariaLabel}
        title={ariaLabel}
        className={cn(
          'h-6 w-7 shrink-0 rounded border border-day-border dark:border-night-border overflow-hidden',
          'cursor-pointer transition-shadow',
          'hover:ring-2 hover:ring-[#84cc16]/40 focus:outline-none focus:ring-2 focus:ring-[#84cc16]/60',
        )}
        style={swatchBgStyle(safeValue)}
      />
      <Transition
        as={Fragment}
        enter="transition duration-100 ease-out"
        enterFrom="opacity-0 scale-95"
        enterTo="opacity-100 scale-100"
        leave="transition duration-75 ease-in"
        leaveFrom="opacity-100 scale-100"
        leaveTo="opacity-0 scale-95"
      >
        <Popover.Panel
          anchor={{ to: 'bottom start', gap: 6 }}
          className={cn(
            'z-[120] w-[260px] rounded-lg p-3',
            'bg-white dark:bg-night-surface',
            'border border-day-border dark:border-night-border shadow-xl',
            'focus:outline-none',
          )}
        >
          {({ close }) => (
            <div className="flex flex-col gap-3">
              {/* HEX entry — auto-focused so the keyboard is ready
                  for direct entry the moment the panel opens. */}
              <div>
                <span className="block text-[10px] uppercase tracking-[0.08em] text-day-muted dark:text-night-muted mb-1">
                  Hex
                </span>
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="h-9 w-9 shrink-0 rounded-md border border-day-border dark:border-night-border overflow-hidden"
                    style={swatchBgStyle(hexInput)}
                  />
                  <input
                    type="text"
                    value={hexInput}
                    autoFocus
                    spellCheck={false}
                    maxLength={7}
                    onChange={(e) => {
                      const v = e.target.value;
                      setHexInput(v);
                      commitHex(v);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        commitHex(hexInput);
                        close();
                      } else if (e.key === 'Escape') {
                        close();
                      }
                    }}
                    onBlur={() => setHexInput(value || '#000000')}
                    className={cn(
                      'box-border w-full rounded-md border px-2 py-1.5 text-[13px] font-mono uppercase tabular-nums',
                      'bg-day-bg dark:bg-night-bg',
                      'border-day-border dark:border-night-border',
                      'text-day-text dark:text-night-text placeholder:text-day-muted',
                      'focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#84cc16]/40',
                    )}
                  />
                </div>
              </div>

              {/* Preset swatch grid — one-click colour selection */}
              <div>
                <span className="block text-[10px] uppercase tracking-[0.08em] text-day-muted dark:text-night-muted mb-1.5">
                  Presets
                </span>
                <div className="grid grid-cols-12 gap-1">
                  {PICKER_PRESETS.map((c) => {
                    const active = c.toLowerCase() === (value || '').toLowerCase();
                    const label = c === 'transparent' ? 'Transparent' : c;
                    return (
                      <button
                        key={c}
                        type="button"
                        title={label}
                        aria-label={label}
                        onClick={() => {
                          onChange(c);
                          close();
                        }}
                        className={cn(
                          'aspect-square rounded transition-transform hover:scale-110 overflow-hidden',
                          'border',
                          active
                            ? 'ring-2 ring-[#84cc16] ring-offset-1 ring-offset-white dark:ring-offset-night-surface border-transparent'
                            : 'border-black/10 dark:border-white/15',
                        )}
                        style={swatchBgStyle(c)}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </Popover.Panel>
      </Transition>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Inline background-colour picker for the marker popover.
//
// Why not the regular ColorSwatch (Popover-based)? Headless UI's
// outside-click detection treats sibling portaled panels as
// "outside" each other — so opening the swatch's popover from inside
// the marker popover dismisses the marker popover entirely, and the
// user loses their icon-grid view. Rendering the picker inline means
// no nested popovers, no dismissal, and it stays compact enough to
// share the marker-popover's panel.
// ---------------------------------------------------------------------------
function InlineBgPicker({ value, explicit, onChange, onReset }) {
  const [hexInput, setHexInput] = useState(value);
  useEffect(() => {
    setHexInput(value);
  }, [value]);

  const commitHex = (raw) => {
    const m = HEX_REGEX.exec(String(raw).trim());
    if (!m) return;
    let hex = m[1];
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    onChange(`#${hex.toLowerCase()}`);
  };

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-day-muted dark:text-night-muted shrink-0">
          Background
        </span>
        <span
          aria-hidden
          className="h-5 w-5 shrink-0 rounded border border-day-border dark:border-night-border overflow-hidden"
          style={swatchBgStyle(value)}
        />
        <input
          type="text"
          value={hexInput}
          onChange={(e) => {
            const v = e.target.value;
            setHexInput(v);
            commitHex(v);
          }}
          onBlur={() => setHexInput(value)}
          spellCheck={false}
          maxLength={7}
          className={cn(
            'box-border w-full flex-1 min-w-0 rounded-md border px-2 py-0.5 text-[12px] font-mono uppercase tabular-nums',
            'bg-day-bg dark:bg-night-bg',
            'border-day-border dark:border-night-border',
            'text-day-text dark:text-night-text',
            'focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#84cc16]/40',
          )}
        />
        {explicit ? (
          <button
            type="button"
            onClick={onReset}
            className="text-[10.5px] text-day-muted dark:text-night-muted hover:text-[#84cc16] transition-colors shrink-0"
            title="Reset to layer fill colour"
          >
            Reset
          </button>
        ) : null}
      </div>
      {/* Compact preset strip — same palette as the standalone
          ColorSwatch so the visual language stays consistent across
          the dashboard. 12 cols × 3 rows fits in 320 px. */}
      <div className="grid grid-cols-12 gap-0.5">
        {PICKER_PRESETS.map((c) => {
          const active = sameHex(c, value);
          const label = c === 'transparent' ? 'Transparent' : c;
          return (
            <button
              key={c}
              type="button"
              title={label}
              aria-label={label}
              onClick={() => onChange(c)}
              className={cn(
                'aspect-square rounded transition-transform hover:scale-110 overflow-hidden',
                'border',
                active
                  ? 'ring-1 ring-[#84cc16] ring-offset-1 ring-offset-white dark:ring-offset-night-surface border-transparent'
                  : 'border-black/10 dark:border-white/15',
              )}
              style={swatchBgStyle(c)}
            />
          );
        })}
      </div>
    </div>
  );
}

function sameHex(a, b) {
  if (!a || !b) return false;
  return String(a).replace(/^#/, '').toLowerCase() ===
    String(b).replace(/^#/, '').toLowerCase();
}

// ---------------------------------------------------------------------------
// MarkerPicker — point-layer marker symbology.
//
// Trigger: a small preview chip that mirrors what the layer currently
// renders on the map (shape + icon + colours). Clicking it opens a
// portal-anchored popover with a 3-way shape toggle (circle / square /
// no background) and a category-grouped icon grid. Selecting an icon
// or shape commits live; the picker stays open so the user can audit
// across categories before closing. A "Clear" pill resets back to a
// plain circle (the historical default).
//
// The trigger preview deliberately avoids regenerating the actual
// Mapbox PNG — it's a CSS / SVG facsimile that's faster to render and
// good enough for "what does my marker look like right now". The
// authoritative rendering happens on the map via buildMarkerImage().
// ---------------------------------------------------------------------------
function MarkerPicker({
  marker,
  fillColor,
  strokeColor,
  strokeWidth,
  radius,
  onChange,
}) {
  const shape = marker?.shape || 'none';
  const iconId = marker?.icon || null;
  const resolved = resolveMarkerIcon(iconId);
  const hasMarker = shape !== 'none' || !!iconId;

  return (
    <Popover className="relative w-full">
      <Popover.Button
        type="button"
        className={cn(
          'inline-flex w-full items-center gap-2 rounded-md',
          'border border-day-border dark:border-night-border',
          'bg-day-bg dark:bg-night-bg',
          'px-2 py-1 text-left text-[12px] text-day-text dark:text-night-text',
          'hover:border-[#84cc16]/60 transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#84cc16]/40',
        )}
      >
        <MarkerPreview
          shape={shape}
          resolved={resolved}
          fillColor={fillColor}
          strokeColor={strokeColor}
          strokeWidth={strokeWidth}
          backgroundColor={marker?.backgroundColor}
        />
        <span className="flex-1 min-w-0 truncate">
          {hasMarker
            ? [
                shape !== 'none' ? capitalize(shape) : null,
                resolved?.kind === 'emoji'
                  ? resolved.char
                  : resolved?.kind === 'custom'
                    ? 'Custom icon'
                    : resolved?.label,
              ]
                .filter(Boolean)
                .join(' · ')
            : 'Default circle'}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0 text-day-muted dark:text-night-muted" />
      </Popover.Button>
      <Transition
        as={Fragment}
        enter="transition duration-100 ease-out"
        enterFrom="opacity-0 scale-95"
        enterTo="opacity-100 scale-100"
        leave="transition duration-75 ease-in"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
      >
        <Popover.Panel
          anchor={{ to: 'bottom start', gap: 6 }}
          className={cn(
            'z-[120] w-[320px] max-h-[480px] overflow-hidden flex flex-col',
            'rounded-lg bg-white dark:bg-night-surface',
            'border border-day-border dark:border-night-border shadow-xl',
            'focus:outline-none',
          )}
        >
          {/* Header — three shape chips + an optional background-
              colour picker that only surfaces when a shape is chosen.
              "None" is rendered as a dashed-circle outline so the
              user reads it as "no container, just an icon". */}
          <div className="px-3 pt-3 pb-2 border-b border-day-border dark:border-night-border">
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-day-muted dark:text-night-muted mb-1.5">
              Shape
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <ShapeChip
                active={shape === 'circle'}
                onClick={() => onChange({ shape: 'circle' })}
                label="Circle"
              >
                <span
                  aria-hidden
                  className="block h-5 w-5 rounded-full"
                  style={{
                    background: marker?.backgroundColor || fillColor || '#84cc16',
                    border: `1px solid ${strokeColor || '#4d7c0f'}`,
                  }}
                />
              </ShapeChip>
              <ShapeChip
                active={shape === 'square'}
                onClick={() => onChange({ shape: 'square' })}
                label="Square"
              >
                <span
                  aria-hidden
                  className="block h-5 w-5 rounded-[3px]"
                  style={{
                    background: marker?.backgroundColor || fillColor || '#84cc16',
                    border: `1px solid ${strokeColor || '#4d7c0f'}`,
                  }}
                />
              </ShapeChip>
              <ShapeChip
                active={shape === 'none'}
                onClick={() => onChange({ shape: 'none' })}
                label="No bg"
              >
                <span
                  aria-hidden
                  className="block h-5 w-5 rounded-full border-2 border-dashed border-day-muted dark:border-night-muted"
                />
              </ShapeChip>
            </div>
            {shape !== 'none' ? (
              <InlineBgPicker
                value={marker?.backgroundColor || fillColor || '#84cc16'}
                explicit={!!marker?.backgroundColor}
                onChange={(c) => onChange({ backgroundColor: c })}
                onReset={() => onChange({ backgroundColor: null })}
              />
            ) : null}
          </div>

          {/* Icon grid — categories rendered in order, each as its own
              labelled subsection. Three icon sources share this slot:
              custom upload (top), emoji (curated, mid), then the
              lucide catalogue. Selection is live-committing — the
              popover stays open so users can audit between sources. */}
          <div className="flex-1 min-h-0 overflow-y-auto px-3 pt-2 pb-3">
            {/* "No icon" tile — quick way back to a plain shape after
                trying a few. */}
            <button
              type="button"
              onClick={() => onChange({ icon: null })}
              className={cn(
                'inline-flex items-center gap-1.5 mb-2 px-2 py-1 rounded-md text-[11px] transition-colors',
                'border border-day-border dark:border-night-border',
                iconId == null
                  ? 'bg-[#84cc16]/10 border-[#84cc16]/50 text-[#84cc16]'
                  : 'text-day-muted dark:text-night-muted hover:border-[#84cc16]/40',
              )}
            >
              <X className="h-3 w-3" />
              No icon
            </button>

            {/* Custom upload — accepts a single SVG or PNG, stores as
                a self-contained data URL in marker.icon. The renderer
                in markerImage.js detects the `data:` prefix and
                routes through SVG <image> instead of the lucide path. */}
            <div className="mb-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-day-muted dark:text-night-muted mb-1.5">
                Custom upload
              </div>
              <CustomUploadRow
                resolved={resolved}
                onUpload={(dataUrl) => onChange({ icon: dataUrl })}
                onClear={() => onChange({ icon: null })}
              />
            </div>

            {/* Emoji grids — `emoji:<char>` ids are dispatched by the
                renderer to an SVG <text> element, so colour emoji
                fonts (Apple, Segoe UI, Noto) render natively. */}
            {EMOJI_CATEGORIES.map((cat) => (
              <div key={cat.id} className="mb-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-day-muted dark:text-night-muted mb-1.5">
                  {cat.label}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {cat.emojis.map((char) => {
                    const id = `emoji:${char}`;
                    const active = iconId === id;
                    return (
                      <button
                        key={char}
                        type="button"
                        onClick={() => onChange({ icon: id })}
                        title={char}
                        aria-label={char}
                        aria-pressed={active}
                        className={cn(
                          'aspect-square inline-flex items-center justify-center rounded-md text-[18px] leading-none transition-colors',
                          'border',
                          active
                            ? 'bg-[#84cc16]/15 border-[#84cc16]/60'
                            : 'border-transparent hover:bg-day-bg dark:hover:bg-night-bg',
                        )}
                      >
                        <span aria-hidden>{char}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {MARKER_CATEGORIES.map((cat) => (
              <div key={cat.id} className="mb-3 last:mb-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-day-muted dark:text-night-muted mb-1.5">
                  {cat.label}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {cat.icons.map(({ id, label, Component }) => {
                    const active = iconId === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => onChange({ icon: id })}
                        title={label}
                        aria-label={label}
                        aria-pressed={active}
                        className={cn(
                          'aspect-square inline-flex items-center justify-center rounded-md transition-colors',
                          'border',
                          active
                            ? 'bg-[#84cc16]/15 border-[#84cc16]/60 text-[#84cc16]'
                            : 'border-transparent text-day-muted dark:text-night-muted hover:bg-day-bg dark:hover:bg-night-bg hover:text-day-text dark:hover:text-night-text',
                        )}
                      >
                        <Component className="h-4 w-4" strokeWidth={1.8} />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Footer — Clear resets shape AND icon to defaults so a
              user can bail out of marker mode entirely with one
              click. */}
          <div className="shrink-0 border-t border-day-border dark:border-night-border px-3 py-2 flex items-center justify-between">
            <span className="text-[11px] text-day-muted dark:text-night-muted">
              {hasMarker
                ? `${
                    resolved?.kind === 'emoji'
                      ? resolved.char
                      : resolved?.kind === 'custom'
                        ? 'Custom'
                        : resolved?.label ?? 'Shape'
                  } marker`
                : 'Default'}
            </span>
            <button
              type="button"
              onClick={() => onChange({ shape: 'none', icon: null, backgroundColor: null })}
              disabled={!hasMarker}
              className={cn(
                'inline-flex items-center gap-1 text-[11px] transition-colors',
                hasMarker
                  ? 'text-day-muted dark:text-night-muted hover:text-[#84cc16]'
                  : 'text-day-muted/40 dark:text-night-muted/40 cursor-not-allowed',
              )}
            >
              <RotateCcw className="h-3 w-3" />
              Clear
            </button>
          </div>
        </Popover.Panel>
      </Transition>
    </Popover>
  );
}

function ShapeChip({ active, onClick, label, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex flex-col items-center justify-center gap-1 px-2 py-2 rounded-md transition-colors',
        'border',
        active
          ? 'bg-[#84cc16]/10 border-[#84cc16]/60'
          : 'border-day-border dark:border-night-border hover:border-day-text/40 dark:hover:border-night-text/40',
      )}
    >
      {children}
      <span
        className={cn(
          'text-[10.5px]',
          active
            ? 'text-[#84cc16] font-semibold'
            : 'text-day-muted dark:text-night-muted',
        )}
      >
        {label}
      </span>
    </button>
  );
}

// Tiny preview chip rendered next to the picker trigger label.
// Mirrors the marker that gets drawn on the map closely enough to be
// recognisable at a glance, without paying the cost of generating the
// real PNG. Branches on the resolver's `kind` so emoji and uploaded
// images preview the same way they'll render on the map.
function MarkerPreview({ shape, resolved, fillColor, strokeColor, strokeWidth, backgroundColor }) {
  const iconColor = fillColor || '#84cc16';
  const bg = backgroundColor || fillColor || '#84cc16';

  let iconNode = null;
  if (resolved?.kind === 'lucide' && resolved.Component) {
    const Icon = resolved.Component;
    iconNode = (
      <Icon
        className="relative h-3 w-3"
        style={{ color: iconColor }}
        strokeWidth={2}
      />
    );
  } else if (resolved?.kind === 'emoji') {
    iconNode = (
      <span
        className="relative leading-none"
        style={{ fontSize: shape === 'none' ? '14px' : '11px' }}
        aria-hidden
      >
        {resolved.char}
      </span>
    );
  } else if (resolved?.kind === 'custom') {
    iconNode = (
      <img
        src={resolved.dataUrl}
        alt=""
        aria-hidden
        className="relative h-3 w-3 object-contain"
      />
    );
  } else if (!shape || shape === 'none') {
    iconNode = (
      <Circle
        className="relative h-3 w-3 text-day-muted dark:text-night-muted"
        strokeWidth={1.5}
      />
    );
  }

  // Two stacked absolutely-positioned layers: the shape (bg + border)
  // and the icon. Both anchor at `inset-0` so the icon's centring is
  // independent of any inline-flex baseline drift the parent might
  // introduce. Without this split, an `<img>` or emoji `<span>` flex
  // child would inherit text baseline alignment from the parent and
  // could land 1-2 px low in some browsers.
  return (
    <span
      aria-hidden
      className="relative inline-block h-5 w-5 shrink-0 align-middle overflow-hidden"
    >
      {shape === 'circle' ? (
        <span
          className="absolute inset-0 rounded-full"
          style={{
            background: bg,
            border: `${Math.max(1, strokeWidth || 1)}px solid ${strokeColor || '#4d7c0f'}`,
          }}
        />
      ) : shape === 'square' ? (
        <span
          className="absolute inset-0 rounded-[3px]"
          style={{
            background: bg,
            border: `${Math.max(1, strokeWidth || 1)}px solid ${strokeColor || '#4d7c0f'}`,
          }}
        />
      ) : null}
      <span className="absolute inset-0 flex items-center justify-center">
        {iconNode}
      </span>
    </span>
  );
}

// Custom upload row — file input + preview tile. Reads the chosen
// .svg / .png / .webp as a base64 data URL via FileReader so the
// result is self-contained (no blob URLs to revoke, no server round-
// trip). The data URL goes straight into `marker.icon`; the renderer
// detects the `data:` prefix and routes through SVG <image>. Files
// larger than MAX_BYTES are rejected up front because anything bigger
// than ~256 KB is almost certainly a photo or full-resolution image,
// neither of which would render legibly at marker size.
const CUSTOM_ICON_MAX_BYTES = 256 * 1024;

function CustomUploadRow({ resolved, onUpload, onClear }) {
  const fileRef = useRef(null);
  const [error, setError] = useState(null);
  const isCustom = resolved?.kind === 'custom';

  const handleFiles = (files) => {
    const file = files && files[0];
    if (!file) return;
    if (
      !/^image\/(svg\+xml|png|webp)$/.test(file.type) &&
      !/\.(svg|png|webp)$/i.test(file.name)
    ) {
      setError('Only SVG, PNG, or WebP files are supported.');
      return;
    }
    if (file.size > CUSTOM_ICON_MAX_BYTES) {
      setError('File must be 256 KB or smaller.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setError('Could not read the file.');
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
        setError('Unexpected file contents.');
        return;
      }
      setError(null);
      onUpload(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        {isCustom ? (
          <span className="h-7 w-7 shrink-0 rounded border border-day-border dark:border-night-border bg-day-bg dark:bg-night-bg overflow-hidden inline-flex items-center justify-center">
            <img
              src={resolved.dataUrl}
              alt="Custom icon preview"
              className="h-full w-full object-contain"
            />
          </span>
        ) : (
          <span className="h-7 w-7 shrink-0 rounded border border-dashed border-day-border dark:border-night-border bg-day-bg dark:bg-night-bg inline-flex items-center justify-center text-day-muted dark:text-night-muted">
            <ImageIcon className="h-3.5 w-3.5" />
          </span>
        )}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className={cn(
            'inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] transition-colors',
            'border border-day-border dark:border-night-border',
            'text-day-text dark:text-night-text hover:border-[#84cc16]/60',
          )}
        >
          <Upload className="h-3 w-3" />
          {isCustom ? 'Replace' : 'Upload SVG / PNG / WebP'}
        </button>
        {isCustom ? (
          <button
            type="button"
            onClick={() => {
              setError(null);
              onClear();
            }}
            className="text-[11px] text-day-muted dark:text-night-muted hover:text-[#84cc16] transition-colors"
          >
            Remove
          </button>
        ) : null}
        <input
          ref={fileRef}
          type="file"
          accept=".svg,.png,.webp,image/svg+xml,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            // Clear so picking the same file twice still fires onChange.
            e.target.value = '';
          }}
        />
      </div>
      {error ? (
        <p className="text-[10.5px] text-red-500" role="alert">
          {error}
        </p>
      ) : (
        <p className="text-[10.5px] text-day-muted dark:text-night-muted">
          Square SVG, PNG, or WebP ≤ 256 KB. Stored inline with the layer.
        </p>
      )}
    </div>
  );
}

function capitalize(s) {
  if (typeof s !== 'string' || s.length === 0) return '';
  return s[0].toUpperCase() + s.slice(1);
}

// Suggestive placeholder text for the per-class label input. The raw
// value gets passed in so we can offer a sensible default when it
// matches a familiar small-integer scheme (risk levels 0-5, binary
// 0/1, ternary -1/0/1) — the user can ignore the suggestion and type
// whatever they like. Only used as the input's `placeholder`, never
// as the actual label.
function getLabelPlaceholder(value) {
  if (value === 0) return 'No data / Background';
  if (value === 1) return 'Very Low';
  if (value === 2) return 'Low';
  if (value === 3) return 'Moderate';
  if (value === 4) return 'High';
  if (value === 5) return 'Very High';
  return `Class ${value}`;
}

// ---------------------------------------------------------------------------
// Classified-mode editor — list of `{ value, color, label? }` rows.
// Label is display-only — used by the inline legend in the Raster
// Layers panel for legibility. The "Auto from data" pill replaces
// whatever's there with one entry per unique value found in the band,
// paired with a categorical palette. "Add" appends a blank row the
// user types into; per-row trash deletes.
// ---------------------------------------------------------------------------
function ClassifiedEditor({ classes, uniqueValues, onChange }) {
  const palette = paletteById('set2')?.colors ?? ['#66c2a5', '#fc8d62', '#8da0cb', '#e78ac3', '#a6d854'];
  const updateAt = (i, partial) => {
    const next = classes.map((c, j) => (j === i ? { ...c, ...partial } : c));
    onChange(next);
  };
  const removeAt = (i) => {
    onChange(classes.filter((_, j) => j !== i));
  };
  const addRow = () => {
    const used = new Set(classes.map((c) => c.value));
    // Pick the next unused value from the unique-values list, or just
    // increment the largest existing value if there's no overlap.
    let nextValue = 0;
    if (Array.isArray(uniqueValues)) {
      const free = uniqueValues.find((v) => !used.has(v));
      if (free != null) nextValue = free;
      else if (classes.length) nextValue = (classes.at(-1)?.value ?? 0) + 1;
    } else if (classes.length) {
      nextValue = (classes.at(-1)?.value ?? 0) + 1;
    }
    onChange([
      ...classes,
      { value: nextValue, color: palette[classes.length % palette.length] },
    ]);
  };
  const autoFill = () => {
    if (!Array.isArray(uniqueValues) || uniqueValues.length === 0) return;
    onChange(
      uniqueValues.map((v, i) => ({
        value: v,
        color: palette[i % palette.length],
      })),
    );
  };

  return (
    <Section
      title="Classes"
      action={
        Array.isArray(uniqueValues) && uniqueValues.length > 0 ? (
          <button
            type="button"
            onClick={autoFill}
            className="text-[10.5px] uppercase tracking-[0.08em] text-[#84cc16] hover:underline"
            title={`${uniqueValues.length} unique value(s) detected in data`}
          >
            Auto from data
          </button>
        ) : null
      }
    >
      {classes.length === 0 ? (
        <p className="text-[11px] text-day-muted dark:text-night-muted px-1">
          No classes yet.{' '}
          {Array.isArray(uniqueValues) && uniqueValues.length > 0
            ? `Click “Auto from data” to seed ${uniqueValues.length} from this raster, or add manually.`
            : 'Add classes manually below.'}
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {/* Header row — micro-labels above the columns so the user knows
              which input is the numeric value and which is the display
              label. Hidden when no rows exist (the empty-state copy
              already explains the schema). */}
          {/* Header row — micro-labels above the columns. The swatch
              column is only 28px (matched to ColorSwatch's w-7 button),
              which doesn't fit "COLOUR" but does fit the 3-letter "HUE"
              cleanly. Same idea, smaller footprint. */}
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.08em] text-day-muted dark:text-night-muted px-0.5">
            <span className="w-7 shrink-0">hue</span>
            <span className="w-14 shrink-0">value</span>
            <span className="flex-1 min-w-0">label (shown in legend)</span>
            <span className="w-6 shrink-0" />
          </div>
          {classes.map((c, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <ColorSwatch
                value={c.color || '#000000'}
                onChange={(color) => updateAt(i, { color })}
                ariaLabel={`Class ${c.value} colour`}
              />
              <input
                type="number"
                value={c.value}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  updateAt(i, { value: Number.isFinite(n) ? n : 0 });
                }}
                className="w-14 shrink-0 rounded-md border border-day-border dark:border-night-border bg-day-bg dark:bg-night-bg text-[12px] px-2 py-1 text-day-text dark:text-night-text tabular-nums focus:outline-none focus:ring-2 focus:ring-[#84cc16]/40"
              />
              <input
                type="text"
                value={c.label ?? ''}
                onChange={(e) => updateAt(i, { label: e.target.value })}
                placeholder={`e.g. ${getLabelPlaceholder(c.value)}`}
                className="flex-1 min-w-0 rounded-md border border-day-border dark:border-night-border bg-day-bg dark:bg-night-bg text-[12px] px-2 py-1 text-day-text dark:text-night-text placeholder:text-day-muted/70 dark:placeholder:text-night-muted/70 focus:outline-none focus:ring-2 focus:ring-[#84cc16]/40"
                aria-label={`Class ${c.value} display label`}
              />
              <button
                type="button"
                onClick={() => removeAt(i)}
                aria-label={`Remove class ${c.value}`}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-day-muted dark:text-night-muted hover:text-red-500 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={addRow}
        className="inline-flex items-center gap-1 text-[12px] text-[#84cc16] hover:underline self-start mt-1"
      >
        <Plus className="h-3 w-3" /> Add class
      </button>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// NoData editor — colour + alpha for pixels flagged as nodata (or
// values not matched by any class in classified mode). Toggling the
// switch off clears the colour, restoring the default transparent
// behaviour the renderer used before classified mode existed.
// ---------------------------------------------------------------------------
function NoDataEditor({ color, opacity, onChange }) {
  const enabled = !!color;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11.5px] text-day-text dark:text-night-text">
          Paint nodata pixels
        </span>
        <Switch
          checked={enabled}
          onChange={(v) =>
            onChange(
              v
                ? { noDataColor: color || '#000000' }
                : { noDataColor: null },
            )
          }
          className={cn(
            'relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#84cc16]/40',
            enabled ? 'bg-[#84cc16]' : 'bg-day-border dark:bg-night-border',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out mt-0.5',
              enabled ? 'translate-x-3.5' : 'translate-x-0.5',
            )}
          />
        </Switch>
      </div>
      {enabled ? (
        <>
          <div className="flex items-center gap-2">
            <ColorSwatch
              value={color}
              onChange={(c) => onChange({ noDataColor: c })}
              ariaLabel="No-data colour"
            />
            <span className="flex-1 min-w-0 rounded-md border border-day-border dark:border-night-border bg-day-bg dark:bg-night-bg text-[12px] px-2 py-1 font-mono uppercase tabular-nums text-day-text dark:text-night-text">
              {color}
            </span>
          </div>
          <Field label="Opacity">
            <NumberSlider
              value={opacity ?? 1}
              onChange={(v) => onChange({ noDataOpacity: v })}
              min={0}
              max={1}
              step={0.05}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </Field>
        </>
      ) : (
        <p className="text-[11px] text-day-muted dark:text-night-muted">
          NoData stays transparent. Turn this on to paint a fixed colour
          instead.
        </p>
      )}
    </div>
  );
}

// Compact preview-swatch-and-label dropdown for picking the active
// colormap. Rendered with the same Listbox primitive the vector
// AttributePicker uses so the visual style matches.
function ColormapDropdown({ options, value, onChange }) {
  const current = options.find((o) => o.id === value) ?? options[0];
  // Group options by category, preserving the order from listColormaps.
  const grouped = [];
  const groupIndex = new Map();
  for (const o of options) {
    const cat = o.category || 'Other';
    if (!groupIndex.has(cat)) {
      groupIndex.set(cat, grouped.length);
      grouped.push({ category: cat, items: [] });
    }
    grouped[groupIndex.get(cat)].items.push(o);
  }
  return (
    <Listbox value={value} onChange={onChange}>
      <div className="relative w-full">
        <Listbox.Button className="w-full inline-flex items-center gap-2 rounded-md border border-day-border dark:border-night-border bg-day-bg dark:bg-night-bg px-2 py-1 text-[12px] text-day-text dark:text-night-text hover:border-[#84cc16]/60 transition-colors">
          <ColormapPreview id={current.id} className="h-3 w-12 shrink-0 rounded" />
          <span className="flex-1 text-left truncate">{current.label}</span>
          <ChevronDown className="h-3 w-3 text-day-muted dark:text-night-muted" />
        </Listbox.Button>
        <Transition
          as={Fragment}
          leave="transition ease-in duration-75"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <Listbox.Options className="absolute z-30 mt-1 w-full rounded-md border border-day-border dark:border-night-border bg-white dark:bg-night-surface shadow-lg max-h-72 overflow-y-auto">
            {grouped.map((g) => (
              <div key={g.category}>
                <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-day-muted dark:text-night-muted">
                  {g.category}
                </div>
                {g.items.map((o) => (
                  <Listbox.Option
                    key={o.id}
                    value={o.id}
                    className={({ active }) =>
                      cn(
                        'flex items-center gap-2 px-2 py-1 text-[12px] cursor-pointer',
                        active
                          ? 'bg-[#84cc16]/10 text-[#84cc16]'
                          : 'text-day-text dark:text-night-text',
                      )
                    }
                  >
                    {({ selected: isSel }) => (
                      <>
                        <ColormapPreview id={o.id} className="h-3 w-12 shrink-0 rounded" />
                        <span className="flex-1 truncate">{o.label}</span>
                        {isSel ? <Check className="h-3 w-3 text-[#84cc16]" /> : null}
                      </>
                    )}
                  </Listbox.Option>
                ))}
              </div>
            ))}
          </Listbox.Options>
        </Transition>
      </div>
    </Listbox>
  );
}

// CSS-only horizontal gradient previewing each colormap. Derived from
// the LUT in `rasterRender.js` so a new colormap shows up here for
// free.
function ColormapPreview({ id, className }) {
  return (
    <span
      aria-hidden
      className={className}
      style={{ backgroundImage: colormapCssGradient(id) }}
    />
  );
}

// Trim trailing zeros so "192.000" reads as "192", but keep meaningful
// decimal places on small floats ("0.0042" stays "0.0042").
function niceNumber(n) {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs === 0) return '0';
  if (abs >= 100) return Math.round(n).toString();
  if (abs >= 1) return Number(n.toFixed(2)).toString();
  return Number(n.toPrecision(3)).toString();
}

// ===========================================================================
// Main panel
// ===========================================================================

export default function LayerStyleConfigPanel() {
  const groups = useLayerRegistry();
  const flat = flatten(groups);

  const [selectedId, setSelectedId] = useState(null);
  useEffect(() => {
    if (selectedId && flat.some((l) => l.id === selectedId)) return;
    setSelectedId(flat[0]?.id ?? null);
  }, [flat, selectedId]);

  const selected = flat.find((l) => l.id === selectedId) ?? null;
  const isRaster = selected?.geometry === 'raster';
  // Vector layer data only — rasters don't carry per-feature attributes.
  const { data, attrs, loading } = useLayerData(isRaster ? null : selected);

  const { styles, setLayerStyle, resetLayerStyle } = useSecondary();
  const style =
    selected && !isRaster
      ? effectiveStyle(selected.id, selected.geometry, styles[selected.id])
      : null;

  const setStyle = (partial) => {
    if (!selected) return;
    const merged = { ...style, ...partial };
    // Label is partial-merged so callers can pass `{ label: { enabled: false } }`
    // and keep their other label settings.
    if (partial.label) merged.label = { ...style.label, ...partial.label };
    // Zoom is fully *replaced* — every caller already passes the complete
    // new map (e.g. ZoomToggle.onDeactivate sends a zoom map with a key
    // deleted). Spread-merging here would silently re-add the deleted key.
    if (partial.zoom !== undefined) merged.zoom = partial.zoom;
    setLayerStyle(selected.id, merged);
  };

  // Auto-derive categories from the selected attribute when entering Categories mode
  useEffect(() => {
    if (!selected || !style) return;
    if (style.type !== 'categories' || !style.colorBy) return;
    if (!data) return;
    const summary = summarizeAttribute(data, style.colorBy);
    if (!summary.distinct.length) return;
    // Only seed if user hasn't curated; preserve any color overrides on values
    // that still exist in the data.
    const palette = paletteById(style.catPaletteId).colors;
    const top = summary.distinct.slice(0, 10);
    const existingByValue = new Map((style.categories || []).map((c) => [c.value, c.color]));
    const seeded = top.map((d, i) => ({
      value: d.value,
      color: existingByValue.get(d.value) ?? palette[i % palette.length],
    }));
    // Only update if the array's value-list actually changed.
    const same = (style.categories || []).length === seeded.length
      && seeded.every((c, i) => style.categories[i]?.value === c.value);
    if (!same) setStyle({ categories: seeded });
  }, [data, style?.type, style?.colorBy, style?.catPaletteId]); // eslint-disable-line

  // For colorRange / sizeRange — auto-fill min/max from the chosen attribute
  useEffect(() => {
    if (!selected || !style || !data) return;
    if (style.type !== 'colorRange' && style.type !== 'sizeRange') return;
    const attr = style.type === 'colorRange' ? style.rangeBy : style.sizeBy;
    if (!attr) return;
    const s = summarizeAttribute(data, attr);
    if (s.min == null || s.max == null) return;
    if (style.rangeMin === s.min && style.rangeMax === s.max) return;
    setStyle({ rangeMin: s.min, rangeMax: s.max });
  }, [data, style?.type, style?.rangeBy, style?.sizeBy]); // eslint-disable-line

  if (!selected) {
    return (
      <div className="flex flex-col h-full -mx-3 -my-3">
        <div className="flex-1 min-h-0 overflow-y-auto px-3 pt-3 pb-3 flex flex-col gap-2.5">
          <LayerSelector groups={groups} selectedId={selectedId} onSelect={setSelectedId} />
          <div className="rounded-md border border-dashed border-day-border dark:border-night-border px-3 py-6 text-center text-[13px] text-day-muted dark:text-night-muted">
            Toggle a layer on (Primary or Secondary) to start styling.
          </div>
        </div>
      </div>
    );
  }

  // Rasters live in their own context with a tiny style schema (colormap
  // + opacity + min/max), so they get a dedicated form. Returning here
  // keeps the vector-property block below untouched.
  if (isRaster) {
    return (
      <RasterStyleForm
        groups={groups}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
    );
  }

  const isPoint   = selected.geometry === 'point';
  const isLine    = selected.geometry === 'line';
  const isPolygon = selected.geometry === 'polygon';

  // ---- helpers for the property fields ----
  const zoomFor = (key) => style.zoom?.[key];

  // ---- synchronous derive helpers — applied immediately on attribute /
  //      type change so the user never sees a flash of stale paint. ----

  const seedCategoriesFor = (attr) => {
    if (!data || !attr) return [];
    const summary = summarizeAttribute(data, attr);
    const palette = paletteById(style.catPaletteId).colors;
    return summary.distinct.slice(0, 10).map((d, i) => ({
      value: d.value,
      color: palette[i % palette.length],
    }));
  };

  const handleTypeChange = (t) => {
    const partial = { type: t };
    // Felt convention: categories default to ~50% fill so adjacent shapes
    // aren't muddied. Only seed the default — preserve user-set opacity.
    if (t === 'categories' && (style.fillOpacity == null || style.fillOpacity > 0.5)) {
      partial.fillOpacity = 0.5;
    }
    // Re-seed categories from the existing attribute if one is already chosen.
    if (t === 'categories' && style.colorBy) {
      partial.categories = seedCategoriesFor(style.colorBy);
    }
    // Auto-fill range min/max if a numeric attribute is already selected.
    if (t === 'colorRange' && style.rangeBy) {
      const s = summarizeAttribute(data, style.rangeBy);
      partial.rangeMin = s.min;
      partial.rangeMax = s.max;
    }
    if (t === 'sizeRange' && style.sizeBy) {
      const s = summarizeAttribute(data, style.sizeBy);
      partial.rangeMin = s.min;
      partial.rangeMax = s.max;
    }
    setStyle(partial);
  };

  const handleColorByChange = (v) => {
    setStyle({ colorBy: v, categories: seedCategoriesFor(v) });
  };

  const handleRangeByChange = (v) => {
    const s = v && data ? summarizeAttribute(data, v) : { min: null, max: null };
    setStyle({ rangeBy: v, rangeMin: s.min, rangeMax: s.max });
  };

  const handleSizeByChange = (v) => {
    const s = v && data ? summarizeAttribute(data, v) : { min: null, max: null };
    setStyle({ sizeBy: v, rangeMin: s.min, rangeMax: s.max });
  };

  return (
    // Outer column fills the right-sidebar's content area so the footer can
    // pin to the bottom while the form body owns its own scroll. Negative
    // margins cancel the parent's `p-3` so we can re-add padding inside the
    // scroll region (otherwise the pinned footer would have padding above it
    // that doesn't match the rest of the surface).
    <div className="flex flex-col h-full -mx-3 -my-3">
      {/* Scrollable body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pt-3 pb-3 flex flex-col gap-3.5">
      <LayerSelector groups={groups} selectedId={selectedId} onSelect={setSelectedId} />

      {/* General — Type */}
      <Section title="General">
        <Field label="Type">
          <TypeDropdown
            geometry={selected.geometry}
            value={style.type}
            onChange={handleTypeChange}
          />
        </Field>

        {style.type === 'categories' && (
          <Field label="Color by">
            <AttributePicker
              attrs={attrs}
              value={style.colorBy}
              onChange={handleColorByChange}
            />
          </Field>
        )}
        {style.type === 'colorRange' && (
          <>
            <Field label="Color by">
              <AttributePicker
                attrs={attrs}
                value={style.rangeBy}
                onChange={handleRangeByChange}
              />
            </Field>
            <Field label="Mode">
              <div className="inline-flex w-full rounded-md border border-day-border dark:border-night-border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setStyle({ classMode: 'continuous' })}
                  className={cn(
                    'flex-1 px-2 py-1 text-[12px] transition-colors',
                    (style.classMode || 'continuous') === 'continuous'
                      ? 'bg-[#84cc16] text-[#1a2e05]'
                      : 'text-day-muted dark:text-night-muted hover:bg-day-bg dark:hover:bg-night-bg',
                  )}
                >
                  Continuous
                </button>
                <button
                  type="button"
                  onClick={() => setStyle({ classMode: 'classified' })}
                  className={cn(
                    'flex-1 px-2 py-1 text-[12px] transition-colors border-l border-day-border dark:border-night-border',
                    style.classMode === 'classified'
                      ? 'bg-[#84cc16] text-[#1a2e05]'
                      : 'text-day-muted dark:text-night-muted hover:bg-day-bg dark:hover:bg-night-bg',
                  )}
                >
                  Classified
                </button>
              </div>
            </Field>
            {style.classMode === 'classified' && (
              <Field label="Classes">
                <NumberSlider
                  value={style.classCount || 5}
                  onChange={(v) => setStyle({ classCount: Math.round(v) })}
                  min={2}
                  max={10}
                  step={1}
                  format={(v) => `${v}`}
                />
              </Field>
            )}
          </>
        )}
        {style.type === 'sizeRange' && (
          <Field label="Size by">
            <AttributePicker
              attrs={attrs}
              value={style.sizeBy}
              onChange={handleSizeByChange}
            />
          </Field>
        )}
      </Section>

      {/* ===== Geometry-specific paint ===== */}
      {style.type === 'heatmap' ? (
        <Section title="Heatmap">
          <Field label="Color">
            <RampSwatch
              rampId={style.rampId}
              reversed={style.rampReversed}
              onChangeRamp={(id) => setStyle({ rampId: id })}
              onToggleReverse={() => setStyle({ rampReversed: !style.rampReversed })}
            />
          </Field>
          <Field label="Radius">
            <NumberSlider
              value={style.heatRadius}
              onChange={(v) => setStyle({ heatRadius: v })}
              min={4} max={80} step={1}
              format={(v) => `${v}px`}
            />
          </Field>
          <Field label="Intensity">
            <NumberSlider
              value={style.heatIntensity}
              onChange={(v) => setStyle({ heatIntensity: v })}
              min={0} max={3} step={0.05}
              format={(v) => v.toFixed(2)}
            />
          </Field>
          <Field label="Opacity">
            <NumberSlider
              value={style.fillOpacity}
              onChange={(v) => setStyle({ fillOpacity: v })}
              min={0} max={1} step={0.05}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </Field>
        </Section>
      ) : (
        <>
          {/* Primary section title — Points / Lines / Polygons */}
          <Section title={isPoint ? 'Points' : isLine ? 'Stroke' : 'Fill'}>
            {isPoint && (
              <Field
                label="Size"
                action={
                  style.type !== 'sizeRange' && (
                    <ZoomToggle
                      active={!!zoomFor('radius')}
                      value={zoomFor('radius') ?? { z1: 4, v1: style.radius, z2: 14, v2: style.radius * 2 }}
                      min={1} max={48} step={0.5}
                      onActivate={() =>
                        setStyle({ zoom: { ...style.zoom, radius: { z1: 4, v1: style.radius, z2: 14, v2: style.radius * 2 } } })
                      }
                      onDeactivate={() => {
                        const next = { ...style.zoom }; delete next.radius;
                        setStyle({ zoom: next });
                      }}
                      onChange={(v) => setStyle({ zoom: { ...style.zoom, radius: v } })}
                      format={(v) => `${v}px`}
                    />
                  )
                }
              >
                {style.type === 'sizeRange' ? (
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-[11px] text-day-muted dark:text-night-muted">min</span>
                    <input type="number" value={style.sizeMin} min={1} max={48} step={0.5}
                      onChange={(e) => setStyle({ sizeMin: Number(e.target.value) })}
                      className="w-12 rounded border border-day-border dark:border-night-border bg-day-bg dark:bg-night-bg px-1 py-0.5 text-[12px] tabular-nums" />
                    <span className="text-[11px] text-day-muted dark:text-night-muted">max</span>
                    <input type="number" value={style.sizeMax} min={1} max={48} step={0.5}
                      onChange={(e) => setStyle({ sizeMax: Number(e.target.value) })}
                      className="w-12 rounded border border-day-border dark:border-night-border bg-day-bg dark:bg-night-bg px-1 py-0.5 text-[12px] tabular-nums" />
                  </div>
                ) : zoomFor('radius') ? (
                  <span className="text-[12px] tabular-nums text-day-text dark:text-night-text">
                    {zoomFor('radius').v1}px → {zoomFor('radius').v2}px
                  </span>
                ) : (
                  <NumberSlider
                    value={style.radius}
                    onChange={(v) => setStyle({ radius: v })}
                    min={1} max={24} step={0.5}
                    format={(v) => v}
                  />
                )}
              </Field>
            )}

            {isPoint && (
              <Field label="Marker">
                <MarkerPicker
                  marker={style.marker || { shape: 'none', icon: null }}
                  fillColor={style.fillColor}
                  strokeColor={style.strokeColor}
                  strokeWidth={style.strokeWidth}
                  radius={style.radius}
                  onChange={(partial) =>
                    setStyle({
                      marker: { ...(style.marker || {}), ...partial },
                    })
                  }
                />
              </Field>
            )}

            {/* Color / Fill */}
            <Field label={isPoint ? 'Fill' : isLine ? 'Color' : 'Color'}>
              {style.type === 'categories' ? (
                <CategoricalPaletteSwatch
                  paletteId={style.catPaletteId}
                  onChange={(p) => {
                    // Re-color current categories with the new palette
                    const palette = paletteById(p).colors;
                    const next = (style.categories || []).map((c, i) => ({
                      ...c,
                      color: palette[i % palette.length],
                    }));
                    setStyle({ catPaletteId: p, categories: next });
                  }}
                />
              ) : style.type === 'colorRange' ? (
                <RampSwatch
                  rampId={style.rampId}
                  reversed={style.rampReversed}
                  classCount={
                    style.classMode === 'classified'
                      ? style.classCount || 5
                      : null
                  }
                  onChangeRamp={(id) => setStyle({ rampId: id })}
                  onToggleReverse={() => setStyle({ rampReversed: !style.rampReversed })}
                />
              ) : (
                <ColorButton
                  value={isLine ? style.color : style.fillColor}
                  onChange={(c) => setStyle(isLine ? { color: c } : { fillColor: c })}
                  ariaLabel="Fill color"
                />
              )}
            </Field>

            {/* Width / stroke for lines */}
            {isLine && (
              <Field
                label="Width"
                action={
                  style.type !== 'sizeRange' && (
                    <ZoomToggle
                      active={!!zoomFor('width')}
                      value={zoomFor('width') ?? { z1: 4, v1: style.width, z2: 14, v2: style.width * 2 }}
                      min={0.25} max={20} step={0.25}
                      onActivate={() =>
                        setStyle({ zoom: { ...style.zoom, width: { z1: 4, v1: style.width, z2: 14, v2: style.width * 2 } } })
                      }
                      onDeactivate={() => {
                        const next = { ...style.zoom }; delete next.width;
                        setStyle({ zoom: next });
                      }}
                      onChange={(v) => setStyle({ zoom: { ...style.zoom, width: v } })}
                      format={(v) => `${v}px`}
                    />
                  )
                }
              >
                {style.type === 'sizeRange' ? (
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-[11px] text-day-muted dark:text-night-muted">min</span>
                    <input type="number" value={style.sizeMin} min={0.25} max={20} step={0.25}
                      onChange={(e) => setStyle({ sizeMin: Number(e.target.value) })}
                      className="w-12 rounded border border-day-border dark:border-night-border bg-day-bg dark:bg-night-bg px-1 py-0.5 text-[12px] tabular-nums" />
                    <span className="text-[11px] text-day-muted dark:text-night-muted">max</span>
                    <input type="number" value={style.sizeMax} min={0.25} max={20} step={0.25}
                      onChange={(e) => setStyle({ sizeMax: Number(e.target.value) })}
                      className="w-12 rounded border border-day-border dark:border-night-border bg-day-bg dark:bg-night-bg px-1 py-0.5 text-[12px] tabular-nums" />
                  </div>
                ) : zoomFor('width') ? (
                  <span className="text-[12px] tabular-nums text-day-text dark:text-night-text">
                    {zoomFor('width').v1}px → {zoomFor('width').v2}px
                  </span>
                ) : (
                  <NumberSlider
                    value={style.width} onChange={(v) => setStyle({ width: v })}
                    min={0.25} max={10} step={0.25} format={(v) => `${v}px`}
                  />
                )}
              </Field>
            )}

            {/* Opacity */}
            <Field label="Opacity">
              <NumberSlider
                value={isLine ? style.opacity : style.fillOpacity}
                onChange={(v) => setStyle(isLine ? { opacity: v } : { fillOpacity: v })}
                min={0} max={1} step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
              />
            </Field>

            {/* Line-only: Pattern */}
            {isLine && (
              <Field label="Pattern">
                <div className="inline-flex w-full rounded-md border border-day-border dark:border-night-border overflow-hidden">
                  <button type="button" onClick={() => setStyle({ dashed: false })}
                    className={cn('flex-1 px-2 py-1 text-[12px] transition-colors',
                      !style.dashed ? 'bg-[#84cc16] text-[#1a2e05]' : 'text-day-muted dark:text-night-muted hover:bg-day-bg dark:hover:bg-night-bg')}>
                    Solid
                  </button>
                  <button type="button" onClick={() => setStyle({ dashed: true })}
                    className={cn('flex-1 px-2 py-1 text-[12px] transition-colors border-l border-day-border dark:border-night-border',
                      style.dashed ? 'bg-[#84cc16] text-[#1a2e05]' : 'text-day-muted dark:text-night-muted hover:bg-day-bg dark:hover:bg-night-bg')}>
                    Dashed
                  </button>
                </div>
              </Field>
            )}
          </Section>

          {/* Stroke section (point + polygon only) */}
          {(isPoint || isPolygon) && (
            <Section title="Stroke">
              <Field label="Color">
                <ColorButton
                  value={style.strokeColor}
                  onChange={(c) => setStyle({ strokeColor: c })}
                  ariaLabel="Stroke color"
                />
              </Field>
              <Field
                label="Width"
                action={
                  <ZoomToggle
                    active={!!zoomFor('strokeWidth')}
                    value={zoomFor('strokeWidth') ?? { z1: 4, v1: style.strokeWidth, z2: 14, v2: style.strokeWidth * 2 }}
                    min={0} max={10} step={0.25}
                    onActivate={() =>
                      setStyle({ zoom: { ...style.zoom, strokeWidth: { z1: 4, v1: style.strokeWidth, z2: 14, v2: style.strokeWidth * 2 } } })
                    }
                    onDeactivate={() => {
                      const next = { ...style.zoom }; delete next.strokeWidth;
                      setStyle({ zoom: next });
                    }}
                    onChange={(v) => setStyle({ zoom: { ...style.zoom, strokeWidth: v } })}
                    format={(v) => `${v}px`}
                  />
                }
              >
                {zoomFor('strokeWidth') ? (
                  <span className="text-[12px] tabular-nums text-day-text dark:text-night-text">
                    {zoomFor('strokeWidth').v1}px → {zoomFor('strokeWidth').v2}px
                  </span>
                ) : (
                  <NumberSlider
                    value={style.strokeWidth}
                    onChange={(v) => setStyle({ strokeWidth: v })}
                    min={0} max={6} step={0.25}
                    format={(v) => `${v}px`}
                  />
                )}
              </Field>
              <Field label="Opacity">
                <NumberSlider
                  value={style.strokeOpacity}
                  onChange={(v) => setStyle({ strokeOpacity: v })}
                  min={0} max={1} step={0.05}
                  format={(v) => `${Math.round(v * 100)}%`}
                />
              </Field>
            </Section>
          )}

          {/* Categories editor — appears below Stroke when active */}
          {style.type === 'categories' && style.colorBy && (style.categories?.length ?? 0) > 0 && (
            <CategoryList
              categories={style.categories}
              otherColor={style.otherColor}
              showOther={style.showOther}
              onChange={setStyle}
            />
          )}
        </>
      )}

      {/* ===== Label section ===== */}
      <Section
        title="Label"
        action={
          <Switch
            checked={style.label.enabled}
            onChange={(v) => setStyle({ label: { enabled: v } })}
            className={cn(
              'relative inline-flex h-4 w-7 items-center rounded-full transition-colors',
              style.label.enabled ? 'bg-[#84cc16]' : 'bg-day-border dark:bg-night-border',
            )}
          >
            <span
              className={cn(
                'inline-block h-3 w-3 transform rounded-full bg-white transition-transform',
                style.label.enabled ? 'translate-x-3.5' : 'translate-x-0.5',
              )}
            />
          </Switch>
        }
      >
        {style.label.enabled && (
          <>
            <Field label="Label by">
              <AttributePicker
                attrs={attrs}
                value={style.label.by}
                onChange={(v) => setStyle({ label: { by: v } })}
              />
            </Field>
            <Field label="Size">
              <NumberSlider
                value={style.label.size}
                onChange={(v) => setStyle({ label: { size: v } })}
                min={8} max={28} step={1}
                format={(v) => `${v}px`}
              />
            </Field>
            <Field label="Color">
              <ColorButton
                value={style.label.color}
                onChange={(c) => setStyle({ label: { color: c } })}
                ariaLabel="Label color"
              />
            </Field>
            <Field label="Halo">
              <ColorButton
                value={style.label.haloColor}
                onChange={(c) => setStyle({ label: { haloColor: c } })}
                ariaLabel="Halo color"
              />
            </Field>
            <Field label="Halo W">
              <NumberSlider
                value={style.label.haloWidth}
                onChange={(v) => setStyle({ label: { haloWidth: v } })}
                min={0} max={4} step={0.25}
                format={(v) => `${v}px`}
              />
            </Field>
            <Field label="Style">
              <div className="inline-flex w-full rounded-md border border-day-border dark:border-night-border overflow-hidden">
                {['medium', 'bold'].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStyle({ label: { style: s } })}
                    className={cn(
                      'flex-1 px-2 py-1 text-[12px] capitalize transition-colors',
                      s !== 'medium' && 'border-l border-day-border dark:border-night-border',
                      style.label.style === s
                        ? 'bg-[#84cc16] text-[#1a2e05]'
                        : 'text-day-muted dark:text-night-muted hover:bg-day-bg dark:hover:bg-night-bg',
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </Field>
          </>
        )}
      </Section>

      </div>

      {/* Pinned footer — sits below the scroll region so it stays visible
          regardless of how much the body scrolls. */}
      <div className="shrink-0 flex items-center justify-between border-t border-day-border dark:border-night-border bg-white dark:bg-night-surface px-3 py-2.5">
        <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] text-day-muted dark:text-night-muted">
          <GeometryGlyph geometry={selected.geometry} className="h-3 w-3 text-[#84cc16]" />
          {selected.geometry} layer
          {loading && <span className="ml-1 text-[#84cc16]/80">· loading…</span>}
        </span>
        <button
          type="button"
          onClick={() => resetLayerStyle(selected.id)}
          className="inline-flex items-center gap-1 text-[12px] text-day-muted dark:text-night-muted hover:text-[#84cc16] transition-colors"
        >
          <RotateCcw className="h-3 w-3" />
          Reset
        </button>
      </div>
    </div>
  );
}
