import { Layers, MapPin } from 'lucide-react';
import Accordion, { AccordionItem } from '@/components/ui/Accordion';
import Toggle from '@/components/ui/Toggle';
import SearchBox from '@/components/ui/SearchBox';
import Badge from '@/components/ui/Badge';
import { useState } from 'react';

const REGIONS = [
  { id: 'badswat', label: 'Badswat', layers: ['Glacier', 'Lake', 'Risk Zonation', 'Fault Line'] },
  { id: 'hinarchi', label: 'Hinarchi', layers: ['Glacier', 'Lake', 'Risk Zonation'] },
  { id: 'reshun', label: 'Reshun', layers: ['Buildings', 'River', 'Risk Zonation'] },
  { id: 'pindoru', label: 'Pindoru', layers: ['Lake', 'Risk Zonation'] },
  { id: 'brep', label: 'Brep', layers: ['Risk Zonation'] },
  { id: 'darkot', label: 'Darkot', layers: ['Buildings', 'Glaciers', 'River', 'Schools', 'Risk Zonation'] },
  { id: 'gulmit', label: 'Gulmit', layers: ['Buildings', 'Rivers', 'Roads', 'Schools', 'Risk Zonation'] },
  { id: 'thalu', label: 'Thalu', layers: ['Risk Zonation'] },
  { id: 'sardar_gol', label: 'Sardar Gol', layers: ['Risk Zonation'] },
  { id: 'tersthunder', label: 'Tersthunder', layers: ['Risk Zonation'] },
];

function LayerToggle({ name }) {
  const [on, setOn] = useState(false);
  return (
    <label className="flex items-center justify-between gap-3 py-1.5 cursor-pointer text-day-text dark:text-night-text">
      <span className="text-sm">{name}</span>
      <Toggle checked={on} onChange={setOn} label={`Toggle ${name}`} />
    </label>
  );
}

export default function LayerMenu({ compact = false }) {
  return (
    <div className={compact ? '' : 'p-1'}>
      <div className="mb-3 flex items-center gap-2">
        <Layers className="h-4 w-4 text-brand-700 dark:text-brand-200" />
        <span className="label-base">Regions</span>
        <Badge tone="brand" className="ml-auto">{REGIONS.length}</Badge>
      </div>

      <SearchBox placeholder="Search regions or layers…" className="mb-3" />

      <Accordion>
        {REGIONS.map((region) => (
          <AccordionItem
            key={region.id}
            title={region.label}
            icon={<MapPin className="h-4 w-4 text-brand-600 dark:text-brand-300" />}
          >
            <div className="space-y-0.5">
              {region.layers.map((layer) => (
                <LayerToggle key={`${region.id}-${layer}`} name={layer} />
              ))}
            </div>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
