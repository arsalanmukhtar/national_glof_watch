import { Loader2 } from 'lucide-react';
import { cn } from '@/utils/cn';

export default function Spinner({ className, size = 'md' }) {
  const sizes = { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-7 w-7' };
  return (
    <Loader2
      className={cn(
        'animate-spin text-brand-600 dark:text-brand-300',
        sizes[size] ?? sizes.md,
        className,
      )}
      aria-label="Loading"
    />
  );
}
