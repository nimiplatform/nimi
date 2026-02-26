import { useCallback, useMemo } from 'react';
import { loadStorageJsonFrom, saveStorageJsonTo } from './local-storage';
import { useAppStore } from './ui';

export const RUNTIME_MOD_SETTINGS_STORAGE_KEY = 'nimi.runtime.mod-settings.v1';

export type RuntimeModSettingsMap = Record<string, Record<string, unknown>>;

type RuntimeModSettingsStoragePayload = {
  version: 1;
  byModId: RuntimeModSettingsMap;
};

type RuntimeModSettingsStoreShape = {
  runtimeModSettingsById?: RuntimeModSettingsMap;
  setRuntimeModSettings?: (modId: string, settings: Record<string, unknown>) => void;
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

function normalizeModId(value: unknown): string {
  return String(value || '').trim();
}

function normalizeModSettingsValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function normalizeRuntimeModSettingsMap(value: unknown): RuntimeModSettingsMap {
  const source = (() => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    const record = value as Record<string, unknown>;
    if (record.byModId && typeof record.byModId === 'object' && !Array.isArray(record.byModId)) {
      return record.byModId as Record<string, unknown>;
    }
    return record;
  })();

  const normalized: RuntimeModSettingsMap = {};
  for (const [rawModId, rawSettings] of Object.entries(source)) {
    const modId = normalizeModId(rawModId);
    if (!modId) continue;
    normalized[modId] = normalizeModSettingsValue(rawSettings);
  }
  return normalized;
}

export function loadRuntimeModSettingsMap(): RuntimeModSettingsMap {
  const storage = resolveStorage();
  const parsed = loadStorageJsonFrom(storage, RUNTIME_MOD_SETTINGS_STORAGE_KEY);
  return normalizeRuntimeModSettingsMap(parsed);
}

export function persistRuntimeModSettingsMap(map: RuntimeModSettingsMap): void {
  const storage = resolveStorage();
  if (!storage) return;
  const payload: RuntimeModSettingsStoragePayload = {
    version: 1,
    byModId: normalizeRuntimeModSettingsMap(map),
  };
  saveStorageJsonTo(storage, RUNTIME_MOD_SETTINGS_STORAGE_KEY, payload);
}

export function readRuntimeModSettings(modId: string): Record<string, unknown> {
  const normalizedModId = normalizeModId(modId);
  if (!normalizedModId) return {};
  const map = loadRuntimeModSettingsMap();
  return map[normalizedModId] || {};
}

export function writeRuntimeModSettings(modId: string, settings: Record<string, unknown>): void {
  const normalizedModId = normalizeModId(modId);
  if (!normalizedModId) return;
  const map = loadRuntimeModSettingsMap();
  map[normalizedModId] = normalizeModSettingsValue(settings);
  persistRuntimeModSettingsMap(map);
}

export function removeRuntimeModSettings(modId: string): void {
  const normalizedModId = normalizeModId(modId);
  if (!normalizedModId) return;
  const map = loadRuntimeModSettingsMap();
  if (!Object.prototype.hasOwnProperty.call(map, normalizedModId)) {
    return;
  }
  delete map[normalizedModId];
  persistRuntimeModSettingsMap(map);
}

function identityNormalize<T extends Record<string, unknown>>(value: unknown, fallback: T): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback;
  }
  return value as T;
}

export function useRuntimeModSettings<T extends Record<string, unknown>>(input: {
  modId: string;
  defaults: T;
  normalize?: (value: unknown) => T;
}): {
  settings: T;
  setSettings: (settings: T) => void;
  updateSettings: (updater: Partial<T> | ((previous: T) => T)) => void;
} {
  const normalizedModId = useMemo(() => normalizeModId(input.modId), [input.modId]);
  const normalize = useMemo(
    () => input.normalize || ((value: unknown) => identityNormalize(value, input.defaults)),
    [input.defaults, input.normalize],
  );

  const runtimeModSettingsById = useAppStore((state) => (
    (state as RuntimeModSettingsStoreShape).runtimeModSettingsById || {}
  ));
  const setRuntimeModSettings = useAppStore((state) => (
    (state as RuntimeModSettingsStoreShape).setRuntimeModSettings
  ));

  const settings = useMemo(() => {
    if (!normalizedModId) {
      return normalize(input.defaults);
    }
    const runtimeValue = runtimeModSettingsById[normalizedModId];
    const fallbackValue = runtimeValue ?? readRuntimeModSettings(normalizedModId);
    return normalize(fallbackValue);
  }, [input.defaults, normalize, normalizedModId, runtimeModSettingsById]);

  const setSettings = useCallback((nextSettings: T) => {
    if (!normalizedModId) return;
    if (typeof setRuntimeModSettings === 'function') {
      setRuntimeModSettings(normalizedModId, nextSettings);
      return;
    }
    writeRuntimeModSettings(normalizedModId, nextSettings);
  }, [normalizedModId, setRuntimeModSettings]);

  const updateSettings = useCallback((updater: Partial<T> | ((previous: T) => T)) => {
    const nextSettings = typeof updater === 'function'
      ? (updater as (previous: T) => T)(settings)
      : ({ ...settings, ...updater } as T);
    setSettings(nextSettings);
  }, [setSettings, settings]);

  return {
    settings,
    setSettings,
    updateSettings,
  };
}
