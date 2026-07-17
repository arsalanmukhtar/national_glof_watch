import { Fragment, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  CloudDownload,
  FileSpreadsheet,
  Grid3x3,
  Hammer,
  HardDriveDownload,
  Layers,
  Shapes,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { TbHeartRateMonitor } from 'react-icons/tb';
import Tooltip from '@/components/ui/Tooltip';
import CsvDataPanel from '@/components/dashboard/CsvDataPanel';
import ExportLayersModal from '@/components/dashboard/ExportLayersModal';
import GeeImageryPanel from '@/components/dashboard/GeeImageryPanel';
import GeoAnalysisPanel from '@/components/dashboard/GeoAnalysisPanel';
import LayerMenu from '@/components/dashboard/LayerMenu';
import MonitoringPanel from '@/components/dashboard/MonitoringPanel';
import ParametersPanel from '@/components/dashboard/ParametersPanel';
import RasterLayersPanel from '@/components/dashboard/RasterLayersPanel';
import SecondaryPanel from '@/components/dashboard/SecondaryPanel';
import { useMonitoring } from '@/contexts/MonitoringContext';
import { cn } from '@/utils/cn';

// All non-Primary icons are "solo" modes — turning one on clears the
// rest. Primary fans out to both PMD parameters and Layers panels at
// once; toggling it off / clicking another icon dismisses it.
const SECONDARY_ID  = 'secondary';
const MONITORING_ID = 'monitoring';
const CSV_ID        = 'csv';
const RASTER_ID     = 'raster';
const GEE_ID        = 'gee';
const TOOLBOX_ID    = 'toolbox';
const PRIMARY_IDS   = ['parameters', 'layers'];
const SOLO_IDS      = [SECONDARY_ID, MONITORING_ID, CSV_ID, RASTER_ID, GEE_ID, TOOLBOX_ID];

const SECTIONS = [
  {
    id: 'parameters',
    label: 'PMD Parameters',
    headerIcon: SlidersHorizontal,
    title: 'PMD Parameters',
    grow: false,
    render: () => <ParametersPanel />,
  },
  {
    id: 'layers',
    label: 'Layers',
    headerIcon: Layers,
    title: 'Layers',
    grow: true,
    render: () => <LayerMenu />,
  },
  {
    id: SECONDARY_ID,
    label: 'Secondary Layers',
    headerIcon: null, // toggle-strip icon already conveys this; avoid duplication
    title: 'Secondary Layers',
    grow: true,
    render: () => <SecondaryPanel />,
  },
  {
    id: MONITORING_ID,
    label: 'Monitoring',
    headerIcon: TbHeartRateMonitor,
    title: 'Monitoring',
    grow: true,
    render: () => <MonitoringPanel />,
  },
  {
    id: CSV_ID,
    label: 'CSV Data',
    headerIcon: FileSpreadsheet,
    title: 'CSV Data',
    grow: true,
    render: () => <CsvDataPanel />,
  },
  {
    id: RASTER_ID,
    label: 'Raster Layers',
    headerIcon: Grid3x3,
    title: 'Raster Layers',
    grow: true,
    render: () => <RasterLayersPanel />,
  },
  {
    id: GEE_ID,
    label: 'GEE Imagery',
    headerIcon: CloudDownload,
    title: 'GEE Imagery',
    grow: true,
    render: () => <GeeImageryPanel />,
  },
  {
    id: TOOLBOX_ID,
    label: 'Geospatial Analysis Toolbox',
    headerIcon: Hammer,
    title: 'Toolbox',
    grow: true,
    render: () => <GeoAnalysisPanel />,
  },
];

// Icon strip — one row per top-level mode. Order mirrors the sidebar
// reading order the user asked for: Primary, Secondary, CSV, Raster,
// GEE, Toolbox. `Export` is the only true action (opens a modal), set
// off by a divider underneath the panel toggles.
const EXPORT_ID = 'export';
const ICON_BUTTONS = [
  { id: 'primary',      label: 'Primary Layers',   icon: Layers,                 tourId: 'primary-panel-icon'    },
  { id: SECONDARY_ID,   label: 'Secondary Layers', icon: Shapes,                 tourId: 'secondary-panel-icon'  },
  { id: MONITORING_ID,  label: 'Monitoring',       icon: TbHeartRateMonitor,     tourId: 'monitoring-panel-icon' },
  { id: CSV_ID,         label: 'CSV Data',         icon: FileSpreadsheet,        tourId: 'csv-panel-icon'        },
  { id: RASTER_ID,      label: 'Raster Layers',    icon: Grid3x3,                tourId: 'raster-panel-icon'     },
  { id: GEE_ID,         label: 'GEE Imagery',      icon: CloudDownload,          tourId: 'gee-panel-icon'        },
  { id: TOOLBOX_ID,     label: 'Geospatial Analysis Toolbox', icon: Hammer,      tourId: 'toolbox-panel-icon'    },
  { id: EXPORT_ID,      label: 'Export Layers',    icon: HardDriveDownload,      tourId: 'export-panel-icon'     },
];

export default function LeftSidebar({ className }) {
  // Default: parameters + layers open. Secondary off until invoked.
  const [activeIds, setActiveIds] = useState(
    () => new Set(['parameters', 'layers']),
  );
  // Export still opens a modal — Toolbox is now a sidebar SOLO panel
  // so its own state lives in `activeIds`, not a separate flag.
  const [exportOpen, setExportOpen] = useState(false);
  // Broadcast Monitoring on/off to the rest of the dashboard —
  // Dashboard swaps the middle column for the map grid, and RightSidebar
  // auto-collapses so the grid can take the whole available width.
  const { setActive: setMonitoringActive } = useMonitoring();
  useEffect(() => {
    setMonitoringActive(activeIds.has(MONITORING_ID));
  }, [activeIds, setMonitoringActive]);

  const toggleIconButton = (id) => {
    setActiveIds((prev) => {
      const next = new Set(prev);
      if (SOLO_IDS.includes(id)) {
        // Solo modes (Secondary / CSV / Raster / GEE / Toolbox) take
        // over the sidebar — turning one on clears every other section,
        // turning it off leaves the bar empty.
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.clear();
          next.add(id);
        }
        return next;
      }
      if (id === 'primary') {
        // Primary fans out to both parameters + layers and dismisses
        // whichever solo mode was active.
        const anyOn = PRIMARY_IDS.some((pid) => next.has(pid));
        if (anyOn) {
          PRIMARY_IDS.forEach((pid) => next.delete(pid));
        } else {
          SOLO_IDS.forEach((sid) => next.delete(sid));
          PRIMARY_IDS.forEach((pid) => next.add(pid));
        }
        return next;
      }
      return next;
    });
  };

  const isIconOn = (id) => {
    if (id === EXPORT_ID) return exportOpen;
    if (id === 'primary') return PRIMARY_IDS.some((pid) => activeIds.has(pid));
    return activeIds.has(id);
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
      data-tour-id="left-sidebar"
      className={cn(
        'hidden lg:flex flex-row items-stretch shrink-0 min-h-0 gap-2',
        className,
      )}
    >
      {/* Icon strip — always visible on lg+ */}
      <div className="card-base flex flex-col items-center gap-1 p-2 w-14 shrink-0">
        {ICON_BUTTONS.map(({ id, label, icon: Icon, tourId }) => {
          const on = isIconOn(id);
          return (
            <Fragment key={id}>
              {id === EXPORT_ID && (
                <div className="my-1 h-px w-7 bg-day-border dark:bg-night-border" />
              )}
              <Tooltip label={label} side="right">
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => {
                    if (id === EXPORT_ID) setExportOpen(true);
                    else toggleIconButton(id);
                  }}
                  aria-pressed={on}
                  aria-label={label}
                  data-tour-id={tourId}
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
            </Fragment>
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
                      <h2 className="text-[14px] font-semibold flex items-center gap-1.5">
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

      <ExportLayersModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
      />
    </aside>
  );
}
