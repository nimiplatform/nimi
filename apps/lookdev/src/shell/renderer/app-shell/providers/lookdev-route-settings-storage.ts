import { loadStorageJsonFrom, saveStorageJsonTo } from '@nimiplatform/sdk/mod';

const LOOKDEV_ROUTE_SETTINGS_STORAGE_KEY = 'nimi:lookdev:route-settings.v1';

export type LookdevRouteSettingsSnapshot = {
  dialogueTargetKey: string;
  generationTargetKey: string;
  evaluationTargetKey: string;
};

type StoredLookdevRouteSettings = {
  version: 1;
  dialogueTargetKey?: string;
  generationTargetKey?: string;
  evaluationTargetKey?: string;
};

function resolveStorage(): Storage | undefined {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  if (typeof globalThis !== 'undefined') {
    return globalThis.localStorage as Storage | undefined;
  }
  return undefined;
}

function normalizeTargetKey(value: unknown): string {
  return String(value || '').trim();
}

function normalizeRouteSettings(value: unknown): LookdevRouteSettingsSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      dialogueTargetKey: '',
      generationTargetKey: '',
      evaluationTargetKey: '',
    };
  }
  const record = value as StoredLookdevRouteSettings;
  return {
    dialogueTargetKey: normalizeTargetKey(record.dialogueTargetKey),
    generationTargetKey: normalizeTargetKey(record.generationTargetKey),
    evaluationTargetKey: normalizeTargetKey(record.evaluationTargetKey),
  };
}

export function loadLookdevRouteSettings(): LookdevRouteSettingsSnapshot {
  const parsed = loadStorageJsonFrom(resolveStorage(), LOOKDEV_ROUTE_SETTINGS_STORAGE_KEY);
  return normalizeRouteSettings(parsed);
}

export function persistLookdevRouteSettings(snapshot: LookdevRouteSettingsSnapshot): void {
  saveStorageJsonTo(resolveStorage(), LOOKDEV_ROUTE_SETTINGS_STORAGE_KEY, {
    version: 1,
    dialogueTargetKey: normalizeTargetKey(snapshot.dialogueTargetKey),
    generationTargetKey: normalizeTargetKey(snapshot.generationTargetKey),
    evaluationTargetKey: normalizeTargetKey(snapshot.evaluationTargetKey),
  } satisfies StoredLookdevRouteSettings);
}

