import {
  createNimiAISnapshotStore,
  type NimiAIHostStorage,
  type NimiAISnapshotStore,
} from '@nimiplatform/sdk/ai';
import { resolveBrowserStorage } from '@nimiplatform/kit/core/storage-json';

const SNAPSHOT_INDEX_KEY = 'nimi.ai-snapshot.execution-index.v1';
const SNAPSHOT_EXECUTION_PREFIX = 'nimi.ai-snapshot.execution.';
const SNAPSHOT_EXECUTION_SUFFIX = '.v1';
const SNAPSHOT_RING_SIZE = 64;

function isStorageLike(value: unknown): value is NimiAIHostStorage {
  return Boolean(value)
    && typeof (value as NimiAIHostStorage).getItem === 'function'
    && typeof (value as NimiAIHostStorage).setItem === 'function';
}

function getStorage(): NimiAIHostStorage | null {
  const storage = resolveBrowserStorage('local');
  return isStorageLike(storage) ? storage : null;
}

function isNonBrowserSnapshotStoreHarness(): boolean {
  return typeof window === 'undefined';
}

function snapshotKeyForExecution(executionId: string): string {
  return `${SNAPSHOT_EXECUTION_PREFIX}${executionId}${SNAPSHOT_EXECUTION_SUFFIX}`;
}

export function createDesktopAISnapshotStore(): NimiAISnapshotStore {
  return createNimiAISnapshotStore({
    storage: () => getStorage(),
    indexKey: SNAPSHOT_INDEX_KEY,
    snapshotKeyForExecution,
    maxSnapshots: SNAPSHOT_RING_SIZE,
    enableEphemeralStore: isNonBrowserSnapshotStoreHarness(),
  });
}
