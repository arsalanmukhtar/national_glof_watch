import { Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { X } from 'lucide-react';
import { cn } from '@/utils/cn';

// A dialog with three regions: a pinned header, a scrollable body, and an
// optional pinned footer. The panel is height-clamped to 90vh so a tall
// body scrolls inside the modal instead of pushing the footer off-screen
// (or overlapping it).
export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  className,
  bodyClassName,
  size = 'md',
}) {
  const sizeClass = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-[min(95vw,1200px)]',
  }[size];

  return (
    <Transition show={!!open} as={Fragment}>
      <Dialog onClose={onClose} className="relative z-[60]">
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" aria-hidden />
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
                'w-full card-base shadow-panel flex flex-col max-h-[90vh]',
                sizeClass,
                className,
              )}
            >
              {/* Header — pinned */}
              <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3 shrink-0">
                {title ? (
                  <Dialog.Title className="text-base font-semibold">
                    {title}
                  </Dialog.Title>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-icon btn-ghost -mr-1.5 -mt-1.5"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Body — scrolls when the content is taller than the panel */}
              <div
                className={cn(
                  'px-5 min-h-0 overflow-y-auto',
                  footer ? 'pb-4' : 'pb-5',
                  bodyClassName,
                )}
              >
                {children}
              </div>

              {/* Footer — pinned */}
              {footer ? (
                <div className="shrink-0 px-5 py-3.5 border-t border-day-border dark:border-night-border">
                  {footer}
                </div>
              ) : null}
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}
