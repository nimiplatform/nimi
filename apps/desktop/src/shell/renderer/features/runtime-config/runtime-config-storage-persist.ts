import {
  readStorageJsonFrom,
  resolveBrowserStorage,
  writeStorageJsonTo,
} from '@nimiplatform/kit/core/storage-json';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';
import {
  RUNTIME_CONFIG_STORAGE_KEY_V13,
  createDefaultStateV11,
  type StoredStateV11,
} from './runtime-config-storage-defaults';
import { normalizeStoredStateV11 } from './runtime-config-storage-normalize';

export function loadRuntimeConfigStateV11(): RuntimeConfigStateV11 {
  const storage = resolveBrowserStorage('local');
  const stored = readStorageJsonFrom<StoredStateV11>(storage, RUNTIME_CONFIG_STORAGE_KEY_V13);
  if (stored.state === 'ready' && stored.value && typeof stored.value === 'object') {
    const parsed = stored.value;
    if (parsed.version === 13) return normalizeStoredStateV11(parsed);
  }
  return createDefaultStateV11();
}

export function persistRuntimeConfigStateV11(state: RuntimeConfigStateV11): void {
  // Connectors are NOT persisted to localStorage; neither are Runtime endpoint or inventory.
  // Runtime bridge config / Runtime SDK projections are the single source of
  // truth. Renderer storage keeps UI preferences only.
  const payload: StoredStateV11 = {
    version: 13,
    initializedByV11: Boolean(state.initializedByV11),
    activePage: state.activePage,
    actionFocus: state.actionFocus,
    diagnosticsCollapsed: Boolean(state.diagnosticsCollapsed),
    uiMode: state.uiMode,
    selectedSource: state.selectedSource,
    local: {
      status: 'idle',
      lastCheckedAt: null,
      lastDetail: '',
    },
  };
  writeStorageJsonTo(
    resolveBrowserStorage('local'),
    RUNTIME_CONFIG_STORAGE_KEY_V13,
    payload,
  );
}

export function setInitializedByV11(state: RuntimeConfigStateV11): RuntimeConfigStateV11 {
  return {
    ...state,
    initializedByV11: true,
  };
}
