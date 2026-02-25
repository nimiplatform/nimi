import { useCallback, useMemo } from 'react';
import { loadStorageJsonFrom, saveStorageJsonTo } from './local-storage';
import { useAppStore } from './ui';
export const RUNTIME_MOD_SETTINGS_STORAGE_KEY = 'nimi.runtime.mod-settings.v1';
function resolveStorage() {
    if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage;
    }
    if (typeof globalThis !== 'undefined') {
        return globalThis.localStorage;
    }
    return undefined;
}
function normalizeModId(value) {
    return String(value || '').trim();
}
function normalizeModSettingsValue(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value;
}
export function normalizeRuntimeModSettingsMap(value) {
    const source = (() => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return {};
        }
        const record = value;
        if (record.byModId && typeof record.byModId === 'object' && !Array.isArray(record.byModId)) {
            return record.byModId;
        }
        return record;
    })();
    const normalized = {};
    for (const [rawModId, rawSettings] of Object.entries(source)) {
        const modId = normalizeModId(rawModId);
        if (!modId)
            continue;
        normalized[modId] = normalizeModSettingsValue(rawSettings);
    }
    return normalized;
}
export function loadRuntimeModSettingsMap() {
    const storage = resolveStorage();
    const parsed = loadStorageJsonFrom(storage, RUNTIME_MOD_SETTINGS_STORAGE_KEY);
    return normalizeRuntimeModSettingsMap(parsed);
}
export function persistRuntimeModSettingsMap(map) {
    const storage = resolveStorage();
    if (!storage)
        return;
    const payload = {
        version: 1,
        byModId: normalizeRuntimeModSettingsMap(map),
    };
    saveStorageJsonTo(storage, RUNTIME_MOD_SETTINGS_STORAGE_KEY, payload);
}
export function readRuntimeModSettings(modId) {
    const normalizedModId = normalizeModId(modId);
    if (!normalizedModId)
        return {};
    const map = loadRuntimeModSettingsMap();
    return map[normalizedModId] || {};
}
export function writeRuntimeModSettings(modId, settings) {
    const normalizedModId = normalizeModId(modId);
    if (!normalizedModId)
        return;
    const map = loadRuntimeModSettingsMap();
    map[normalizedModId] = normalizeModSettingsValue(settings);
    persistRuntimeModSettingsMap(map);
}
export function removeRuntimeModSettings(modId) {
    const normalizedModId = normalizeModId(modId);
    if (!normalizedModId)
        return;
    const map = loadRuntimeModSettingsMap();
    if (!Object.prototype.hasOwnProperty.call(map, normalizedModId)) {
        return;
    }
    delete map[normalizedModId];
    persistRuntimeModSettingsMap(map);
}
function identityNormalize(value, fallback) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return fallback;
    }
    return value;
}
export function useRuntimeModSettings(input) {
    const normalizedModId = useMemo(() => normalizeModId(input.modId), [input.modId]);
    const normalize = useMemo(() => input.normalize || ((value) => identityNormalize(value, input.defaults)), [input.defaults, input.normalize]);
    const runtimeModSettingsById = useAppStore((state) => (state.runtimeModSettingsById || {}));
    const setRuntimeModSettings = useAppStore((state) => (state.setRuntimeModSettings));
    const settings = useMemo(() => {
        if (!normalizedModId) {
            return normalize(input.defaults);
        }
        const runtimeValue = runtimeModSettingsById[normalizedModId];
        const fallbackValue = runtimeValue ?? readRuntimeModSettings(normalizedModId);
        return normalize(fallbackValue);
    }, [input.defaults, normalize, normalizedModId, runtimeModSettingsById]);
    const setSettings = useCallback((nextSettings) => {
        if (!normalizedModId)
            return;
        if (typeof setRuntimeModSettings === 'function') {
            setRuntimeModSettings(normalizedModId, nextSettings);
            return;
        }
        writeRuntimeModSettings(normalizedModId, nextSettings);
    }, [normalizedModId, setRuntimeModSettings]);
    const updateSettings = useCallback((updater) => {
        const nextSettings = typeof updater === 'function'
            ? updater(settings)
            : { ...settings, ...updater };
        setSettings(nextSettings);
    }, [setSettings, settings]);
    return {
        settings,
        setSettings,
        updateSettings,
    };
}
