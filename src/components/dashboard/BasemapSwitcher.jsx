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
        'absolute top-3 left-3 z-10 flex items-center gap-0.5 p-1 rounded-md shadow-sm',
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
              'inline-flex items-center justify-center h-7 px-2 rounded text-xs font-medium transition-colors',
              on
                ? 'bg-brand-700 text-white'
                : 'text-day-text dark:text-night-text hover:bg-day-bg dark:hover:bg-night-bg',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden xl:inline ml-1.5">{label}</span>
          </button>
        );
      })}
    </motion.div>
  );
}
