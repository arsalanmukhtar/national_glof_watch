import { motion } from 'framer-motion';
import {
  AlertTriangle,
  Building2,
  Cloud,
  Mountain,
  Radio,
  Snowflake,
  Thermometer,
  Waves,
} from 'lucide-react';
import { cn } from '@/utils/cn';

// Per-layer styles. Strings written out in full so Tailwind's content scan
// picks them up — never compose color classes dynamically.
const QUICK_LAYERS = [
  {
    id: 'glaciers',
    label: 'Glaciers',
    icon: Snowflake,
    on: 'bg-sky-500 text-white border-sky-500 shadow-sm',
    off: 'bg-sky-500/10 text-sky-700 border-sky-500/40 hover:bg-sky-500/20 dark:text-sky-300 dark:bg-sky-500/15 dark:border-sky-500/50 dark:hover:bg-sky-500/25',
  },
  {
    id: 'lakes',
    label: 'Glacial Lakes',
    icon: Waves,
    on: 'bg-blue-500 text-white border-blue-500 shadow-sm',
    off: 'bg-blue-500/10 text-blue-700 border-blue-500/40 hover:bg-blue-500/20 dark:text-blue-300 dark:bg-blue-500/15 dark:border-blue-500/50 dark:hover:bg-blue-500/25',
  },
  {
    id: 'incidents',
    label: 'Incidents',
    icon: AlertTriangle,
    on: 'bg-rose-500 text-white border-rose-500 shadow-sm',
    off: 'bg-rose-500/10 text-rose-700 border-rose-500/40 hover:bg-rose-500/20 dark:text-rose-300 dark:bg-rose-500/15 dark:border-rose-500/50 dark:hover:bg-rose-500/25',
  },
  {
    id: 'stations',
    label: 'EWS Stations',
    icon: Radio,
    on: 'bg-emerald-500 text-white border-emerald-500 shadow-sm',
    off: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/40 hover:bg-emerald-500/20 dark:text-emerald-300 dark:bg-emerald-500/15 dark:border-emerald-500/50 dark:hover:bg-emerald-500/25',
  },
  {
    id: 'lst',
    label: 'LST',
    icon: Thermometer,
    on: 'bg-orange-500 text-white border-orange-500 shadow-sm',
    off: 'bg-orange-500/10 text-orange-700 border-orange-500/40 hover:bg-orange-500/20 dark:text-orange-300 dark:bg-orange-500/15 dark:border-orange-500/50 dark:hover:bg-orange-500/25',
  },
  {
    id: 'precip',
    label: 'Precipitation',
    icon: Cloud,
    on: 'bg-indigo-500 text-white border-indigo-500 shadow-sm',
    off: 'bg-indigo-500/10 text-indigo-700 border-indigo-500/40 hover:bg-indigo-500/20 dark:text-indigo-300 dark:bg-indigo-500/15 dark:border-indigo-500/50 dark:hover:bg-indigo-500/25',
  },
  {
    id: 'infra',
    label: 'Infrastructure',
    icon: Building2,
    on: 'bg-violet-500 text-white border-violet-500 shadow-sm',
    off: 'bg-violet-500/10 text-violet-700 border-violet-500/40 hover:bg-violet-500/20 dark:text-violet-300 dark:bg-violet-500/15 dark:border-violet-500/50 dark:hover:bg-violet-500/25',
  },
  {
    id: 'terrain',
    label: '3D Terrain',
    icon: Mountain,
    on: 'bg-amber-600 text-white border-amber-600 shadow-sm',
    off: 'bg-amber-600/10 text-amber-700 border-amber-600/40 hover:bg-amber-600/20 dark:text-amber-300 dark:bg-amber-600/15 dark:border-amber-600/50 dark:hover:bg-amber-600/25',
  },
];

export default function QuickToggles({ active, onToggle }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="card-base px-3 py-2 shrink-0"
    >
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin">
        <span className="label-base shrink-0 mr-1 hidden md:inline">Quick Layers</span>
        {QUICK_LAYERS.map(({ id, label, icon: Icon, on: onClass, off: offClass }) => {
          const on = active.has(id);
          return (
            <motion.button
              key={id}
              type="button"
              whileTap={{ scale: 0.95 }}
              onClick={() => onToggle(id)}
              className={cn(
                'shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border transition-all',
                on ? onClass : offClass,
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </motion.button>
          );
        })}
      </div>
    </motion.div>
  );
}
