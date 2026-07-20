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

export interface NimiThemeAttributeInput {
  readonly scheme: NimiThemeScheme;
  readonly accentPack: NimiAccentPack;
  readonly density?: NimiDensity;
}

interface NimiThemeAttributeSnapshot {
  readonly scheme: string | undefined;
  readonly accent: string | undefined;
  readonly density: string | undefined;
  readonly dark: boolean;
  readonly accentClasses: Readonly<Record<string, boolean>>;
}

/** Apply Kit theme attributes to one explicit target and restore it exactly. */
export function applyNimiThemeAttributesToTarget(
  target: HTMLElement,
  {
    scheme,
    accentPack,
    density = 'regular',
  }: NimiThemeAttributeInput,
): () => void {
  const before: NimiThemeAttributeSnapshot = {
    scheme: target.dataset.nimiScheme,
    accent: target.dataset.nimiAccent,
    density: target.dataset.nimiDensity,
    dark: target.classList.contains('dark'),
    accentClasses: Object.fromEntries(
      ALL_ACCENT_CLASSES.map((className) => [className, target.classList.contains(className)]),
    ),
  };

  target.dataset.nimiScheme = scheme;
  target.dataset.nimiAccent = accentPack;
  target.classList.toggle('dark', scheme === 'dark');
  if (density === 'regular') {
    delete target.dataset.nimiDensity;
  } else {
    target.dataset.nimiDensity = density;
  }
  for (const className of ALL_ACCENT_CLASSES) {
    target.classList.remove(className);
  }
  target.classList.add(`nimi-theme-accent--${accentPack}`);

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    restoreDatasetValue(target, 'nimiScheme', before.scheme);
    restoreDatasetValue(target, 'nimiAccent', before.accent);
    restoreDatasetValue(target, 'nimiDensity', before.density);
    target.classList.toggle('dark', before.dark);
    for (const className of ALL_ACCENT_CLASSES) {
      target.classList.toggle(className, before.accentClasses[className] === true);
    }
  };
}

export function applyNimiThemeAttributes({
  scheme,
  accentPack,
  density = 'regular',
}: NimiThemeAttributeInput): (() => void) | undefined {
  if (typeof document === 'undefined') {
    return;
  }
  return applyNimiThemeAttributesToTarget(document.documentElement, {
    scheme,
    accentPack,
    density,
  });
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
    return applyNimiThemeAttributes({
      scheme: activeScheme,
      accentPack,
      density: activeDensity,
    });
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

function restoreDatasetValue(
  target: HTMLElement,
  key: 'nimiScheme' | 'nimiAccent' | 'nimiDensity',
  value: string | undefined,
): void {
  if (value === undefined) {
    delete target.dataset[key];
    return;
  }
  target.dataset[key] = value;
}
