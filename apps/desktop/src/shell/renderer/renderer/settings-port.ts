import type {
  AppearancePreferences,
} from '../features/settings/settings-device-preferences.js';

export type DesktopRendererStorageUsage = {
  readonly localStorageBytes: number;
  readonly estimatedUsageBytes: number;
  readonly estimatedQuotaBytes: number;
};

export type DesktopRendererStorageDirs = {
  readonly dataRoot: string;
  readonly modelsDir: string;
  readonly dependenciesDir: string;
  readonly environmentsDir: string;
  readonly appsDir: string;
  readonly accountsDir: string;
  readonly logsDir: string;
  readonly auditDir: string;
};

const VISIBLE_SETTINGS_SELECTED_IDS = Object.freeze([
  'profile',
  'appearance',
  'privacy',
  'security',
  'notifications',
  'performance',
  'data',
  'about-legal',
]);

// Retired settings ids that must resolve to their successor page instead of
// the global fallback, so persisted selections and stale deep links keep
// landing on the content the user meant.
const LEGACY_SETTINGS_SELECTED_ID_MAP: Readonly<Record<string, string>> = Object.freeze({
  language: 'appearance',
});

export function normalizeSettingsSelectedId(id: string, fallback: string): string {
  const candidate = String(id || '').trim();
  if (VISIBLE_SETTINGS_SELECTED_IDS.includes(candidate)) {
    return candidate;
  }
  const legacyTarget = LEGACY_SETTINGS_SELECTED_ID_MAP[candidate];
  if (legacyTarget && VISIBLE_SETTINGS_SELECTED_IDS.includes(legacyTarget)) {
    return legacyTarget;
  }
  const fallbackCandidate = String(fallback || '').trim();
  if (VISIBLE_SETTINGS_SELECTED_IDS.includes(fallbackCandidate)) {
    return fallbackCandidate;
  }
  return 'profile';
}

export interface DesktopRendererSettingsPort {
  loadSelected(fallback: string): string;
  persistSelected(id: string): void;
  openSection(id: string): void;
  subscribeOpenSection(listener: (id: string) => void): () => void;
  loadAppearancePreferences(): AppearancePreferences;
  persistAppearancePreferences(preferences: AppearancePreferences): void;
  subscribeAppearancePreferences(listener: (preferences: AppearancePreferences) => void): () => void;
  estimateStorageUsage(): Promise<DesktopRendererStorageUsage>;
  loadStorageDirs(): Promise<DesktopRendererStorageDirs>;
}

export function createMemoryDesktopRendererSettingsPort(): DesktopRendererSettingsPort {
  let selectedId = 'profile';
  let appearancePreferences: AppearancePreferences = {
    theme: 'system',
    reduceMotion: false,
  };
  const appearanceListeners = new Set<(preferences: AppearancePreferences) => void>();
  const openSectionListeners = new Set<(id: string) => void>();

  return Object.freeze({
    loadSelected: (fallback: string) => normalizeSettingsSelectedId(selectedId, fallback),
    persistSelected(id: string) {
      selectedId = normalizeSettingsSelectedId(id, 'profile');
    },
    openSection(id: string) {
      selectedId = normalizeSettingsSelectedId(id, 'profile');
      for (const listener of openSectionListeners) listener(selectedId);
    },
    subscribeOpenSection(listener: (id: string) => void) {
      openSectionListeners.add(listener);
      return () => openSectionListeners.delete(listener);
    },
    loadAppearancePreferences: () => ({ ...appearancePreferences }),
    persistAppearancePreferences(preferences: AppearancePreferences) {
      appearancePreferences = { ...preferences };
      for (const listener of appearanceListeners) listener({ ...appearancePreferences });
    },
    subscribeAppearancePreferences(listener: (preferences: AppearancePreferences) => void) {
      appearanceListeners.add(listener);
      return () => appearanceListeners.delete(listener);
    },
    async estimateStorageUsage() {
      return Object.freeze({
        localStorageBytes: 0,
        estimatedUsageBytes: 0,
        estimatedQuotaBytes: 0,
      });
    },
    async loadStorageDirs() {
      throw new Error('DESKTOP_SIMULATOR_STORAGE_DIRS_UNADMITTED');
    },
  });
}
