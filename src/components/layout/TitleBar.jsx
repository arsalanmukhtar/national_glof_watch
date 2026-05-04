import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Layers, Moon, PanelRight, Sun } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import { useTheme } from '@/hooks/useTheme';
import { logos } from '@/assets';

const ndmaLogo = logos.ndma;

export default function TitleBar({ onOpenMobileMenu, onOpenMediaMenu }) {
  const { theme, toggle } = useTheme();
  const [logoOk, setLogoOk] = useState(true);

  return (
    <header className="titlebar">
      <div className="flex items-center gap-3" style={{ perspective: '600px' }}>
        {logoOk ? (
          <motion.img
            src={ndmaLogo}
            alt="NDMA"
            className="h-10 w-auto select-none"
            onError={() => setLogoOk(false)}
            draggable={false}
            animate={{ rotateY: 360 }}
            transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
            style={{ transformStyle: 'preserve-3d', backfaceVisibility: 'visible' }}
          />
        ) : (
          <div className="h-10 w-10 rounded bg-white/10 grid place-items-center text-xs font-semibold">
            NDMA
          </div>
        )}
        <span className="text-lg sm:text-xl lg:text-2xl font-semibold tracking-wide">
          National GLOF Watch
        </span>
      </div>

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
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
                  <Sun className="h-5 w-5" />
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
                  <Moon className="h-5 w-5" />
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        </Tooltip>

        <span
          aria-label="Alert level N-2"
          className="bg-white text-emerald-800 font-black text-xl sm:text-2xl leading-none px-3 py-1.5 my-2 ml-3 rounded-sm shadow-sm select-none tracking-wide"
        >
          N-2
        </span>

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
      </div>
    </header>
  );
}
