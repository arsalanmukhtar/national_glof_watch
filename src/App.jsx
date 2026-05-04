import { ThemeProvider } from '@/contexts/ThemeContext';
import AppShell from '@/components/layout/AppShell';
import Dashboard from '@/components/dashboard/Dashboard';

export default function App() {
  return (
    <ThemeProvider>
      <AppShell>
        <Dashboard />
      </AppShell>
    </ThemeProvider>
  );
}
