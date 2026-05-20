import { motion } from 'framer-motion';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/utils/cn';

// Replaces the rocker `Toggle` for layer visibility — an open eye when on
// (brand green), a slashed eye when off (muted). Keeps the same
// (checked, onChange, label) prop shape so callers can swap with one line.
export default function EyeToggle({ checked, onChange, label, className }) {
  const Icon = checked ? Eye : EyeOff;
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.92 }}
      onClick={() => onChange(!checked)}
      aria-pressed={!!checked}
      aria-label={label}
      className={cn(
        'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors',
        checked
          ? 'text-[#84cc16] hover:bg-[#84cc16]/10'
          : 'text-day-muted dark:text-night-muted hover:bg-day-bg dark:hover:bg-night-bg',
        className,
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </motion.button>
  );
}
