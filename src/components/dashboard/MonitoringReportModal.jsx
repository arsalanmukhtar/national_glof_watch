import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FileDown, Loader2, X } from 'lucide-react';
import { layoutById, useMonitoring } from '@/contexts/MonitoringContext';
import { colorFor } from '@/config/parameterColors';
import { cn } from '@/utils/cn';

// Confirmation modal shown when the operator clicks the "Report"
// button in MonitoringPanel. Summarises exactly what the export will
// include (layout, active cells with their parameters + resolved
// stations, time window, classification method) and only kicks the
// generator once the operator confirms — a full report takes a few
// seconds to render, so a preview-before-commit step keeps them from
// waiting on an accidental click.
//
// The `onConfirm` prop is an async fn (imported by the panel from
// `@/services/monitoringReport`). While it runs, the modal shows a
// progress line ("Snapshotting cell A…") streamed from the generator
// so the operator sees something happening rather than a frozen
// button.
export default function MonitoringReportModal({ open, onCancel, onConfirm }) {
  const {
    layoutId,
    cellParameters,
    chartDays,
    chartWindowMode,
    chartCustomDays,
    earlyWarning,
    getChartApi,
    chartApisVersion,
  } = useMonitoring();

  const layout = layoutById(layoutId);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ step: 0, total: 0, label: '' });
  const [error, setError] = useState(null);

  // Reset state each time the modal re-opens so a previous failed
  // run doesn't leave stale text on the next visit.
  useEffect(() => {
    if (!open) {
      setBusy(false);
      setProgress({ step: 0, total: 0, label: '' });
      setError(null);
    }
  }, [open]);

  // Enumerate the cells that will actually contribute to the report —
  // any cell without a picked parameter is skipped by the generator,
  // so we mirror that decision in the preview list too.
  //
  // `chartApisVersion` bumps whenever a chart row registers or updates
  // its api (which happens as data / roster / selection resolves), so
  // the "no station yet" line flips to the real station name the
  // moment the row finishes its fetch — no manual reload of the modal.
  const activeCells = useMemo(() => {
    return layout.areas
      .map((area) => {
        const parameter = cellParameters[area] ?? null;
        if (!parameter) return null;
        // Peek at the chart api (if the ChartsPanel has already
        // rendered) for the resolved station name — it's the same
        // fall-back logic (selected → first-alphabetical) the row
        // uses to plot its chart, so the summary matches the export.
        const api = getChartApi(area);
        const info = api?.getData?.() ?? {};
        return {
          area,
          parameter,
          stationName: info.stationName || null,
          isAutoPick: info.isAutoPick ?? true,
        };
      })
      .filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, cellParameters, getChartApi, chartApisVersion]);

  const windowLabel =
    chartWindowMode === 'daily'
      ? 'Daily · past 24 hours'
      : chartWindowMode === 'weekly'
        ? 'Weekly · past 7 days'
        : `Custom · past ${chartCustomDays} days`;

  const classificationLabel = earlyWarning ? 'NDMA (Early Warning)' : 'PMD (Official)';
  const classificationColor = earlyWarning ? '#dc2626' : '#0369a1';

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    setProgress({ step: 0, total: 0, label: 'Preparing…' });
    try {
      await onConfirm({
        onProgress: (step, total, label) => {
          setProgress({ step, total, label });
        },
      });
      // Successful run — dismiss the modal via the parent's cancel
      // handler (same effect: unmount).
      onCancel?.();
    } catch (err) {
      console.error('[monitoring report] generation failed:', err);
      setError(err?.message || 'Report generation failed.');
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="monitoring-report-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm px-3"
          onClick={busy ? undefined : onCancel}
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="monitoring-report-title"
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'w-full max-w-[520px] rounded-lg shadow-2xl overflow-hidden',
              'bg-white dark:bg-night-surface',
              'border border-day-border dark:border-night-border',
            )}
          >
            {/* Header — emerald brand bar so the modal reads as an
                official monitoring action. Close chrome is disabled
                while a run is in flight so an accidental click on
                the X can't leave the pipeline hanging. */}
            <div className="flex items-center gap-2 px-4 py-3 bg-emerald-950 text-white">
              <FileDown className="h-4 w-4" aria-hidden />
              <h2
                id="monitoring-report-title"
                className="text-[14px] font-semibold tracking-wide"
              >
                Export Monitoring Report
              </h2>
              <button
                type="button"
                onClick={onCancel}
                disabled={busy}
                aria-label="Close"
                className={cn(
                  'ml-auto inline-flex items-center justify-center h-7 w-7 rounded-md',
                  busy
                    ? 'opacity-40 cursor-not-allowed'
                    : 'hover:bg-white/10',
                )}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-4 flex flex-col gap-3 text-[12.5px] text-day-text dark:text-night-text">
              <p className="text-[12.5px] leading-relaxed">
                A PDF report will be generated for the current Monitoring
                grid. Each active cell contributes one section with its map
                snapshot, chart for the selected time window, station
                attributes, and surrounding district context.
              </p>

              {/* Meta table — what the export covers. Two-column grid
                  with muted labels + hard values keeps it scan-friendly. */}
              <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 border rounded-md border-day-border dark:border-night-border p-3 bg-day-bg dark:bg-night-bg">
                <dt className="text-day-muted dark:text-night-muted">Layout</dt>
                <dd className="font-medium">
                  {layout.label} · {activeCells.length}/{layout.cells} cell
                  {layout.cells === 1 ? '' : 's'} with data
                </dd>

                <dt className="text-day-muted dark:text-night-muted">Time window</dt>
                <dd className="font-medium">{windowLabel}</dd>

                <dt className="text-day-muted dark:text-night-muted">Classification</dt>
                <dd className="font-medium inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: classificationColor }}
                  />
                  {classificationLabel}
                </dd>

                <dt className="text-day-muted dark:text-night-muted">Generated at</dt>
                <dd className="font-medium tabular-nums">
                  {new Date().toLocaleString()}
                </dd>
              </dl>

              {/* Cell list — if empty, tell the operator plainly that
                  nothing will be exported so they don't wonder why the
                  PDF is a cover page and nothing else. */}
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-day-muted dark:text-night-muted">
                  Cells to include
                </span>
                {activeCells.length === 0 ? (
                  <p className="text-[12px] text-day-muted dark:text-night-muted italic px-1">
                    No cells have a parameter picked. Assign parameters in
                    the config panel first.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {activeCells.map(({ area, parameter, stationName, isAutoPick }) => (
                      <li
                        key={area}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-day-border dark:border-night-border bg-day-bg dark:bg-night-bg"
                      >
                        <span
                          className="inline-flex items-center justify-center h-5 w-5 shrink-0 rounded text-[10px] font-bold uppercase text-white"
                          style={{ backgroundColor: colorFor(parameter) }}
                        >
                          {area.toUpperCase()}
                        </span>
                        <span className="text-[12px] font-medium truncate">
                          {parameter}
                        </span>
                        <span className="ml-auto text-[11px] text-day-muted dark:text-night-muted truncate">
                          {stationName ? (
                            <>
                              {stationName}
                              {isAutoPick ? (
                                <span className="ml-1 text-[9.5px] uppercase font-semibold text-[#a16207] dark:text-[#facc15]">
                                  auto
                                </span>
                              ) : null}
                            </>
                          ) : (
                            <span className="italic">no station yet</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Progress + error rows. Absent when idle so the modal
                  height doesn't jump around unnecessarily. */}
              {busy ? (
                <div className="flex items-center gap-2 text-[12px] text-day-muted dark:text-night-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  <span>
                    {progress.label}
                    {progress.total > 0
                      ? ` (${progress.step}/${progress.total})`
                      : ''}
                  </span>
                </div>
              ) : null}
              {error ? (
                <p className="text-[12px] text-red-600 dark:text-red-400">
                  {error}
                </p>
              ) : null}
            </div>

            {/* Footer — cancel + confirm. Confirm is disabled when
                nothing would be exported so the operator can't burn
                a click on an empty run. */}
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-day-border dark:border-night-border bg-day-bg dark:bg-night-bg">
              <button
                type="button"
                onClick={onCancel}
                disabled={busy}
                className={cn(
                  'px-3 py-1.5 rounded-md text-[12px] font-medium',
                  'border border-day-border dark:border-night-border',
                  'text-day-text dark:text-night-text',
                  busy
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:bg-white dark:hover:bg-night-surface',
                )}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={busy || activeCells.length === 0}
                className={cn(
                  'px-3 py-1.5 rounded-md text-[12px] font-semibold inline-flex items-center gap-1.5',
                  'bg-[#84cc16] text-[#1a2e05]',
                  (busy || activeCells.length === 0)
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:bg-[#65a30d]',
                )}
              >
                {busy ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Exporting…
                  </>
                ) : (
                  <>
                    <FileDown className="h-3.5 w-3.5" />
                    Yes, export PDF
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
