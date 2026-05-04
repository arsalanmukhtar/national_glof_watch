import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Layers, Map, Moon, Mountain, Satellite, Sun } from 'lucide-react';
import { cn } from '@/utils/cn';

const OPTIONS = [
  { id: 'satellite', label: 'Satellite', icon: Satellite },
  { id: 'streets',   label: 'Streets',   icon: Map },
  { id: 'outdoors',  label: 'Outdoors',  icon: Mountain },
  { id: 'light',     label: 'Light',     icon: Sun },
  { id: 'dark',      label: 'Dark',      icon: Moon },
];

// Collapsible basemap chooser. Default state is just the Layers icon —
// click it to slide the chip row open from left to right. Click again
// (or pick a basemap) and it stays expanded until the user collapses it.
export default function BasemapSwitcher({ current, onChange }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.15 }}
      className={cn(
        'absolute top-2 left-2 z-10 flex items-center gap-0.5 p-0.5 rounded-md shadow-sm',
        'bg-white/95 dark:bg-night-surface/95 backdrop-blur-sm',
        'border border-day-border dark:border-night-border',
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        aria-label="Basemap"
        title="Basemap"
        className={cn(
          'inline-flex items-center justify-center h-6 w-6 rounded transition-colors shrink-0',
          expanded
            ? 'bg-[#16a085] text-white'
            : 'text-day-text dark:text-night-text hover:bg-day-bg dark:hover:bg-night-bg',
        )}
      >
        <Layers className="h-3 w-3" strokeWidth={2} />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="basemap-chips"
            role="radiogroup"
            aria-label="Basemap"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 'auto', opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="flex items-center gap-0.5 overflow-hidden"
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
                    'inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-medium transition-colors whitespace-nowrap',
                    on
                      ? 'bg-[#16a085] text-white'
                      : 'text-day-text dark:text-night-text hover:bg-day-bg dark:hover:bg-night-bg',
                  )}
                >
                  <Icon className="h-3 w-3" />
                  <span>{label}</span>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
