import { motion } from 'framer-motion';
import { Map, Moon, Mountain, Satellite, Sun } from 'lucide-react';
import { cn } from '@/utils/cn';

const OPTIONS = [
  { id: 'satellite', label: 'Satellite', icon: Satellite },
  { id: 'streets', label: 'Streets', icon: Map },
  { id: 'outdoors', label: 'Outdoors', icon: Mountain },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
];

export default function BasemapSwitcher({ current, onChange }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.15 }}
      role="radiogroup"
      aria-label="Basemap"
      className={cn(
        'absolute top-2 left-2 z-10 flex items-center gap-0.5 p-0.5 rounded-md shadow-sm',
        'bg-white/95 dark:bg-night-surface/95 backdrop-blur-sm',
        'border border-day-border dark:border-night-border',
      )}
    >
      {OPTIONS.map(({ id, label, icon: Icon }) => {
        const on = current === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            title={label}
            onClick={() => onChange(id)}
            className={cn(
              'inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-medium transition-colors',
              on
                ? 'bg-brand-700 text-white dark:bg-[#16a085]'
                : 'text-day-text dark:text-night-text hover:bg-day-bg dark:hover:bg-night-bg',
            )}
          >
            <Icon className="h-3 w-3" />
            <span>{label}</span>
          </button>
        );
      })}
    </motion.div>
  );
}
