export type PerformancePreferences = {
  readonly hardwareAcceleration: boolean;
  readonly reduceAnimations: boolean;
  readonly autoUpdate: boolean;
};

export const DEFAULT_PERFORMANCE_PREFERENCES: PerformancePreferences = Object.freeze({
  hardwareAcceleration: true,
  reduceAnimations: false,
  autoUpdate: true,
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
    autoUpdate: preferences.autoUpdate === true,
  });
}

export interface DesktopRendererSettingsPort {
  loadSelected(fallback: string): string;
  persistSelected(id: string): void;
  openSection(id: string): void;
  subscribeOpenSection(listener: (id: string) => void): () => void;
  loadPerformancePreferences(): PerformancePreferences;
  persistPerformancePreferences(preferences: PerformancePreferences): void;
}

export function createMemoryDesktopRendererSettingsPort(): DesktopRendererSettingsPort {
  let selectedId = 'profile';
  let performancePreferences = DEFAULT_PERFORMANCE_PREFERENCES;
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
  });
}
