import { forwardRef } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/utils/cn';

const SearchBox = forwardRef(function SearchBox(
  { className, placeholder = 'Search…', ...props },
  ref,
) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1.5 border shadow-sm transition-colors',
        'bg-white dark:bg-night-surface border-day-border dark:border-night-border',
        'focus-within:ring-2 focus-within:ring-brand-500 focus-within:border-transparent',
        className,
      )}
    >
      <Search
        aria-hidden
        className="block shrink-0 size-[14px] text-day-muted dark:text-night-muted"
      />
      <input
        ref={ref}
        type="text"
        role="searchbox"
        placeholder={placeholder}
        className={cn(
          'flex-1 min-w-0 bg-transparent border-0 outline-none p-0',
          'text-xs font-medium text-day-text dark:text-night-text',
          'placeholder:text-day-muted dark:placeholder:text-night-muted',
        )}
        {...props}
      />
    </div>
  );
});

export default SearchBox;
