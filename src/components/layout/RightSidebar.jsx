import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FileBarChart, X } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import ThresholdStationsCard from '@/components/dashboard/ThresholdStationsCard';
import { useMonitoring } from '@/contexts/MonitoringContext';
import { useSecondary } from '@/contexts/SecondaryContext';
import { MEDIA_SECTIONS } from './MediaSwitcher';
import { cn } from '@/utils/cn';

export default function RightSidebar({ className }) {
  const { uploads } = useSecondary();
  // Sections flagged `requiresUploads` only appear after the user has
  // uploaded a secondary file. Filter at render so the icon strip stays
  // in sync as files are added/removed. Footer-positioned sections live
  // below the divider / report button (pure-reference panels like
  // Sensors Info), so split them out for the JSX below.
  const sections = useMemo(
    () => MEDIA_SECTIONS.filter((s) => !s.requiresUploads || uploads.length > 0),
    [uploads.length],
  );
  const mainSections = sections.filter((s) => s.position !== 'footer');
  const footerSections = sections.filter((s) => s.position === 'footer');

  const [activeId, setActiveId] = useState(mainSections[0]?.id ?? null);
  const active = sections.find((s) => s.id === activeId);

  // If the open section gets filtered out (last upload removed while the
  // Attributes panel was visible), close the panel rather than leaving a
  // dangling activeId pointing at nothing.
  useEffect(() => {
    if (activeId && !sections.some((s) => s.id === activeId)) {
      setActiveId(null);
    }
  }, [sections, activeId]);

  // When Monitoring is active the grid needs the full column width, so
  // auto-collapse this panel. Remember which section was open before we
  // collapsed and restore it when Monitoring turns off — the operator
  // shouldn't lose their place because they took a comparison detour.
  const { active: monitoringActive } = useMonitoring();
  const preMonitoringId = useRef(null);
  useEffect(() => {
    if (monitoringActive) {
      if (activeId != null) {
        preMonitoringId.current = activeId;
        setActiveId(null);
      }
    } else if (preMonitoringId.current != null) {
      setActiveId(preMonitoringId.current);
      preMonitoringId.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monitoringActive]);

  // Right column structure:
  //   ┌─────────────────────────────────────┐
  //   │ ThresholdStationsCard (when open)   │
  //   ├──────────────────┬──────────────────┤
  //   │ Content panel    │ Icon strip (w-14)│
  //   └──────────────────┴──────────────────┘
  // The threshold card is shown only when a content section is active —
  // otherwise the sidebar collapses back to just the icon strip and lets
  // the map breathe.
  return (
    <aside
      className={cn(
        'hidden lg:flex flex-col items-stretch shrink-0 min-h-0',
        className,
      )}
    >
      <AnimatePresence initial={false}>
        {active && !active.hideThreshold ? (
          <motion.div
            key="threshold"
            initial={{ height: 0, opacity: 0, marginBottom: 0 }}
            animate={{ height: 'auto', opacity: 1, marginBottom: 8 }}
            exit={{ height: 0, opacity: 0, marginBottom: 0 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden w-[424px] self-end shrink-0"
          >
            <ThresholdStationsCard />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="flex flex-row-reverse items-stretch min-h-0 flex-1">
        <div className="card-base flex flex-col items-center gap-1 p-2 w-14 shrink-0">
          {mainSections.map(({ id, label, icon: Icon }) => {
            const on = activeId === id;
            return (
              <Tooltip key={id} label={label} side="left">
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setActiveId(on ? null : id)}
                  aria-pressed={on}
                  aria-label={label}
                  className={cn(
                    'btn-icon transition-colors',
                    on
                      ? 'bg-[#84cc16] text-[#1a2e05] hover:bg-[#65a30d]'
                      : 'btn-ghost',
                  )}
                >
                  <Icon className="h-5 w-5" />
                </motion.button>
              </Tooltip>
            );
          })}

          <div className="my-1 h-px w-8 bg-day-border dark:bg-night-border" />

          <Tooltip label="Generate Weather Report" side="left">
            <motion.button
              type="button"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                // TODO: wire to backend report generation endpoint.
                console.log('[report] Generate Weather Report clicked');
              }}
              aria-label="Generate Weather Report"
              className="btn-icon btn-ghost transition-colors"
            >
              <FileBarChart className="h-5 w-5" />
            </motion.button>
          </Tooltip>

          {footerSections.map(({ id, label, icon: Icon }) => {
            const on = activeId === id;
            return (
              <Tooltip key={id} label={label} side="left">
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setActiveId(on ? null : id)}
                  aria-pressed={on}
                  aria-label={label}
                  className={cn(
                    'btn-icon transition-colors',
                    on
                      ? 'bg-[#84cc16] text-[#1a2e05] hover:bg-[#65a30d]'
                      : 'btn-ghost',
                  )}
                >
                  <Icon className="h-5 w-5" />
                </motion.button>
              </Tooltip>
            );
          })}
        </div>

        <AnimatePresence initial={false}>
          {active ? (
            <motion.div
              key="panel"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 360, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              className="overflow-hidden mr-2 min-h-0"
            >
              <div className="card-base flex flex-col h-full w-[360px] min-h-0">
                <div className="panel-header px-3 mb-0 pb-2 pt-3 shrink-0">
                  <h2 className="text-sm font-semibold">{active.label}</h2>
                  <button
                    type="button"
                    onClick={() => setActiveId(null)}
                    className="btn-icon btn-ghost ml-auto"
                    aria-label="Close panel"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto p-3">
                  {active.render()}
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </aside>
  );
}
