import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Search } from 'lucide-react';
import { colorFor } from '@/config/parameterColors';
import { cn } from '@/utils/cn';

// Themed parameter picker used everywhere Monitoring surfaces an
// element selector. Replaces the native `<select>` which showed the
// OS's default dropdown chrome and broke the day/night palette.
//
// Behaviour:
//   • Menu portals into document.body with fixed positioning so it
//     escapes any parent's overflow / z-index clip.
//   • Anchor to the trigger's bounding rect on every open; auto-flip
//     upward if the menu wouldn't fit below.
//   • Inline search (keyword filter) surfaces as the operator types —
//     the parameter catalog is 40+ elements, so a filter matters.
//   • Each row carries a coloured dot (from `colorFor`) matching the
//     accent used across the app's charts + panels for that parameter.
//
// Props:
//   value        — selected element name, or '' for none
//   onChange(name)
//   elements     — array of { name } from ParameterContext
//   size         — 'sm' (default) fits inside a map-cell corner; 'md'
//                  fits inside the sidebar config panel
//   className    — merged onto the trigger button
export default function ParameterSelect({
  value,
  onChange,
  elements,
  placeholder = 'Select parameter…',
  size = 'sm',
  className,
  accentColorFor = colorFor,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const accent = value ? accentColorFor(value) : null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return elements;
    return elements.filter((el) => el.name.toLowerCase().includes(q));
  }, [elements, query]);

  // Anchor position — computed on open and on scroll/resize so the
  // menu tracks the trigger without a re-render loop. Kept in state so
  // it re-renders when it does change (open ↔ close, viewport shifts).
  const [anchor, setAnchor] = useState({ top: 0, left: 0, width: 240, flip: false });

  const compute = () => {
    const el = triggerRef.current;
    if (!el || typeof window === 'undefined') return;
    const r = el.getBoundingClientRect();
    const width = Math.max(r.width, 220);
    const maxLeft = window.innerWidth - width - 8;
    const spaceBelow = window.innerHeight - r.bottom;
    const flip = spaceBelow < 240 && r.top > spaceBelow;
    setAnchor({
      top: flip ? r.top - 4 : r.bottom + 4,
      left: Math.max(8, Math.min(r.left, maxLeft)),
      width,
      flip,
    });
  };

  useEffect(() => {
    if (!open) return undefined;
    compute();
    const onResize = () => compute();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
    // compute closes over the ref, which is stable — no deps needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Outside-click + Escape close.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target)) return;
      if (triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Reset the filter every time the menu closes so a re-open starts
  // fresh — carrying stale filter state across sessions is a papercut.
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const sizeCls =
    size === 'md'
      ? 'h-8 px-2.5 text-[12.5px]'
      : 'h-7 px-2 text-[11px]';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'group inline-flex items-center gap-1.5 rounded-md',
          'border border-day-border dark:border-night-border',
          'bg-white/95 dark:bg-night-surface/95 backdrop-blur-sm',
          'text-day-text dark:text-night-text',
          'shadow-sm hover:border-[#84cc16]/60 dark:hover:border-[#84cc16]/60',
          'focus:outline-none focus:ring-1 focus:ring-[#84cc16]',
          'transition-colors',
          sizeCls,
          className,
        )}
      >
        {value ? (
          <>
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full border border-slate-900/30 dark:border-white/25"
              style={{ backgroundColor: accent }}
            />
            <span className="truncate font-medium">{value}</span>
          </>
        ) : (
          <span className="truncate text-day-muted dark:text-night-muted">
            {placeholder}
          </span>
        )}
        <ChevronDown
          className={cn(
            'h-3 w-3 ml-auto shrink-0 text-day-muted dark:text-night-muted transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {typeof document !== 'undefined'
        ? createPortal(
            <AnimatePresence>
              {open ? (
                <motion.div
                  key="pm-menu"
                  ref={menuRef}
                  initial={{ opacity: 0, y: anchor.flip ? 4 : -4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: anchor.flip ? 4 : -4, scale: 0.98 }}
                  transition={{ duration: 0.14, ease: [0.4, 0, 0.2, 1] }}
                  role="listbox"
                  style={{
                    position: 'fixed',
                    top: anchor.flip ? undefined : anchor.top,
                    bottom: anchor.flip
                      ? window.innerHeight - anchor.top
                      : undefined,
                    left: anchor.left,
                    width: anchor.width,
                    zIndex: 9999,
                  }}
                  className={cn(
                    'rounded-md overflow-hidden shadow-xl',
                    'bg-white dark:bg-night-surface',
                    'border border-day-border dark:border-night-border',
                  )}
                >
                  {/* Search field */}
                  <div className="relative border-b border-day-border dark:border-night-border">
                    <Search
                      className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-day-muted dark:text-night-muted"
                      aria-hidden
                    />
                    <input
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      autoFocus
                      placeholder="Filter parameters…"
                      className={cn(
                        'w-full pl-7 pr-2 py-1.5 text-[11.5px]',
                        'bg-transparent focus:outline-none',
                        'text-day-text dark:text-night-text',
                        'placeholder-day-muted dark:placeholder-night-muted',
                      )}
                    />
                  </div>

                  {/* Options — cap height + custom scrollbar-esque
                      overflow so the dropdown never grows off-screen. */}
                  <ul className="max-h-[240px] overflow-y-auto py-1">
                    {value ? (
                      <li>
                        <MenuRow
                          color="#94a3b8"
                          label="Clear selection"
                          italic
                          onClick={() => {
                            onChange('');
                            setOpen(false);
                          }}
                        />
                        <li
                          aria-hidden
                          className="my-1 h-px mx-2 bg-day-border dark:bg-night-border"
                        />
                      </li>
                    ) : null}

                    {filtered.length === 0 ? (
                      <li className="px-3 py-2 text-[11.5px] text-day-muted dark:text-night-muted text-center">
                        No parameters match &ldquo;{query}&rdquo;
                      </li>
                    ) : null}

                    {filtered.map((el) => {
                      const selected = el.name === value;
                      const color = accentColorFor(el.name);
                      return (
                        <MenuRow
                          key={el.name}
                          color={color}
                          label={el.name}
                          selected={selected}
                          onClick={() => {
                            onChange(el.name);
                            setOpen(false);
                          }}
                        />
                      );
                    })}
                  </ul>
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </>
  );
}

function MenuRow({ color, label, selected, italic, onClick }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        role="option"
        aria-selected={!!selected}
        className={cn(
          'w-full flex items-center gap-2 px-2.5 py-1.5 text-[11.5px] text-left transition-colors',
          selected
            ? 'bg-[#84cc16]/12 text-[#4d7c0f] dark:text-[#a3e635] font-semibold'
            : 'text-day-text dark:text-night-text hover:bg-day-bg dark:hover:bg-night-bg',
        )}
      >
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full border border-slate-900/30 dark:border-white/25"
          style={{ backgroundColor: color }}
        />
        <span className={cn('flex-1 truncate', italic && 'italic')}>
          {label}
        </span>
        {selected ? (
          <Check className="h-3 w-3 shrink-0 text-[#84cc16]" aria-hidden />
        ) : null}
      </button>
    </li>
  );
}
