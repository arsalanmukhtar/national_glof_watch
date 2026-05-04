import { Disclosure, Transition } from '@headlessui/react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/utils/cn';

export function AccordionItem({ title, defaultOpen = false, children, icon, className }) {
  return (
    <Disclosure defaultOpen={defaultOpen} as="div" className={cn('border-b border-day-border dark:border-night-border last:border-b-0', className)}>
      {({ open }) => (
        <>
          <Disclosure.Button className="flex w-full items-center justify-between gap-3 py-2.5 px-1 text-sm font-medium text-day-text dark:text-night-text hover:text-brand-700 dark:hover:text-brand-200 transition-colors">
            <span className="flex items-center gap-2">
              {icon}
              <span>{title}</span>
            </span>
            <ChevronDown
              className={cn(
                'h-4 w-4 text-day-muted dark:text-night-muted transition-transform duration-200',
                open && 'rotate-180',
              )}
              aria-hidden
            />
          </Disclosure.Button>
          <Transition
            enter="transition duration-150 ease-out"
            enterFrom="transform -translate-y-1 opacity-0"
            enterTo="transform translate-y-0 opacity-100"
            leave="transition duration-100 ease-in"
            leaveFrom="transform translate-y-0 opacity-100"
            leaveTo="transform -translate-y-1 opacity-0"
          >
            <Disclosure.Panel className="pb-3 pt-1 px-1 text-sm text-day-muted dark:text-night-muted">
              {children}
            </Disclosure.Panel>
          </Transition>
        </>
      )}
    </Disclosure>
  );
}

export default function Accordion({ children, className }) {
  return <div className={cn('w-full', className)}>{children}</div>;
}
