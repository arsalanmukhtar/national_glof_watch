import { Fragment } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { X } from 'lucide-react';
import { cn } from '@/utils/cn';

export default function MobileMenu({
  open,
  onClose,
  children,
  title = 'Layers',
  side = 'left',
}) {
  const isLeft = side === 'left';

  return (
    <Transition show={!!open} as={Fragment}>
      <Dialog onClose={onClose} className="relative z-[55] lg:hidden">
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

        <Transition.Child
          as={Fragment}
          enter="transform transition ease-in-out duration-250"
          enterFrom={isLeft ? '-translate-x-full' : 'translate-x-full'}
          enterTo="translate-x-0"
          leave="transform transition ease-in-out duration-200"
          leaveFrom="translate-x-0"
          leaveTo={isLeft ? '-translate-x-full' : 'translate-x-full'}
        >
          <Dialog.Panel
            className={cn(
              'fixed inset-y-0 w-[88vw] max-w-sm bg-day-surface dark:bg-night-surface shadow-panel flex flex-col',
              isLeft ? 'left-0' : 'right-0',
            )}
          >
            <div className="flex items-center justify-between px-4 h-16 bg-brand-900 text-white shrink-0">
              <Dialog.Title className="text-sm font-semibold">{title}</Dialog.Title>
              <button
                type="button"
                onClick={onClose}
                className="btn-icon text-white hover:bg-white/10"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-4">{children}</div>
          </Dialog.Panel>
        </Transition.Child>
      </Dialog>
    </Transition>
  );
}
