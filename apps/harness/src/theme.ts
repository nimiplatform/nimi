import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { NimiThemeScheme } from '@nimiplatform/kit/ui';

export type ThemePreference = 'system' | 'light' | 'dark';

const THEME_STORAGE_KEY = 'nimi-harness:theme';

function readInitialPreference(): ThemePreference {
  if (typeof window !== 'undefined') {
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === 'system' || stored === 'light' || stored === 'dark') return stored;
    } catch { /* ignore */ }
  }
  return 'system';
}

function readSystemScheme(): NimiThemeScheme {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

type ThemeContextValue = {
  preference: ThemePreference;
  scheme: NimiThemeScheme;
  setPreference: (next: ThemePreference) => void;
  cyclePreference: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readInitialPreference);
  const [systemScheme, setSystemScheme] = useState<NimiThemeScheme>(readSystemScheme);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemScheme(event.matches ? 'dark' : 'light');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try { window.localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* ignore */ }
  }, []);

  const cyclePreference = useCallback(() => {
    const order: ThemePreference[] = ['system', 'light', 'dark'];
    const idx = order.indexOf(preference);
    setPreference(order[(idx + 1) % order.length]);
  }, [preference, setPreference]);

  const scheme: NimiThemeScheme = preference === 'system' ? systemScheme : preference;

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.style.colorScheme = scheme;
    }
  }, [scheme]);

  const value = useMemo(() => ({ preference, scheme, setPreference, cyclePreference }), [preference, scheme, setPreference, cyclePreference]);
  return createElement(ThemeContext.Provider, { value }, children);
}

export function useAppTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    return { preference: 'system', scheme: 'light', setPreference: () => {}, cyclePreference: () => {} };
  }
  return value;
}
