import {
  readStorageJsonFrom,
  resolveBrowserStorage,
  writeStorageJsonTo,
} from '@nimiplatform/kit/core/storage-json';

export type AvatarShellSettings = {
  alwaysOnTop: boolean;
  showVoiceCaptions: boolean;
  captionSize: 'small' | 'medium' | 'large';
  captionContrast: 'standard' | 'high';
  captionDuration: 'short' | 'standard' | 'long';
};

type StoredAvatarShellSettings = Partial<AvatarShellSettings> & {
  schemaVersion?: number;
};

export const AVATAR_SHELL_SETTINGS_STORAGE_KEY = 'nimi.avatar.shell-settings.v1';

export const defaultAvatarShellSettings: AvatarShellSettings = {
  alwaysOnTop: true,
  showVoiceCaptions: true,
  captionSize: 'medium',
  captionContrast: 'standard',
  captionDuration: 'standard',
};

function normalizeStoredAvatarShellSettings(value: unknown): StoredAvatarShellSettings {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as StoredAvatarShellSettings
    : {};
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readEnum<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === 'string' && values.includes(value as T) ? value as T : fallback;
}

export function avatarCaptionDurationMs(value: AvatarShellSettings['captionDuration']): number {
  if (value === 'short') return 3_000;
  if (value === 'long') return 8_000;
  return 5_000;
}

export function readAvatarShellSettings(): AvatarShellSettings {
  const result = readStorageJsonFrom(
    resolveBrowserStorage('local'),
    AVATAR_SHELL_SETTINGS_STORAGE_KEY,
    normalizeStoredAvatarShellSettings,
  );
  if (result.state !== 'ready') {
    return { ...defaultAvatarShellSettings };
  }
  const stored = result.value;
  return {
    alwaysOnTop: readBoolean(stored.alwaysOnTop, defaultAvatarShellSettings.alwaysOnTop),
    showVoiceCaptions: readBoolean(stored.showVoiceCaptions, defaultAvatarShellSettings.showVoiceCaptions),
    captionSize: readEnum(stored.captionSize, ['small', 'medium', 'large'], defaultAvatarShellSettings.captionSize),
    captionContrast: readEnum(stored.captionContrast, ['standard', 'high'], defaultAvatarShellSettings.captionContrast),
    captionDuration: readEnum(stored.captionDuration, ['short', 'standard', 'long'], defaultAvatarShellSettings.captionDuration),
  };
}

export function writeAvatarShellSettings(settings: AvatarShellSettings): void {
  writeStorageJsonTo(
    resolveBrowserStorage('local'),
    AVATAR_SHELL_SETTINGS_STORAGE_KEY,
    {
      schemaVersion: 1,
      ...settings,
    },
  );
}
