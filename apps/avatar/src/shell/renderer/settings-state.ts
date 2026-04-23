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

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readStoredValue(): StoredAvatarShellSettings | null {
  if (!hasStorage()) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(AVATAR_SHELL_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed as StoredAvatarShellSettings;
  } catch {
    return null;
  }
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function readAvatarShellSettings(): AvatarShellSettings {
  const stored = readStoredValue();
  if (!stored) {
    return { ...defaultAvatarShellSettings };
  }
  return {
    alwaysOnTop: readBoolean(stored.alwaysOnTop, defaultAvatarShellSettings.alwaysOnTop),
    bubbleAutoOpen: readBoolean(stored.bubbleAutoOpen, defaultAvatarShellSettings.bubbleAutoOpen),
    bubbleAutoCollapse: readBoolean(stored.bubbleAutoCollapse, defaultAvatarShellSettings.bubbleAutoCollapse),
    showVoiceCaptions: readBoolean(stored.showVoiceCaptions, defaultAvatarShellSettings.showVoiceCaptions),
  };
}

export function writeAvatarShellSettings(settings: AvatarShellSettings): void {
  if (!hasStorage()) {
    return;
  }
  try {
    window.localStorage.setItem(AVATAR_SHELL_SETTINGS_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      ...settings,
    }));
  } catch {
    // Ignore local persistence failures; shell behavior still updates in-memory.
  }
}
