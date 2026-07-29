import {
  readStorageJsonFrom,
  readStorageTextFrom,
  resolveBrowserStorage,
  writeStorageJsonTo,
  writeStorageTextTo,
} from '@nimiplatform/kit/core/storage-json';
import { parseOptionalJsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import { desktopBridge } from '../../bridge.js';
import {
  DEFAULT_APPEARANCE_PREFERENCES,
  DEFAULT_DOWNLOAD_PREFERENCES,
  DevicePreferenceProjectionError,
  projectAppearancePreferences,
  projectDownloadPreferences,
  SETTINGS_APPEARANCE_PREFERENCES_STORAGE_KEY,
  SETTINGS_DOWNLOAD_PREFERENCES_STORAGE_KEY,
  type AppearancePreferences,
  type DownloadPreferences,
} from './settings-device-preferences.js';
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

async function estimateProductionStorageUsage() {
  const storage = resolveBrowserStorage('local');
  let localStorageBytes = 0;
  if (storage) {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key) continue;
      localStorageBytes += (key.length + (storage.getItem(key) || '').length) * 2;
    }
  }

  let estimatedUsageBytes = 0;
  let estimatedQuotaBytes = 0;
  if (navigator.storage?.estimate) {
    const estimate = await navigator.storage.estimate();
    estimatedUsageBytes = Number(estimate.usage || 0);
    estimatedQuotaBytes = Number(estimate.quota || 0);
  }
  return Object.freeze({
    localStorageBytes,
    estimatedUsageBytes,
    estimatedQuotaBytes,
  });
}

export function createDesktopProductionSettingsPort(): DesktopRendererSettingsPort {
  const appearanceListeners = new Set<(value: AppearancePreferences) => void>();
  const downloadListeners = new Set<(value: DownloadPreferences) => void>();

  function loadDevicePreferences<T>(
    storageKey: string,
    defaults: T,
    project: (payload: Record<string, unknown>) => T,
  ): T {
    const storage = resolveBrowserStorage('local');
    if (!storage) throw new DevicePreferenceProjectionError(storageKey, 'localStorage unavailable');
    const result = readStorageJsonFrom(storage, storageKey, (parsed) => {
      const payload = parseOptionalJsonObject(parsed);
      if (!payload) throw new Error('projection is not an object');
      return project(payload);
    });
    if (result.state === 'missing') return { ...defaults };
    if (result.state !== 'ready') {
      throw new DevicePreferenceProjectionError(storageKey, result.error || 'storage read rejected');
    }
    return result.value;
  }

  function persistDevicePreferences<T>(
    storageKey: string,
    listeners: Set<(value: T) => void>,
    value: T,
  ): void {
    const storage = resolveBrowserStorage('local');
    if (!storage) throw new DevicePreferenceProjectionError(storageKey, 'localStorage unavailable');
    const result = writeStorageJsonTo(storage, storageKey, value);
    if (result.state !== 'saved') {
      throw new DevicePreferenceProjectionError(storageKey, result.error || 'storage write rejected');
    }
    for (const listener of listeners) listener(value);
  }

  function subscribeDevicePreferences<T>(
    storageKey: string,
    listeners: Set<(value: T) => void>,
    load: () => T,
    listener: (value: T) => void,
  ): () => void {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== storageKey) return;
      try {
        listener(load());
      } catch {
        // Active reads retain fail-closed projection reporting.
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener('storage', onStorage);
    };
  }

  const loadAppearancePreferences = () => loadDevicePreferences(
    SETTINGS_APPEARANCE_PREFERENCES_STORAGE_KEY,
    DEFAULT_APPEARANCE_PREFERENCES,
    projectAppearancePreferences,
  );
  const loadDownloadPreferences = () => loadDevicePreferences(
    SETTINGS_DOWNLOAD_PREFERENCES_STORAGE_KEY,
    DEFAULT_DOWNLOAD_PREFERENCES,
    projectDownloadPreferences,
  );

  return Object.freeze({
    loadSelected: loadStoredSettingsSelected,
    persistSelected: persistStoredSettingsSelected,
    openSection: dispatchSettingsOpenSection,
    subscribeOpenSection: addSettingsOpenSectionListener,
    loadPerformancePreferences: loadStoredPerformancePreferences,
    persistPerformancePreferences: persistStoredPerformancePreferences,
    loadAppearancePreferences,
    persistAppearancePreferences: (value: AppearancePreferences) => persistDevicePreferences(
      SETTINGS_APPEARANCE_PREFERENCES_STORAGE_KEY,
      appearanceListeners,
      value,
    ),
    subscribeAppearancePreferences: (listener: (value: AppearancePreferences) => void) => subscribeDevicePreferences(
      SETTINGS_APPEARANCE_PREFERENCES_STORAGE_KEY,
      appearanceListeners,
      loadAppearancePreferences,
      listener,
    ),
    loadDownloadPreferences,
    persistDownloadPreferences: (value: DownloadPreferences) => persistDevicePreferences(
      SETTINGS_DOWNLOAD_PREFERENCES_STORAGE_KEY,
      downloadListeners,
      value,
    ),
    subscribeDownloadPreferences: (listener: (value: DownloadPreferences) => void) => subscribeDevicePreferences(
      SETTINGS_DOWNLOAD_PREFERENCES_STORAGE_KEY,
      downloadListeners,
      loadDownloadPreferences,
      listener,
    ),
    estimateStorageUsage: estimateProductionStorageUsage,
    loadStorageDirs: () => desktopBridge.getDesktopStorageDirs(),
  });
}
