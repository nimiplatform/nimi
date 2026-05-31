import { readStorageJsonFrom, writeStorageJsonTo } from '@nimiplatform/kit/core/storage-json';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';
import {
  RUNTIME_CONFIG_STORAGE_KEY_V11,
  RUNTIME_CONFIG_STORAGE_KEY_V12,
  createDefaultStateV11,
  type StoredStateV11,
} from './runtime-config-storage-defaults';
import { normalizeStoredStateV11 } from './runtime-config-storage-normalize';

export function loadRuntimeConfigStateV11(): RuntimeConfigStateV11 {
  const storage = typeof globalThis !== 'undefined' ? (globalThis.localStorage as Storage | undefined) : undefined;
  const v12 = readStorageJsonFrom<StoredStateV11>(storage, RUNTIME_CONFIG_STORAGE_KEY_V12);
  const v11 = v12.state === 'ready'
    ? v12
    : readStorageJsonFrom<StoredStateV11>(storage, RUNTIME_CONFIG_STORAGE_KEY_V11);
  if (v11.state === 'ready' && v11.value && typeof v11.value === 'object') {
    const parsed = v11.value;
    if (parsed.version === 11 || parsed.version === 12) {
      return normalizeStoredStateV11(parsed);
    }
  }
  return createDefaultStateV11();
}

export function persistRuntimeConfigStateV11(state: RuntimeConfigStateV11): void {
  // Connectors are NOT persisted to localStorage — runtime bridge config (config.json)
  // is the single source of truth for provider/connector data. Local model
  // inventory is also runtime-derived and must not be persisted here.
  const payload: StoredStateV11 = {
    version: 12,
    initializedByV11: Boolean(state.initializedByV11),
    activePage: state.activePage,
    diagnosticsCollapsed: Boolean(state.diagnosticsCollapsed),
    uiMode: state.uiMode,
    selectedSource: state.selectedSource,
    activeCapability: state.activeCapability,
    local: {
      ...state.local,
      models: [],
      nodeMatrix: [],
      status: 'idle',
      lastCheckedAt: null,
      lastDetail: '',
    },
  };
  writeStorageJsonTo(
    typeof globalThis !== 'undefined' ? (globalThis.localStorage as Storage | undefined) : undefined,
    RUNTIME_CONFIG_STORAGE_KEY_V12,
    payload,
  );
}

export function setInitializedByV11(state: RuntimeConfigStateV11): RuntimeConfigStateV11 {
  return {
    ...state,
    initializedByV11: true,
  };
}
