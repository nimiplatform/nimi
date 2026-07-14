import {
  readStorageJsonFrom,
  readStorageTextFrom,
  resolveBrowserStorage,
  writeStorageJsonTo,
  writeStorageTextTo,
} from '@nimiplatform/kit/core/storage-json';
import { parseOptionalJsonObject } from '@nimiplatform/kit/shell/renderer/bridge';

export const SETTINGS_SELECTED_STORAGE_KEY = 'nimi.settings.selected';
export const SETTINGS_SELECTED_TARGET_ID_STORAGE_KEY = 'nimi.settings.targetId';
export const SETTINGS_PERFORMANCE_PREFERENCES_STORAGE_KEY = 'nimi.settings.performance.preferences.v1';
export const SETTINGS_PERFORMANCE_PREFERENCES_EVENT = 'nimi:settings:performance-preferences-changed';
export const SETTINGS_OPEN_SECTION_EVENT = 'nimi://settings-open-section';

const VISIBLE_SETTINGS_SELECTED_IDS = new Set([
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

function normalizeSettingsSelectedId(id: string, fallback: string): string {
  const candidate = String(id || '').trim();
  if (VISIBLE_SETTINGS_SELECTED_IDS.has(candidate)) {
    return candidate;
  }
  const fallbackCandidate = String(fallback || '').trim();
  if (VISIBLE_SETTINGS_SELECTED_IDS.has(fallbackCandidate)) {
    return fallbackCandidate;
  }
  return 'profile';
}

export function loadStoredSettingsSelected(fallback: string): string {
  const result = readStorageTextFrom(resolveBrowserStorage('local'), SETTINGS_SELECTED_STORAGE_KEY);
  return result.state === 'ready'
    ? normalizeSettingsSelectedId(String(result.value || ''), fallback)
    : normalizeSettingsSelectedId(fallback, 'profile');
}

export function persistStoredSettingsSelected(id: string): void {
  writeStorageTextTo(resolveBrowserStorage('local'), SETTINGS_SELECTED_STORAGE_KEY, normalizeSettingsSelectedId(id, 'profile'));
}

export function dispatchSettingsOpenSection(id: string): void {
  const normalized = normalizeSettingsSelectedId(id, 'profile');
  persistStoredSettingsSelected(normalized);
  globalThis.window?.dispatchEvent?.(
    new CustomEvent(SETTINGS_OPEN_SECTION_EVENT, {
      detail: normalized,
    }),
  );
}

export function addSettingsOpenSectionListener(onOpen: (id: string) => void): () => void {
  const eventTarget = globalThis.window;
  if (!eventTarget?.addEventListener) {
    return () => {};
  }
  const onEvent = (event: Event) => {
    const next = normalizeSettingsSelectedId(String((event as CustomEvent<unknown>).detail || ''), 'profile');
    onOpen(next);
  };
  eventTarget.addEventListener(SETTINGS_OPEN_SECTION_EVENT, onEvent);
  return () => {
    eventTarget.removeEventListener(SETTINGS_OPEN_SECTION_EVENT, onEvent);
  };
}

export function loadStoredSettingsTargetId(): string {
  const result = readStorageTextFrom(resolveBrowserStorage('local'), SETTINGS_SELECTED_TARGET_ID_STORAGE_KEY);
  return result.state === 'ready' ? String(result.value || '').trim() : '';
}

export function persistStoredSettingsTargetId(targetId: string): void {
  writeStorageTextTo(resolveBrowserStorage('local'), SETTINGS_SELECTED_TARGET_ID_STORAGE_KEY, String(targetId || '').trim());
}

export type PerformancePreferences = {
  hardwareAcceleration: boolean;
  reduceAnimations: boolean;
  autoUpdate: boolean;
};

const DEFAULT_PERFORMANCE_PREFERENCES: PerformancePreferences = {
  hardwareAcceleration: true,
  reduceAnimations: false,
  autoUpdate: true,
};

const performancePreferenceSubscribers = new Set<(prefs: PerformancePreferences) => void>();

export function loadStoredPerformancePreferences(): PerformancePreferences {
  const result = readStorageJsonFrom(
    resolveBrowserStorage('local'),
    SETTINGS_PERFORMANCE_PREFERENCES_STORAGE_KEY,
    (parsed) => {
      const payload = parseOptionalJsonObject(parsed);
      if (!payload) {
        return { ...DEFAULT_PERFORMANCE_PREFERENCES };
    }
    return {
      hardwareAcceleration: payload.hardwareAcceleration !== false,
      reduceAnimations: payload.reduceAnimations === true,
      autoUpdate: payload.autoUpdate !== false,
      };
    },
  );
  return result.state === 'ready'
    ? result.value
    : { ...DEFAULT_PERFORMANCE_PREFERENCES };
}

export function persistStoredPerformancePreferences(prefs: PerformancePreferences): void {
  try {
    const normalized = {
      hardwareAcceleration: prefs.hardwareAcceleration === true,
      reduceAnimations: prefs.reduceAnimations === true,
      autoUpdate: prefs.autoUpdate === true,
    };
    const result = writeStorageJsonTo(
      resolveBrowserStorage('local'),
      SETTINGS_PERFORMANCE_PREFERENCES_STORAGE_KEY,
      normalized,
    );
    if (result.state !== 'saved') {
      return;
    }
    for (const subscriber of performancePreferenceSubscribers) {
      subscriber(normalized);
    }
    globalThis.window?.dispatchEvent?.(
      new CustomEvent(SETTINGS_PERFORMANCE_PREFERENCES_EVENT, {
        detail: normalized,
      }),
    );
  } catch {
    // ignore
  }
}

export function subscribeStoredPerformancePreferences(
  onChange: (prefs: PerformancePreferences) => void,
): () => void {
  performancePreferenceSubscribers.add(onChange);
  const eventTarget = globalThis.window;
  if (!eventTarget?.addEventListener) {
    return () => {
      performancePreferenceSubscribers.delete(onChange);
    };
  }

  const onStorageEvent = (event: Event) => {
    const storageEvent = event as StorageEvent;
    if (storageEvent.key && storageEvent.key !== SETTINGS_PERFORMANCE_PREFERENCES_STORAGE_KEY) {
      return;
    }
    onChange(loadStoredPerformancePreferences());
  };

  eventTarget.addEventListener('storage', onStorageEvent);
  return () => {
    performancePreferenceSubscribers.delete(onChange);
    eventTarget.removeEventListener('storage', onStorageEvent);
  };
}
