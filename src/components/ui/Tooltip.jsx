import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/utils/cn';

// Compute fixed-position coordinates relative to the viewport for each
// side+align combo. The tooltip is rendered into <body>, so we anchor by
// the trigger's bounding rect and use a CSS transform to handle the
// align-axis offset (so we don't need to know the tooltip's own size).
function computeCoords(rect, side, align, gap = 8) {
  if (side === 'top') {
    return {
      top: rect.top - gap,
      left:
        align === 'start' ? rect.left
        : align === 'end' ? rect.right
        : rect.left + rect.width / 2,
      transform:
        align === 'start' ? 'translate(0, -100%)'
        : align === 'end' ? 'translate(-100%, -100%)'
        : 'translate(-50%, -100%)',
    };
  }
  if (side === 'bottom') {
    return {
      top: rect.bottom + gap,
      left:
        align === 'start' ? rect.left
        : align === 'end' ? rect.right
        : rect.left + rect.width / 2,
      transform:
        align === 'start' ? 'translate(0, 0)'
        : align === 'end' ? 'translate(-100%, 0)'
        : 'translate(-50%, 0)',
    };
  }
  if (side === 'left') {
    return {
      top:
        align === 'start' ? rect.top
        : align === 'end' ? rect.bottom
        : rect.top + rect.height / 2,
      left: rect.left - gap,
      transform:
        align === 'start' ? 'translate(-100%, 0)'
        : align === 'end' ? 'translate(-100%, -100%)'
        : 'translate(-100%, -50%)',
    };
  }
  // right
  return {
    top:
      align === 'start' ? rect.top
      : align === 'end' ? rect.bottom
      : rect.top + rect.height / 2,
    left: rect.right + gap,
    transform:
      align === 'start' ? 'translate(0, 0)'
      : align === 'end' ? 'translate(0, -100%)'
      : 'translate(0, -50%)',
  };
}

export default function Tooltip({
  label,
  side = 'top',
  align = 'center',
  children,
  className,
  // Replaces the wrapper's default `inline-flex` display. Useful when
  // the trigger needs `block min-w-0 truncate` (long-text labels) so the
  // wrapper itself becomes the ellipsis target.
  triggerClassName,
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const triggerRef = useRef(null);

  const refresh = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setCoords(computeCoords(rect, side, align));
    }
  };

  const onOpen = () => {
    setOpen(true);
    refresh();
  };
  const onClose = () => setOpen(false);

  // Keep the tooltip pinned to the trigger if the page scrolls or the
  // window resizes while it's visible.
  useEffect(() => {
    if (!open) return undefined;
    const handler = () => refresh();
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <span
      ref={triggerRef}
      className={cn('relative', triggerClassName ?? 'inline-flex')}
      onMouseEnter={onOpen}
      onMouseLeave={onClose}
      onFocus={onOpen}
      onBlur={onClose}
    >
      {children}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {open && label && coords ? (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                role="tooltip"
                className={cn(
                  'fixed z-[100] whitespace-nowrap rounded-md bg-slate-900 text-white text-xs px-2 py-1 shadow-panel pointer-events-none',
                  className,
                )}
                style={{
                  top: coords.top,
                  left: coords.left,
                  transform: coords.transform,
                }}
              >
                {label}
              </motion.span>
            ) : null}
          </AnimatePresence>,
          document.body,
        )}
    </span>
  );
}
