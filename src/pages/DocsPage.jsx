import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import TitleBar from '@/components/layout/TitleBar';
import { ContentBody, TOC } from './docs/content';
import { cn } from '@/utils/cn';

// ---------------------------------------------------------------------------
// DocsPage — sticky two-column layout (sidebar TOC + scrolling content).
// Uses IntersectionObserver to track which section is in view, then
// highlights the matching TOC item. Hash links scroll to the matching
// section via `scroll-mt-24` on each `<DocsSection>` (so the heading
// doesn't disappear under the fixed title bar).
// ---------------------------------------------------------------------------

export default function DocsPage() {
  const [activeId, setActiveId] = useState(TOC[0]?.id ?? null);
  const contentRef = useRef(null);

  // Flatten the TOC into [{id, parentId|null}, …] so the observer can
  // bubble up "active subsection ⇒ also highlight the parent".
  const flatIds = useMemo(() => {
    const out = [];
    for (const t of TOC) {
      out.push({ id: t.id, parentId: null });
      for (const c of t.children ?? []) out.push({ id: c.id, parentId: t.id });
    }
    return out;
  }, []);

  // Active-section tracking — runs an IntersectionObserver against
  // every section's id. A section is "active" when its top crosses
  // the upper third of the viewport. Picking the first match in the
  // page order keeps the highlight stable when several sections are
  // simultaneously partly visible.
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;

    const headings = flatIds
      .map(({ id }) => document.getElementById(id))
      .filter(Boolean);
    if (headings.length === 0) return;

    const visible = new Map();
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.set(e.target.id, e.intersectionRatio);
          else visible.delete(e.target.id);
        }
        // Walk the headings in REVERSE order so a subsection wins over
        // its parent. Parent sections wrap their subsections in the
        // DOM, so when the user is inside a subsection both the parent
        // div AND the subsection div are intersecting at the same
        // time. Forward iteration would always pick the parent and the
        // child highlight would never fire — reverse iteration matches
        // the most-specific (later-in-tree) target instead.
        for (let i = headings.length - 1; i >= 0; i--) {
          const h = headings[i];
          if (visible.has(h.id)) {
            setActiveId(h.id);
            return;
          }
        }
      },
      {
        // Trigger when the heading reaches roughly the top quarter of
        // the viewport — well above the dead-zone covered by the title
        // bar so the highlight feels responsive.
        rootMargin: '-25% 0px -65% 0px',
        threshold: [0, 0.25, 0.5, 1],
      },
    );
    headings.forEach((h) => obs.observe(h));
    return () => obs.disconnect();
  }, [flatIds]);

  // Find the parent of the active subsection so the parent's TOC row
  // stays highlighted while the user is reading any of its children.
  const activeParent = flatIds.find((f) => f.id === activeId)?.parentId ?? null;

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-day-bg dark:bg-night-bg">
      <TitleBar />
      <main
        ref={contentRef}
        className="titlebar-content-offset flex-1 min-h-0 overflow-y-auto"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-8 flex gap-8">
          <DocsTOC active={activeId} activeParent={activeParent} />
          <div className="min-w-0 flex-1">
            <header className="mb-8">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#84cc16] mb-2">
                Operator's Manual
              </div>
              <h1 className="text-[34px] sm:text-[40px] font-semibold leading-tight tracking-tight text-day-text dark:text-night-text">
                National GLOF Monitoring Documentation
              </h1>
              <p className="mt-3 text-[15px] text-day-muted dark:text-night-muted max-w-2xl text-justify hyphens-auto">
                Operator's manual for the dashboard — what every panel does,
                how the layers fit together, and how to drive the common
                workflows.
              </p>
            </header>
            <ContentBody />
          </div>
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar TOC. Sticky inside the scrolling main column. Items render
// the TOC tree (top-level row + nested rows). A vertical accent rail
// on the active row matches the brand teal used elsewhere.
// ---------------------------------------------------------------------------
function DocsTOC({ active, activeParent }) {
  return (
    <aside className="hidden lg:block shrink-0 w-60">
      <nav
        aria-label="Documentation contents"
        className="sticky top-4"
      >
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-day-muted dark:text-night-muted mb-3 px-3">
          On This Page
        </div>
        <ul className="space-y-0.5">
          {TOC.map((t) => {
            const isParent = active === t.id || activeParent === t.id;
            return (
              <li key={t.id}>
                <a
                  href={`#${t.id}`}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
                    isParent
                      ? 'text-[#84cc16] bg-[#84cc16]/10'
                      : 'text-day-text dark:text-night-text hover:bg-day-surface/70 dark:hover:bg-night-surface/70',
                  )}
                >
                  <ChevronRight
                    className={cn(
                      'w-3 h-3 transition-transform',
                      isParent && 'rotate-90 text-[#84cc16]',
                    )}
                    aria-hidden
                  />
                  {t.title}
                </a>
                {t.children?.length > 0 && isParent && (
                  <ul className="ml-5 mt-0.5 mb-1 space-y-0.5 border-l border-day-border dark:border-night-border pl-2">
                    {t.children.map((c) => {
                      const isActive = active === c.id;
                      return (
                        <li key={c.id}>
                          <a
                            href={`#${c.id}`}
                            className={cn(
                              'block rounded-md px-2 py-1 text-[12.5px] transition-colors',
                              isActive
                                ? 'text-[#84cc16] font-semibold'
                                : 'text-day-muted dark:text-night-muted hover:text-day-text dark:hover:text-night-text',
                            )}
                          >
                            {c.title}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
