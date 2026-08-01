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
  DevicePreferenceProjectionError,
  projectAppearancePreferences,
  SETTINGS_APPEARANCE_PREFERENCES_STORAGE_KEY,
  type AppearancePreferences,
} from './settings-device-preferences.js';
import {
  normalizeSettingsSelectedId,
  type DesktopRendererSettingsPort,
} from '../../renderer/settings-port.js';

export const SETTINGS_SELECTED_STORAGE_KEY = 'nimi.settings.selected';
export const SETTINGS_SELECTED_TARGET_ID_STORAGE_KEY = 'nimi.settings.targetId';
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

  return Object.freeze({
    loadSelected: loadStoredSettingsSelected,
    persistSelected: persistStoredSettingsSelected,
    openSection: dispatchSettingsOpenSection,
    subscribeOpenSection: addSettingsOpenSectionListener,
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
    estimateStorageUsage: estimateProductionStorageUsage,
    loadStorageDirs: () => desktopBridge.getDesktopStorageDirs(),
  });
}
