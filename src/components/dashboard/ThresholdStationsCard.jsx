import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock,
  CloudRain,
  CloudSnow,
  Compass,
  Droplets,
  Gauge,
  Loader2,
  Sun,
  Thermometer,
  Waves,
  Wind,
} from 'lucide-react';
import { classifyState, stateForAlertId } from '@/config/alertStates';
import { colorFor } from '@/config/parameterColors';
import { useParameter } from '@/contexts/ParameterContext';
import { cn } from '@/utils/cn';

// Per-element icon + short-label overrides. Colours DO NOT live here —
// they come from `colorFor(elementName)` in @/config/parameterColors so
// every parameter reads with the same accent as in the ParametersPanel
// list (Air Temperature = orange, Compact GAS State = violet, etc.).
// Curated colours are pinned in parameterColors.js; anything else lands
// in a stable 30-hue palette by hash of its name.
const ELEMENT_META = {
  'Air Temperature':        { icon: Thermometer, short: 'Air Temp' },
  'Water Level':            { icon: Waves,       short: 'Water Level' },
  'Instantaneous Flow':     { icon: Gauge,       short: 'Inst. Flow' },
  'Istantaneous Flow':      { icon: Gauge,       short: 'Inst. Flow' },  // PMD's own spelling
  'Total Rain':             { icon: Droplets,    short: 'Total Rain' },
  Rainfall:                 { icon: CloudRain,   short: 'Rainfall' },
  Precipitation:            { icon: CloudRain,   short: 'Precip.' },
  Humidity:                 { icon: Droplets,    short: 'Humidity' },
  'Wind Speed':             { icon: Wind,        short: 'Wind Spd' },
  'Wind Direction':         { icon: Compass,     short: 'Wind Dir' },
  'Snow Depth':             { icon: CloudSnow,   short: 'Snow Dep' },
  'Solar Radiation':        { icon: Sun,         short: 'Solar Rad' },
};

const DEFAULT_META = { icon: CircleAlert, short: null };

function metaFor(elementName) {
  const meta = ELEMENT_META[elementName] || DEFAULT_META;
  return {
    id: elementName,
    label: elementName,
    icon: meta.icon,
    // Full-opacity per-parameter colour shared with ParametersPanel.
    tabAccent: colorFor(elementName),
    // Fallback short label: first two words, truncated.
    short:
      meta.short ??
      (elementName.length > 10
        ? elementName.split(' ').slice(0, 2).join(' ').slice(0, 12)
        : elementName),
  };
}

// Severity cutoff for "breach" — PMD's ladder: 0 Normal, 20 Error,
// 40 Warning, 70 Pre-alarm, 90 Alarm. Focus is Pre-alarm-or-worse so the
// card surfaces only the states that need active attention.
const MIN_STATE = 70;

// Preferred tab ordering: known "priority" elements first, then the rest
// alphabetical. Keeps Air Temp / Water Level / etc. left-most when the
// catalog is large.
const TAB_PRIORITY = [
  'Air Temperature',
  'Total Rain',
  'Water Level',
  'Instantaneous Flow',
];

const CAROUSEL_INTERVAL_MS = 3500;
const TAB_INTERVAL_MS = 5000;      // auto-advance parameter tabs every 5 s
const MAX_DOTS = 6;       // vertical dots on the row — capped so card height stays fixed

function formatValue(value, unit) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  const txt = Number.isInteger(n) ? n.toString() : n.toFixed(1);
  return unit ? `${txt} ${unit}` : txt;
}

function timeAgo(ts) {
  if (!ts) return '—';
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return '—';
  const delta = Math.max(0, Date.now() - t);
  if (delta < 45_000) return 'Just now';
  const mins = Math.floor(delta / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function crossedLabel(crossed, unit) {
  if (!crossed) return null;
  const op = crossed.operator ?? '';
  const min = crossed.min;
  const max = crossed.max;
  if (crossed.condition) {
    return unit ? `${crossed.condition} ${unit}` : crossed.condition;
  }
  if (op && min != null) {
    const rounded = Number.isFinite(min)
      ? (Number.isInteger(min) ? min : Number(min.toFixed(1)))
      : min;
    return unit ? `${op} ${rounded} ${unit}` : `${op} ${rounded}`;
  }
  if (op && max != null) {
    return unit ? `${op} ${max} ${unit}` : `${op} ${max}`;
  }
  return null;
}

export default function ThresholdStationsCard() {
  const { elements } = useParameter();

  // Build the tab list from the live element catalog. Ordered:
  // priority elements first (in the order given), everything else after
  // alphabetically. Elements with zero stations reporting are still
  // included — the card will just say "no breaches" for them.
  const tabs = useMemo(() => {
    if (!elements?.length) {
      // Bootstrap fallback so the card doesn't render empty on first
      // paint before the catalog fetch resolves.
      return TAB_PRIORITY.map(metaFor);
    }
    const priority = TAB_PRIORITY
      .map((name) => elements.find((e) => e.name === name))
      .filter(Boolean);
    const seen = new Set(priority.map((e) => e.name));
    const rest = elements
      .filter((e) => !seen.has(e.name))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
    return [...priority, ...rest].map((e) => metaFor(e.name));
  }, [elements]);

  const [tabId, setTabId] = useState(TAB_PRIORITY[0]);

  // Guard: if the catalog reloads and the previously-selected tab no
  // longer exists (renamed, removed), snap to the first available.
  useEffect(() => {
    if (!tabs.length) return;
    if (!tabs.some((t) => t.id === tabId)) {
      setTabId(tabs[0].id);
    }
  }, [tabs, tabId]);

  const tab = tabs.find((t) => t.id === tabId) ?? tabs[0];
  const activeIdx = tabs.findIndex((t) => t.id === tab?.id);

  const [breaches, setBreaches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  // Info-popover visibility. Small explainer that opens when the user
  // clicks the header's warning-triangle. Rendered through a portal
  // with fixed positioning so it escapes any parent panel's overflow
  // or stacking context (which was clipping / underlaying it before).
  const [showInfo, setShowInfo] = useState(false);
  const infoBtnRef = useRef(null);

  useEffect(() => {
    if (!tab) return;
    let cancelled = false;
    const load = () => {
      const url = `/api/parameters/${encodeURIComponent(tab.id)}/latest?minState=${MIN_STATE}`;
      setLoading((wasLoading) => wasLoading || breaches.length === 0);
      setError(null);
      fetch(url)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((data) => {
          if (cancelled) return;
          const list = (data?.features ?? [])
            .map((f) => f.properties)
            .filter((p) => p && Number.isFinite(Number(p.stateId)))
            .sort((a, b) => {
              const dS = (b.stateId ?? 0) - (a.stateId ?? 0);
              if (dS !== 0) return dS;
              const ta = new Date(a.lastUpdate ?? 0).getTime();
              const tb = new Date(b.lastUpdate ?? 0).getTime();
              return tb - ta;
            });
          setBreaches(list);
          setIndex(0);
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err.message);
          setBreaches([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab?.id]);

  useEffect(() => {
    if (hovered || breaches.length <= 1) return;
    const t = setInterval(() => {
      setIndex((i) => (i + 1) % breaches.length);
    }, CAROUSEL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [hovered, breaches.length]);

  // Auto-advance the parameter tab every 3 s. Uses the functional form of
  // setTabId + a ref-free lookup against the live `tabs` array so the
  // interval doesn't need to be torn down / rebuilt on every tab change —
  // only when the catalog changes or the user pauses on hover.
  useEffect(() => {
    if (hovered || tabs.length <= 1) return;
    const t = setInterval(() => {
      setTabId((currentId) => {
        const idx = tabs.findIndex((tt) => tt.id === currentId);
        if (idx < 0) return tabs[0].id;
        return tabs[(idx + 1) % tabs.length].id;
      });
    }, TAB_INTERVAL_MS);
    return () => clearInterval(t);
  }, [hovered, tabs]);

  const current = breaches[index] ?? null;

  const worstState = useMemo(() => {
    if (!breaches.length) return null;
    const worstId = breaches.reduce(
      (max, b) => Math.max(max, Number(b.stateId) || 0),
      0,
    );
    return stateForAlertId(worstId);
  }, [breaches]);

  const rowState = current ? classifyState(current.stateId, current.lastUpdate) : null;
  const rowColor = rowState?.color ?? '#6b7280';
  const rowUnit = current?.unit ?? '';
  const rowCrossed = crossedLabel(current?.crossedThreshold, rowUnit);

  // ---- Tab carousel: 3 fixed slots (prev | active | next) ----------
  // Chevrons and preview slots advance the active tab by exactly one
  // step so the user always sees the same layout: their currently
  // selected parameter dead-centre, with a hint of what's on either
  // side. Cleaner than a sliding window because there is no separate
  // "which tab is active" vs "which window is visible" state to keep
  // in sync — the active tab IS the middle slot, always.
  const prevTab = activeIdx > 0 ? tabs[activeIdx - 1] : null;
  const nextTab = activeIdx >= 0 && activeIdx < tabs.length - 1
    ? tabs[activeIdx + 1]
    : null;
  const goPrev = () => {
    if (prevTab) setTabId(prevTab.id);
  };
  const goNext = () => {
    if (nextTab) setTabId(nextTab.id);
  };

  // ---- Fixed-count dot indicator -----------------------------------
  // When there are <= MAX_DOTS breaches, dots map 1:1 to stations. Once
  // over MAX_DOTS, they compress to a proportional position bar so the
  // column stays exactly MAX_DOTS tall — the card height never grows
  // with the breach count.
  const dotCount = Math.min(breaches.length, MAX_DOTS);
  const dotToIndex = (dotIdx) => {
    if (breaches.length <= MAX_DOTS) return dotIdx;
    // Round outward so first/last dots always target the ends.
    return Math.round((dotIdx / (MAX_DOTS - 1)) * (breaches.length - 1));
  };
  const activeDot =
    breaches.length <= MAX_DOTS
      ? index
      : breaches.length <= 1
        ? 0
        : Math.round((index / (breaches.length - 1)) * (MAX_DOTS - 1));

  return (
    <div
      className="card-base flex flex-col"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Header — title + worst-state badge */}
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-2 border-b border-day-border dark:border-night-border">
        <button
          ref={infoBtnRef}
          type="button"
          onClick={() => setShowInfo((v) => !v)}
          aria-label="About Threshold Breaches"
          title="How thresholds are calculated"
          className="inline-flex items-center justify-center rounded transition-opacity hover:opacity-80"
        >
          <AlertTriangle
            className="h-3.5 w-3.5"
            style={{ color: worstState?.color ?? tab?.tabAccent ?? '#84cc16' }}
            aria-hidden
          />
        </button>
        <h3 className="text-[13px] font-semibold tracking-wide uppercase text-day-text dark:text-night-text">
          Threshold Breaches
        </h3>
        {showInfo && (
          <ThresholdInfoPopover
            anchorRef={infoBtnRef}
            onClose={() => setShowInfo(false)}
          />
        )}
        {worstState ? (
          <span
            className="ml-auto text-[11px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md border"
            style={{
              color: worstState.color,
              borderColor: `${worstState.color}66`,
              backgroundColor: `${worstState.color}14`,
            }}
          >
            {worstState.label}
          </span>
        ) : loading ? (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-day-muted dark:text-night-muted">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            Loading…
          </span>
        ) : null}
      </div>

      {/* Tab carousel — three fixed slots: previous (icon+short, muted),
          active (icon + FULL label, accent-coloured), next (icon+short,
          muted). Chevrons + preview slots both step by one so the user
          always sees the same layout: current parameter dead-centre. */}
      <div className="flex items-stretch gap-0.5 px-1.5 pt-1.5">
        <button
          type="button"
          onClick={goPrev}
          disabled={!prevTab}
          aria-label={prevTab ? `Previous parameter: ${prevTab.label}` : 'No previous parameter'}
          className={cn(
            'shrink-0 h-8 w-6 inline-flex items-center justify-center rounded-md transition-colors',
            prevTab
              ? 'text-day-text dark:text-night-text hover:bg-day-bg dark:hover:bg-night-bg'
              : 'text-day-muted/40 dark:text-night-muted/40 cursor-not-allowed',
          )}
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
        </button>

        <div className="flex-1 flex items-stretch gap-0.5 min-w-0">
          {/* PREVIOUS — narrow preview slot; empty placeholder keeps the
              layout stable at the left edge of the list. */}
          {prevTab ? (
            <button
              type="button"
              onClick={goPrev}
              aria-label={`Switch to ${prevTab.label}`}
              title={prevTab.label}
              className="shrink-0 w-14 inline-flex items-center justify-center gap-1 px-1 py-1.5 text-[11.5px] font-medium rounded-md text-day-muted dark:text-night-muted hover:text-day-text dark:hover:text-night-text hover:bg-day-bg dark:hover:bg-night-bg transition-colors"
            >
              <prevTab.icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{prevTab.short}</span>
            </button>
          ) : (
            <span className="shrink-0 w-14" aria-hidden />
          )}

          {/* ACTIVE — full label, coloured with tabAccent, animated
              underline follows the accent. */}
          {tab ? (
            <div
              className="relative flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md"
              aria-current="true"
              title={tab.label}
            >
              <tab.icon
                className="h-3.5 w-3.5 shrink-0"
                style={{ color: tab.tabAccent }}
                aria-hidden
              />
              <span
                className="truncate text-[12.5px] font-semibold"
                style={{ color: tab.tabAccent }}
              >
                {tab.label}
              </span>
              <motion.span
                layoutId="threshold-tab-underline"
                className="absolute inset-x-1 bottom-0 h-0.5 rounded-full"
                style={{ backgroundColor: tab.tabAccent }}
                transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              />
            </div>
          ) : (
            <span className="flex-1" aria-hidden />
          )}

          {/* NEXT — narrow preview slot; empty placeholder at the right
              edge of the list. */}
          {nextTab ? (
            <button
              type="button"
              onClick={goNext}
              aria-label={`Switch to ${nextTab.label}`}
              title={nextTab.label}
              className="shrink-0 w-14 inline-flex items-center justify-center gap-1 px-1 py-1.5 text-[11.5px] font-medium rounded-md text-day-muted dark:text-night-muted hover:text-day-text dark:hover:text-night-text hover:bg-day-bg dark:hover:bg-night-bg transition-colors"
            >
              <nextTab.icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{nextTab.short}</span>
            </button>
          ) : (
            <span className="shrink-0 w-14" aria-hidden />
          )}
        </div>

        <button
          type="button"
          onClick={goNext}
          disabled={!nextTab}
          aria-label={nextTab ? `Next parameter: ${nextTab.label}` : 'No next parameter'}
          className={cn(
            'shrink-0 h-8 w-6 inline-flex items-center justify-center rounded-md transition-colors',
            nextTab
              ? 'text-day-text dark:text-night-text hover:bg-day-bg dark:hover:bg-night-bg'
              : 'text-day-muted/40 dark:text-night-muted/40 cursor-not-allowed',
          )}
        >
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      {/* Carousel viewport */}
      <div className="relative px-3 pt-2.5 pb-3 min-h-[68px]">
        {error ? (
          <div className="flex items-center justify-center h-[60px] text-[12px] text-red-600 dark:text-red-400">
            {error}
          </div>
        ) : loading && breaches.length === 0 ? (
          <div className="flex items-center justify-center h-[60px] gap-1.5 text-[12px] text-day-muted dark:text-night-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Loading breaches…
          </div>
        ) : breaches.length === 0 ? (
          <div className="flex items-center justify-center h-[60px] text-[12px] text-day-muted dark:text-night-muted text-center px-2">
            No {(tab?.short ?? tab?.label ?? 'station').toString().toLowerCase()} stations at Pre-alarm or Alarm right now.
          </div>
        ) : current ? (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${tab.id}-${current.stationId}-${index}`}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.32, ease: [0.4, 0, 0.2, 1] }}
              className="flex items-center gap-3 p-2.5 rounded-md"
              style={{ backgroundColor: `${rowColor}33` }}
            >
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center"
                style={{ color: rowColor }}
              >
                <tab.icon className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span
                    className="text-[16px] font-semibold tabular-nums"
                    style={{ color: rowColor }}
                  >
                    {formatValue(current.value, rowUnit)}
                  </span>
                  {rowCrossed ? (
                    <span className="text-[11px] uppercase tracking-wide text-day-muted dark:text-night-muted">
                      {rowCrossed}
                    </span>
                  ) : rowState ? (
                    <span className="text-[11px] uppercase tracking-wide text-day-muted dark:text-night-muted">
                      {rowState.label}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 text-[13px] text-day-text dark:text-night-text truncate">
                  <ArrowRight className="h-3 w-3 shrink-0 text-day-muted dark:text-night-muted" aria-hidden />
                  <span className="truncate font-medium">
                    {current.stationName ?? `Station ${current.stationId}`}
                  </span>
                </div>
                <div className="flex items-center gap-1 mt-0.5 text-[11px] text-day-muted dark:text-night-muted">
                  <Clock className="h-2.5 w-2.5" aria-hidden />
                  <span>{timeAgo(current.lastUpdate)}</span>
                </div>
              </div>
              {/* Pagination dots — always MAX_DOTS tall. Beyond that many
                  breaches, the dots represent a proportional position
                  along the list so the card height never grows. */}
              <div className="flex flex-col gap-1 shrink-0">
                {Array.from({ length: dotCount }).map((_, i) => {
                  const targetIdx = dotToIndex(i);
                  const isActive = i === activeDot;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setIndex(targetIdx)}
                      aria-label={`Show breach ${targetIdx + 1} of ${breaches.length}`}
                      className={cn(
                        'h-1.5 w-1.5 rounded-full transition-colors',
                        isActive
                          ? ''
                          : 'bg-day-border dark:bg-night-border hover:bg-day-muted dark:hover:bg-night-muted',
                      )}
                      style={isActive ? { backgroundColor: rowColor } : undefined}
                    />
                  );
                })}
                {breaches.length > MAX_DOTS ? (
                  <span
                    className="mt-0.5 text-[9px] font-semibold tabular-nums text-day-muted dark:text-night-muted"
                    title={`Showing ${index + 1} of ${breaches.length}`}
                  >
                    +{breaches.length - MAX_DOTS}
                  </span>
                ) : null}
              </div>
            </motion.div>
          </AnimatePresence>
        ) : null}
      </div>
    </div>
  );
}

// Explainer popover that opens when the user clicks the header
// warning-triangle. Rendered through a Portal into document.body with
// FIXED positioning so it escapes every parent's overflow-hidden and
// stacking context (previously the Layer Style panel underneath was
// drawing on top of it). Position is computed from the anchor button's
// bounding rect and refreshed on window resize.
function ThresholdInfoPopover({ anchorRef, onClose }) {
  const POPOVER_WIDTH = 280;
  const [pos, setPos] = useState(() => computePos());

  function computePos() {
    const el = anchorRef?.current;
    if (!el || typeof window === 'undefined') return { top: 0, left: 0 };
    const r = el.getBoundingClientRect();
    // Anchor: 4 px below the icon, left-aligned to its left edge, but
    // clamped so the 280 px box never spills off the viewport's right side.
    const preferredLeft = r.left;
    const maxLeft = window.innerWidth - POPOVER_WIDTH - 8;
    return {
      top: r.bottom + 4,
      left: Math.max(8, Math.min(preferredLeft, maxLeft)),
    };
  }

  useEffect(() => {
    setPos(computePos());
    const onResize = () => setPos(computePos());
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
    // computePos closes over the ref, which is stable — no deps needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      {/* Invisible full-viewport backdrop closes the popover on any
          outside click. z-[9998] sits just below the popover so clicks
          on the popover itself land through. */}
      <button
        type="button"
        aria-label="Close info"
        onClick={onClose}
        className="fixed inset-0 z-[9998] cursor-default bg-transparent"
      />
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15 }}
        role="dialog"
        aria-label="How our early warning works"
        style={{ top: pos.top, left: pos.left, width: POPOVER_WIDTH }}
        className={cn(
          'fixed z-[9999] p-3 rounded-md shadow-xl',
          'bg-white dark:bg-night-surface',
          'border border-day-border dark:border-night-border',
          'text-[12px] leading-relaxed text-day-text dark:text-night-text',
          // text-justify + hyphens make the paragraph rag flush on both
          // sides without ugly word-spacing gaps in the narrow 280px box.
          'text-justify hyphens-auto',
        )}
      >
        <div className="mb-1.5 text-left">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-day-muted dark:text-night-muted">
            How this works
          </span>
        </div>
        <p className="mb-2">
          We warn you <span className="font-semibold">10% sooner</span> than
          PMD. So if PMD would raise the alarm at{' '}
          <span className="font-semibold">30 °C</span>, our warning appears at{' '}
          <span className="font-semibold">27 °C</span>. That extra buffer
          gives you time to check the station and take action before the
          official alarm fires.
        </p>
        <p className="text-[11.5px] text-day-muted dark:text-night-muted">
          Every station has its own alert limits set by PMD. The 10% early
          check is applied to each station individually, not to the whole
          network at once.
        </p>
      </motion.div>
    </>,
    document.body,
  );
}