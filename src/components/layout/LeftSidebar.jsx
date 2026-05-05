import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Layers, Shapes, SlidersHorizontal, X } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import LayerMenu from '@/components/dashboard/LayerMenu';
import ParametersPanel from '@/components/dashboard/ParametersPanel';
import SecondaryPanel from '@/components/dashboard/SecondaryPanel';
import { cn } from '@/utils/cn';

// `secondary` is "modal": activating it hides the others, and activating
// any other deactivates secondary. The first two stack as before.
const SECONDARY_ID = 'secondary';

const SECTIONS = [
  {
    id: 'parameters',
    label: 'PMD Parameters',
    icon: SlidersHorizontal,
    headerIcon: SlidersHorizontal,
    title: 'PMD Parameters',
    grow: false,
    render: () => <ParametersPanel />,
  },
  {
    id: 'layers',
    label: 'Layers',
    icon: Layers,
    headerIcon: Layers,
    title: 'Layers',
    grow: true,
    render: () => <LayerMenu />,
  },
  {
    id: SECONDARY_ID,
    label: 'Secondary Layers',
    icon: Shapes,
    headerIcon: null, // toggle-strip icon already conveys this; avoid duplication
    title: 'Secondary Layers',
    grow: true,
    render: () => <SecondaryPanel />,
  },
];

export default function LeftSidebar({ className }) {
  // Default: parameters + layers open. Secondary off until invoked.
  const [activeIds, setActiveIds] = useState(
    () => new Set(['parameters', 'layers']),
  );

  const toggle = (id) => {
    setActiveIds((prev) => {
      const next = new Set(prev);
      if (id === SECONDARY_ID) {
        // Activating secondary takes over; deactivating it leaves the bar empty.
        if (next.has(SECONDARY_ID)) {
          next.delete(SECONDARY_ID);
        } else {
          next.clear();
          next.add(SECONDARY_ID);
        }
        return next;
      }
      // Toggling parameters/layers exits secondary mode automatically.
      next.delete(SECONDARY_ID);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const close = (id) => {
    setActiveIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const visibleSections = SECTIONS.filter((s) => activeIds.has(s.id));

  return (
    <aside
      className={cn(
        'hidden lg:flex flex-row items-stretch shrink-0 min-h-0 gap-2',
        className,
      )}
    >
      {/* Icon strip — always visible on lg+ */}
      <div className="card-base flex flex-col items-center gap-1 p-2 w-14 shrink-0">
        {SECTIONS.map(({ id, label, icon: Icon }) => {
          const on = activeIds.has(id);
          return (
            <Tooltip key={id} label={label} side="right">
              <motion.button
                type="button"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => toggle(id)}
                aria-pressed={on}
                aria-label={label}
                className={cn(
                  'btn-icon transition-colors',
                  on
                    ? 'bg-[#16a085] text-white hover:bg-[#138b72]'
                    : 'btn-ghost',
                )}
              >
                <Icon className="h-5 w-5" />
              </motion.button>
            </Tooltip>
          );
        })}
      </div>

      {/* Content stack — slides out when at least one section is active */}
      <AnimatePresence initial={false}>
        {visibleSections.length > 0 ? (
          <motion.div
            key="content"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 320, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden min-h-0"
          >
            <div className="flex flex-col gap-2 w-[320px] h-full min-h-0">
              {visibleSections.map(
                ({ id, headerIcon: HeaderIcon, title, grow, render }) => {
                  // Panels with a sticky sub-header (Layers) own the visual
                  // divider themselves; suppress the panel-header's bottom
                  // border + padding so they sit flush.
                  const flush = id === 'layers';
                  return (
                  <div
                    key={id}
                    className={cn(
                      'card-base flex flex-col min-h-0 overflow-hidden',
                      grow ? 'flex-1' : 'shrink-0',
                    )}
                  >
                    <div
                      className={cn(
                        'flex items-center justify-between px-2.5 pt-2 mb-0 shrink-0',
                        flush
                          ? 'pb-2 border-b-0'
                          : 'pb-1.5 border-b border-day-border dark:border-night-border',
                      )}
                    >
                      <h2 className="text-[13px] font-semibold flex items-center gap-1.5">
                        {HeaderIcon ? (
                          <HeaderIcon className="h-3.5 w-3.5 text-brand-700 dark:text-brand-200" />
                        ) : null}
                        {title}
                      </h2>
                      <button
                        type="button"
                        onClick={() => close(id)}
                        className="btn-icon btn-ghost ml-auto h-7 w-7"
                        aria-label={`Close ${title}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div
                      className={cn(
                        'px-2.5 pb-2',
                        flush ? 'pt-0' : 'pt-2',
                        grow ? 'flex-1 min-h-0 overflow-y-auto' : '',
                      )}
                    >
                      {render()}
                    </div>
                  </div>
                  );
                },
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </aside>
  );
}
