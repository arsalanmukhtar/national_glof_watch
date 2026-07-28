import { AnimatePresence, motion } from 'framer-motion';
import { useFlypath } from '@/contexts/FlypathContext';

// FlypathRouteLabel — floating title chip pinned to the top-centre of
// the map showing the currently-selected route's name. Mounted inside
// the map wrapper so it survives fullscreen. Only renders when there
// is a selected route (never during an empty state), and fades in /
// out via Framer Motion when the selection changes.
//
// Typography:
//   • Inter, 30 px, semi-bold white.
//   • Multi-layer black text-shadow acts as a legibility halo against
//     any basemap — satellite, dark, glacier.
//   • Faint backdrop-blurred pill so the halo has a soft anchor
//     without competing with the map underneath.

export default function FlypathRouteLabel() {
  const { selectedRoute } = useFlypath();
  const name = selectedRoute?.name;

  return (
    <div
      className="absolute top-3 left-1/2 -translate-x-1/2 z-10 pointer-events-none"
      aria-live="polite"
    >
      <AnimatePresence mode="wait">
        {name ? (
          <motion.div
            key={selectedRoute?.id ?? name}
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0,  scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="px-6 py-2 rounded-xl bg-black/35 backdrop-blur-md border border-white/25 shadow-2xl"
          >
            <span
              style={{
                fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
                fontSize: '30px',
                fontWeight: 600,
                color: '#ffffff',
                lineHeight: 1.1,
                letterSpacing: '0.005em',
                WebkitTextStroke: '1px #000',
                textShadow:
                  '-1px -1px 0 #000,' +
                  ' 1px -1px 0 #000,' +
                  '-1px  1px 0 #000,' +
                  ' 1px  1px 0 #000,' +
                  ' 0 0 4px rgba(0,0,0,0.85),' +
                  ' 0 2px 10px rgba(0,0,0,0.75)',
              }}
            >
              {name}
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}