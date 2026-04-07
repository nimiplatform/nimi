import * as React from 'react';
import type { JsonObject } from '../internal/utils.js';
import { loadStorageJsonFrom, saveStorageJsonTo } from './local-storage.js';
import { setModSdkRuntimeModSettings, useModSdkRuntimeModSettings } from './internal/settings-access.js';

export const RUNTIME_MOD_SETTINGS_STORAGE_KEY = 'nimi.runtime.mod-settings.v1';

export type RuntimeModSettingsMap = Record<string, JsonObject>;

type RuntimeModSettingsStoragePayload = {
  version: 1;
  byModId: RuntimeModSettingsMap;
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

function normalizeModSettingsValue(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as JsonObject;
}

export function normalizeRuntimeModSettingsMap(value: unknown): RuntimeModSettingsMap {
  const source = (() => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    const record = value as JsonObject;
    if (record.byModId && typeof record.byModId === 'object' && !Array.isArray(record.byModId)) {
      return record.byModId as Record<string, JsonObject>;
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

export function readRuntimeModSettings(modId: string): JsonObject {
  const normalizedModId = normalizeModId(modId);
  if (!normalizedModId) return {};
  const map = loadRuntimeModSettingsMap();
  return map[normalizedModId] || {};
}

export function writeRuntimeModSettings(modId: string, settings: JsonObject): void {
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

function identityNormalize<T extends JsonObject>(value: unknown, fallback: T): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback;
  }
  return value as T;
}

export function useRuntimeModSettings<T extends JsonObject>(input: {
  modId: string;
  defaults: T;
  normalize?: (value: unknown) => T;
}): {
  settings: T;
  setSettings: (settings: T) => void;
  updateSettings: (updater: Partial<T> | ((previous: T) => T)) => void;
} {
  const normalizedModId = React.useMemo(() => normalizeModId(input.modId), [input.modId]);
  const normalize = React.useMemo(
    () => input.normalize || ((value: unknown) => identityNormalize(value, input.defaults)),
    [input.defaults, input.normalize],
  );

  const runtimeModSettings = useModSdkRuntimeModSettings(normalizedModId);

  const settings = React.useMemo(() => {
    if (!normalizedModId) {
      return normalize(input.defaults);
    }
    const runtimeValue = runtimeModSettings;
    const fallbackValue = runtimeValue ?? readRuntimeModSettings(normalizedModId);
    return normalize(fallbackValue);
  }, [input.defaults, normalize, normalizedModId, runtimeModSettings]);

  const setSettings = React.useCallback((nextSettings: T) => {
    if (!normalizedModId) return;
    setModSdkRuntimeModSettings(normalizedModId, nextSettings);
  }, [normalizedModId]);

  const updateSettings = React.useCallback((updater: Partial<T> | ((previous: T) => T)) => {
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
