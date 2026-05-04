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

const QUICK_LAYERS = [
  { id: 'glaciers', label: 'Glaciers', icon: Snowflake },
  { id: 'lakes', label: 'Glacial Lakes', icon: Waves },
  { id: 'incidents', label: 'Incidents', icon: AlertTriangle },
  { id: 'stations', label: 'EWS Stations', icon: Radio },
  { id: 'lst', label: 'LST', icon: Thermometer },
  { id: 'precip', label: 'Precipitation', icon: Cloud },
  { id: 'infra', label: 'Infrastructure', icon: Building2 },
  { id: 'terrain', label: '3D Terrain', icon: Mountain },
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
        {QUICK_LAYERS.map(({ id, label, icon: Icon }) => {
          const on = active.has(id);
          return (
            <motion.button
              key={id}
              type="button"
              whileTap={{ scale: 0.95 }}
              onClick={() => onToggle(id)}
              className={cn(
                'shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border transition-all',
                on
                  ? 'bg-brand-700 text-white border-brand-700 shadow-sm'
                  : 'bg-white text-day-text border-day-border hover:border-brand-300 dark:bg-night-surface dark:text-night-text dark:border-night-border dark:hover:border-brand-500',
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
