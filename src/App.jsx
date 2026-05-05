import { ThemeProvider } from '@/contexts/ThemeContext';
import { ParameterProvider } from '@/contexts/ParameterContext';
import { SecondaryProvider } from '@/contexts/SecondaryContext';
import { RegionLayersProvider } from '@/contexts/RegionLayersContext';
import { MapProvider } from '@/contexts/MapContext';
import AppShell from '@/components/layout/AppShell';
import Dashboard from '@/components/dashboard/Dashboard';

export default function App() {
  return (
    <ThemeProvider>
      <ParameterProvider>
        <SecondaryProvider>
          <RegionLayersProvider>
            <MapProvider>
              <AppShell>
                <Dashboard />
              </AppShell>
            </MapProvider>
          </RegionLayersProvider>
        </SecondaryProvider>
      </ParameterProvider>
    </ThemeProvider>
  );
}
