/**
 * Typed device-local preference projections for the Settings surface.
 *
 * Appearance / accessibility / download preferences are device-scoped (not
 * account-scoped) product settings. They persist through a single typed
 * localStorage projection per family.
 *
 * Fail-close contract (T10.3): a *failed* projection — storage unavailable, or
 * a stored payload that is present but not a valid object — surfaces a typed
 * error instead of silently returning defaults. A genuinely *absent* projection
 * (no key yet) is a valid first-run state and resolves to defaults. This keeps
 * a corrupt preference blob from being masked as a healthy default.
 */

import {
  readStorageJsonFrom,
  resolveBrowserStorage,
  writeStorageJsonTo,
} from '@nimiplatform/kit/core/storage-json';
import { parseOptionalJsonObject } from '@nimiplatform/kit/shell/renderer/bridge';

/* ------------------------------------------------------------------ */
/*  Storage keys + events                                             */
/* ------------------------------------------------------------------ */

export const SETTINGS_APPEARANCE_PREFERENCES_STORAGE_KEY =
  'nimi.settings.appearance.preferences.v1';
export const SETTINGS_APPEARANCE_PREFERENCES_EVENT =
  'nimi:settings:appearance-preferences-changed';

export const SETTINGS_DOWNLOAD_PREFERENCES_STORAGE_KEY =
  'nimi.settings.downloads.preferences.v1';
export const SETTINGS_DOWNLOAD_PREFERENCES_EVENT =
  'nimi:settings:download-preferences-changed';

/* ------------------------------------------------------------------ */
/*  Failed-projection error                                           */
/* ------------------------------------------------------------------ */

/**
 * Raised when a device-preference projection cannot be resolved into a typed
 * value. Distinct from an absent projection (valid first-run → defaults).
 */
export class DevicePreferenceProjectionError extends Error {
  readonly storageKey: string;

  constructor(storageKey: string, reason: string) {
    super(`device preference projection failed for ${storageKey}: ${reason}`);
    this.name = 'DevicePreferenceProjectionError';
    this.storageKey = storageKey;
  }
}

/* ------------------------------------------------------------------ */
/*  Appearance + accessibility                                        */
/* ------------------------------------------------------------------ */

export const APPEARANCE_THEMES = ['system', 'light', 'dark'] as const;
export type AppearanceTheme = (typeof APPEARANCE_THEMES)[number];

export type AppearancePreferences = {
  /** Color theme. `system` follows the OS appearance. */
  theme: AppearanceTheme;
  /** Minimize non-essential motion / animation. */
  reduceMotion: boolean;
  /** Increase contrast for legibility. */
  highContrast: boolean;
  /** Render UI text at a larger base size. */
  largerText: boolean;
};

export const DEFAULT_APPEARANCE_PREFERENCES: AppearancePreferences = {
  theme: 'system',
  reduceMotion: false,
  highContrast: false,
  largerText: false,
};

function isAppearanceTheme(value: unknown): value is AppearanceTheme {
  return typeof value === 'string'
    && (APPEARANCE_THEMES as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ */
/*  Downloads                                                         */
/* ------------------------------------------------------------------ */

export type DownloadPreferences = {
  /**
   * Explicit download directory. Empty string means "use the platform default
   * downloads location". Stored as a plain path string — no directory picker
   * bridge exists, and the data-management surface uses the same text-input
   * convention for `nimi_data`.
   */
  downloadLocation: string;
  /** Ask where to save before every download instead of using the location. */
  askEachTime: boolean;
  /** Open a file automatically once its download completes. */
  autoOpenOnComplete: boolean;
};

export const DEFAULT_DOWNLOAD_PREFERENCES: DownloadPreferences = {
  downloadLocation: '',
  askEachTime: false,
  autoOpenOnComplete: false,
};

/* ------------------------------------------------------------------ */
/*  Generic typed projection load/persist                             */
/* ------------------------------------------------------------------ */

function resolveStorage(storageKey: string): Storage {
  const storage = resolveBrowserStorage('local');
  if (!storage) {
    throw new DevicePreferenceProjectionError(storageKey, 'localStorage unavailable');
  }
  return storage;
}

/**
 * Resolve a stored preference projection into a typed value.
 *
 * - Absent key → `defaults` (valid first-run).
 * - Present but unparseable / non-object → `DevicePreferenceProjectionError`.
 */
function loadProjection<T>(
  storageKey: string,
  defaults: T,
  project: (payload: Record<string, unknown>) => T,
): T {
  const storage = resolveStorage(storageKey);
  const result = readStorageJsonFrom(storage, storageKey, (parsed) => {
    const payload = parseOptionalJsonObject(parsed);
    if (!payload) {
      throw new Error('projection is not an object');
    }
    return project(payload);
  });
  if (result.state === 'missing') {
    return { ...defaults };
  }
  if (result.state !== 'ready') {
    throw new DevicePreferenceProjectionError(
      storageKey,
      result.error || (result.state === 'unavailable' ? 'localStorage unavailable' : 'storage read rejected'),
    );
  }
  return result.value;
}

function persistProjection<T>(
  storageKey: string,
  eventName: string,
  subscribers: Set<(value: T) => void>,
  value: T,
): void {
  const storage = resolveStorage(storageKey);
  const result = writeStorageJsonTo(storage, storageKey, value);
  if (result.state !== 'saved') {
    throw new DevicePreferenceProjectionError(
      storageKey,
      result.error || (result.state === 'unavailable' ? 'localStorage unavailable' : 'storage write rejected'),
    );
  }
  for (const subscriber of subscribers) {
    subscriber(value);
  }
  globalThis.window?.dispatchEvent?.(new CustomEvent(eventName, { detail: value }));
}

function subscribeProjection<T>(
  storageKey: string,
  subscribers: Set<(value: T) => void>,
  reload: () => T,
  onChange: (value: T) => void,
): () => void {
  subscribers.add(onChange);
  const target = typeof window === 'undefined' ? null : window;
  if (!target?.addEventListener) {
    return () => {
      subscribers.delete(onChange);
    };
  }
  const onStorage = (event: Event) => {
    const storageEvent = event as StorageEvent;
    if (storageEvent.key && storageEvent.key !== storageKey) {
      return;
    }
    try {
      onChange(reload());
    } catch {
      // A cross-tab storage event for a now-corrupt projection must not crash
      // a passive subscriber; the active loader still fail-closes on read.
    }
  };
  target.addEventListener('storage', onStorage);
  return () => {
    subscribers.delete(onChange);
    target.removeEventListener('storage', onStorage);
  };
}

/* ------------------------------------------------------------------ */
/*  Appearance projection                                             */
/* ------------------------------------------------------------------ */

const appearanceSubscribers = new Set<(value: AppearancePreferences) => void>();

export function loadAppearancePreferences(): AppearancePreferences {
  return loadProjection(
    SETTINGS_APPEARANCE_PREFERENCES_STORAGE_KEY,
    DEFAULT_APPEARANCE_PREFERENCES,
    (payload) => ({
      theme: isAppearanceTheme(payload.theme)
        ? payload.theme
        : DEFAULT_APPEARANCE_PREFERENCES.theme,
      reduceMotion: payload.reduceMotion === true,
      highContrast: payload.highContrast === true,
      largerText: payload.largerText === true,
    }),
  );
}

export function persistAppearancePreferences(value: AppearancePreferences): void {
  persistProjection(
    SETTINGS_APPEARANCE_PREFERENCES_STORAGE_KEY,
    SETTINGS_APPEARANCE_PREFERENCES_EVENT,
    appearanceSubscribers,
    value,
  );
}

export function subscribeAppearancePreferences(
  onChange: (value: AppearancePreferences) => void,
): () => void {
  return subscribeProjection(
    SETTINGS_APPEARANCE_PREFERENCES_STORAGE_KEY,
    appearanceSubscribers,
    loadAppearancePreferences,
    onChange,
  );
}

export function appearanceEqual(
  left: AppearancePreferences,
  right: AppearancePreferences,
): boolean {
  return left.theme === right.theme
    && left.reduceMotion === right.reduceMotion
    && left.highContrast === right.highContrast
    && left.largerText === right.largerText;
}

/* ------------------------------------------------------------------ */
/*  Download projection                                               */
/* ------------------------------------------------------------------ */

const downloadSubscribers = new Set<(value: DownloadPreferences) => void>();

export function loadDownloadPreferences(): DownloadPreferences {
  return loadProjection(
    SETTINGS_DOWNLOAD_PREFERENCES_STORAGE_KEY,
    DEFAULT_DOWNLOAD_PREFERENCES,
    (payload) => ({
      downloadLocation: typeof payload.downloadLocation === 'string'
        ? payload.downloadLocation.trim()
        : DEFAULT_DOWNLOAD_PREFERENCES.downloadLocation,
      askEachTime: payload.askEachTime === true,
      autoOpenOnComplete: payload.autoOpenOnComplete === true,
    }),
  );
}

export function persistDownloadPreferences(value: DownloadPreferences): void {
  persistProjection(
    SETTINGS_DOWNLOAD_PREFERENCES_STORAGE_KEY,
    SETTINGS_DOWNLOAD_PREFERENCES_EVENT,
    downloadSubscribers,
    value,
  );
}

export function subscribeDownloadPreferences(
  onChange: (value: DownloadPreferences) => void,
): () => void {
  return subscribeProjection(
    SETTINGS_DOWNLOAD_PREFERENCES_STORAGE_KEY,
    downloadSubscribers,
    loadDownloadPreferences,
    onChange,
  );
}

export function downloadEqual(
  left: DownloadPreferences,
  right: DownloadPreferences,
): boolean {
  return left.downloadLocation === right.downloadLocation
    && left.askEachTime === right.askEachTime
    && left.autoOpenOnComplete === right.autoOpenOnComplete;
}
