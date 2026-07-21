import {
  readStorageJsonFrom,
  readStorageTextFrom,
  resolveBrowserStorage,
  writeStorageJsonTo,
  writeStorageTextTo,
} from '@nimiplatform/kit/core/storage-json';
import { parseOptionalJsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  DEFAULT_PERFORMANCE_PREFERENCES,
  normalizePerformancePreferences,
  normalizeSettingsSelectedId,
  type DesktopRendererSettingsPort,
  type PerformancePreferences,
} from '../../renderer/settings-port.js';

export type { PerformancePreferences } from '../../renderer/settings-port.js';

export const SETTINGS_SELECTED_STORAGE_KEY = 'nimi.settings.selected';
export const SETTINGS_SELECTED_TARGET_ID_STORAGE_KEY = 'nimi.settings.targetId';
export const SETTINGS_PERFORMANCE_PREFERENCES_STORAGE_KEY = 'nimi.settings.performance.preferences.v1';
export const SETTINGS_PERFORMANCE_PREFERENCES_EVENT = 'nimi:settings:performance-preferences-changed';
export const SETTINGS_OPEN_SECTION_EVENT = 'nimi://settings-open-section';

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
    const normalized = normalizePerformancePreferences(prefs);
    const result = writeStorageJsonTo(
      resolveBrowserStorage('local'),
      SETTINGS_PERFORMANCE_PREFERENCES_STORAGE_KEY,
      normalized,
    );
    if (result.state !== 'saved') {
      return;
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
  const eventTarget = globalThis.window;
  if (!eventTarget?.addEventListener) {
    return () => undefined;
  }

  const onPreferenceEvent = (event: Event) => {
    if (event.type === SETTINGS_PERFORMANCE_PREFERENCES_EVENT) {
      const detail = (event as CustomEvent<PerformancePreferences>).detail;
      onChange(normalizePerformancePreferences(detail));
      return;
    }
    const storageEvent = event as StorageEvent;
    if (storageEvent.key && storageEvent.key !== SETTINGS_PERFORMANCE_PREFERENCES_STORAGE_KEY) {
      return;
    }
    onChange(loadStoredPerformancePreferences());
  };

  eventTarget.addEventListener(SETTINGS_PERFORMANCE_PREFERENCES_EVENT, onPreferenceEvent);
  eventTarget.addEventListener('storage', onPreferenceEvent);
  return () => {
    eventTarget.removeEventListener(SETTINGS_PERFORMANCE_PREFERENCES_EVENT, onPreferenceEvent);
    eventTarget.removeEventListener('storage', onPreferenceEvent);
  };
}

export function createDesktopProductionSettingsPort(): DesktopRendererSettingsPort {
  return Object.freeze({
    loadSelected: loadStoredSettingsSelected,
    persistSelected: persistStoredSettingsSelected,
    openSection: dispatchSettingsOpenSection,
    subscribeOpenSection: addSettingsOpenSectionListener,
    loadPerformancePreferences: loadStoredPerformancePreferences,
    persistPerformancePreferences: persistStoredPerformancePreferences,
  });
}
