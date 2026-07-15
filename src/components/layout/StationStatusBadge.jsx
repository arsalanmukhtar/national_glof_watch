import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw } from 'lucide-react';
import { timeAgo } from '@/utils/timeAgo';
import { cn } from '@/utils/cn';

// Compact PMD network-status pill rendered in the titlebar. Shows the
// three counts the upstream reports (total / total active / currently
// active) plus a "Last updated …" footer.
//
// Poll cadence: 30 minutes once the badge has data. While no data has
// ever loaded (backend booting, upstream PMD API slow, /station-status
// still returning 503 with a warming cache), we retry every 30 s so
// the pill fills in as soon as the backend is ready instead of
// silently staying blank until the next 30-minute tick.
// A separate 60s tick updates the relative-time label so the user
// sees the counter advance ("21 mins ago" → "22 mins ago") without
// paying for a refetch.
const REFRESH_MS       = 30 * 60 * 1000;
const RETRY_WHILE_EMPTY_MS = 30 * 1000;
const TICK_MS          = 60 * 1000;

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
    // Slow interval always ticks; a faster retry ticks only while we
    // don't yet have data, so the pill fills in the moment the
    // backend cache is warm rather than waiting up to 30 minutes.
    const refreshId = setInterval(load, REFRESH_MS);
    const retryId = setInterval(() => {
      if (!data) load();
    }, RETRY_WHILE_EMPTY_MS);
    const tickId = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      clearInterval(refreshId);
      clearInterval(retryId);
      clearInterval(tickId);
    };
  }, [load, data]);

  // Reserve space while the first request is in flight so the layout
  // doesn't jolt once data lands. Width matches the rendered combined
  // badge — feed label + metrics + footer.
  if (!loaded && !data) {
    return (
      <div
        aria-hidden
        className="hidden md:block w-[440px] h-11 rounded-md bg-white/5 border border-white/10"
      />
    );
  }
  // Deliberately fall through to the render even when the fetch has
  // failed — the badge itself is useful chrome (the label + refresh
  // button remain interactive) and the metric columns show dashes
  // via the `value ?? '—'` fallback in <Metric>. Previously a hard
  // error hid the whole pill until a full page reload, which the
  // operator experienced as "the section disappeared".

  // Hard-pinned to the published EWS station roster (279) regardless
  // of what the upstream count reports — the live API occasionally
  // double-counts after sensor swaps and the surface number should
  // match the inventory the team publishes.
  const totalStations  = 279;
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
        // Explicit h-11 pins this pill to 44 px so it stays row-aligned
        // with the sibling SensorTypesBadge next to it, regardless of
        // small content differences between the two.
        'hidden md:flex h-11 items-stretch gap-3 pl-3 pr-3 rounded-md select-none',
        'bg-white/10 border border-white/15 text-white shadow-sm',
      )}
      aria-label="PMD GLOF 2 live station status"
    >
      {/* Feed identifier column — pulsing dot + name on top,
          "Updated …" + refresh button below. Dot goes emerald when
          the last fetch succeeded, amber while we're operating on a
          missing/errored backend so the operator can tell "dashes"
          apart from "actual zeros". */}
      <div className="flex flex-col justify-center gap-1 pr-2 border-r border-white/15">
        <div className="flex items-center gap-2">
          <span className="relative inline-flex h-2 w-2 shrink-0" aria-hidden>
            <span
              className={cn(
                'absolute inset-0 rounded-full animate-ping opacity-75',
                data ? 'bg-emerald-400' : 'bg-amber-400',
              )}
            />
            <span
              className={cn(
                'relative h-2 w-2 rounded-full',
                data ? 'bg-emerald-400' : 'bg-amber-400',
              )}
            />
          </span>
          <span className="text-[12px] font-semibold uppercase tracking-[0.1em] whitespace-nowrap">
            PMD GLOF 2 Live
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 leading-none">
          <span
            className="text-[10px] text-white/60 whitespace-nowrap"
            title={!data && error ? `Upstream unavailable: ${error}` : undefined}
          >
            Updated{' '}
            <span className="text-white/85 tabular-nums">
              {fetchedAt ? timeAgo(fetchedAt) : !data && error ? 'unavailable' : '—'}
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
              'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded',
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
      </div>

      {/* Metrics column — single row now that the freshness footer
          moved to the feed-label column. The increased label-to-value
          gap (gap-1.5) lets the eye separate the metric type from its
          count instead of reading the two as one stacked chip. */}
      <div className="flex items-stretch gap-3 self-center">
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
    </motion.div>
  );
}

function Metric({ label, value, subtitle, accent = false }) {
  return (
    <div className="flex flex-col items-start leading-none gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.08em] text-white/70 whitespace-nowrap">
        {label}
      </span>
      <div className="flex items-baseline gap-1.5">
        <span
          className={cn(
            'text-[15px] font-semibold tabular-nums leading-none',
            accent ? 'text-emerald-300' : 'text-white',
          )}
        >
          {value ?? '—'}
        </span>
        {subtitle && (
          <span className="text-[10px] text-white/55 whitespace-nowrap">
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
