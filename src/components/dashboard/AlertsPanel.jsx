import { useState } from 'react';
import Panel from '@/components/ui/Panel';
import Modal from '@/components/ui/Modal';
import { cn } from '@/utils/cn';

const ALERT_MODULES = import.meta.glob('../../assets/images/alerts/*.{jpeg,jpg,png,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
});

const ALERTS = Object.entries(ALERT_MODULES)
  .map(([path, src]) => {
    const name = path.split('/').pop() ?? '';
    return {
      src,
      label: name.replace(/\.[^.]+$/, '').replace(/_/g, ' '),
    };
  })
  .sort((a, b) => a.label.localeCompare(b.label));

export default function AlertsPanel({ compact = false }) {
  const [active, setActive] = useState(null);

  const gridClass = compact
    ? 'grid grid-cols-2 gap-2'
    : 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3';

  return (
    <>
      <Panel title={compact ? null : 'Alerts'} className={compact ? 'border-0 shadow-none p-0' : ''}>
        <div className={gridClass}>
          {ALERTS.map((alert) => (
            <button
              key={alert.src}
              type="button"
              onClick={() => setActive(alert)}
              className={cn(
                'group relative aspect-[4/3] overflow-hidden rounded-md border border-day-border dark:border-night-border focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
              )}
            >
              <img
                src={alert.src}
                alt={alert.label}
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
              <span className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-slate-900/80 to-transparent p-2 text-[11px] text-white text-left capitalize">
                {alert.label}
              </span>
            </button>
          ))}
        </div>
      </Panel>

      <Modal
        open={!!active}
        onClose={() => setActive(null)}
        title={active?.label}
        size="xl"
      >
        {active ? (
          <img
            src={active.src}
            alt={active.label}
            className="w-full h-auto rounded-md"
          />
        ) : null}
      </Modal>
    </>
  );
}
