import React, { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { type NimiAccentPack, type NimiThemeScheme, resolveNimiThemeClassName } from './design-tokens.js';

type NimiThemeContextValue = {
  scheme: NimiThemeScheme;
  accentPack: NimiAccentPack;
  setScheme: (scheme: NimiThemeScheme) => void;
  rootClassName: string;
};

const NimiThemeContext = createContext<NimiThemeContextValue | null>(null);

type NimiThemeProviderProps = {
  scheme?: NimiThemeScheme;
  defaultScheme?: NimiThemeScheme;
  accentPack: NimiAccentPack;
  children: ReactNode;
};

export function NimiThemeProvider({
  scheme,
  defaultScheme = 'light',
  accentPack,
  children,
}: NimiThemeProviderProps) {
  const [internalScheme, setInternalScheme] = useState<NimiThemeScheme>(defaultScheme);
  const activeScheme = scheme ?? internalScheme;
  const rootClassName = resolveNimiThemeClassName(activeScheme, accentPack);

  useLayoutEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    document.documentElement.dataset.nimiScheme = activeScheme;
    document.documentElement.dataset.nimiAccent = accentPack;
    document.documentElement.classList.add('nimi-theme-root');
    document.documentElement.classList.remove('nimi-theme--light', 'nimi-theme--dark');
    document.documentElement.classList.add(`nimi-theme--${activeScheme}`);
    for (const accentClass of [
      'nimi-theme-accent--desktop-accent',
      'nimi-theme-accent--forge-accent',
      'nimi-theme-accent--relay-accent',
      'nimi-theme-accent--overtone-accent',
    ]) {
      document.documentElement.classList.remove(accentClass);
    }
    document.documentElement.classList.add(`nimi-theme-accent--${accentPack}`);

    return () => {
      document.documentElement.classList.remove(`nimi-theme--${activeScheme}`);
      document.documentElement.classList.remove(`nimi-theme-accent--${accentPack}`);
      if (document.documentElement.dataset.nimiAccent === accentPack) {
        delete document.documentElement.dataset.nimiAccent;
      }
      if (document.documentElement.dataset.nimiScheme === activeScheme) {
        delete document.documentElement.dataset.nimiScheme;
      }
    };
  }, [accentPack, activeScheme]);

  const value = useMemo<NimiThemeContextValue>(() => ({
    scheme: activeScheme,
    accentPack,
    setScheme: setInternalScheme,
    rootClassName,
  }), [accentPack, activeScheme, rootClassName]);

  return <NimiThemeContext.Provider value={value}>{children}</NimiThemeContext.Provider>;
}

export function useNimiTheme() {
  const value = useContext(NimiThemeContext);
  if (!value) {
    throw new Error('NIMI_THEME_PROVIDER_MISSING');
  }
  return value;
}
