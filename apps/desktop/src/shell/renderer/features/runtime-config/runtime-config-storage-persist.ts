import type { RuntimeConfigStateV11 } from './runtime-config-state-types';
import {
  RUNTIME_CONFIG_STORAGE_KEY_V11,
  RUNTIME_CONFIG_STORAGE_KEY_V12,
  createDefaultStateV11,
  type RuntimeConfigSeedV11,
  type StoredStateV11,
} from './runtime-config-storage-defaults';
import { normalizeStoredStateV11 } from './runtime-config-storage-normalize';
import { loadStorageJsonFrom, saveStorageJsonTo } from "@nimiplatform/sdk/mod";
export function loadRuntimeConfigStateV11(seed: RuntimeConfigSeedV11): RuntimeConfigStateV11 {
    const storage = typeof globalThis !== 'undefined' ? (globalThis.localStorage as Storage | undefined) : undefined;
    const parsedUnknown = loadStorageJsonFrom(storage, RUNTIME_CONFIG_STORAGE_KEY_V12)
        || loadStorageJsonFrom(storage, RUNTIME_CONFIG_STORAGE_KEY_V11);
    if (parsedUnknown && typeof parsedUnknown === 'object') {
        const parsed = parsedUnknown as StoredStateV11;
        if (parsed.version === 11 || parsed.version === 12) {
            return normalizeStoredStateV11(seed, parsed);
        }
    }
    return createDefaultStateV11(seed);
}
export function persistRuntimeConfigStateV11(state: RuntimeConfigStateV11): void {
    // Connectors are NOT persisted to localStorage — runtime bridge config (config.json)
    // is the single source of truth for provider/connector data.
    const payload: StoredStateV11 = {
        version: 12,
        initializedByV11: Boolean(state.initializedByV11),
        activePage: state.activePage,
        diagnosticsCollapsed: Boolean(state.diagnosticsCollapsed),
        uiMode: state.uiMode,
        selectedSource: state.selectedSource,
        activeCapability: state.activeCapability,
        local: state.local,
    };
    saveStorageJsonTo(typeof globalThis !== 'undefined' ? (globalThis.localStorage as Storage | undefined) : undefined, RUNTIME_CONFIG_STORAGE_KEY_V12, payload);
}
export function setInitializedByV11(state: RuntimeConfigStateV11): RuntimeConfigStateV11 {
    return {
        ...state,
        initializedByV11: true,
    };
}
