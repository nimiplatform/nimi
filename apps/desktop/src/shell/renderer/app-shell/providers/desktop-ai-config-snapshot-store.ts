import {
  createScopedAISnapshotStore,
  type AIConfigStorageLike,
  type ScopedAISnapshotStore,
} from '@nimiplatform/sdk/ai';
import { resolveBrowserStorage } from '@nimiplatform/kit/core/storage-json';

const SNAPSHOT_INDEX_KEY = 'nimi.ai-snapshot.execution-index.v1';
const SNAPSHOT_EXECUTION_PREFIX = 'nimi.ai-snapshot.execution.';
const SNAPSHOT_EXECUTION_SUFFIX = '.v1';
const SNAPSHOT_RING_SIZE = 64;

function getStorage(): Storage | null {
  return resolveBrowserStorage('local');
}

function isNonBrowserSnapshotStoreHarness(): boolean {
  return typeof window === 'undefined';
}

function snapshotKeyForExecution(executionId: string): string {
  return `${SNAPSHOT_EXECUTION_PREFIX}${executionId}${SNAPSHOT_EXECUTION_SUFFIX}`;
}

export function createDesktopAISnapshotStore(): ScopedAISnapshotStore {
  return createScopedAISnapshotStore({
    storage: () => getStorage() as AIConfigStorageLike | null,
    indexKey: SNAPSHOT_INDEX_KEY,
    snapshotKeyForExecution,
    maxSnapshots: SNAPSHOT_RING_SIZE,
    enableEphemeralStore: isNonBrowserSnapshotStoreHarness(),
  });
}
