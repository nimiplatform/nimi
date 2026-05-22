import type { AIScopeRef, AISnapshot } from '@nimiplatform/sdk/mod';
import { scopeKeyFromRef } from './desktop-ai-config-storage.js';

// ---------------------------------------------------------------------------
// Snapshot store — in-memory ring buffer (S-AICONF-005: host-local persistence)
// ---------------------------------------------------------------------------

const SNAPSHOT_RING_SIZE = 64;

export type SnapshotStore = {
  byExecutionId: Map<string, AISnapshot>;
  byScopeKey: Map<string, AISnapshot>; // latest per scope
  insertionOrder: string[]; // executionId ring for eviction
};

export function createSnapshotStore(): SnapshotStore {
  return {
    byExecutionId: new Map(),
    byScopeKey: new Map(),
    insertionOrder: [],
  };
}

function scopeKey(ref: AIScopeRef): string {
  return scopeKeyFromRef(ref);
}

export function storeSnapshot(store: SnapshotStore, snapshot: AISnapshot): void {
  if (store.insertionOrder.length >= SNAPSHOT_RING_SIZE) {
    const evictId = store.insertionOrder.shift()!;
    store.byExecutionId.delete(evictId);
  }
  store.byExecutionId.set(snapshot.executionId, snapshot);
  store.byScopeKey.set(scopeKey(snapshot.scopeRef), snapshot);
  store.insertionOrder.push(snapshot.executionId);
}
