import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, BookOpen, Layers, Moon, PanelRight, Sun } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import Tooltip from '@/components/ui/Tooltip';
import StationStatusBadge from '@/components/layout/StationStatusBadge';
import { logos } from '@/assets';
import { useTheme } from '@/hooks/useTheme';

// `onOpenMobileMenu` / `onOpenMediaMenu` are dashboard-only — when
// rendered on /docs they're undefined and the corresponding buttons
// are skipped. Keeping the same TitleBar component on both routes
// means the brand bar reads identically across the app.
export default function TitleBar({ onOpenMobileMenu, onOpenMediaMenu }) {
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const onDocs = location.pathname.startsWith('/docs');

  return (
    <header className="titlebar">
      <div className="flex items-center gap-3">
        {onDocs && (
          <Tooltip label="Back to dashboard" side="bottom" align="start">
            <motion.span
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="inline-flex"
            >
              <Link
                to="/"
                className="btn-icon text-white hover:bg-white/10"
                aria-label="Back to dashboard"
              >
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </motion.span>
          </Tooltip>
        )}
        {/* Rotating brand logo — spins around the Y-axis like a flipping
            coin. `perspective` on the wrapper turns the 2D rotateY into
            a proper 3D animation (without it the logo would just look
            like it's being scaled horizontally to nothing every half
            turn). 4 s per revolution feels lively without being
            distracting; tweak `duration` to taste. */}
        <span
          aria-hidden
          className="inline-flex h-10 w-10 sm:h-12 sm:w-12 shrink-0"
          style={{ perspective: '600px' }}
        >
          <motion.img
            src={logos.ndma}
            alt=""
            className="h-full w-full select-none"
            animate={{ rotateY: 360 }}
            transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
            style={{ backfaceVisibility: 'visible', transformStyle: 'preserve-3d' }}
            draggable={false}
          />
        </span>
        <span className="text-lg sm:text-xl lg:text-2xl font-semibold tracking-wide">
          Realtime GLOF Monitoring
        </span>
      </div>

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        {/* PMD GLOF 2 Live feed badge — combined feed identifier +
            station counter. The component handles its own label,
            divider, metrics block, and "Last updated" footer. Only on
            the dashboard — pulling station data on the docs page is
            just noise. */}
        {!onDocs && <StationStatusBadge />}
        <span aria-hidden className="hidden md:block w-3" />

        <Tooltip label={theme === 'day' ? 'Switch to night' : 'Switch to day'} side="bottom" align="end">
          <motion.button
            type="button"
            onClick={toggle}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="btn-icon text-white hover:bg-white/10"
            aria-label="Toggle theme"
          >
            <AnimatePresence mode="wait" initial={false}>
              {theme === 'day' ? (
                <motion.span
                  key="sun"
                  initial={{ rotate: -90, opacity: 0 }}
                  animate={{ rotate: 0, opacity: 1 }}
                  exit={{ rotate: 90, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="inline-flex"
                >
                  <Sun className="h-5 w-5 text-yellow-300" fill="currentColor" />
                </motion.span>
              ) : (
                <motion.span
                  key="moon"
                  initial={{ rotate: 90, opacity: 0 }}
                  animate={{ rotate: 0, opacity: 1 }}
                  exit={{ rotate: -90, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="inline-flex"
                >
                  <Moon className="h-5 w-5 text-white" fill="currentColor" />
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        </Tooltip>

        {!onDocs && (
          <Tooltip label="Documentation" side="bottom" align="end">
            <motion.span
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="inline-flex"
            >
              <Link
                to="/docs"
                className="btn-icon text-white hover:bg-white/10"
                aria-label="Open documentation"
              >
                <BookOpen className="h-5 w-5" />
              </Link>
            </motion.span>
          </Tooltip>
        )}

        {onOpenMobileMenu && (
          <Tooltip label="Layers" side="bottom" align="end">
            <motion.button
              type="button"
              onClick={onOpenMobileMenu}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="btn-icon text-white hover:bg-white/10 lg:hidden"
              aria-label="Open layers menu"
            >
              <Layers className="h-5 w-5" />
            </motion.button>
          </Tooltip>
        )}

        {onOpenMediaMenu && (
          <Tooltip label="Media" side="bottom" align="end">
            <motion.button
              type="button"
              onClick={onOpenMediaMenu}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="btn-icon text-white hover:bg-white/10 lg:hidden"
              aria-label="Open media menu"
            >
              <PanelRight className="h-5 w-5" />
            </motion.button>
          </Tooltip>
        )}
      </div>
    </header>
  );
}
