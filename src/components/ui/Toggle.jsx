import { Switch } from '@headlessui/react';
import { cn } from '@/utils/cn';

export default function Toggle({
  checked,
  onChange,
  label,
  className,
  activeClass = 'bg-accent-orange',
}) {
  return (
    <Switch
      checked={!!checked}
      onChange={onChange}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
        checked ? activeClass : 'bg-slate-300 dark:bg-slate-600',
        className,
      )}
      aria-label={label}
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
          checked ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </Switch>
  );
}
