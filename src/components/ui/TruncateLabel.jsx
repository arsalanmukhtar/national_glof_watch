import { useEffect, useRef, useState } from 'react';
import Tooltip from '@/components/ui/Tooltip';
import { cn } from '@/utils/cn';

// ---------------------------------------------------------------------------
// TruncateLabel — single-line ellipsised text that automatically reveals
// its full content in a styled tooltip on hover, *only when actually
// clipped*. Short labels that already fit don't spawn a hover.
//
// Parent must constrain the width — typically `flex-1 min-w-0` on the
// row, since `truncate` only takes effect when the element has a known
// max width.
// ---------------------------------------------------------------------------

export default function TruncateLabel({
  text,
  className,
  side = 'top',
  align = 'start',
}) {
  const ref = useRef(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => {
      // +1 px tolerance to absorb sub-pixel rounding — otherwise a label
      // that fits exactly would flicker into "overflowing" on resize.
      setOverflowing(el.scrollWidth > el.clientWidth + 1);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  // The Tooltip's trigger span IS the truncate container. Passing a
  // null `label` short-circuits the tooltip (see Tooltip.jsx) — so the
  // wrapper stays in the tree even when overflow is off, and React
  // doesn't have to re-mount on every resize tick.
  // Truncation lives on the inner span so its scrollWidth /
  // clientWidth comparison reflects the actual clipped state. The
  // Tooltip wrapper just provides width constraint + the hover region.
  return (
    <Tooltip
      label={overflowing ? text : null}
      side={side}
      align={align}
      triggerClassName="block min-w-0 max-w-full"
    >
      <span ref={ref} className={cn('block w-full truncate', className)}>
        {text}
      </span>
    </Tooltip>
  );
}
