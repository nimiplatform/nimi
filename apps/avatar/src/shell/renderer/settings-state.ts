import {
  readStorageJsonFrom,
  resolveBrowserStorage,
  writeStorageJsonTo,
} from '@nimiplatform/kit/core/storage-json';

export type AvatarShellSettings = {
  alwaysOnTop: boolean;
  bubbleAutoOpen: boolean;
  bubbleAutoCollapse: boolean;
  showVoiceCaptions: boolean;
};

type StoredAvatarShellSettings = Partial<AvatarShellSettings> & {
  schemaVersion?: number;
};

export const AVATAR_SHELL_SETTINGS_STORAGE_KEY = 'nimi.avatar.shell-settings.v1';

export const defaultAvatarShellSettings: AvatarShellSettings = {
  alwaysOnTop: true,
  bubbleAutoOpen: true,
  bubbleAutoCollapse: true,
  showVoiceCaptions: true,
};

function normalizeStoredAvatarShellSettings(value: unknown): StoredAvatarShellSettings {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as StoredAvatarShellSettings
    : {};
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
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
    bubbleAutoOpen: readBoolean(stored.bubbleAutoOpen, defaultAvatarShellSettings.bubbleAutoOpen),
    bubbleAutoCollapse: readBoolean(stored.bubbleAutoCollapse, defaultAvatarShellSettings.bubbleAutoCollapse),
    showVoiceCaptions: readBoolean(stored.showVoiceCaptions, defaultAvatarShellSettings.showVoiceCaptions),
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
