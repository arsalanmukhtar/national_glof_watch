import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Listbox, Popover, Switch, Transition } from '@headlessui/react';
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  CircleDot,
  Layers as LayersIcon,
  Pipette,
  RotateCcw,
  Slash,
  Square,
} from 'lucide-react';
import {
  parseRegionLayerId,
  useRegionLayers,
} from '@/contexts/RegionLayersContext';
import { useSecondary } from '@/contexts/SecondaryContext';
import { fetchGeoJson, regionLayerGeometry, regionLayerUrl, secondaryLayerUrl } from '@/config/layerSources';
import { effectiveStyle } from '@/utils/layerStyle';
import {
  CATEGORICAL_PALETTES,
  COLOR_RAMPS,
  paletteById,
  rampById,
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
  const { layers: secondaryLayers, visibleLayers: secondaryVisible, uploads } = useSecondary();

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

    return groups;
  }, [regionVisible, secondaryLayers, secondaryVisible, uploads]);
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
  const { uploads } = useSecondary();
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
  }, [item, uploads]);

  // Derive: list of attributes + per-attribute summary (numeric/categorical)
  const attrs = useMemo(() => {
    if (!data?.features?.length) return [];
    // Inspect up to first 200 features to keep this snappy on large layers.
    const sample = data.features.slice(0, 200);
    const props = new Map();
    for (const f of sample) {
      const p = f.properties || {};
      for (const [k, v] of Object.entries(p)) {
        if (!props.has(k)) props.set(k, { name: k, values: [], numericCount: 0, total: 0 });
        const entry = props.get(k);
        entry.total += 1;
        if (entry.values.length < 6 && v != null && entry.values.indexOf(v) === -1) {
          entry.values.push(v);
        }
        if (typeof v === 'number' && Number.isFinite(v)) entry.numericCount += 1;
      }
    }
    return [...props.values()].map((e) => ({
      name: e.name,
      sample: e.values,
      kind: e.numericCount / Math.max(1, e.total) > 0.7 ? 'numeric' : 'categorical',
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
    if (v == null) continue;
    if (typeof v === 'number' && Number.isFinite(v)) {
      if (v < min) min = v;
      if (v > max) max = v;
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
  const s = hex.replace('#', '');
  const v =
    s.length === 3
      ? s.split('').map((c) => parseInt(c + c, 16))
      : [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  return { r: v[0] || 0, g: v[1] || 0, b: v[2] || 0 };
}

function rgbToHex(r, g, b) {
  const t = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${t(r)}${t(g)}${t(b)}`;
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

function isHex(v) { return /^#([0-9a-fA-F]{3}){1,2}$/.test(v); }

// ===========================================================================
// Felt-style color picker — HSL square + hue slider + preset rows
// ===========================================================================

const PRESET_ROWS = [
  ['#1f6f5c', '#5b8b3a', '#7eb539', '#65a30d', '#0f766e', '#0e7490', '#1d4ed8'],
  ['#22d3ee', '#93c5fd', '#a78bfa', '#c084fc', '#f472b6', '#dc2626', '#f97316'],
  ['#facc15', '#fde047', '#92400e', '#7c2d12', '#0f172a', '#475569', '#cbd5e1', '#ffffff'],
];

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
              'pl-1 pr-1.5 py-1 text-[11px] tabular-nums',
              'hover:border-[#16a085]/60 transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-[#16a085]/40',
            )}
            aria-label={ariaLabel}
          >
            {value ? (
              <>
                <span
                  className="h-4 w-4 rounded-sm border border-black/10 dark:border-white/10"
                  style={{ backgroundColor: value }}
                />
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
  const rgb = hexToRgb(value);
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  const [h, setH] = useState(hsv.h);
  const [s, setS] = useState(hsv.s);
  const [v, setV] = useState(hsv.v);
  const [hex, setHex] = useState(value);

  // Re-sync when external value changes (e.g. preset click)
  useEffect(() => {
    if (value && value.toLowerCase() !== hex.toLowerCase()) {
      const r = hexToRgb(value);
      const o = rgbToHsv(r.r, r.g, r.b);
      setH(o.h); setS(o.s); setV(o.v);
      setHex(value);
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

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
                className="h-5 w-7 rounded-sm border border-day-border dark:border-night-border text-[9px] font-medium text-day-muted dark:text-night-muted hover:border-[#16a085]"
              >
                None
              </button>
            )}
            {row.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onChange(c)}
                aria-label={c}
                className={cn(
                  'h-5 w-5 rounded-sm border transition-transform hover:scale-110',
                  value.toLowerCase() === c.toLowerCase()
                    ? 'border-[#16a085] ring-2 ring-[#16a085]/30'
                    : 'border-black/10 dark:border-white/10',
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Hex + format */}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={hex}
          onChange={(e) => {
            const v_ = e.target.value;
            setHex(v_);
            if (isHex(v_)) onChange(v_);
          }}
          spellCheck={false}
          className={cn(
            'flex-1 rounded-md px-2 py-1 text-[11px] tabular-nums uppercase',
            'bg-day-bg dark:bg-night-bg',
            'border border-day-border dark:border-night-border',
            'text-day-text dark:text-night-text',
            'focus:outline-none focus:ring-2 focus:ring-[#16a085]/40',
          )}
        />
        <span className="text-[11px] text-day-muted dark:text-night-muted">Hex</span>
        <span className="text-[11px] text-day-muted dark:text-night-muted">100%</span>
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
        className="w-full h-1 rounded-full appearance-none bg-day-border dark:bg-night-border accent-[#16a085] cursor-pointer"
      />
      <span className="w-12 text-right tabular-nums text-[11px] text-day-text dark:text-night-text">
        {format(value)}
      </span>
    </div>
  );
}

function GeometryGlyph({ geometry, className }) {
  const Icon =
    geometry === 'point' ? CircleDot : geometry === 'line' ? Slash : Square;
  return <Icon className={className} aria-hidden />;
}

function Section({ title, children, action }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-semibold text-day-text dark:text-night-text">{title}</span>
        {action ? <div className="ml-auto">{action}</div> : null}
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function Field({ label, children, action }) {
  return (
    <div className="grid grid-cols-[68px_1fr_auto] items-center gap-2">
      <span className="text-[11px] text-day-muted dark:text-night-muted capitalize">{label}</span>
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
            'px-2 py-1 text-left text-[11px]',
            'hover:border-[#16a085]/60 transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-[#16a085]/40',
          )}
        >
          <span className="flex-1 min-w-0 truncate">{renderTrigger(options.find((o) => o.id === value) ?? options[0])}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-day-muted dark:text-night-muted" />
        </Listbox.Button>
        <Transition as={Fragment} leave="transition ease-in duration-100" leaveFrom="opacity-100" leaveTo="opacity-0">
          <Listbox.Options
            anchor={{ to: 'bottom start', gap: 4 }}
            className={cn(
              'z-[100] max-h-64 w-[var(--button-width)] overflow-y-auto rounded-md py-1',
              'bg-white dark:bg-night-surface',
              'border border-day-border dark:border-night-border shadow-lg text-[11px] focus:outline-none',
            )}
          >
            {options.map((opt) => (
              <Listbox.Option
                key={opt.id}
                value={opt.id}
                className={({ active }) =>
                  cn(
                    'flex items-center gap-2 px-2 py-1 cursor-pointer select-none',
                    active ? 'bg-[#16a085]/10' : '',
                  )
                }
              >
                {({ selected }) => (
                  <>
                    <span className="flex-1 min-w-0 truncate">{renderOption(opt)}</span>
                    {selected && <Check className="h-3 w-3 text-[#16a085]" />}
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
    simple:    ['#16a085', '#16a085', '#16a085'],
    categories:['#dc2626', '#facc15', '#3b82f6'],
    colorRange:['#fee08b', '#f97316', '#dc2626'],
    sizeRange: ['#16a085', '#16a085', '#16a085'],
    heatmap:   ['#22c55e', '#facc15', '#dc2626'],
  }[type] || ['#16a085'];
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
  const [active, setActive] = useState(1); // 1 → A (low), 2 → B (high)
  const z = active === 1 ? value.z1 : value.z2;
  const v = active === 1 ? value.v1 : value.v2;

  const setZ = (nz) => {
    const z1 = active === 1 ? nz : value.z1;
    const z2 = active === 2 ? nz : value.z2;
    // keep A < B so the interpolate stays well-formed
    onChange({ ...value, z1: Math.min(z1, z2), z2: Math.max(z1, z2) });
  };
  const setV = (nv) => {
    onChange({ ...value, [active === 1 ? 'v1' : 'v2']: nv });
  };

  // Visual preview — two dots sized proportionally to v1/v2.
  const maxDot = 18;
  const minDot = 4;
  const span = Math.max(0.001, max - min);
  const sizeAt = (val) => minDot + ((val - min) / span) * (maxDot - minDot);

  const pos = (zoom) =>
    `${((zoom - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)) * 100}%`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center">
        <span className="text-[11px] font-semibold">Zoom-driven</span>
        <button
          type="button"
          onClick={onDeactivate}
          className="ml-auto text-[10px] text-day-muted dark:text-night-muted hover:text-red-500"
        >
          Remove
        </button>
      </div>

      {/* Visual preview */}
      <div className="flex items-end justify-between px-1 pb-2 border-b border-day-border/60 dark:border-night-border/60">
        <div className="flex flex-col items-center gap-1">
          <span
            className="rounded-full bg-[#16a085]"
            style={{ width: sizeAt(value.v1), height: sizeAt(value.v1) }}
          />
          <span className="text-[10px] tabular-nums text-day-muted dark:text-night-muted">
            {format(value.v1)}
          </span>
        </div>
        <div className="flex-1 mx-2 mb-1.5 h-px bg-gradient-to-r from-[#16a085]/30 via-[#16a085]/30 to-[#16a085]/30" />
        <div className="flex flex-col items-center gap-1">
          <span
            className="rounded-full bg-[#16a085]"
            style={{ width: sizeAt(value.v2), height: sizeAt(value.v2) }}
          />
          <span className="text-[10px] tabular-nums text-day-muted dark:text-night-muted">
            {format(value.v2)}
          </span>
        </div>
      </div>

      {/* Zoom range track — two clickable anchors */}
      <div>
        <div className="flex items-center justify-between mb-1 text-[10px] text-day-muted dark:text-night-muted">
          <span>z {ZOOM_MIN}</span>
          <span>Zoom range</span>
          <span>z {ZOOM_MAX}</span>
        </div>
        <div className="relative h-6">
          {/* track */}
          <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-day-border dark:bg-night-border" />
          {/* active range */}
          <span
            className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-[#16a085]/50"
            style={{ left: pos(value.z1), right: `calc(100% - ${pos(value.z2)})` }}
          />
          {/* anchor A */}
          <button
            type="button"
            onClick={() => setActive(1)}
            aria-label="Edit anchor A"
            className={cn(
              'absolute top-1/2 -translate-y-1/2 -translate-x-1/2 inline-flex flex-col items-center',
            )}
            style={{ left: pos(value.z1) }}
          >
            <span
              className={cn(
                'block h-3.5 w-3.5 rounded-full border-2 transition-transform',
                active === 1
                  ? 'bg-[#16a085] border-white scale-110 shadow'
                  : 'bg-white dark:bg-night-surface border-[#16a085]',
              )}
            />
            <span className={cn(
              'mt-0.5 text-[9px] tabular-nums',
              active === 1 ? 'text-[#16a085] font-semibold' : 'text-day-muted dark:text-night-muted',
            )}>{value.z1}</span>
          </button>
          {/* anchor B */}
          <button
            type="button"
            onClick={() => setActive(2)}
            aria-label="Edit anchor B"
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 inline-flex flex-col items-center"
            style={{ left: pos(value.z2) }}
          >
            <span
              className={cn(
                'block h-3.5 w-3.5 rounded-full border-2 transition-transform',
                active === 2
                  ? 'bg-[#16a085] border-white scale-110 shadow'
                  : 'bg-white dark:bg-night-surface border-[#16a085]',
              )}
            />
            <span className={cn(
              'mt-0.5 text-[9px] tabular-nums',
              active === 2 ? 'text-[#16a085] font-semibold' : 'text-day-muted dark:text-night-muted',
            )}>{value.z2}</span>
          </button>
        </div>
      </div>

      {/* Selected anchor config */}
      <div className="rounded-md bg-day-bg/60 dark:bg-night-bg/60 px-2.5 py-2">
        <div className="mb-1.5 flex items-center gap-1">
          <span className="text-[10px] font-semibold text-[#16a085]">
            Styling zoom {z}
          </span>
          <span className="ml-auto text-[10px] text-day-muted dark:text-night-muted">
            anchor {active === 1 ? 'A' : 'B'}
          </span>
        </div>
        <label className="flex items-center gap-2">
          <span className="w-10 text-[10px] text-day-muted dark:text-night-muted">Zoom</span>
          <input
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={0.5}
            value={z}
            onChange={(e) => setZ(Number(e.target.value))}
            className="flex-1 h-1 rounded-full appearance-none bg-day-border dark:bg-night-border accent-[#16a085] cursor-pointer"
          />
          <span className="w-8 text-right tabular-nums text-[11px]">{z}</span>
        </label>
        <label className="mt-1.5 flex items-center gap-2">
          <span className="w-10 text-[10px] text-day-muted dark:text-night-muted">Value</span>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={v}
            onChange={(e) => setV(Number(e.target.value))}
            className="flex-1 h-1 rounded-full appearance-none bg-day-border dark:bg-night-border accent-[#16a085] cursor-pointer"
          />
          <span className="w-12 text-right tabular-nums text-[11px]">{format(v)}</span>
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
                ? 'bg-[#16a085]/15 text-[#16a085] border-[#16a085]/40'
                : 'text-day-muted dark:text-night-muted hover:text-[#16a085]',
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
              'px-1 py-1 text-[11px]',
              'hover:border-[#16a085]/60 transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-[#16a085]/40',
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
                'z-[100] w-[260px] rounded-lg p-2',
                'bg-white dark:bg-night-surface',
                'border border-day-border dark:border-night-border shadow-xl',
              )}
            >
              <div className="flex flex-col gap-1.5">
                {CATEGORICAL_PALETTES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onChange(p.id)}
                    className={cn(
                      'flex items-center gap-2 rounded p-1 text-left transition-colors',
                      p.id === paletteId ? 'bg-[#16a085]/10' : 'hover:bg-day-bg dark:hover:bg-night-bg',
                    )}
                  >
                    <div className="flex h-4 w-32 overflow-hidden rounded-sm">
                      {p.colors.map((c) => (
                        <span key={c} className="flex-1" style={{ backgroundColor: c }} />
                      ))}
                    </div>
                    <span className="text-[11px]">{p.label}</span>
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
        <span className="text-[11px] font-semibold">Set categories</span>
        <label className="ml-auto inline-flex items-center gap-1 text-[10px] text-day-muted dark:text-night-muted cursor-pointer">
          <span>Show other</span>
          <Switch
            checked={showOther}
            onChange={(v) => onChange({ showOther: v })}
            className={cn(
              'relative inline-flex h-3.5 w-7 items-center rounded-full transition-colors',
              showOther ? 'bg-[#16a085]' : 'bg-day-border dark:bg-night-border',
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
            <span className="flex-1 truncate text-[11px]">{c.value}</span>
          </div>
        ))}
        {showOther && (
          <div className="flex items-center gap-1.5 mt-1 pt-1.5 border-t border-day-border/60 dark:border-night-border/60">
            <ColorButton
              value={otherColor}
              onChange={(nc) => onChange({ otherColor: nc })}
              ariaLabel="Other color"
            />
            <span className="flex-1 text-[11px] text-day-muted dark:text-night-muted">Other</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Color-range ramp swatch
// ===========================================================================

function RampSwatch({ rampId, reversed, onChangeRamp, onToggleReverse }) {
  const ramp = rampById(rampId);
  const stops = reversed ? [...ramp.stops].reverse() : ramp.stops;
  return (
    <Popover className="relative flex-1">
      {() => (
        <>
          <Popover.Button
            className={cn(
              'flex w-full items-center gap-1 rounded-md',
              'border border-day-border dark:border-night-border',
              'bg-white dark:bg-night-bg',
              'px-1 py-1 text-[11px]',
              'hover:border-[#16a085]/60 transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-[#16a085]/40',
            )}
          >
            <div
              className="flex-1 h-4 rounded-sm"
              style={{ background: `linear-gradient(to right, ${stops.join(', ')})` }}
            />
            <ChevronDown className="h-3 w-3 text-day-muted dark:text-night-muted" />
          </Popover.Button>
          <Transition as={Fragment} enter="transition ease-out duration-100"
            enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100">
            <Popover.Panel
              anchor={{ to: 'bottom end', gap: 6 }}
              className={cn(
                'z-[100] w-[260px] rounded-lg p-2',
                'bg-white dark:bg-night-surface',
                'border border-day-border dark:border-night-border shadow-xl',
              )}
            >
              <div className="flex flex-col gap-1">
                {COLOR_RAMPS.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onChangeRamp(r.id)}
                    className={cn(
                      'flex items-center gap-2 rounded p-1 text-left transition-colors',
                      r.id === rampId ? 'bg-[#16a085]/10' : 'hover:bg-day-bg dark:hover:bg-night-bg',
                    )}
                  >
                    <div
                      className="h-4 w-32 rounded-sm"
                      style={{ background: `linear-gradient(to right, ${r.stops.join(', ')})` }}
                    />
                    <span className="text-[11px]">{r.label}</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={onToggleReverse}
                  className="mt-1 inline-flex items-center justify-center gap-1.5 rounded border border-day-border dark:border-night-border px-2 py-1 text-[11px] text-day-text dark:text-night-text hover:bg-day-bg dark:hover:bg-night-bg"
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
          <span className="text-[11px]">{opt.name}</span>
          {opt.sample?.length ? (
            <span className="text-[9px] text-day-muted dark:text-night-muted truncate">
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
            'px-2.5 py-1.5 text-left text-[12px]',
            'hover:border-[#16a085]/60 transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-[#16a085]/40',
          )}
        >
          {selected ? (
            <>
              <GeometryGlyph geometry={selected.geometry} className="h-3.5 w-3.5 shrink-0 text-[#16a085]" />
              <span className="flex-1 min-w-0 truncate">
                {selected.regionLabel ? (
                  <>
                    <span className="text-day-muted dark:text-night-muted">{selected.regionLabel} · </span>
                    {selected.layerLabel}
                  </>
                ) : (
                  selected.layerLabel
                )}
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
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-day-muted dark:text-night-muted group-hover:text-[#16a085] transition-colors" />
        </Listbox.Button>
        <Transition as={Fragment} leave="transition ease-in duration-100" leaveFrom="opacity-100" leaveTo="opacity-0">
          <Listbox.Options
            anchor={{ to: 'bottom start', gap: 4 }}
            className={cn(
              'z-[100] max-h-72 w-[var(--button-width)] overflow-y-auto rounded-md py-1',
              'bg-white dark:bg-night-surface',
              'border border-day-border dark:border-night-border shadow-lg focus:outline-none text-[12px]',
            )}
          >
            {groups.length === 0 ? (
              <div className="px-3 py-2 text-day-muted dark:text-night-muted">
                No layers available — toggle a layer on first.
              </div>
            ) : groups.map((g) => (
              <div key={g.name}>
                <div className="px-2.5 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-day-muted dark:text-night-muted">
                  {g.name}
                </div>
                {g.items.map((item) => (
                  <Listbox.Option
                    key={item.id}
                    value={item.id}
                    className={({ active }) =>
                      cn('flex items-center gap-2 px-2.5 py-1.5 cursor-pointer select-none',
                        active ? 'bg-[#16a085]/10' : '')
                    }
                  >
                    {({ selected: isSel }) => (
                      <>
                        <GeometryGlyph
                          geometry={item.geometry}
                          className={cn('h-3 w-3 shrink-0',
                            item.visible ? 'text-[#16a085]' : 'text-day-muted dark:text-night-muted')}
                        />
                        <span className="flex-1 min-w-0 truncate">
                          {item.regionLabel ? (
                            <>
                              <span className="text-day-muted dark:text-night-muted">{item.regionLabel} · </span>
                              {item.layerLabel}
                            </>
                          ) : item.layerLabel}
                        </span>
                        {!item.visible && (
                          <span className="text-[9px] uppercase tracking-wider text-day-muted/70 dark:text-night-muted/70">hidden</span>
                        )}
                        {isSel && <Check className="h-3 w-3 text-[#16a085]" />}
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
  const { data, attrs, loading } = useLayerData(selected);

  const { styles, setLayerStyle, resetLayerStyle } = useSecondary();
  const style = selected ? effectiveStyle(selected.id, selected.geometry, styles[selected.id]) : null;

  const setStyle = (partial) => {
    if (!selected) return;
    const merged = { ...style, ...partial };
    if (partial.label) merged.label = { ...style.label, ...partial.label };
    if (partial.zoom)  merged.zoom  = { ...style.zoom,  ...partial.zoom  };
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
      <div className="flex flex-col gap-2.5">
        <LayerSelector groups={groups} selectedId={selectedId} onSelect={setSelectedId} />
        <div className="rounded-md border border-dashed border-day-border dark:border-night-border px-3 py-6 text-center text-[12px] text-day-muted dark:text-night-muted">
          Toggle a layer on (Primary or Secondary) to start styling.
        </div>
      </div>
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
    <div className="flex flex-col gap-3.5">
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
          <Field label="Color by">
            <AttributePicker
              attrs={attrs}
              value={style.rangeBy}
              onChange={handleRangeByChange}
              filter="numeric"
            />
          </Field>
        )}
        {style.type === 'sizeRange' && (
          <Field label="Size by">
            <AttributePicker
              attrs={attrs}
              value={style.sizeBy}
              onChange={handleSizeByChange}
              filter="numeric"
            />
          </Field>
        )}
      </Section>

      {/* ===== Geometry-specific paint ===== */}
      {style.type === 'heatmap' ? (
        <Section title="Heatmap">
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
                    <span className="text-[10px] text-day-muted dark:text-night-muted">min</span>
                    <input type="number" value={style.sizeMin} min={1} max={48} step={0.5}
                      onChange={(e) => setStyle({ sizeMin: Number(e.target.value) })}
                      className="w-12 rounded border border-day-border dark:border-night-border bg-day-bg dark:bg-night-bg px-1 py-0.5 text-[11px] tabular-nums" />
                    <span className="text-[10px] text-day-muted dark:text-night-muted">max</span>
                    <input type="number" value={style.sizeMax} min={1} max={48} step={0.5}
                      onChange={(e) => setStyle({ sizeMax: Number(e.target.value) })}
                      className="w-12 rounded border border-day-border dark:border-night-border bg-day-bg dark:bg-night-bg px-1 py-0.5 text-[11px] tabular-nums" />
                  </div>
                ) : zoomFor('radius') ? (
                  <span className="text-[11px] tabular-nums text-day-text dark:text-night-text">
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
                    <span className="text-[10px] text-day-muted dark:text-night-muted">min</span>
                    <input type="number" value={style.sizeMin} min={0.25} max={20} step={0.25}
                      onChange={(e) => setStyle({ sizeMin: Number(e.target.value) })}
                      className="w-12 rounded border border-day-border dark:border-night-border bg-day-bg dark:bg-night-bg px-1 py-0.5 text-[11px] tabular-nums" />
                    <span className="text-[10px] text-day-muted dark:text-night-muted">max</span>
                    <input type="number" value={style.sizeMax} min={0.25} max={20} step={0.25}
                      onChange={(e) => setStyle({ sizeMax: Number(e.target.value) })}
                      className="w-12 rounded border border-day-border dark:border-night-border bg-day-bg dark:bg-night-bg px-1 py-0.5 text-[11px] tabular-nums" />
                  </div>
                ) : zoomFor('width') ? (
                  <span className="text-[11px] tabular-nums text-day-text dark:text-night-text">
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
                    className={cn('flex-1 px-2 py-1 text-[11px] transition-colors',
                      !style.dashed ? 'bg-[#16a085] text-white' : 'text-day-muted dark:text-night-muted hover:bg-day-bg dark:hover:bg-night-bg')}>
                    Solid
                  </button>
                  <button type="button" onClick={() => setStyle({ dashed: true })}
                    className={cn('flex-1 px-2 py-1 text-[11px] transition-colors border-l border-day-border dark:border-night-border',
                      style.dashed ? 'bg-[#16a085] text-white' : 'text-day-muted dark:text-night-muted hover:bg-day-bg dark:hover:bg-night-bg')}>
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
                  <span className="text-[11px] tabular-nums text-day-text dark:text-night-text">
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
              style.label.enabled ? 'bg-[#16a085]' : 'bg-day-border dark:bg-night-border',
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
                      'flex-1 px-2 py-1 text-[11px] capitalize transition-colors',
                      s !== 'medium' && 'border-l border-day-border dark:border-night-border',
                      style.label.style === s
                        ? 'bg-[#16a085] text-white'
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

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-day-border dark:border-night-border pt-2.5 mt-1">
        <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.08em] text-day-muted dark:text-night-muted">
          <GeometryGlyph geometry={selected.geometry} className="h-3 w-3 text-[#16a085]" />
          {selected.geometry} layer
          {loading && <span className="ml-1 text-[#16a085]/80">· loading…</span>}
        </span>
        <button
          type="button"
          onClick={() => resetLayerStyle(selected.id)}
          className="inline-flex items-center gap-1 text-[11px] text-day-muted dark:text-night-muted hover:text-[#16a085] transition-colors"
        >
          <RotateCcw className="h-3 w-3" />
          Reset
        </button>
      </div>
    </div>
  );
}
