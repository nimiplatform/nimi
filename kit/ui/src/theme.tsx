import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { type NimiAccentPack, type NimiDensity, type NimiThemeScheme } from './design-tokens.js';
import { ACCENT_PACK_IDS } from './generated/tokens.js';

type NimiThemeContextValue = {
  scheme: NimiThemeScheme;
  accentPack: NimiAccentPack;
  density: NimiDensity;
  setScheme: (scheme: NimiThemeScheme) => void;
  setDensity: (density: NimiDensity) => void;
};

const NimiThemeContext = createContext<NimiThemeContextValue | null>(null);

type NimiThemeProviderProps = {
  scheme?: NimiThemeScheme;
  defaultScheme?: NimiThemeScheme;
  accentPack: NimiAccentPack;
  /** Density runtime axis (P-DESIGN-028). `regular` is the default and emits no attribute. */
  density?: NimiDensity;
  defaultDensity?: NimiDensity;
  children: ReactNode;
};

const ALL_ACCENT_CLASSES = ACCENT_PACK_IDS.map((accentPack) => `nimi-theme-accent--${accentPack}`);

export function applyNimiThemeAttributes({
  scheme,
  accentPack,
  density = 'regular',
}: {
  scheme: NimiThemeScheme;
  accentPack: NimiAccentPack;
  density?: NimiDensity;
}) {
  if (typeof document === 'undefined') {
    return;
  }
  const html = document.documentElement;
  html.dataset.nimiScheme = scheme;
  html.dataset.nimiAccent = accentPack;
  html.classList.toggle('dark', scheme === 'dark');
  if (density === 'regular') {
    delete html.dataset.nimiDensity;
  } else {
    html.dataset.nimiDensity = density;
  }
  for (const cls of ALL_ACCENT_CLASSES) {
    html.classList.remove(cls);
  }
  html.classList.add(`nimi-theme-accent--${accentPack}`);
}

export function NimiThemeProvider({
  scheme,
  defaultScheme = 'light',
  accentPack,
  density,
  defaultDensity = 'regular',
  children,
}: NimiThemeProviderProps) {
  const [internalScheme, setInternalScheme] = useState<NimiThemeScheme>(defaultScheme);
  const [internalDensity, setInternalDensity] = useState<NimiDensity>(defaultDensity);
  const activeScheme = scheme ?? internalScheme;
  const activeDensity = density ?? internalDensity;

  useLayoutEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    applyNimiThemeAttributes({ scheme: activeScheme, accentPack, density: activeDensity });

    return () => {
      const html = document.documentElement;
      html.classList.remove('dark');
      html.classList.remove(`nimi-theme-accent--${accentPack}`);
      if (html.dataset.nimiAccent === accentPack) {
        delete html.dataset.nimiAccent;
      }
      if (html.dataset.nimiScheme === activeScheme) {
        delete html.dataset.nimiScheme;
      }
      if (html.dataset.nimiDensity === activeDensity) {
        delete html.dataset.nimiDensity;
      }
    };
  }, [accentPack, activeScheme, activeDensity]);

  const value = useMemo<NimiThemeContextValue>(() => ({
    scheme: activeScheme,
    accentPack,
    density: activeDensity,
    setScheme: setInternalScheme,
    setDensity: setInternalDensity,
  }), [accentPack, activeScheme, activeDensity]);

  return <NimiThemeContext.Provider value={value}>{children}</NimiThemeContext.Provider>;
}

export function useNimiTheme() {
  const value = useContext(NimiThemeContext);
  if (!value) {
    throw new Error('NIMI_THEME_PROVIDER_MISSING');
  }
  return value;
}
