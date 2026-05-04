import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/utils/cn';

const POSITION = {
  top: {
    axis: 'bottom-full mb-2',
    start: 'left-0',
    center: 'left-1/2 -translate-x-1/2',
    end: 'right-0',
  },
  bottom: {
    axis: 'top-full mt-2',
    start: 'left-0',
    center: 'left-1/2 -translate-x-1/2',
    end: 'right-0',
  },
  left: {
    axis: 'right-full mr-2',
    start: 'top-0',
    center: 'top-1/2 -translate-y-1/2',
    end: 'bottom-0',
  },
  right: {
    axis: 'left-full ml-2',
    start: 'top-0',
    center: 'top-1/2 -translate-y-1/2',
    end: 'bottom-0',
  },
};

export default function Tooltip({
  label,
  side = 'top',
  align = 'center',
  children,
  className,
}) {
  const [open, setOpen] = useState(false);
  const pos = POSITION[side] ?? POSITION.top;
  const placement = `${pos.axis} ${pos[align] ?? pos.center}`;

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      <AnimatePresence>
        {open && label ? (
          <motion.span
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            role="tooltip"
            className={cn(
              'absolute z-50 whitespace-nowrap rounded-md bg-slate-900 text-white text-xs px-2 py-1 shadow-panel pointer-events-none',
              placement,
              className,
            )}
          >
            {label}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </span>
  );
}
