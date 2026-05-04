import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { THEME_STORAGE_KEY } from '@/config/theme';

export const ThemeContext = createContext(null);

function getInitialTheme() {
  if (typeof window === 'undefined') return 'day';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'day' || stored === 'night') return stored;
  } catch {
    /* localStorage may be blocked */
  }
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'night';
  }
  return 'day';
}

function applyThemeClass(theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'night') root.classList.add('dark');
  else root.classList.remove('dark');
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(getInitialTheme);

  useEffect(() => {
    applyThemeClass(theme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const setTheme = useCallback((next) => {
    setThemeState(next === 'night' ? 'night' : 'day');
  }, []);

  const toggle = useCallback(() => {
    setThemeState((t) => (t === 'day' ? 'night' : 'day'));
  }, []);

  const value = useMemo(
    () => ({ theme, setTheme, toggle, isDark: theme === 'night' }),
    [theme, setTheme, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
