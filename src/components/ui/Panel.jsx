import { cn } from '@/utils/cn';

export default function Panel({ title, actions, className, children }) {
  return (
    <section className={cn('panel-base', className)}>
      {(title || actions) && (
        <header className="panel-header">
          {title ? (
            <h2 className="text-sm font-semibold text-day-text dark:text-night-text">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>
      )}
      {children}
    </section>
  );
}
