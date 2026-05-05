import { Layers, MapPin } from 'lucide-react';
import Accordion, { AccordionItem } from '@/components/ui/Accordion';
import Toggle from '@/components/ui/Toggle';
import SearchBox from '@/components/ui/SearchBox';
import Badge from '@/components/ui/Badge';
import { cn } from '@/utils/cn';
import { useMemo, useState } from 'react';

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

function LayerToggle({ name }) {
  const [on, setOn] = useState(false);
  const { outline, toggle } = layerStyle(name);
  return (
    <label
      className={cn(
        'flex items-center justify-between gap-2 px-2.5 py-1 rounded-md border cursor-pointer text-day-text dark:text-night-text transition-colors',
        outline,
      )}
    >
      <span className="text-[13px]">{name}</span>
      <Toggle
        checked={on}
        onChange={setOn}
        label={`Toggle ${name}`}
        activeClass={toggle}
      />
    </label>
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
          accordion list scrolls underneath. Negative margins counter the
          parent (LeftSidebar) wrapper's px-2.5 / pt-2 so the sticky bar
          spans edge-to-edge of the panel card. */}
      <div className="sticky top-0 z-10 -mx-2.5 -mt-2 px-2.5 pt-2 pb-2 bg-white dark:bg-night-surface">
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
                {region.layers.map((layer) => (
                  <LayerToggle key={`${region.id}-${layer}`} name={layer} />
                ))}
              </div>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </div>
  );
}
