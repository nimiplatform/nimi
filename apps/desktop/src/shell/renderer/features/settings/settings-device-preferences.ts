export const SETTINGS_APPEARANCE_PREFERENCES_STORAGE_KEY =
  'nimi.settings.appearance.preferences.v1';

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
};

export const DEFAULT_APPEARANCE_PREFERENCES: AppearancePreferences = Object.freeze({
  theme: 'system',
  reduceMotion: false,
});

export function projectAppearancePreferences(payload: Record<string, unknown>): AppearancePreferences {
  const theme = typeof payload.theme === 'string'
    && (APPEARANCE_THEMES as readonly string[]).includes(payload.theme)
    ? payload.theme as AppearanceTheme
    : DEFAULT_APPEARANCE_PREFERENCES.theme;
  return {
    theme,
    reduceMotion: payload.reduceMotion === true,
  };
}

export function appearanceEqual(
  left: AppearancePreferences,
  right: AppearancePreferences,
): boolean {
  return left.theme === right.theme
    && left.reduceMotion === right.reduceMotion;
}
