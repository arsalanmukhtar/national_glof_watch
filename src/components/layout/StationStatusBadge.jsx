import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw } from 'lucide-react';
import { timeAgo } from '@/utils/timeAgo';
import { cn } from '@/utils/cn';

// Compact PMD network-status pill rendered in the titlebar. Shows the
// three counts the upstream reports (total / total active / currently
// active) plus a "Last updated …" footer.
//
// Poll cadence: 30 minutes. The upstream rolls slowly enough that more
// frequent polls just burn the proxy cache without surfacing new data.
// A separate 60s tick updates the relative-time label so the user sees
// the counter advance ("21 mins ago" → "22 mins ago") without paying
// for a refetch.
const REFRESH_MS = 30 * 60 * 1000;
const TICK_MS    = 60 * 1000;

export default function StationStatusBadge() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  // `now` exists purely to re-render the relative-time footer on each
  // tick — the value isn't read directly. eslint will warn; suppression
  // would just hide the intent.
  const [, setNow] = useState(Date.now());
  // Tracks the latest in-flight load so a stale earlier response can't
  // overwrite a fresh one (e.g. user spam-clicks the refresh button).
  const lastReqIdRef = useRef(0);

  const load = useCallback(async () => {
    const reqId = ++lastReqIdRef.current;
    setRefreshing(true);
    try {
      const r = await fetch('/api/parameters/station-status');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (reqId !== lastReqIdRef.current) return;
      setData(j);
      setError(null);
      setLoaded(true);
      setFetchedAt(new Date().toISOString());
    } catch (err) {
      if (reqId !== lastReqIdRef.current) return;
      setError(err.message);
      setLoaded(true);
    } finally {
      if (reqId === lastReqIdRef.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const refreshId = setInterval(load, REFRESH_MS);
    const tickId    = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      clearInterval(refreshId);
      clearInterval(tickId);
    };
  }, [load]);

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
    <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className={cn(
          'hidden md:flex flex-col gap-0.5 px-3 py-1 rounded-md select-none',
          'bg-white/10 border border-white/15 text-white shadow-sm',
        )}
        aria-label="PMD station status"
      >
        <div className="flex items-stretch gap-3">
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
        </div>
        <div className="flex items-center justify-between gap-2 leading-none">
          <span className="text-[9px] text-white/60">
            Last updated{' '}
            <span className="text-white/85 tabular-nums">
              {fetchedAt ? timeAgo(fetchedAt) : '—'}
            </span>
          </span>
          <button
            type="button"
            onClick={() => {
              if (!refreshing) load();
            }}
            disabled={refreshing}
            aria-label="Refresh station status"
            title="Refresh now"
            className={cn(
              'inline-flex h-4 w-4 items-center justify-center rounded',
              'text-white/60 hover:text-white hover:bg-white/10 transition-colors',
              'disabled:opacity-60 disabled:cursor-not-allowed',
              refreshing && 'text-white',
            )}
          >
            <RefreshCw
              className={cn('h-2.5 w-2.5', refreshing && 'animate-spin')}
            />
          </button>
        </div>
      </motion.div>
  );
}

function Metric({ label, value, subtitle, accent = false }) {
  return (
    <div className="flex flex-col items-start leading-none gap-0.5">
      <span className="text-[9px] uppercase tracking-[0.08em] text-white/70 whitespace-nowrap">
        {label}
      </span>
      <div className="flex items-baseline gap-1.5">
        <span
          className={cn(
            'text-[14px] font-semibold tabular-nums leading-none',
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
