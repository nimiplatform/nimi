export const SETTINGS_APPEARANCE_PREFERENCES_STORAGE_KEY =
  'nimi.settings.appearance.preferences.v1';
export const SETTINGS_DOWNLOAD_PREFERENCES_STORAGE_KEY =
  'nimi.settings.downloads.preferences.v1';

export class DevicePreferenceProjectionError extends Error {
  readonly storageKey: string;

  constructor(storageKey: string, reason: string) {
    super(`device preference projection failed for ${storageKey}: ${reason}`);
    this.name = 'DevicePreferenceProjectionError';
    this.storageKey = storageKey;
  }
}

export const APPEARANCE_THEMES = ['system', 'light', 'dark'] as const;
export type AppearanceTheme = (typeof APPEARANCE_THEMES)[number];

export type AppearancePreferences = {
  theme: AppearanceTheme;
  reduceMotion: boolean;
  highContrast: boolean;
  largerText: boolean;
};

export const DEFAULT_APPEARANCE_PREFERENCES: AppearancePreferences = Object.freeze({
  theme: 'system',
  reduceMotion: false,
  highContrast: false,
  largerText: false,
});

export type DownloadPreferences = {
  downloadLocation: string;
  askEachTime: boolean;
  autoOpenOnComplete: boolean;
};

export const DEFAULT_DOWNLOAD_PREFERENCES: DownloadPreferences = Object.freeze({
  downloadLocation: '',
  askEachTime: false,
  autoOpenOnComplete: false,
});

export function projectAppearancePreferences(payload: Record<string, unknown>): AppearancePreferences {
  const theme = typeof payload.theme === 'string'
    && (APPEARANCE_THEMES as readonly string[]).includes(payload.theme)
    ? payload.theme as AppearanceTheme
    : DEFAULT_APPEARANCE_PREFERENCES.theme;
  return {
    theme,
    reduceMotion: payload.reduceMotion === true,
    highContrast: payload.highContrast === true,
    largerText: payload.largerText === true,
  };
}

export function projectDownloadPreferences(payload: Record<string, unknown>): DownloadPreferences {
  return {
    downloadLocation: typeof payload.downloadLocation === 'string'
      ? payload.downloadLocation.trim()
      : DEFAULT_DOWNLOAD_PREFERENCES.downloadLocation,
    askEachTime: payload.askEachTime === true,
    autoOpenOnComplete: payload.autoOpenOnComplete === true,
  };
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

export function downloadEqual(
  left: DownloadPreferences,
  right: DownloadPreferences,
): boolean {
  return left.downloadLocation === right.downloadLocation
    && left.askEachTime === right.askEachTime
    && left.autoOpenOnComplete === right.autoOpenOnComplete;
}
