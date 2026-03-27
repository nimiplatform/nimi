import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { type NimiAccentPack, type NimiThemeScheme } from './design-tokens.js';

type NimiThemeContextValue = {
  scheme: NimiThemeScheme;
  accentPack: NimiAccentPack;
  setScheme: (scheme: NimiThemeScheme) => void;
};

const NimiThemeContext = createContext<NimiThemeContextValue | null>(null);

type NimiThemeProviderProps = {
  scheme?: NimiThemeScheme;
  defaultScheme?: NimiThemeScheme;
  accentPack: NimiAccentPack;
  children: ReactNode;
};

const ALL_ACCENT_CLASSES = [
  'nimi-theme-accent--desktop-accent',
  'nimi-theme-accent--forge-accent',
  'nimi-theme-accent--relay-accent',
  'nimi-theme-accent--overtone-accent',
] as const;

export function NimiThemeProvider({
  scheme,
  defaultScheme = 'light',
  accentPack,
  children,
}: NimiThemeProviderProps) {
  const [internalScheme, setInternalScheme] = useState<NimiThemeScheme>(defaultScheme);
  const activeScheme = scheme ?? internalScheme;

  useLayoutEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const html = document.documentElement;
    html.dataset.nimiScheme = activeScheme;
    html.dataset.nimiAccent = accentPack;
    html.classList.toggle('dark', activeScheme === 'dark');
    for (const cls of ALL_ACCENT_CLASSES) {
      html.classList.remove(cls);
    }
    html.classList.add(`nimi-theme-accent--${accentPack}`);

    return () => {
      html.classList.remove('dark');
      html.classList.remove(`nimi-theme-accent--${accentPack}`);
      if (html.dataset.nimiAccent === accentPack) {
        delete html.dataset.nimiAccent;
      }
      if (html.dataset.nimiScheme === activeScheme) {
        delete html.dataset.nimiScheme;
      }
    };
  }, [accentPack, activeScheme]);

  const value = useMemo<NimiThemeContextValue>(() => ({
    scheme: activeScheme,
    accentPack,
    setScheme: setInternalScheme,
  }), [accentPack, activeScheme]);

  return <NimiThemeContext.Provider value={value}>{children}</NimiThemeContext.Provider>;
}

export function useNimiTheme() {
  const value = useContext(NimiThemeContext);
  if (!value) {
    throw new Error('NIMI_THEME_PROVIDER_MISSING');
  }
  return value;
}
