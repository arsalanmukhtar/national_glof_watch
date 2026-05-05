import { useState } from 'react';
import { AlertTriangle, Film, Sheet } from 'lucide-react';
import { motion } from 'framer-motion';
import VideosPanel from '@/components/dashboard/VideoPanels';
import AlertsPanel from '@/components/dashboard/AlertsPanel';
import AttributeTablePanel from '@/components/dashboard/AttributeTablePanel';
import { useSecondary } from '@/contexts/SecondaryContext';
import { cn } from '@/utils/cn';

// `requiresUploads: true` hides the section in containers (RightSidebar /
// MediaSwitcher) until the user has uploaded at least one secondary file.
export const MEDIA_SECTIONS = [
  { id: 'videos', label: 'Videos', icon: Film, render: () => <VideosPanel compact /> },
  {
    id: 'alerts',
    label: 'Alerts',
    icon: AlertTriangle,
    render: () => <AlertsPanel compact />,
  },
  {
    id: 'attributes',
    label: 'Attributes',
    icon: Sheet,
    requiresUploads: true,
    render: () => <AttributeTablePanel />,
  },
];

export default function MediaSwitcher({ initial = 'videos', className }) {
  const [activeId, setActiveId] = useState(initial);
  const { uploads } = useSecondary();
  // Sections marked requiresUploads only surface once the user has actually
  // uploaded a file in the Secondary panel.
  const sections = MEDIA_SECTIONS.filter(
    (s) => !s.requiresUploads || uploads.length > 0,
  );
  const active = sections.find((s) => s.id === activeId) ?? sections[0];

  return (
    <div className={cn('flex flex-col h-full min-h-0', className)}>
      <div role="tablist" className="flex items-center gap-1 p-1 bg-day-bg dark:bg-night-bg rounded-md mb-3 shrink-0">
        {sections.map(({ id, label, icon: Icon }) => {
          const on = activeId === id;
          return (
            <motion.button
              key={id}
              type="button"
              role="tab"
              aria-selected={on}
              whileTap={{ scale: 0.97 }}
              onClick={() => setActiveId(id)}
              className={cn(
                'flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded transition-colors',
                on
                  ? 'bg-[#16a085] text-white shadow-sm'
                  : 'text-day-text dark:text-night-text hover:bg-day-surface dark:hover:bg-night-surface',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </motion.button>
          );
        })}
      </div>

      <motion.div
        key={active.id}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="flex-1 min-h-0 overflow-y-auto pr-1"
      >
        {active.render()}
      </motion.div>
    </div>
  );
}
