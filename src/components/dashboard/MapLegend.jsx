import { motion } from 'framer-motion';
import { useParameter } from '@/contexts/ParameterContext';
import {
  PARAMETER_LEGENDS,
  STALE_COLOR,
  STALE_LABEL,
  legendDisplayName,
} from '@/config/parameterLegends';
import { cn } from '@/utils/cn';

// Bottom-left legend overlay. Hidden when no parameter is selected.
// All bins render as circles to match the map symbols (squares/triangles
// from the legacy mock-ups are intentionally not used here).
export default function MapLegend() {
  const { selected } = useParameter();
  if (!selected) return null;

  const legend = PARAMETER_LEGENDS[selected];
  if (!legend) return null;

  const bins = [...legend.bins, { color: STALE_COLOR, label: STALE_LABEL }];

  return (
    <motion.div
      key={selected}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'absolute left-2 bottom-2 z-10 rounded-md shadow-md overflow-hidden',
        'bg-white/95 dark:bg-night-surface/95 backdrop-blur-sm',
        'border border-day-border dark:border-night-border',
      )}
    >
      <div className="px-2.5 py-1.5 border-b border-day-border dark:border-night-border">
        <h4 className="text-[11px] font-semibold text-day-text dark:text-night-text">
          {legendDisplayName(selected)} Legend
        </h4>
      </div>
      <ul className="px-2.5 py-1.5 flex flex-col gap-1">
        {bins.map((b) => (
          <li
            key={b.label}
            className="flex items-center gap-2 text-[11px] text-day-text dark:text-night-text"
          >
            <span
              aria-hidden
              className="h-2.5 w-2.5 rounded-full shrink-0 border border-slate-900/40 dark:border-white/30"
              style={{ backgroundColor: b.color }}
            />
            <span className="leading-none">{b.label}</span>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}
