import { BrowserRouter, Route, Routes } from 'react-router-dom';
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
import DocsPage from '@/pages/DocsPage';

// Two routes:
//   /       → the live monitoring dashboard (existing AppShell + Dashboard)
//   /docs   → the static documentation site, owns its own minimal layout
//
// The provider stack lives above the router so a deep link to /docs
// still has access to ThemeContext (day/night toggle) without the
// dashboard providers having to re-mount on every navigation. The
// dashboard-specific providers (ParameterContext, MapContext, …) are
// mounted on the dashboard route only — DocsPage doesn't need them and
// keeping them on `/` avoids the Parameter cron firing while the user
// is just reading the manual.
export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <Routes>
          <Route
            path="/"
            element={
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
            }
          />
          <Route path="/docs/*" element={<DocsPage />} />
        </Routes>
      </ThemeProvider>
    </BrowserRouter>
  );
}
