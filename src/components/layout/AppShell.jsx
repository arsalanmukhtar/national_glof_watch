import { useState } from 'react';
import { Layers, SlidersHorizontal } from 'lucide-react';
import TitleBar from './TitleBar';
import MobileMenu from './MobileMenu';
import MediaSwitcher from './MediaSwitcher';
import LayerMenu from '@/components/dashboard/LayerMenu';
import ParametersPanel from '@/components/dashboard/ParametersPanel';

export default function AppShell({ children }) {
  const [layerMenuOpen, setLayerMenuOpen] = useState(false);
  const [mediaMenuOpen, setMediaMenuOpen] = useState(false);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <TitleBar
        onOpenMobileMenu={() => setLayerMenuOpen(true)}
        onOpenMediaMenu={() => setMediaMenuOpen(true)}
      />
      <main className="titlebar-content-offset flex-1 min-h-0 flex flex-col overflow-hidden">
        {children}
      </main>

      <MobileMenu
        open={layerMenuOpen}
        onClose={() => setLayerMenuOpen(false)}
        title="Layers & Parameters"
        side="left"
      >
        <section className="mb-4">
          <header className="mb-2 flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-brand-700 dark:text-brand-200" />
            <span className="label-base">PMD Parameters</span>
          </header>
          <ParametersPanel />
        </section>
        <hr className="border-day-border dark:border-night-border my-3" />
        <section>
          <header className="mb-2 flex items-center gap-2">
            <Layers className="h-4 w-4 text-brand-700 dark:text-brand-200" />
            <span className="label-base">Layers</span>
          </header>
          <LayerMenu compact />
        </section>
      </MobileMenu>

      <MobileMenu
        open={mediaMenuOpen}
        onClose={() => setMediaMenuOpen(false)}
        title="Media"
        side="right"
      >
        <MediaSwitcher />
      </MobileMenu>
    </div>
  );
}
