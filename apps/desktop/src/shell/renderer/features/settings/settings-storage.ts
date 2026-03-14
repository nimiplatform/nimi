export const SETTINGS_SELECTED_STORAGE_KEY = 'nimi.settings.selected';
export const SETTINGS_SELECTED_MOD_ID_STORAGE_KEY = 'nimi.settings.modId';
export const SETTINGS_PERFORMANCE_PREFERENCES_STORAGE_KEY = 'nimi.settings.performance.preferences.v1';
export const SETTINGS_PERFORMANCE_PREFERENCES_EVENT = 'nimi:settings:performance-preferences-changed';

export function loadStoredSettingsSelected(fallback: string): string {
  try {
    const value = localStorage.getItem(SETTINGS_SELECTED_STORAGE_KEY);
    return String(value || '').trim() || fallback;
  } catch {
    return fallback;
  }
}

export function persistStoredSettingsSelected(id: string): void {
  try {
    localStorage.setItem(SETTINGS_SELECTED_STORAGE_KEY, String(id || '').trim());
  } catch {
    // ignore
  }
}

export function loadStoredSettingsModId(): string {
  try {
    return String(localStorage.getItem(SETTINGS_SELECTED_MOD_ID_STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function persistStoredSettingsModId(modId: string): void {
  try {
    localStorage.setItem(SETTINGS_SELECTED_MOD_ID_STORAGE_KEY, String(modId || '').trim());
  } catch {
    // ignore
  }
}

export type PerformancePreferences = {
  hardwareAcceleration: boolean;
  reduceAnimations: boolean;
  autoUpdate: boolean;
  developerMode: boolean;
};

const DEFAULT_PERFORMANCE_PREFERENCES: PerformancePreferences = {
  hardwareAcceleration: true,
  reduceAnimations: false,
  autoUpdate: true,
  developerMode: false,
};

const performancePreferenceSubscribers = new Set<(prefs: PerformancePreferences) => void>();

export function loadStoredPerformancePreferences(): PerformancePreferences {
  try {
    const raw = localStorage.getItem(SETTINGS_PERFORMANCE_PREFERENCES_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_PERFORMANCE_PREFERENCES };
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { ...DEFAULT_PERFORMANCE_PREFERENCES };
    }
    const payload = parsed as Record<string, unknown>;
    return {
      hardwareAcceleration: payload.hardwareAcceleration !== false,
      reduceAnimations: payload.reduceAnimations === true,
      autoUpdate: payload.autoUpdate !== false,
      developerMode: payload.developerMode === true,
    };
  } catch {
    return { ...DEFAULT_PERFORMANCE_PREFERENCES };
  }
}

export function persistStoredPerformancePreferences(prefs: PerformancePreferences): void {
  try {
    const normalized = {
      hardwareAcceleration: prefs.hardwareAcceleration === true,
      reduceAnimations: prefs.reduceAnimations === true,
      autoUpdate: prefs.autoUpdate === true,
      developerMode: prefs.developerMode === true,
    };
    localStorage.setItem(
      SETTINGS_PERFORMANCE_PREFERENCES_STORAGE_KEY,
      JSON.stringify(normalized),
    );
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
