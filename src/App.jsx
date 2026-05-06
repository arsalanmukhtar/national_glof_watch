import { ThemeProvider } from '@/contexts/ThemeContext';
import { ParameterProvider } from '@/contexts/ParameterContext';
import { SecondaryProvider } from '@/contexts/SecondaryContext';
import { RegionLayersProvider } from '@/contexts/RegionLayersContext';
import { MapProvider } from '@/contexts/MapContext';
import { AttributeTablesProvider } from '@/contexts/AttributeTablesContext';
import { CsvDatasetsProvider } from '@/contexts/CsvDatasetsContext';
import { RasterProvider } from '@/contexts/RasterContext';
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
                <CsvDatasetsProvider>
                  <RasterProvider>
                    <AppShell>
                      <Dashboard />
                    </AppShell>
                  </RasterProvider>
                </CsvDatasetsProvider>
              </AttributeTablesProvider>
            </MapProvider>
          </RegionLayersProvider>
        </SecondaryProvider>
      </ParameterProvider>
    </ThemeProvider>
  );
}
