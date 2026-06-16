import {
  readStorageJsonFrom,
  resolveBrowserStorage,
  writeStorageJsonTo,
} from '@nimiplatform/kit/core/storage-json';

export const AVATAR_SCALE_STORAGE_KEY = 'nimi.avatar.instance-scale.v1';
export const AVATAR_SCALE_DEFAULT = 1;
export const AVATAR_SCALE_MIN = 0.6;
export const AVATAR_SCALE_MAX = 1.8;
export const AVATAR_SCALE_WHEEL_STEP = 0.05;

type StoredAvatarScales = {
  schemaVersion?: number;
  scales?: Record<string, unknown>;
};

function normalizeStoredAvatarScales(value: unknown): StoredAvatarScales {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as StoredAvatarScales
    : {};
}

export function clampAvatarScale(value: number): number {
  if (!Number.isFinite(value)) return AVATAR_SCALE_DEFAULT;
  const clamped = Math.max(AVATAR_SCALE_MIN, Math.min(value, AVATAR_SCALE_MAX));
  return Math.round(clamped * 100) / 100;
}

export function scaleStorageKeyForAvatarInstance(input: {
  avatarInstanceId: string | null;
  fixtureId: string | null;
}): string {
  const avatarInstanceId = normalizeKeyPart(input.avatarInstanceId);
  if (avatarInstanceId) return `avatar:${avatarInstanceId}`;
  const fixtureId = normalizeKeyPart(input.fixtureId);
  if (fixtureId) return `fixture:${fixtureId}`;
  return 'dev:anonymous-avatar';
}

export function readAvatarInstanceScale(scaleKey: string): number {
  const result = readStorageJsonFrom(
    resolveBrowserStorage('local'),
    AVATAR_SCALE_STORAGE_KEY,
    normalizeStoredAvatarScales,
  );
  if (result.state !== 'ready') return AVATAR_SCALE_DEFAULT;
  const value = result.value.scales?.[scaleKey];
  return typeof value === 'number' ? clampAvatarScale(value) : AVATAR_SCALE_DEFAULT;
}

export function writeAvatarInstanceScale(scaleKey: string, scale: number): void {
  const stored = readStoredScaleMap();
  stored[scaleKey] = clampAvatarScale(scale);
  writeStorageJsonTo(
    resolveBrowserStorage('local'),
    AVATAR_SCALE_STORAGE_KEY,
    {
      schemaVersion: 1,
      scales: stored,
    },
  );
}

export function resetAvatarInstanceScale(scaleKey: string): void {
  const stored = readStoredScaleMap();
  delete stored[scaleKey];
  writeStorageJsonTo(
    resolveBrowserStorage('local'),
    AVATAR_SCALE_STORAGE_KEY,
    {
      schemaVersion: 1,
      scales: stored,
    },
  );
}

function readStoredScaleMap(): Record<string, number> {
  const result = readStorageJsonFrom(
    resolveBrowserStorage('local'),
    AVATAR_SCALE_STORAGE_KEY,
    normalizeStoredAvatarScales,
  );
  if (result.state !== 'ready') return {};
  const source = result.value.scales ?? {};
  const next: Record<string, number> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== 'number') continue;
    next[key] = clampAvatarScale(value);
  }
  return next;
}

function normalizeKeyPart(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
