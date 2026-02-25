import { loadStorageJsonFrom, saveStorageJsonTo } from '@nimiplatform/mod-sdk/utils';
import {
  loadRuntimeModSettingsMap,
  persistRuntimeModSettingsMap,
  type RuntimeModSettingsMap,
} from '@nimiplatform/mod-sdk/settings';

export const RUNTIME_MOD_LIFECYCLE_STORAGE_KEY = 'nimi.runtime.mod-lifecycle.v1';

export type RuntimeModLifecycleState = {
  disabledModIds: string[];
  uninstalledModIds: string[];
};

function resolveStorage(): Storage | undefined {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  if (typeof globalThis === 'undefined') return undefined;
  return globalThis.localStorage as Storage | undefined;
}

function normalizeModIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const deduped = new Set<string>();
  for (const item of value) {
    const modId = String(item || '').trim();
    if (!modId) continue;
    deduped.add(modId);
  }
  return Array.from(deduped.values()).sort();
}

function normalizeLifecycleState(value: unknown): RuntimeModLifecycleState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      disabledModIds: [],
      uninstalledModIds: [],
    };
  }
  const record = value as Record<string, unknown>;
  return {
    disabledModIds: normalizeModIds(record.disabledModIds),
    uninstalledModIds: normalizeModIds(record.uninstalledModIds),
  };
}

export function loadRuntimeModLifecycleState(): RuntimeModLifecycleState {
  const parsed = loadStorageJsonFrom(resolveStorage(), RUNTIME_MOD_LIFECYCLE_STORAGE_KEY);
  return normalizeLifecycleState(parsed);
}

export function persistRuntimeModLifecycleState(state: RuntimeModLifecycleState): void {
  saveStorageJsonTo(resolveStorage(), RUNTIME_MOD_LIFECYCLE_STORAGE_KEY, {
    version: 1,
    disabledModIds: normalizeModIds(state.disabledModIds),
    uninstalledModIds: normalizeModIds(state.uninstalledModIds),
  });
}

export function loadRuntimeModSettingsState(): RuntimeModSettingsMap {
  return loadRuntimeModSettingsMap();
}

export function persistRuntimeModSettingsState(settingsById: RuntimeModSettingsMap): void {
  persistRuntimeModSettingsMap(settingsById);
}
