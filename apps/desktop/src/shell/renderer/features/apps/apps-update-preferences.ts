import { DevicePreferenceProjectionError } from '../settings/settings-device-preferences.js';
import { canRequestCatalogUpdate } from './apps-card-actions.js';
import type { DesktopAppsEntry } from './apps-panel-projection.js';

// @nimi-authority: rule.nimi.desktop.shell-ui.r053

/**
 * Per-app update behavior, persisted on this device. `auto` never installs
 * silently: when a newer Registry version appears, Desktop starts the same
 * update flow a manual request would, and the standard confirmation dialog
 * still gates the install. `lastAutoPromptedVersion` records the newest
 * version that flow was started for so a canceled or failed attempt does not
 * re-prompt until an even newer version appears.
 */

export const APPS_UPDATE_PREFERENCES_STORAGE_KEY = 'nimi.apps.update-preferences.v1';

export const APP_UPDATE_POLICIES = ['manual', 'auto'] as const;
export type AppUpdatePolicy = (typeof APP_UPDATE_POLICIES)[number];

export interface AppUpdatePreference {
  readonly policy: AppUpdatePolicy;
  readonly lastAutoPromptedVersion: string | null;
}

export const DEFAULT_APP_UPDATE_PREFERENCE: AppUpdatePreference = Object.freeze({
  policy: 'manual',
  lastAutoPromptedVersion: null,
});

type AppsUpdatePreferenceMap = Readonly<Record<string, AppUpdatePreference>>;

const listeners = new Set<() => void>();

export function subscribeAppUpdatePreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyAppUpdatePreferencesChanged(): void {
  for (const listener of listeners) listener();
}

function defaultStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function projectAppUpdatePreference(payload: unknown): AppUpdatePreference {
  if (!payload || typeof payload !== 'object') return DEFAULT_APP_UPDATE_PREFERENCE;
  const record = payload as Record<string, unknown>;
  const policy = typeof record.policy === 'string'
    && (APP_UPDATE_POLICIES as readonly string[]).includes(record.policy)
    ? record.policy as AppUpdatePolicy
    : DEFAULT_APP_UPDATE_PREFERENCE.policy;
  return {
    policy,
    lastAutoPromptedVersion: typeof record.lastAutoPromptedVersion === 'string' && record.lastAutoPromptedVersion
      ? record.lastAutoPromptedVersion
      : null,
  };
}

function readPreferenceMap(storage: Storage): AppsUpdatePreferenceMap {
  const raw = storage.getItem(APPS_UPDATE_PREFERENCES_STORAGE_KEY);
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object') return {};
  const apps = (parsed as Record<string, unknown>).apps;
  if (!apps || typeof apps !== 'object') return {};
  const map: Record<string, AppUpdatePreference> = {};
  for (const [appId, payload] of Object.entries(apps as Record<string, unknown>)) {
    map[appId] = projectAppUpdatePreference(payload);
  }
  return map;
}

function writePreferenceMap(storage: Storage, map: AppsUpdatePreferenceMap): void {
  storage.setItem(APPS_UPDATE_PREFERENCES_STORAGE_KEY, JSON.stringify({ version: 1, apps: map }));
}

function requireStorage(storage: Storage | null): Storage {
  if (!storage) throw new DevicePreferenceProjectionError(APPS_UPDATE_PREFERENCES_STORAGE_KEY, 'localStorage unavailable');
  return storage;
}

export function readAppUpdatePreference(appId: string, storage: Storage | null = defaultStorage()): AppUpdatePreference {
  if (!storage) return DEFAULT_APP_UPDATE_PREFERENCE;
  return readPreferenceMap(storage)[appId] ?? DEFAULT_APP_UPDATE_PREFERENCE;
}

export function writeAppUpdatePolicy(
  appId: string,
  policy: AppUpdatePolicy,
  storage: Storage | null = defaultStorage(),
): AppUpdatePreference {
  const target = requireStorage(storage);
  const map = { ...readPreferenceMap(target) };
  const next: AppUpdatePreference = {
    policy,
    lastAutoPromptedVersion: map[appId]?.lastAutoPromptedVersion ?? null,
  };
  map[appId] = next;
  writePreferenceMap(target, map);
  notifyAppUpdatePreferencesChanged();
  return next;
}

export function markAppUpdateAutoPrompted(
  appId: string,
  version: string,
  storage: Storage | null = defaultStorage(),
): void {
  const target = requireStorage(storage);
  const map = { ...readPreferenceMap(target) };
  const current = map[appId] ?? DEFAULT_APP_UPDATE_PREFERENCE;
  map[appId] = { ...current, lastAutoPromptedVersion: version };
  writePreferenceMap(target, map);
}

export interface AppUpdateAutoPromptCandidate {
  readonly entryKey: string;
  readonly appId: string;
  readonly version: string;
}

/** First installed entry whose `auto` policy has an unprompted newer Registry version. */
export function planAppUpdateAutoPrompt(
  entries: readonly DesktopAppsEntry[],
  read: (appId: string) => AppUpdatePreference = readAppUpdatePreference,
): AppUpdateAutoPromptCandidate | null {
  for (const entry of entries) {
    const preference = read(entry.identity.appId);
    if (preference.policy !== 'auto') continue;
    const version = entry.catalogTarget?.version;
    if (!version || preference.lastAutoPromptedVersion === version) continue;
    if (!canRequestCatalogUpdate(entry)) continue;
    return { entryKey: entry.identity.entryKey, appId: entry.identity.appId, version };
  }
  return null;
}
