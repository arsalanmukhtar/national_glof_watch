import { Lightbulb, AlertTriangle, Image as ImageIcon, Info } from 'lucide-react';
import { cn } from '@/utils/cn';

// ---------------------------------------------------------------------------
// Building blocks for DocsPage. Kept dependency-free (no router, no
// context) so they can be reused inside content.jsx without dragging
// the whole layout shell along.
// ---------------------------------------------------------------------------

// One scroll target. The id is what the TOC links to via `<a href="#id">`
// and what the IntersectionObserver in DocsLayout watches for "in view"
// state. Heading is rendered as a real <h2> for accessibility + SEO.
export function DocsSection({ id, title, eyebrow, children }) {
  return (
    <section id={id} className="scroll-mt-24 pb-12">
      {eyebrow && (
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#16a085] mb-2">
          {eyebrow}
        </div>
      )}
      <h2 className="text-[24px] sm:text-[28px] font-semibold text-day-text dark:text-night-text leading-tight mb-4 tracking-tight">
        {title}
      </h2>
      <div className="prose-doc">{children}</div>
    </section>
  );
}

// One subsection. Renders an h3 with a lighter weight than the section
// title and an anchor id that the TOC nests beneath the parent.
export function DocsSubsection({ id, title, children }) {
  return (
    <div id={id} className="scroll-mt-24 pt-2 pb-6">
      <h3 className="text-[18px] font-semibold text-day-text dark:text-night-text mb-3 mt-5 first:mt-0">
        {title}
      </h3>
      <div className="prose-doc">{children}</div>
    </div>
  );
}

// Standard paragraph. Slightly looser leading than Tailwind defaults
// so dense docs still read comfortably. `text-justify` matches the
// rest of the page's prose blocks; `hyphens-auto` + a small word-break
// rule keep tight columns from leaving river-rapids of whitespace
// inside justified lines.
export function P({ children, className }) {
  return (
    <p
      className={cn(
        'text-[14.5px] leading-7 text-day-text dark:text-night-text mb-3 text-justify hyphens-auto',
        className,
      )}
    >
      {children}
    </p>
  );
}

// Inline keyboard / button label, e.g. <Kbd>Daily</Kbd>. Renders as
// a small chip — same accent treatment used elsewhere in the app.
export function Kbd({ children }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-day-bg dark:bg-night-bg border border-day-border dark:border-night-border text-[12px] font-mono tabular-nums text-day-text dark:text-night-text">
      {children}
    </span>
  );
}

// Tagged value chip, e.g. <Pill tone="risk">High Risk</Pill>. Used for
// labels that benefit from a coloured background — risk levels,
// kind/category markers, etc.
const PILL_TONES = {
  default: 'bg-day-bg dark:bg-night-bg text-day-text dark:text-night-text border-day-border dark:border-night-border',
  brand:   'bg-[#16a085]/15 text-[#16a085] border-[#16a085]/40',
  warn:    'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40',
  risk:    'bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/40',
  ok:      'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/40',
};
export function Pill({ tone = 'default', children }) {
  // `min-w-[4rem]` + `justify-center` so a row of pills with different
  // word lengths (High / Medium / Low, Daily / Weekly / Custom) renders
  // as visually-equal chips. The width comfortably fits "Medium"
  // without padding tightness; shorter words centre inside the same box.
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center min-w-[4rem] px-2 py-0.5 rounded-full border text-[11.5px] font-semibold',
        PILL_TONES[tone] ?? PILL_TONES.default,
      )}
    >
      {children}
    </span>
  );
}

// Bullet list — kept as a thin wrapper so spacing stays consistent.
export function UL({ children, className }) {
  return (
    <ul
      className={cn(
        'list-disc pl-5 text-[14.5px] leading-7 text-day-text dark:text-night-text mb-3 space-y-1',
        className,
      )}
    >
      {children}
    </ul>
  );
}
export function OL({ children, className }) {
  return (
    <ol
      className={cn(
        'list-decimal pl-5 text-[14.5px] leading-7 text-day-text dark:text-night-text mb-3 space-y-1',
        className,
      )}
    >
      {children}
    </ol>
  );
}
export function LI({ children }) {
  return <li>{children}</li>;
}

// Highlighted callout — three tones (info / tip / warning). Built to
// match the rest of the dashboard's panel-base look so the docs page
// feels of-a-piece with the live UI.
const CALLOUT_TONES = {
  info: {
    Icon: Info,
    border: 'border-sky-500/40',
    fill:   'bg-sky-500/10',
    iconCls: 'text-sky-600 dark:text-sky-400',
  },
  tip: {
    Icon: Lightbulb,
    border: 'border-emerald-500/40',
    fill:   'bg-emerald-500/10',
    iconCls: 'text-emerald-600 dark:text-emerald-400',
  },
  warning: {
    Icon: AlertTriangle,
    border: 'border-amber-500/40',
    fill:   'bg-amber-500/10',
    iconCls: 'text-amber-600 dark:text-amber-400',
  },
};
export function Callout({ tone = 'info', title, children }) {
  const t = CALLOUT_TONES[tone] ?? CALLOUT_TONES.info;
  const { Icon } = t;
  return (
    <div
      className={cn(
        'flex gap-3 rounded-lg border p-3 mb-4',
        t.border,
        t.fill,
      )}
    >
      <Icon className={cn('w-4.5 h-4.5 shrink-0 mt-0.5', t.iconCls)} aria-hidden />
      <div className="min-w-0 flex-1 text-[13.5px] leading-6 text-day-text dark:text-night-text">
        {title && (
          <div className="font-semibold mb-0.5 text-day-text dark:text-night-text">
            {title}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

// Figure / "screenshot" placeholder. Renders a dashed-bordered card
// with the supplied caption — leaves space for a real screenshot to
// be dropped in later (`<DocsFigure src="…">`). When a `src` is
// provided the image renders normally; otherwise it falls back to a
// styled placeholder with a hint icon. This keeps the docs visually
// consistent whether or not the asset has been authored yet.
export function DocsFigure({ src, alt, caption, aspect = '16/9' }) {
  return (
    <figure className="my-5">
      <div
        className={cn(
          'relative w-full rounded-lg overflow-hidden',
          'border border-dashed border-day-border dark:border-night-border',
          'bg-day-bg/60 dark:bg-night-bg/60',
        )}
        style={{ aspectRatio: aspect }}
      >
        {src ? (
          <img src={src} alt={alt ?? caption} className="w-full h-full object-contain" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4 gap-2">
            <ImageIcon className="w-8 h-8 text-day-muted dark:text-night-muted" aria-hidden />
            <span className="text-[12px] font-medium text-day-muted dark:text-night-muted max-w-md">
              {caption}
            </span>
          </div>
        )}
      </div>
      {src && caption && (
        <figcaption className="mt-2 text-[12px] text-day-muted dark:text-night-muted text-center">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

// Compact key/value strip — used to summarise a layer or component's
// vital stats (geometry, source, layer ids, …) without needing a full
// table. Pairs are rendered in a 2-column grid.
export function StatGrid({ items }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 my-4">
      {items.map((it) => (
        <div
          key={it.label}
          className="rounded-md border border-day-border dark:border-night-border bg-day-surface dark:bg-night-surface px-3 py-2"
        >
          <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-day-muted dark:text-night-muted">
            {it.label}
          </dt>
          <dd className="text-[13.5px] font-medium text-day-text dark:text-night-text mt-0.5 break-words">
            {it.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// Card grid for "feature highlights" — used on the Overview to point
// at the main bits of the app. Each card has icon + title + blurb +
// optional anchor.
export function FeatureCard({ icon: Icon, title, anchor, children }) {
  const inner = (
    <>
      <div className="w-9 h-9 rounded-md flex items-center justify-center bg-[#16a085]/15 text-[#16a085] mb-3">
        <Icon className="w-4.5 h-4.5" strokeWidth={2.25} aria-hidden />
      </div>
      <h4 className="text-[14px] font-semibold text-day-text dark:text-night-text mb-1">
        {title}
      </h4>
      <p className="text-[12.5px] leading-relaxed text-day-muted dark:text-night-muted">
        {children}
      </p>
    </>
  );
  if (anchor) {
    return (
      <a
        href={anchor}
        className={cn(
          'block rounded-lg border p-4 transition-all',
          'bg-day-surface dark:bg-night-surface',
          'border-day-border dark:border-night-border',
          'hover:border-[#16a085]/50 hover:shadow-sm',
        )}
      >
        {inner}
      </a>
    );
  }
  return (
    <div className="rounded-lg border border-day-border dark:border-night-border bg-day-surface dark:bg-night-surface p-4">
      {inner}
    </div>
  );
}

// Tiny "endpoint" badge for documenting API routes — uses tabular-nums
// so columns align nicely when stacked.
export function ApiPill({ method = 'GET', path }) {
  const methodCls = {
    GET:    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    POST:   'bg-sky-500/15 text-sky-700 dark:text-sky-300',
    PATCH:  'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    DELETE: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  }[method] ?? 'bg-slate-500/15 text-slate-700 dark:text-slate-300';
  return (
    <span className="inline-flex items-center gap-2 rounded-md border border-day-border dark:border-night-border bg-day-surface dark:bg-night-surface px-2 py-1 my-1 mr-2 text-[12px] font-mono tabular-nums">
      <span className={cn('px-1.5 rounded text-[10px] font-bold tracking-wide', methodCls)}>
        {method}
      </span>
      <span className="text-day-text dark:text-night-text">{path}</span>
    </span>
  );
}
