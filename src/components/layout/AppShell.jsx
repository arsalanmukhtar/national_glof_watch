import { useState } from 'react';
import { Layers, Shapes, SlidersHorizontal } from 'lucide-react';
import TitleBar from './TitleBar';
import MobileMenu from './MobileMenu';
import MediaSwitcher from './MediaSwitcher';
import LayerMenu from '@/components/dashboard/LayerMenu';
import ParametersPanel from '@/components/dashboard/ParametersPanel';
import SecondaryPanel from '@/components/dashboard/SecondaryPanel';

// Section header used inside the mobile drawer. Deliberately heavier
// than the inline `label-base` subheadings (LAYERS / REGIONS) inside
// each panel — section title here, subgroup label there.
function MobileSection({ icon: Icon, title, children, last }) {
  return (
    <section className={last ? '' : 'mb-5'}>
      <header className="mb-3 pb-2 flex items-center gap-2 border-b-2 border-[#16a085]/40">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[#16a085]/15 text-[#16a085]">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <h3 className="text-[15px] font-semibold tracking-tight text-day-text dark:text-night-text">
          {title}
        </h3>
      </header>
      {children}
    </section>
  );
}

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
        <MobileSection icon={SlidersHorizontal} title="PMD Parameters">
          <ParametersPanel />
        </MobileSection>
        <MobileSection icon={Layers} title="Layers">
          <LayerMenu compact />
        </MobileSection>
        <MobileSection icon={Shapes} title="Secondary Layers" last>
          <SecondaryPanel compact />
        </MobileSection>
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
