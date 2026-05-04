import { useId } from 'react';
import { cn } from '@/utils/cn';

// AlertTriangle path data borrowed from lucide-react. We render it
// directly so we can paint its strokes with a SVG <linearGradient> that
// continuously translates — `spreadMethod="repeat"` makes the gradient
// tile, so as the gradientTransform slides it appears to flow through
// every stroke of the icon (triangle outline + exclamation marks).
export default function AnimatedAlertTriangle({ className }) {
  const reactId = useId();
  const gradId = `alert-flow-${reactId.replace(/:/g, '')}`;

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn('block', className)}
    >
      <defs>
        <linearGradient
          id={gradId}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="0"
          x2="24"
          y2="0"
          spreadMethod="repeat"
        >
          <stop offset="0%"   stopColor="#fde047" />
          <stop offset="33%"  stopColor="#f97316" />
          <stop offset="66%"  stopColor="#dc2626" />
          <stop offset="100%" stopColor="#fde047" />
          <animateTransform
            attributeName="gradientTransform"
            type="translate"
            from="0 0"
            to="24 0"
            dur="2.4s"
            repeatCount="indefinite"
          />
        </linearGradient>
      </defs>
      <path
        d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"
        stroke={`url(#${gradId})`}
      />
      <line x1="12" x2="12"    y1="9"  y2="13" stroke={`url(#${gradId})`} />
      <line x1="12" x2="12.01" y1="17" y2="17" stroke={`url(#${gradId})`} />
    </svg>
  );
}
