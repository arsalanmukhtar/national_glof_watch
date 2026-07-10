import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/utils/cn';

// Distinct colour per sensor family. Picked from Tailwind's -400
// range where possible so every dot reads with strong contrast on
// the emerald titlebar in both day and night themes. Kept in-file
// rather than as a global palette because these values are only
// meaningful in the context of the titlebar chip row.
const TYPE_COLORS = {
  ARG:   '#38bdf8',   // sky      — rain-gauge (precipitation)
  WP:    '#fbbf24',   // amber    — warning-post (matches on-map bullseye theme)
  'WL-R':'#22d3ee',   // cyan     — water level, river
  DG:    '#c084fc',   // violet   — discharge / data-logger
  'WL-L':'#5eead4',   // teal     — water level, lake
  AWS:   '#fb923c',   // orange   — automatic weather station
  'AWS-H':'#f472b6',  // pink     — AWS hydromet variant
  OTHER: '#94a3b8',   // slate    — fallback for any future type
};

// Human-readable expansion of each abbreviation — surfaced in the
// per-chip tooltip so operators don't have to remember what "DG" or
// "WL-R" stands for.
const TYPE_LABELS = {
  ARG:    'Automatic Rain Gauge',
  WP:     'Warning Post',
  'WL-R': 'Water Level – River',
  DG:     'Discharge Gauge',
  'WL-L': 'Water Level – Lake',
  AWS:    'Automatic Weather Station',
  'AWS-H':'AWS Hydromet',
  OTHER:  'Other',
};

const REFRESH_MS = 60 * 60 * 1000;   // 1 h — roster changes are slow

export default function SensorTypesBadge() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const lastReqIdRef = useRef(0);

  const load = useCallback(async () => {
    const reqId = ++lastReqIdRef.current;
    try {
      const r = await fetch('/api/parameters/sensor-types');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (reqId !== lastReqIdRef.current) return;
      setData(j);
      setError(null);
      setLoaded(true);
    } catch (err) {
      if (reqId !== lastReqIdRef.current) return;
      setError(err.message);
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  // Reserve horizontal space with a translucent skeleton while the
  // first request is in flight so the titlebar doesn't jolt once data
  // lands. Hide entirely on a hard error — the row is optional info.
  if (!loaded && !data) {
    return (
      <div
        aria-hidden
        className="hidden xl:block w-[520px] h-11 rounded-md bg-white/5 border border-white/10"
      />
    );
  }
  if (error && !data) return null;

  const types = Array.isArray(data?.types) ? data.types : [];

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn(
        // Explicit h-11 locks this pill to the exact height of the
        // sibling StationStatusBadge (which renders naturally at 44 px
        // via py-1 + Metric content) so the two pills sit side-by-side
        // as one horizontal band.
        'hidden xl:flex h-11 items-stretch gap-3 pl-3 pr-3 rounded-md select-none',
        'bg-white/10 border border-white/15 text-white shadow-sm',
      )}
      aria-label="Sensor-type breakdown"
    >
      {/* Label column — `justify-center` on a flex-col centres the
          single-line heading exactly like the neighbour's two-line
          PMD-GLOF-2-Live block, so the label sits on the vertical
          midline instead of the top of the column. */}
      <div className="flex flex-col justify-center pr-2 border-r border-white/15">
        <span className="text-[12px] font-semibold uppercase tracking-[0.1em] whitespace-nowrap">
          Sensor Types
        </span>
      </div>

      {/* Per-type metric columns — type label on top (plain white,
          small caps), count below (bold, coloured per family). Each
          column is `justify-center` so the pair is centred within the
          fixed row height; matches how the neighbour badge's metric
          block reads. */}
      <div className="flex items-stretch gap-3">
        {types.map((t, i) => (
          <TypeMetric
            key={t.type}
            type={t.type}
            count={t.count}
            title={`${TYPE_LABELS[t.type] ?? t.type} · ${t.count} station${t.count === 1 ? '' : 's'}`}
            showDivider={i > 0}
          />
        ))}
      </div>
    </motion.div>
  );
}

function TypeMetric({ type, count, title, showDivider }) {
  const color = TYPE_COLORS[type] ?? TYPE_COLORS.OTHER;
  return (
    <>
      {showDivider && <Divider />}
      <div
        // `items-center` horizontally centres the count under the type
        // label, and `min-w-[42px]` forces every column to the same
        // width so the seven cells read as a uniform grid instead of
        // hugging their respective label widths (which drift because
        // "AWS-H" is 5 chars while "WP" is 2).
        className="flex flex-col justify-center items-center leading-none gap-1.5 min-w-[42px]"
        title={title}
      >
        <span className="text-[10px] uppercase tracking-[0.08em] text-white whitespace-nowrap leading-none">
          {type}
        </span>
        <span
          className="text-[15px] font-semibold tabular-nums leading-none"
          style={{ color }}
        >
          {count}
        </span>
      </div>
    </>
  );
}

function Divider() {
  return <span aria-hidden className="self-stretch w-px bg-white/15" />;
}
