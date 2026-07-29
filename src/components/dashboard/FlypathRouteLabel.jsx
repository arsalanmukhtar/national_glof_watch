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
            className="px-5 py-1.5 rounded-lg bg-black/40 backdrop-blur-md border border-white/20 shadow-2xl"
          >
            <span
              style={{
                // Same font family the Mapbox symbol layer uses for
                // the on-map feature labels — DIN falls back through
                // DIN Alternate (macOS system), then a condensed
                // Helvetica / Arial, then Inter and the system
                // stack. Keeps the two label surfaces feeling like
                // one typography system.
                fontFamily:
                  '"DIN Pro", "DIN Alternate", "DIN Condensed", ' +
                  '"Helvetica Neue Condensed", "Arial Narrow", ' +
                  '"Inter", "Segoe UI", system-ui, sans-serif',
                fontSize: '26px',
                fontWeight: 500,
                color: '#ffffff',
                lineHeight: 1.15,
                letterSpacing: '0.015em',
                // Softer halo — with the lighter weight a heavy
                // outline started reading as chunky. Four 1 px
                // offsets at 75 % opacity + a single 4 px blur is
                // enough to hold contrast on snow / sand.
                textShadow:
                  '-1px -1px 0 rgba(0,0,0,0.75),' +
                  ' 1px -1px 0 rgba(0,0,0,0.75),' +
                  '-1px  1px 0 rgba(0,0,0,0.75),' +
                  ' 1px  1px 0 rgba(0,0,0,0.75),' +
                  ' 0 0 4px rgba(0,0,0,0.55),' +
                  ' 0 2px 6px rgba(0,0,0,0.45)',
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