import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  MapPin,
  Layers,
  Hash,
  FileJson,
  Box,
  Compass,
  Ruler,
  Sparkles,
  Type,
  AlertTriangle,
  Image as ImageIcon,
} from 'lucide-react';
import { useAttributeTables } from '@/contexts/AttributeTablesContext';
import { cn } from '@/utils/cn';

// Feature Details — a card-based, non-tabular view of a clicked map
// feature's properties. Three regions:
//
//   1. Header card — layer kind chip + label + geometry sublabel, with a
//      coloured rail on the left matching the layer's accent.
//   2. Highlighted "primary" properties (name / id / risk-level if any)
//      promoted to a separate top row so the user sees the identifying
//      attributes first without scanning a wall of cards.
//   3. The remaining attributes laid out as a responsive 1/2/3-column
//      grid of compact tiles. Each tile auto-formats its value (numbers
//      get locale grouping, URLs become links, booleans get pill chips).
//
// The component intentionally never falls back to a <table>. The user's
// design brief was explicit about that — the Attributes Table tab is the
// tabular view; this is the "look at one thing carefully" view.

export default function FeatureDetailsPanel() {
  const { selectedFeature } = useAttributeTables();

  // Hooks have to run unconditionally on every render, so derive
  // everything from `selectedFeature` (or sensible fallbacks) BEFORE the
  // empty-state early return. The branch below just decides what to
  // show; the work above is identical regardless.
  const properties = selectedFeature?.feature?.properties ?? null;

  // Keep stable insertion order; drop nulls/empties so the panel doesn't
  // pad itself with "—" tiles. If everything's empty we surface that
  // explicitly below the header rather than rendering a hollow grid.
  const allEntries = useMemo(() => {
    if (!properties) return [];
    return Object.entries(properties).filter(
      ([, v]) => v !== null && v !== '' && v !== undefined,
    );
  }, [properties]);

  // Promote a handful of "identity-ish" keys to the top so the user sees
  // the most informative attributes first. The match is loose (case-
  // insensitive substring) so columns like `lake_name`, `Name`, `LAKE_ID`
  // all pick up.
  const primaryKeys = useMemo(() => {
    const wanted = ['name', 'title', 'risk', 'level', 'id'];
    const seen = new Set();
    const picks = [];
    for (const [k] of allEntries) {
      const lower = k.toLowerCase();
      for (const w of wanted) {
        if (lower.includes(w) && !seen.has(k)) {
          picks.push(k);
          seen.add(k);
          break;
        }
      }
      if (picks.length >= 4) break;
    }
    return picks;
  }, [allEntries]);

  if (!selectedFeature) {
    return <EmptyState />;
  }

  const { feature, kind, label, sublabel, accentColor } = selectedFeature;
  const primaryEntries = allEntries.filter(([k]) => primaryKeys.includes(k));
  const secondaryEntries = allEntries.filter(([k]) => !primaryKeys.includes(k));

  return (
    <motion.div
      key={selectedFeature.overlayKey + '|' + (feature?.id ?? '')}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex-1 min-h-0 overflow-auto p-3"
    >
      <HeaderCard
        kind={kind}
        label={label}
        sublabel={sublabel}
        accentColor={accentColor}
        propertyCount={allEntries.length}
      />

      {primaryEntries.length > 0 && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {primaryEntries.map(([k, v]) => (
            <PropTile key={k} k={k} v={v} accentColor={accentColor} primary />
          ))}
        </div>
      )}

      {secondaryEntries.length > 0 && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {secondaryEntries.map(([k, v]) => (
            <PropTile key={k} k={k} v={v} accentColor={accentColor} />
          ))}
        </div>
      )}

      {allEntries.length === 0 && (
        <div className="mt-4 rounded-lg border border-dashed border-day-border dark:border-night-border p-4 text-center">
          <Sparkles
            className="w-5 h-5 mx-auto mb-1.5 text-day-muted dark:text-night-muted"
            aria-hidden
          />
          <p className="text-[12.5px] text-day-muted dark:text-night-muted">
            This feature carries no extra attributes — only its geometry.
          </p>
        </div>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Empty state — shown when nothing has been clicked yet.
// ---------------------------------------------------------------------------
function EmptyState() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6">
      <div className="relative mb-3">
        <div className="absolute inset-0 rounded-full bg-[#16a085]/10 blur-xl" />
        <div className="relative w-12 h-12 rounded-full flex items-center justify-center bg-day-bg dark:bg-night-bg border border-day-border dark:border-night-border">
          <MapPin className="w-5 h-5 text-[#16a085]" aria-hidden />
        </div>
      </div>
      <h3 className="text-[13.5px] font-semibold text-day-text dark:text-night-text">
        Click a feature on the map
      </h3>
      <p className="mt-1 text-[12px] text-day-muted dark:text-night-muted max-w-sm">
        Pick any visible region or secondary layer feature and its full set of
        attributes will appear here.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header card — coloured left rail, kind chip, layer label, geometry / count.
// ---------------------------------------------------------------------------
function HeaderCard({ kind, label, sublabel, accentColor, propertyCount }) {
  const Icon = ICON_FOR_KIND[kind] ?? Layers;
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg border',
        'border-day-border dark:border-night-border',
        'bg-day-surface dark:bg-night-surface',
      )}
    >
      {/* Soft tint that bleeds in from the left so the card feels anchored
          to the layer's color without overpowering the dark/light theme. */}
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 w-1.5"
        style={{ background: accentColor }}
      />
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `linear-gradient(90deg, ${hexToRgba(accentColor, 0.10)} 0%, transparent 60%)`,
        }}
      />
      <div className="relative px-4 py-3 flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{
            background: hexToRgba(accentColor, 0.16),
            color: accentColor,
          }}
        >
          <Icon className="w-4.5 h-4.5" strokeWidth={2.25} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-day-muted dark:text-night-muted">
            <span>{KIND_LABEL[kind] ?? 'Layer'}</span>
            {sublabel && (
              <>
                <span aria-hidden>•</span>
                <span>{sublabel}</span>
              </>
            )}
          </div>
          <h3 className="mt-0.5 text-[15px] font-semibold text-day-text dark:text-night-text truncate">
            {label}
          </h3>
        </div>
        <div className="shrink-0 hidden sm:flex flex-col items-end">
          <span
            className="text-[10px] font-semibold uppercase tracking-wider text-day-muted dark:text-night-muted"
          >
            Attributes
          </span>
          <span
            className="text-[15px] font-semibold tabular-nums"
            style={{ color: accentColor }}
          >
            {propertyCount}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Property tile — picks an icon + value renderer based on key name + value
// shape. `primary` flips it to a slightly larger card for promoted keys.
// ---------------------------------------------------------------------------
function PropTile({ k, v, accentColor, primary = false }) {
  const { Icon, kind } = pickFieldType(k, v);
  return (
    <div
      className={cn(
        'group rounded-md border bg-day-surface dark:bg-night-surface',
        'border-day-border dark:border-night-border',
        'px-3 py-2 transition-colors',
        'hover:border-day-text/30 dark:hover:border-night-text/30',
        primary && 'shadow-sm',
      )}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="inline-flex items-center justify-center w-5 h-5 rounded shrink-0"
          style={{
            background: hexToRgba(accentColor, 0.12),
            color: accentColor,
          }}
        >
          <Icon className="w-3 h-3" strokeWidth={2.5} aria-hidden />
        </span>
        <span
          className={cn(
            'text-[10.5px] font-semibold uppercase tracking-wider truncate',
            'text-day-muted dark:text-night-muted',
          )}
          title={k}
        >
          {humanizeKey(k)}
        </span>
      </div>
      <div className={cn('mt-1', primary ? 'pl-0' : '')}>
        <ValueRenderer value={v} kind={kind} primary={primary} accentColor={accentColor} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Value renderers — string, number, boolean, url, json. Picks based on the
// value's runtime shape and the key's hint (e.g. "*url*", "*name*").
// ---------------------------------------------------------------------------
function ValueRenderer({ value, kind, primary, accentColor }) {
  if (value && typeof value === 'object') {
    return (
      <pre
        className={cn(
          'text-[11px] leading-snug text-day-text dark:text-night-text',
          'bg-day-bg dark:bg-night-bg rounded px-2 py-1 overflow-x-auto',
          'border border-day-border dark:border-night-border',
          'font-mono',
        )}
      >
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  if (typeof value === 'boolean') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
          value
            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
            : 'bg-rose-500/15 text-rose-600 dark:text-rose-300',
        )}
      >
        <span
          className={cn(
            'w-1.5 h-1.5 rounded-full',
            value ? 'bg-emerald-500' : 'bg-rose-500',
          )}
          aria-hidden
        />
        {value ? 'True' : 'False'}
      </span>
    );
  }

  if (kind === 'url' && typeof value === 'string') {
    return (
      <a
        href={value}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          'text-[12.5px] break-all underline decoration-dotted underline-offset-2',
          'hover:opacity-80',
        )}
        style={{ color: accentColor }}
      >
        {value}
      </a>
    );
  }

  if (kind === 'color' && typeof value === 'string') {
    const hex = value.trim().startsWith('#') ? value.trim() : `#${value.trim()}`;
    return (
      <span className="inline-flex items-center gap-2">
        <span
          aria-hidden
          className="inline-block w-4 h-4 rounded border border-day-border dark:border-night-border shrink-0"
          style={{ background: hex }}
        />
        <span className="text-[12.5px] tabular-nums text-day-text dark:text-night-text">
          {hex.toLowerCase()}
        </span>
      </span>
    );
  }

  if (kind === 'risk' && typeof value === 'string') {
    const tone = pickRiskTone(value);
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[12px] font-semibold capitalize',
          tone.bg,
          tone.text,
        )}
      >
        <AlertTriangle className="w-3 h-3" aria-hidden />
        {String(value)}
      </span>
    );
  }

  // Numbers — format with locale grouping; coordinates kept compact.
  if (typeof value === 'number') {
    return (
      <span
        className={cn(
          'tabular-nums text-day-text dark:text-night-text',
          primary ? 'text-[15px] font-semibold' : 'text-[13px] font-medium',
        )}
      >
        {formatNumber(value)}
      </span>
    );
  }

  // Strings — single-line for short, wrapped for long.
  const text = String(value);
  return (
    <span
      className={cn(
        'text-day-text dark:text-night-text break-words',
        primary
          ? 'text-[14.5px] font-semibold leading-snug'
          : 'text-[12.5px] leading-snug',
      )}
    >
      {text}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ICON_FOR_KIND = {
  region:    Layers,
  secondary: Box,
  upload:    FileJson,
  db:        FileJson,
  raster:    ImageIcon,
};

const KIND_LABEL = {
  region:    'Region Layer',
  secondary: 'Secondary Layer',
  upload:    'Uploaded Layer',
  db:        'Database Layer',
  raster:    'Raster Pixel',
};

// Pick a field icon + value-rendering hint from the key name + value shape.
// Order matters — more specific keys (risk, geometry) come before generic
// (name, id) so a column called e.g. `risk_name` registers as risk.
function pickFieldType(key, value) {
  const k = String(key).toLowerCase();
  if (typeof value === 'object' && value !== null) return { Icon: FileJson, kind: 'json' };
  if ((k.includes('color') || k.includes('colour')) && isHexColor(value)) {
    return { Icon: Sparkles, kind: 'color' };
  }
  if (k.includes('risk') || k.includes('hazard')) return { Icon: AlertTriangle, kind: 'risk' };
  if (k.includes('url') || k.includes('link') || k.includes('href')) {
    return { Icon: FileJson, kind: 'url' };
  }
  if (k === 'id' || k.endsWith('_id') || k.startsWith('id_') || k === 'fid' || k === 'ogc_fid') {
    return { Icon: Hash, kind: 'id' };
  }
  if (k.includes('name') || k.includes('title') || k.includes('label')) {
    return { Icon: Type, kind: 'name' };
  }
  if (k.includes('lat') || k.includes('lon') || k.includes('lng') || k.includes('coord')) {
    return { Icon: Compass, kind: 'coord' };
  }
  if (k.includes('area') || k.includes('length') || k.includes('distance') || k.includes('elev') || k.includes('height')) {
    return { Icon: Ruler, kind: 'measure' };
  }
  if (typeof value === 'number') return { Icon: Hash, kind: 'number' };
  return { Icon: Type, kind: 'string' };
}

function isHexColor(v) {
  return typeof v === 'string' && /^#?[a-f\d]{3}([a-f\d]{3})?$/i.test(v.trim());
}

// Convert a snake_case / camelCase property key into a human label, while
// keeping ALL-CAPS acronyms (`OGC_FID` → `OGC FID`) and short codes intact.
function humanizeKey(k) {
  return String(k)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b([a-z])(\w*)/g, (_, a, b) => a.toUpperCase() + b);
}

// Numbers up to 4 decimals; integers grouped with locale separator;
// very small / very large fall back to exponential to stay readable.
function formatNumber(n) {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return n.toLocaleString();
  const abs = Math.abs(n);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e9)) return n.toExponential(3);
  return Number(n.toFixed(4)).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function hexToRgba(hex, alpha) {
  if (!hex) return `rgba(22, 160, 133, ${alpha})`;
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return `rgba(22, 160, 133, ${alpha})`;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function pickRiskTone(raw) {
  const v = String(raw).toLowerCase();
  if (v.includes('high') || v.includes('severe') || v.includes('extreme')) {
    return {
      bg: 'bg-rose-500/15 dark:bg-rose-500/20',
      text: 'text-rose-600 dark:text-rose-300',
    };
  }
  if (v.includes('medium') || v.includes('mod')) {
    return {
      bg: 'bg-amber-500/15 dark:bg-amber-500/20',
      text: 'text-amber-700 dark:text-amber-300',
    };
  }
  if (v.includes('low') || v.includes('safe')) {
    return {
      bg: 'bg-emerald-500/15 dark:bg-emerald-500/20',
      text: 'text-emerald-700 dark:text-emerald-300',
    };
  }
  return {
    bg: 'bg-slate-500/15 dark:bg-slate-500/20',
    text: 'text-slate-700 dark:text-slate-300',
  };
}
