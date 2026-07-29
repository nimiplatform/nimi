import type {
  AppearancePreferences,
  DownloadPreferences,
} from '../features/settings/settings-device-preferences.js';

export type PerformancePreferences = {
  readonly hardwareAcceleration: boolean;
  readonly reduceAnimations: boolean;
};

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

export const DEFAULT_PERFORMANCE_PREFERENCES: PerformancePreferences = Object.freeze({
  hardwareAcceleration: true,
  reduceAnimations: false,
});

const VISIBLE_SETTINGS_SELECTED_IDS = Object.freeze([
  'profile',
  'language',
  'appearance',
  'privacy',
  'security',
  'notifications',
  'downloads',
  'performance',
  'data',
  'about-legal',
]);

export function normalizeSettingsSelectedId(id: string, fallback: string): string {
  const candidate = String(id || '').trim();
  if (VISIBLE_SETTINGS_SELECTED_IDS.includes(candidate)) {
    return candidate;
  }
  const fallbackCandidate = String(fallback || '').trim();
  if (VISIBLE_SETTINGS_SELECTED_IDS.includes(fallbackCandidate)) {
    return fallbackCandidate;
  }
  return 'profile';
}

export function normalizePerformancePreferences(
  preferences: PerformancePreferences,
): PerformancePreferences {
  return Object.freeze({
    hardwareAcceleration: preferences.hardwareAcceleration === true,
    reduceAnimations: preferences.reduceAnimations === true,
  });
}

export interface DesktopRendererSettingsPort {
  loadSelected(fallback: string): string;
  persistSelected(id: string): void;
  openSection(id: string): void;
  subscribeOpenSection(listener: (id: string) => void): () => void;
  loadPerformancePreferences(): PerformancePreferences;
  persistPerformancePreferences(preferences: PerformancePreferences): void;
  loadAppearancePreferences(): AppearancePreferences;
  persistAppearancePreferences(preferences: AppearancePreferences): void;
  subscribeAppearancePreferences(listener: (preferences: AppearancePreferences) => void): () => void;
  loadDownloadPreferences(): DownloadPreferences;
  persistDownloadPreferences(preferences: DownloadPreferences): void;
  subscribeDownloadPreferences(listener: (preferences: DownloadPreferences) => void): () => void;
  estimateStorageUsage(): Promise<DesktopRendererStorageUsage>;
  loadStorageDirs(): Promise<DesktopRendererStorageDirs>;
}

export function createMemoryDesktopRendererSettingsPort(): DesktopRendererSettingsPort {
  let selectedId = 'profile';
  let performancePreferences = DEFAULT_PERFORMANCE_PREFERENCES;
  let appearancePreferences: AppearancePreferences = {
    theme: 'system',
    reduceMotion: false,
    highContrast: false,
    largerText: false,
  };
  let downloadPreferences: DownloadPreferences = {
    downloadLocation: '',
    askEachTime: false,
    autoOpenOnComplete: false,
  };
  const appearanceListeners = new Set<(preferences: AppearancePreferences) => void>();
  const downloadListeners = new Set<(preferences: DownloadPreferences) => void>();
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
    loadPerformancePreferences: () => ({ ...performancePreferences }),
    persistPerformancePreferences(preferences: PerformancePreferences) {
      performancePreferences = normalizePerformancePreferences(preferences);
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
    loadDownloadPreferences: () => ({ ...downloadPreferences }),
    persistDownloadPreferences(preferences: DownloadPreferences) {
      downloadPreferences = { ...preferences };
      for (const listener of downloadListeners) listener({ ...downloadPreferences });
    },
    subscribeDownloadPreferences(listener: (preferences: DownloadPreferences) => void) {
      downloadListeners.add(listener);
      return () => downloadListeners.delete(listener);
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
