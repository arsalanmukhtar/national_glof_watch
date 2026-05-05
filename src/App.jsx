import { ThemeProvider } from '@/contexts/ThemeContext';
import { ParameterProvider } from '@/contexts/ParameterContext';
import { SecondaryProvider } from '@/contexts/SecondaryContext';
import AppShell from '@/components/layout/AppShell';
import Dashboard from '@/components/dashboard/Dashboard';

export default function App() {
  return (
    <ThemeProvider>
      <ParameterProvider>
        <SecondaryProvider>
          <AppShell>
            <Dashboard />
          </AppShell>
        </SecondaryProvider>
      </ParameterProvider>
    </ThemeProvider>
  );
}
