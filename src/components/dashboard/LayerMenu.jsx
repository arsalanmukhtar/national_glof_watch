import { ChevronDown, Layers, MapPin, Shrink, TableProperties } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import Accordion, { AccordionItem } from '@/components/ui/Accordion';
import EyeToggle from '@/components/ui/EyeToggle';
import SearchBox from '@/components/ui/SearchBox';
import Badge from '@/components/ui/Badge';
import TruncateLabel from '@/components/ui/TruncateLabel';
import { cn } from '@/utils/cn';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRegionLayers } from '@/contexts/RegionLayersContext';
import { useMapView } from '@/contexts/MapContext';
import { useAttributeTables } from '@/contexts/AttributeTablesContext';

// Mirrors the per-region tables loaded into PostGIS via
// scripts/shell/geojson2postgis.sh — each layer string maps to one or
// more tables in the rivers / lakes / risk_zones / glaciers / faultlines /
// buildings / schools / roads schemas.
const REGIONS = [
  { id: 'badswat',       label: 'Badswat',       layers: ['Lake', 'Glacier', 'Faultline', 'Risk Zones'] },
  { id: 'brep',          label: 'Brep',          layers: ['Risk Zones'] },
  { id: 'chatiboi',      label: 'Chatiboi',      layers: ['Lake', 'River', 'Risk Zones'] },
  { id: 'chitral',       label: 'Chitral',       layers: ['River'] },
  { id: 'darkot',        label: 'Darkot',        layers: ['River', 'Glacier', 'Buildings', 'Schools', 'Risk Zones'] },
  { id: 'gulmit',        label: 'Gulmit',        layers: ['River', 'Roads', 'Buildings', 'Schools', 'Risk Zones'] },
  { id: 'hinarchi',      label: 'Hinarchi',      layers: ['Lake', 'Risk Zones'] },
  { id: 'ishokoman',     label: 'Ishokoman',     layers: ['River', 'Risk Zones'] },
  { id: 'karambar',      label: 'Karambar',      layers: ['Lake'] },
  { id: 'lusht',         label: 'Lusht',         layers: ['Risk Zones'] },
  { id: 'pindoru_chaat', label: 'Pindoru Chaat', layers: ['Lake', 'Risk Zones'] },
  { id: 'reshun',        label: 'Reshun',        layers: ['River', 'Glacier', 'Faultline', 'Risk Zones'] },
  { id: 'sardar_gol',    label: 'Sardar Gol',    layers: ['Risk Zones'] },
  { id: 'shisper',       label: 'Shisper',       layers: ['Lake', 'Risk Zones'] },
  { id: 'terset_hundur', label: 'Terset Hundur', layers: ['Lake', 'River', 'Risk Zones'] },
  { id: 'ultar',         label: 'Ultar',         layers: ['Risk Zones'] },
];

// One outline + toggle color per layer type, shared across regions.
// Outlines run at /60 opacity; toggle fills stay full opacity for clarity.
// Strings are written out so Tailwind picks them up at build time.
// Keys are matched after lowercasing + trailing-'s' strip — so 'Lakes',
// 'Lake', 'Buildings', 'Building' all resolve to the same entry.
const LAYER_STYLES = {
  glacier:     { outline: 'border-sky-500/60 dark:border-sky-400/60',         toggle: 'bg-sky-500' },
  lake:        { outline: 'border-blue-500/60 dark:border-blue-400/60',       toggle: 'bg-blue-500' },
  'risk zone': { outline: 'border-rose-500/60 dark:border-rose-400/60',       toggle: 'bg-rose-500' },
  faultline:   { outline: 'border-orange-500/60 dark:border-orange-400/60',   toggle: 'bg-orange-500' },
  building:    { outline: 'border-violet-500/60 dark:border-violet-400/60',   toggle: 'bg-violet-500' },
  river:       { outline: 'border-cyan-500/60 dark:border-cyan-400/60',       toggle: 'bg-cyan-500' },
  school:      { outline: 'border-emerald-500/60 dark:border-emerald-400/60', toggle: 'bg-emerald-500' },
  road:        { outline: 'border-slate-500/60 dark:border-slate-400/60',     toggle: 'bg-slate-500' },
};

const FALLBACK_STYLE = {
  outline: 'border-day-border dark:border-night-border',
  toggle: 'bg-accent-orange',
};

function layerStyle(name) {
  const key = name.toLowerCase().replace(/s$/, '');
  return LAYER_STYLES[key] ?? FALLBACK_STYLE;
}

// Map a UI label ("Lake", "Buildings", "Risk Zones") to the layerKey used
// by layerSources / RegionLayersContext ("lake", "building"). Risk zones
// are rendered through RiskZonesRow so they don't pass through here.
function labelToLayerKey(label) {
  return label.toLowerCase().replace(/s$/, '');
}

// Small icon button that flies the map to a layer's extent. Lives next to
// the eye toggle in every row so users can preview a layer's footprint
// without first turning it on.
function ShrinkButton({ onClick, label }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.92 }}
      onClick={onClick}
      title={label}
      aria-label={label}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-day-muted dark:text-night-muted hover:text-[#16a085] hover:bg-[#16a085]/10 transition-colors"
    >
      <Shrink className="h-3.5 w-3.5" aria-hidden />
    </motion.button>
  );
}

// Sibling to ShrinkButton — opens this layer's attribute table in the
// chart panel's "Attributes Table" tab. Stays highlighted (#16a085 bg)
// while its table is open so the user can see at a glance which rows
// have an attribute view active.
function AttrTableButton({ open, onClick, label }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.92 }}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={open}
      className={cn(
        'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors',
        open
          ? 'bg-[#16a085]/15 text-[#16a085]'
          : 'text-day-muted dark:text-night-muted hover:text-[#16a085] hover:bg-[#16a085]/10',
      )}
    >
      <TableProperties className="h-3.5 w-3.5" aria-hidden />
    </motion.button>
  );
}

function LayerToggle({ regionId, name }) {
  const { isLayerVisible, toggleLayer } = useRegionLayers();
  const { zoomToRegionLayer } = useMapView();
  const { toggleTable, isOpen } = useAttributeTables();
  const layerKey = labelToLayerKey(name);
  const on = isLayerVisible(regionId, layerKey);
  const { outline } = layerStyle(name);

  // Toggle + fly: every visibility change also frames the layer so the
  // user immediately sees where the affected geometry lives. Works in
  // both directions — flying after toggle-off briefly shows the location
  // before the layer fades, which doubles as a "where was that?" cue.
  const handleToggle = () => {
    toggleLayer(regionId, layerKey);
    zoomToRegionLayer(regionId, layerKey);
  };

  const tableId = `region:${regionId}:${layerKey}`;
  const tableOpen = isOpen(tableId);
  const regionLabel =
    REGIONS.find((r) => r.id === regionId)?.label ?? regionId;
  const handleTableToggle = () => {
    toggleTable({
      id: tableId,
      kind: 'region',
      regionId,
      layerKey,
      label: `${regionLabel} · ${name}`,
    });
  };

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-1 pl-2.5 pr-1 py-0.5 rounded-md border text-day-text dark:text-night-text transition-colors',
        outline,
      )}
    >
      <span className="flex-1 min-w-0">
        <TruncateLabel text={name} className="text-[14px]" />
      </span>
      <AttrTableButton
        open={tableOpen}
        onClick={handleTableToggle}
        label={tableOpen ? `Close ${name} attributes` : `Open ${name} attributes`}
      />
      <ShrinkButton
        onClick={() => zoomToRegionLayer(regionId, layerKey)}
        label={`Zoom to ${name}`}
      />
      <EyeToggle
        checked={on}
        onChange={handleToggle}
        label={`Toggle ${name}`}
      />
    </div>
  );
}

// Risk-level pill specs — three independently-toggleable buttons that sit
// inline inside an expandable "Risk Zones" row. Colors are chosen for clear
// contrast in both day & night modes; yellow uses dark text since white-on-
// yellow fails WCAG AA.
const RISK_LEVELS = [
  {
    id: 'low',
    label: 'Low',
    on:  'bg-yellow-400 text-yellow-950 border-yellow-400 shadow-sm',
    off: 'border-yellow-500/60 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-400/10',
  },
  {
    id: 'medium',
    label: 'Medium',
    on:  'bg-orange-500 text-white border-orange-500 shadow-sm',
    off: 'border-orange-500/60 text-orange-700 dark:text-orange-300 hover:bg-orange-500/10',
  },
  {
    id: 'high',
    label: 'High',
    on:  'bg-red-500 text-white border-red-500 shadow-sm',
    off: 'border-red-500/60 text-red-700 dark:text-red-300 hover:bg-red-500/10',
  },
];

function RiskZonesRow({ regionId }) {
  const { isLayerVisible, toggleLayer } = useRegionLayers();
  const { zoomToRegionLayer, zoomToRegionRiskZones } = useMapView();
  const { toggleTable, isOpen } = useAttributeTables();
  const [open, setOpen] = useState(false);
  // First time the dropdown is opened we auto-toggle every level on so
  // the user immediately sees Low / Medium / High coloring. Subsequent
  // opens preserve whatever the user has since toggled — only first
  // open triggers the seed.
  const seededRef = useRef(false);

  const isOn = (level) => isLayerVisible(regionId, `risk:${level}`);

  useEffect(() => {
    if (!open || seededRef.current) return;
    seededRef.current = true;
    for (const { id } of RISK_LEVELS) {
      if (!isLayerVisible(regionId, `risk:${id}`)) {
        toggleLayer(regionId, `risk:${id}`);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const activeCount = RISK_LEVELS.reduce(
    (acc, { id }) => acc + (isOn(id) ? 1 : 0),
    0,
  );
  const anyOn = activeCount > 0;

  const tableId = `region:${regionId}:risk`;
  const tableOpen = isOpen(tableId);
  const regionLabel =
    REGIONS.find((r) => r.id === regionId)?.label ?? regionId;
  const handleTableToggle = () => {
    toggleTable({
      id: tableId,
      kind: 'risk',
      regionId,
      label: `${regionLabel} · Risk Zones`,
    });
  };

  // Each level pill toggles + zooms to its own file, mirroring the
  // LayerToggle behavior so risk pills feel consistent with regular layers.
  const handlePill = (level) => {
    toggleLayer(regionId, `risk:${level}`);
    zoomToRegionLayer(regionId, `risk:${level}`);
  };

  return (
    <div
      className={cn(
        'rounded-md border transition-colors',
        anyOn
          ? 'border-rose-500/70 dark:border-rose-400/70'
          : 'border-rose-500/40 dark:border-rose-400/40',
      )}
    >
      {/* Mirrors LayerToggle's geometry exactly so vertical columns line
          up across rows: label · Shrink · trailing-action. The chevron
          replaces the EyeToggle in the third slot, sized identically
          (h-7 w-7 button, h-4 w-4 glyph) so the row has true symmetry. */}
      <div className="flex items-center gap-1 pl-2.5 pr-1 py-0.5 text-day-text dark:text-night-text">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex-1 inline-flex items-center min-w-0 gap-1.5 text-left"
        >
          <span className="text-[14px] flex-1 truncate">Risk Zones</span>
          {anyOn ? (
            <span className="text-[11px] font-semibold tabular-nums text-rose-600 dark:text-rose-400">
              {activeCount}/3
            </span>
          ) : null}
        </button>
        <AttrTableButton
          open={tableOpen}
          onClick={handleTableToggle}
          label={tableOpen ? 'Close risk-zone attributes' : 'Open risk-zone attributes'}
        />
        <ShrinkButton
          onClick={() => zoomToRegionRiskZones(regionId)}
          label="Zoom to risk zones"
        />
        <motion.button
          type="button"
          whileTap={{ scale: 0.92 }}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? 'Collapse risk levels' : 'Expand risk levels'}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-day-muted dark:text-night-muted hover:text-[#16a085] hover:bg-[#16a085]/10 transition-colors"
        >
          <ChevronDown
            className={cn(
              'h-4 w-4 transition-transform duration-200',
              open && 'rotate-180',
            )}
            aria-hidden
          />
        </motion.button>
      </div>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="levels"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-1 px-2 pb-1.5">
              {RISK_LEVELS.map(({ id, label, on, off }) => {
                const active = isOn(id);
                return (
                  <motion.button
                    key={id}
                    type="button"
                    whileTap={{ scale: 0.96 }}
                    onClick={() => handlePill(id)}
                    aria-pressed={active}
                    aria-label={`${label} risk`}
                    className={cn(
                      'flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[12px] font-semibold uppercase tracking-wide border transition-colors',
                      active ? on : off,
                    )}
                  >
                    {label}
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default function LayerMenu({ compact = false }) {
  const [query, setQuery] = useState('');

  // A region matches if its name contains the query, OR if any of its
  // layers does. Region match keeps the full layer list visible; a layer-
  // only match narrows the region down to just the matched layer(s).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return REGIONS;
    return REGIONS.flatMap((r) => {
      const regionMatch = r.label.toLowerCase().includes(q);
      const matchedLayers = r.layers.filter((l) =>
        l.toLowerCase().includes(q),
      );
      if (regionMatch) return [r];
      if (matchedLayers.length > 0) return [{ ...r, layers: matchedLayers }];
      return [];
    });
  }, [query]);

  return (
    <div className={compact ? '' : ''}>
      {/* Pinned header: "Regions" label + search stay visible while the
          accordion list scrolls underneath. Negative horizontal margin
          counters the parent's px-2.5 so the sticky bar spans edge-to-edge
          of the panel card and sits flush against the title (the LeftSidebar
          drops its top padding for this section so no -mt is needed). */}
      <div className="sticky top-0 z-10 -mx-2.5 px-2.5 pt-2 pb-2 bg-white dark:bg-night-surface border-b border-day-border dark:border-night-border">
        <div className="mb-2 flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5 text-brand-700 dark:text-brand-200" />
          <span className="label-base">Regions</span>
          <Badge tone="brand" className="ml-auto">
            {filtered.length}
            {query && filtered.length !== REGIONS.length ? ` / ${REGIONS.length}` : ''}
          </Badge>
        </div>

        <SearchBox
          placeholder="Search regions or layers…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="px-2 py-3 text-xs text-center text-day-muted dark:text-night-muted">
          No regions or layers match “{query}”.
        </p>
      ) : (
        <Accordion>
          {filtered.map((region) => (
            <AccordionItem
              key={region.id}
              title={region.label}
              icon={<MapPin className="h-3.5 w-3.5 text-brand-600 dark:text-brand-300" />}
            >
              <div className="space-y-1">
                {region.layers.map((layer) =>
                  layer === 'Risk Zones' ? (
                    <RiskZonesRow key={`${region.id}-risk`} regionId={region.id} />
                  ) : (
                    <LayerToggle
                      key={`${region.id}-${layer}`}
                      regionId={region.id}
                      name={layer}
                    />
                  ),
                )}
              </div>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </div>
  );
}
