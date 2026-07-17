// Side-effect helpers used by tour steps' `onEnter` hooks.
// ---------------------------------------------------------------------------
// Tour steps live in a static `tours.js` (no React context, no
// hooks), so any state change they need to demonstrate happens via
// the DOM: querying `data-tour-id` anchors and clicking / focusing
// them like a real user would.
//
// All helpers are idempotent — they only act when the target isn't
// already in the requested state (so re-entering a step doesn't
// toggle the panel off, and prev/next don't ping-pong the UI).

// Click a left-sidebar panel icon only if it isn't already active.
// The icon's active state is exposed via `aria-pressed`.
export function ensurePanelOpen(tourId) {
  const btn = document.querySelector(`[data-tour-id="${tourId}"]`);
  if (!btn) return;
  if (btn.getAttribute('aria-pressed') !== 'true') {
    btn.click();
  }
}

// Click a chart-row tab only if it isn't already selected.
// Tabs use ARIA `aria-selected="true"` for active state.
export function ensureTab(tabId) {
  const btn = document.querySelector(`[data-tour-id="chart-tab-${tabId}"]`);
  if (!btn) return;
  if (btn.getAttribute('aria-selected') !== 'true') {
    btn.click();
  }
}

// Demo-select the first parameter row IF no parameter is currently
// active. Non-destructive to an operator who's already picked one —
// preserves their choice. The list container is
// [data-tour-id="parameters-list"]; active rows have their own
// distinctive styling but no ARIA state, so we detect "selected"
// heuristically: a row whose child button is visibly on the dark
// background of the parameter's own accent (background-color style
// matches an activated row).
export function ensureFirstParameterPicked() {
  const list = document.querySelector('[data-tour-id="parameters-list"]');
  if (!list) return;
  // A row is active when its inline background-color equals the
  // parameter's saturated accent (any 6-digit hex). Inactive rows
  // use the muted `withAlpha(color, 0.12)` fill which shows up as an
  // rgba() with alpha < 1. This test is heuristic but reliable in
  // practice because active rows are the only ones with rgb() /
  // solid-colour backgrounds.
  const rows = list.querySelectorAll('[class*="rounded-md"][class*="border"]');
  let hasActive = false;
  for (const r of rows) {
    const bg = window.getComputedStyle(r).backgroundColor;
    // rgba(_,_,_,1) or plain rgb() → active. rgba(_,_,_, < 1) → not.
    if (/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(0?\.?\d+))?\)/.test(bg)) {
      const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(0?\.?\d+))?\)/);
      const alpha = m?.[4] == null ? 1 : parseFloat(m[4]);
      if (alpha >= 0.85) { hasActive = true; break; }
    }
  }
  if (hasActive) return;
  const firstBtn = list.querySelector('button');
  if (firstBtn) firstBtn.click();
}
