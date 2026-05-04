import { cn } from '@/utils/cn';

const TONES = {
  brand: 'bg-brand-100 text-brand-800 dark:bg-brand-800/30 dark:text-brand-100',
  success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200',
  warn: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200',
  danger: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200',
  neutral: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
};

export default function Badge({ tone = 'brand', className, children }) {
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full font-medium', TONES[tone] ?? TONES.brand, className)}>
      {children}
    </span>
  );
}
