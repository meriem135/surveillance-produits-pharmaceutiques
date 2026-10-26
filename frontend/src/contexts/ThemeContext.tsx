import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { ThemeMode } from '../types';

interface ThemeContextValue {
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  nextTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  setTheme: () => {},
  nextTheme: () => {},
});

const STORAGE_KEY = 'pfe-theme';
const THEME_ORDER: ThemeMode[] = ['light', 'dark'];

/** Thème mémorisé ; les anciens thèmes « cyberpunk » / « matrix » deviennent « sombre ». */
function initialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  let stored: string | null = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch { /* stockage indisponible */ }
  if (stored === 'light' || stored === 'dark') return stored;
  if (stored === 'cyberpunk' || stored === 'matrix') return 'dark';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(initialTheme);

  const setTheme = useCallback((t: ThemeMode) => {
    setThemeState(t);
    try { localStorage.setItem(STORAGE_KEY, t); } catch { /* stockage indisponible */ }
  }, []);

  const nextTheme = useCallback(() => {
    const idx = THEME_ORDER.indexOf(theme);
    setTheme(THEME_ORDER[(idx + 1) % THEME_ORDER.length]);
  }, [theme, setTheme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, nextTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
