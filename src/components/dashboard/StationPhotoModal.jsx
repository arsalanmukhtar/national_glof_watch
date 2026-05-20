import { Fragment, useCallback, useEffect, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, ImageOff, X } from 'lucide-react';
import { cn } from '@/utils/cn';

// Centred photo lightbox for the Feature Details image catalog. Uses the
// app's existing Headless UI Dialog plumbing so the overlay / focus trap
// match the other modals; the slider itself is hand-rolled because we
// only need previous / next / thumbnails for ≤ 3 images per station.
export default function StationPhotoModal({
  open,
  onClose,
  photos = [],
  stationLabel,
  stationSublabel,
}) {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  // Reset the slider state every time the modal opens with a new
  // station — otherwise it'd remember the last index from a previous
  // station's catalog.
  useEffect(() => {
    if (!open) return;
    setIndex(0);
    setDirection(0);
    setLoaded(false);
    setErrored(false);
  }, [open, photos]);

  const total = photos.length;
  const current = total > 0 ? photos[index] : null;

  const goPrev = useCallback(() => {
    if (total < 2) return;
    setDirection(-1);
    setLoaded(false);
    setErrored(false);
    setIndex((i) => (i - 1 + total) % total);
  }, [total]);

  const goNext = useCallback(() => {
    if (total < 2) return;
    setDirection(1);
    setLoaded(false);
    setErrored(false);
    setIndex((i) => (i + 1) % total);
  }, [total]);

  // Keyboard navigation while the modal is open — left/right swap slides,
  // Escape closes (Headless UI handles Escape natively but we still want
  // arrows wired up).
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, goPrev, goNext]);

  return (
    <Transition show={!!open} as={Fragment}>
      <Dialog onClose={onClose} className="relative z-[70]">
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm"
            aria-hidden
          />
        </Transition.Child>

        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <Dialog.Panel
              className={cn(
                'w-full max-w-[min(96vw,1320px)]',
                'rounded-xl overflow-hidden shadow-2xl',
                'bg-white dark:bg-night-surface',
                'border border-day-border dark:border-night-border',
                'flex flex-col',
              )}
            >
              <div className="flex items-start justify-between gap-3 px-5 py-3 border-b border-day-border dark:border-night-border">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-day-muted dark:text-night-muted">
                    Image Catalog
                    {stationSublabel ? ` • ${stationSublabel}` : ''}
                  </div>
                  <Dialog.Title className="mt-0.5 text-[15px] font-semibold text-day-text dark:text-night-text truncate">
                    {stationLabel || 'Station'}
                  </Dialog.Title>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {total > 0 ? (
                    <span className="text-[11px] tabular-nums font-medium text-day-muted dark:text-night-muted">
                      {index + 1} / {total}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={onClose}
                    className="btn-icon btn-ghost"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div
                className={cn(
                  'relative flex items-center justify-center',
                  'bg-slate-950 text-white',
                  'h-[min(78vh,760px)]',
                )}
              >
                {total === 0 ? (
                  <EmptySlide />
                ) : (
                  <>
                    <AnimatePresence
                      initial={false}
                      mode="popLayout"
                      custom={direction}
                    >
                      <motion.div
                        key={current?.url ?? index}
                        custom={direction}
                        initial={{
                          opacity: 0,
                          x: direction === 0 ? 0 : direction * 40,
                        }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -direction * 40 }}
                        transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                        className="absolute inset-0 flex items-center justify-center"
                      >
                        {errored ? (
                          <FailedSlide filename={current?.filename} />
                        ) : (
                          <>
                            {!loaded ? (
                              <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-[12px]">
                                Loading…
                              </div>
                            ) : null}
                            <img
                              key={current?.url}
                              src={current?.url}
                              alt={current?.filename || 'Station photo'}
                              loading="eager"
                              draggable={false}
                              onLoad={() => setLoaded(true)}
                              onError={() => {
                                setLoaded(true);
                                setErrored(true);
                              }}
                              className={cn(
                                'max-w-full max-h-full object-contain select-none',
                                loaded ? 'opacity-100' : 'opacity-0',
                                'transition-opacity duration-200',
                              )}
                            />
                          </>
                        )}
                      </motion.div>
                    </AnimatePresence>

                    {total > 1 ? (
                      <>
                        <button
                          type="button"
                          onClick={goPrev}
                          aria-label="Previous photo"
                          className={cn(
                            'absolute left-3 top-1/2 -translate-y-1/2 z-10',
                            'h-10 w-10 rounded-full grid place-items-center',
                            'bg-slate-900/70 hover:bg-slate-900/90 text-white',
                            'backdrop-blur-sm border border-white/10',
                            'transition-colors',
                          )}
                        >
                          <ChevronLeft className="h-5 w-5" strokeWidth={2} />
                        </button>
                        <button
                          type="button"
                          onClick={goNext}
                          aria-label="Next photo"
                          className={cn(
                            'absolute right-3 top-1/2 -translate-y-1/2 z-10',
                            'h-10 w-10 rounded-full grid place-items-center',
                            'bg-slate-900/70 hover:bg-slate-900/90 text-white',
                            'backdrop-blur-sm border border-white/10',
                            'transition-colors',
                          )}
                        >
                          <ChevronRight className="h-5 w-5" strokeWidth={2} />
                        </button>
                      </>
                    ) : null}
                  </>
                )}
              </div>

              {total > 1 ? (
                <div className="px-5 py-3 border-t border-day-border dark:border-night-border bg-day-bg/40 dark:bg-night-bg/40">
                  <div className="flex items-center gap-2 overflow-x-auto overflow-y-hidden">
                    {photos.map((p, i) => {
                      const active = i === index;
                      return (
                        <button
                          key={p.url}
                          type="button"
                          onClick={() => {
                            setDirection(i > index ? 1 : -1);
                            setLoaded(false);
                            setErrored(false);
                            setIndex(i);
                          }}
                          className={cn(
                            'shrink-0 h-14 w-20 rounded-md overflow-hidden',
                            'border-2 transition-all',
                            active
                              ? 'border-[#84cc16] shadow-md scale-[1.02]'
                              : 'border-transparent opacity-70 hover:opacity-100',
                          )}
                          aria-label={`Show photo ${i + 1}`}
                          aria-current={active ? 'true' : undefined}
                        >
                          <img
                            src={p.url}
                            alt=""
                            loading="lazy"
                            draggable={false}
                            className="h-full w-full object-cover"
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : current?.filename ? (
                <div className="px-5 py-2 border-t border-day-border dark:border-night-border bg-day-bg/40 dark:bg-night-bg/40 text-[11.5px] text-day-muted dark:text-night-muted truncate">
                  {current.filename}
                </div>
              ) : null}
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}

function EmptySlide() {
  return (
    <div className="flex flex-col items-center gap-2 text-slate-400">
      <ImageOff className="h-8 w-8" strokeWidth={1.5} />
      <p className="text-[12.5px]">No photos available for this station.</p>
    </div>
  );
}

function FailedSlide({ filename }) {
  return (
    <div className="flex flex-col items-center gap-2 text-slate-400 px-6 text-center">
      <ImageOff className="h-8 w-8" strokeWidth={1.5} />
      <p className="text-[12.5px]">Couldn't load this photo.</p>
      {filename ? (
        <p className="text-[11px] text-slate-500 break-all">{filename}</p>
      ) : null}
    </div>
  );
}
