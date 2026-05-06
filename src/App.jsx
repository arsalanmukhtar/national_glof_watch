import { ThemeProvider } from '@/contexts/ThemeContext';
import { ParameterProvider } from '@/contexts/ParameterContext';
import { SecondaryProvider } from '@/contexts/SecondaryContext';
import { RegionLayersProvider } from '@/contexts/RegionLayersContext';
import { MapProvider } from '@/contexts/MapContext';
import { AttributeTablesProvider } from '@/contexts/AttributeTablesContext';
import AppShell from '@/components/layout/AppShell';
import Dashboard from '@/components/dashboard/Dashboard';

export default function App() {
  return (
    <ThemeProvider>
      <ParameterProvider>
        <SecondaryProvider>
          <RegionLayersProvider>
            <MapProvider>
              <AttributeTablesProvider>
                <AppShell>
                  <Dashboard />
                </AppShell>
              </AttributeTablesProvider>
            </MapProvider>
          </RegionLayersProvider>
        </SecondaryProvider>
      </ParameterProvider>
    </ThemeProvider>
  );
}
