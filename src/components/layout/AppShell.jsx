import { useState } from 'react';
import TitleBar from './TitleBar';
import MobileMenu from './MobileMenu';
import MediaSwitcher from './MediaSwitcher';
import LayerMenu from '@/components/dashboard/LayerMenu';

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
        title="Layers"
        side="left"
      >
        <LayerMenu compact />
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
