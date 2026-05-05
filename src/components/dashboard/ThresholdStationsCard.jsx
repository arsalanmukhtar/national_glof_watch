import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ArrowRight, Clock, Droplets, Thermometer, Waves } from 'lucide-react';
import { cn } from '@/utils/cn';

// Tabs displayed at the top of the card. Order matches PMD priority.
const TABS = [
  {
    id: 'Air Temperature',
    label: 'Air Temperature',
    short: 'Air Temp',
    icon: Thermometer,
    accent: '#ef4444',   // red-500 — extreme-heat alert color
    unit: '°C',
    operator: '>',
    threshold: 30,       // dummy: high-heat advisory threshold
    thresholdLabel: '> 30°C',
  },
  {
    id: 'Total Rain',
    label: 'Total Rain',
    short: 'Total Rain',
    icon: Droplets,
    accent: '#3b82f6',   // blue-500 — heavy rain
    unit: 'mm',
    operator: '>',
    threshold: 30,       // dummy: heavy-rain threshold
    thresholdLabel: '> 30 mm',
  },
  {
    id: 'Water Level',
    label: 'Water Level',
    short: 'Water Level',
    icon: Waves,
    accent: '#dc2626',   // red-600 — flood risk
    unit: 'm',
    operator: '≥',
    threshold: 2,        // dummy: high-water alert per parameterLegends.js
    thresholdLabel: '≥ 2 m',
  },
];

// Dummy breaching stations per parameter — every entry is *intentionally*
// over the tab's threshold so the carousel always has something to show
// during testing. Replace with a real fetch (e.g. /api/parameters/:el/latest
// filtered by threshold) once the alert-thresholds policy is finalized.
const DUMMY_BREACHES = {
  'Air Temperature': [
    { name: 'Skardu',          value: 33.4, ago: '15m ago' },
    { name: 'Gilgit',          value: 31.8, ago: '8m ago'  },
    { name: 'Chitral',         value: 32.1, ago: '42m ago' },
    { name: 'Bunji',           value: 35.0, ago: '5m ago'  },
    { name: 'Astore',          value: 30.6, ago: '20m ago' },
  ],
  'Total Rain': [
    { name: 'Hunza',           value: 42,   ago: '1h ago'  },
    { name: 'Gulmit',          value: 38,   ago: '20m ago' },
    { name: 'Chatiboi',        value: 51,   ago: '35m ago' },
    { name: 'Reshun',          value: 33,   ago: '12m ago' },
  ],
  'Water Level': [
    { name: 'Indus @ Bunji',   value: 2.4,  ago: '30m ago' },
    { name: 'Hunza @ Khairabad', value: 2.8, ago: '10m ago' },
    { name: 'Gilgit @ Alam Br',  value: 2.1, ago: '45m ago' },
  ],
};

// Cycle through breaching stations once every CAROUSEL_INTERVAL_MS while
// the user isn't hovering. 3.5s is slow enough to read a value, fast
// enough to feel "live" without becoming distracting.
const CAROUSEL_INTERVAL_MS = 3500;

function formatValue(v, unit) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  const txt = Number.isInteger(v) ? v.toString() : v.toFixed(1);
  return `${txt} ${unit}`;
}

export default function ThresholdStationsCard() {
  const [tabId, setTabId] = useState(TABS[0].id);
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);

  const tab = TABS.find((t) => t.id === tabId) ?? TABS[0];
  const breaches = useMemo(() => DUMMY_BREACHES[tab.id] ?? [], [tab.id]);

  // Reset carousel position when switching tabs so the user lands on
  // the first breaching station of the new parameter.
  useEffect(() => {
    setIndex(0);
  }, [tabId]);

  // Auto-advance the carousel. Cleared on hover so the user can read a
  // value without it sliding away.
  useEffect(() => {
    if (hovered || breaches.length <= 1) return;
    const t = setInterval(() => {
      setIndex((i) => (i + 1) % breaches.length);
    }, CAROUSEL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [hovered, breaches.length]);

  const current = breaches[index] ?? null;

  return (
    <div className="card-base flex flex-col">
      {/* Header — title + threshold badge */}
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-2 border-b border-day-border dark:border-night-border">
        <AlertTriangle
          className="h-3.5 w-3.5"
          style={{ color: tab.accent }}
          aria-hidden
        />
        <h3 className="text-[12px] font-semibold tracking-wide uppercase text-day-text dark:text-night-text">
          Threshold Breaches
        </h3>
        <span
          className="ml-auto text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-md border"
          style={{
            color: tab.accent,
            borderColor: `${tab.accent}66`,
            backgroundColor: `${tab.accent}14`,
          }}
        >
          {tab.thresholdLabel}
        </span>
      </div>

      {/* Tabs */}
      <div className="flex items-stretch gap-0.5 px-1.5 pt-1.5">
        {TABS.map((t) => {
          const active = t.id === tabId;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTabId(t.id)}
              aria-pressed={active}
              className={cn(
                'relative flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] font-medium rounded-md transition-colors',
                active
                  ? 'text-day-text dark:text-night-text'
                  : 'text-day-muted dark:text-night-muted hover:text-day-text dark:hover:text-night-text',
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              <span className="truncate">{t.short}</span>
              {active ? (
                <motion.span
                  layoutId="threshold-tab-underline"
                  className="absolute inset-x-1 bottom-0 h-0.5 rounded-full"
                  style={{ backgroundColor: tab.accent }}
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                />
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Carousel viewport */}
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="relative px-3 pt-2.5 pb-3 min-h-[68px]"
      >
        {breaches.length === 0 ? (
          <div className="flex items-center justify-center h-[60px] text-[11px] text-day-muted dark:text-night-muted">
            No stations breaching {tab.thresholdLabel} right now.
          </div>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${tab.id}-${index}`}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.32, ease: [0.4, 0, 0.2, 1] }}
              // Accent tint matching the threshold badge in the header.
              // Hex `33` ≈ 20% opacity — visibly filled while keeping the
              // value text crisp against it on both day and night.
              className="flex items-center gap-3 p-2.5 rounded-md"
              style={{ backgroundColor: `${tab.accent}33` }}
            >
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center"
                style={{ color: tab.accent }}
              >
                <tab.icon className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span
                    className="text-[15px] font-semibold tabular-nums"
                    style={{ color: tab.accent }}
                  >
                    {formatValue(current.value, tab.unit)}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-day-muted dark:text-night-muted">
                    {tab.operator} {tab.threshold} {tab.unit}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 text-[12px] text-day-text dark:text-night-text truncate">
                  <ArrowRight className="h-3 w-3 shrink-0 text-day-muted dark:text-night-muted" aria-hidden />
                  <span className="truncate font-medium">{current.name}</span>
                </div>
                <div className="flex items-center gap-1 mt-0.5 text-[10px] text-day-muted dark:text-night-muted">
                  <Clock className="h-2.5 w-2.5" aria-hidden />
                  <span>{current.ago}</span>
                </div>
              </div>
              {/* Pagination dots — show position in the rotation. Click to
                  jump straight to that station. */}
              <div className="flex flex-col gap-1 shrink-0">
                {breaches.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setIndex(i)}
                    aria-label={`Show breach ${i + 1}`}
                    className={cn(
                      'h-1.5 w-1.5 rounded-full transition-colors',
                      i === index
                        ? ''
                        : 'bg-day-border dark:bg-night-border hover:bg-day-muted dark:hover:bg-night-muted',
                    )}
                    style={i === index ? { backgroundColor: tab.accent } : undefined}
                  />
                ))}
              </div>
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
