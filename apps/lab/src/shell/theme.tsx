import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  readStorageTextFrom,
  resolveBrowserStorage,
  writeStorageTextTo,
} from '@nimiplatform/kit/core/storage-json';
import {
  NimiThemeProvider,
  type NimiDensity,
  type NimiThemeScheme,
} from '@nimiplatform/kit/ui';

export type LabThemePreference = 'system' | 'light' | 'dark';
export type LabDensityPreference = Extract<NimiDensity, 'compact' | 'regular'>;

export type LabThemeSnapshot = {
  readonly scheme: NimiThemeScheme;
  readonly accentPack: 'nimi-accent';
  readonly density: LabDensityPreference;
};

export const LAB_THEME_STORAGE_KEY = 'nimi.lab.theme';
export const LAB_DENSITY_STORAGE_KEY = 'nimi.lab.density';
export const DEFAULT_LAB_THEME_PREFERENCE: LabThemePreference = 'system';
export const DEFAULT_LAB_DENSITY_PREFERENCE: LabDensityPreference = 'compact';

const THEME_PREFERENCES: readonly LabThemePreference[] = Object.freeze(['system', 'light', 'dark']);
const DENSITY_PREFERENCES: readonly LabDensityPreference[] = Object.freeze(['compact', 'regular']);

export function readLabThemePreference(
  storage: Storage | null = resolveBrowserStorage('local'),
): LabThemePreference {
  const stored = readStorageTextFrom(storage, LAB_THEME_STORAGE_KEY);
  if (stored.state === 'ready' && (THEME_PREFERENCES as readonly string[]).includes(stored.value)) {
    return stored.value as LabThemePreference;
  }
  return DEFAULT_LAB_THEME_PREFERENCE;
}

export function readLabDensityPreference(
  storage: Storage | null = resolveBrowserStorage('local'),
): LabDensityPreference {
  const stored = readStorageTextFrom(storage, LAB_DENSITY_STORAGE_KEY);
  if (stored.state === 'ready' && (DENSITY_PREFERENCES as readonly string[]).includes(stored.value)) {
    return stored.value as LabDensityPreference;
  }
  return DEFAULT_LAB_DENSITY_PREFERENCE;
}

export function readSystemColorScheme(): NimiThemeScheme {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

export function resolveLabThemeScheme(
  preference: LabThemePreference,
  systemScheme: NimiThemeScheme,
): NimiThemeScheme {
  return preference === 'system' ? systemScheme : preference;
}

export function resolveLabInitialThemeSnapshot(
  storage: Storage | null = resolveBrowserStorage('local'),
): LabThemeSnapshot {
  const preference = readLabThemePreference(storage);
  const density = readLabDensityPreference(storage);
  return {
    scheme: resolveLabThemeScheme(preference, readSystemColorScheme()),
    accentPack: 'nimi-accent',
    density,
  };
}

type LabThemeContextValue = {
  readonly preference: LabThemePreference;
  readonly scheme: NimiThemeScheme;
  readonly density: LabDensityPreference;
  readonly setPreference: (next: LabThemePreference) => void;
  readonly setDensity: (next: LabDensityPreference) => void;
};

const LabThemeContext = createContext<LabThemeContextValue | null>(null);

export function LabThemeProvider({
  children,
  onThemeSnapshotChange,
}: {
  readonly children: ReactNode;
  readonly onThemeSnapshotChange?: (snapshot: LabThemeSnapshot) => void;
}) {
  const [preference, setPreferenceState] = useState<LabThemePreference>(() => readLabThemePreference());
  const [density, setDensityState] = useState<LabDensityPreference>(() => readLabDensityPreference());
  const [systemScheme, setSystemScheme] = useState<NimiThemeScheme>(readSystemColorScheme);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemScheme(media.matches ? 'dark' : 'light');
    const onChange = (event: MediaQueryListEvent) => {
      setSystemScheme(event.matches ? 'dark' : 'light');
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const setPreference = useCallback((next: LabThemePreference) => {
    if (!(THEME_PREFERENCES as readonly string[]).includes(next)) return;
    setPreferenceState(next);
    writeStorageTextTo(resolveBrowserStorage('local'), LAB_THEME_STORAGE_KEY, next);
  }, []);

  const setDensity = useCallback((next: LabDensityPreference) => {
    if (!(DENSITY_PREFERENCES as readonly string[]).includes(next)) return;
    setDensityState(next);
    writeStorageTextTo(resolveBrowserStorage('local'), LAB_DENSITY_STORAGE_KEY, next);
  }, []);

  const scheme = resolveLabThemeScheme(preference, systemScheme);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.style.colorScheme = scheme;
    }
  }, [scheme]);

  useEffect(() => {
    onThemeSnapshotChange?.({
      scheme,
      accentPack: 'nimi-accent',
      density,
    });
  }, [density, onThemeSnapshotChange, scheme]);

  const value = useMemo<LabThemeContextValue>(
    () => ({ preference, scheme, density, setPreference, setDensity }),
    [density, preference, scheme, setDensity, setPreference],
  );

  return (
    <LabThemeContext.Provider value={value}>
      <NimiThemeProvider scheme={scheme} accentPack="nimi-accent" density={density}>
        {children}
      </NimiThemeProvider>
    </LabThemeContext.Provider>
  );
}

export function useLabTheme(): LabThemeContextValue {
  const value = useContext(LabThemeContext);
  if (!value) {
    return {
      preference: DEFAULT_LAB_THEME_PREFERENCE,
      scheme: 'light',
      density: DEFAULT_LAB_DENSITY_PREFERENCE,
      setPreference: () => {},
      setDensity: () => {},
    };
  }
  return value;
}
