import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import Tooltip from '@/components/ui/Tooltip';
import { cn } from '@/utils/cn';

// Compact PMD network-status pill rendered in the titlebar. Shows the
// three counts the upstream reports (total / total active / currently
// active) with the active-window in minutes summarised as a footnote.
// Polls every 60s — short enough to feel live, long enough to stay light
// on the upstream + the local proxy's 30s cache.
export default function StationStatusBadge() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch('/api/parameters/station-status');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (!cancelled) {
          setData(j);
          setError(null);
          setLoaded(true);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setLoaded(true);
        }
      }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Reserve space while the first request is in flight so the layout
  // doesn't jolt once data lands; vanish only on a hard error.
  if (!loaded && !data) {
    return (
      <div
        aria-hidden
        className="hidden md:block w-[260px] h-9 rounded-md bg-white/5 border border-white/10"
      />
    );
  }
  if (error && !data) return null;

  const totalStations  = data?.totalStations  ?? null;
  const totalActive    = data?.totalActive    ?? null;
  const currentActive  = data?.currentActive  ?? null;
  const windowMinutes  = data?.windowMinutes  ?? null;
  const windowLabel = windowMinutes != null
    ? windowMinutes >= 60
      ? `${Math.round(windowMinutes / 60)} h`
      : `${windowMinutes} m`
    : '—';

  return (
    <Tooltip
      label={
        windowMinutes != null
          ? `"Currently active" = stations reporting within the last ${windowMinutes} minutes`
          : 'PMD station network status'
      }
      side="bottom"
      align="end"
    >
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className={cn(
          'hidden md:flex items-stretch gap-3 px-3 py-1.5 rounded-md select-none',
          'bg-white/10 border border-white/15 text-white shadow-sm',
        )}
        aria-label="PMD station status"
      >
        <Metric label="Total Stations" value={totalStations} />
        <Divider />
        <Metric label="Total Active" value={totalActive} />
        <Divider />
        <Metric
          label="Current Active"
          value={currentActive}
          subtitle={`${windowLabel} window`}
          accent
        />
      </motion.div>
    </Tooltip>
  );
}

function Metric({ label, value, subtitle, accent = false }) {
  return (
    <div className="flex flex-col items-start leading-tight">
      <span className="text-[9px] uppercase tracking-[0.08em] text-white/70 whitespace-nowrap">
        {label}
      </span>
      <div className="flex items-baseline gap-1.5">
        <span
          className={cn(
            'text-[16px] font-semibold tabular-nums',
            accent ? 'text-emerald-300' : 'text-white',
          )}
        >
          {value ?? '—'}
        </span>
        {subtitle && (
          <span className="text-[9px] text-white/55 whitespace-nowrap">
            {subtitle}
          </span>
        )}
      </div>
    </div>
  );
}

function Divider() {
  return <span aria-hidden className="self-stretch w-px bg-white/15" />;
}
