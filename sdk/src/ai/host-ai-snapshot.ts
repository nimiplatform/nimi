import {
  areAIScopeRefsEqual,
  encodeAIScopeRefKey,
  type AIScopeRef,
} from '../scope/ai-scope.js';
import type { AISnapshot } from './ai-config.js';
import type { AIConfigStorageLike } from './host-ai-config.js';

export type ScopedAISnapshotStoreOptions = {
  readonly storage: () => AIConfigStorageLike | null | undefined;
  readonly indexKey?: string;
  readonly snapshotKeyForExecution?: (executionId: string) => string;
  readonly maxSnapshots?: number;
  readonly enableEphemeralStore?: boolean;
};

export type ScopedAISnapshotStore = {
  readonly record: (snapshot: AISnapshot) => AISnapshot;
  readonly get: (executionId: string) => AISnapshot | null;
  readonly getLatest: (scopeRef: AIScopeRef) => AISnapshot | null;
  readonly listExecutionIds: () => string[];
};

const DEFAULT_MAX_SNAPSHOTS = 64;

function normalizeExecutionId(value: unknown): string {
  return String(value || '').trim();
}

function cloneSnapshot(snapshot: AISnapshot): AISnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as AISnapshot;
}

function parseStorageJson(raw: string | null): unknown {
  if (!raw) {
    return null;
  }
  return JSON.parse(raw);
}

function writeStorageJson(storage: AIConfigStorageLike, key: string, value: unknown): void {
  storage.setItem(key, JSON.stringify(value));
}

function readStringList(storage: AIConfigStorageLike, key: string): string[] {
  const parsed = parseStorageJson(storage.getItem(key));
  return Array.isArray(parsed)
    ? parsed.map((item) => normalizeExecutionId(item)).filter(Boolean)
    : [];
}

function parseScopeRef(raw: unknown): AIScopeRef | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const kind = String(record.kind || '').trim();
  const ownerId = String(record.ownerId || '').trim();
  if (!kind || !ownerId) {
    return null;
  }
  const surfaceId = record.surfaceId === undefined
    ? undefined
    : String(record.surfaceId || '').trim();
  return surfaceId
    ? { kind: kind as AIScopeRef['kind'], ownerId, surfaceId }
    : { kind: kind as AIScopeRef['kind'], ownerId };
}

function validateSnapshotShape(snapshot: AISnapshot): void {
  const executionId = normalizeExecutionId(snapshot.executionId);
  if (!executionId) {
    throw new Error('AISnapshot executionId is required.');
  }
  if (!parseScopeRef(snapshot.scopeRef)) {
    throw new Error('AISnapshot scopeRef is invalid.');
  }
  if (!snapshot.configEvidence || typeof snapshot.configEvidence !== 'object') {
    throw new Error('AISnapshot configEvidence is required.');
  }
  if (!snapshot.configEvidence.configSnapshot) {
    throw new Error('AISnapshot configEvidence.configSnapshot is required.');
  }
  if (!areAIScopeRefsEqual(snapshot.scopeRef, snapshot.configEvidence.configSnapshot.scopeRef)) {
    throw new Error('AISnapshot scopeRef must match configEvidence.configSnapshot.scopeRef.');
  }
  if (
    !snapshot.conversationCapabilitySlice
    || typeof snapshot.conversationCapabilitySlice !== 'object'
  ) {
    throw new Error('AISnapshot conversationCapabilitySlice is required.');
  }
  if (normalizeExecutionId(snapshot.conversationCapabilitySlice.executionId) !== executionId) {
    throw new Error('AISnapshot conversationCapabilitySlice.executionId must match executionId.');
  }
}

function parseAISnapshot(raw: unknown, executionId?: string): AISnapshot {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('AISnapshot schema is invalid.');
  }
  const snapshot = raw as AISnapshot;
  if (executionId && normalizeExecutionId(snapshot.executionId) !== executionId) {
    throw new Error('AISnapshot executionId does not match storage key.');
  }
  validateSnapshotShape(snapshot);
  return cloneSnapshot(snapshot);
}

function createDefaultSnapshotKeyForExecution(executionId: string): string {
  return `nimi.ai-snapshot.execution.${executionId}.v1`;
}

export function createScopedAISnapshotStore(
  options: ScopedAISnapshotStoreOptions,
): ScopedAISnapshotStore {
  const indexKey = options.indexKey || 'nimi.ai-snapshot.execution-index.v1';
  const snapshotKeyForExecution =
    options.snapshotKeyForExecution || createDefaultSnapshotKeyForExecution;
  const maxSnapshots = Math.max(
    1,
    Math.floor(Number(options.maxSnapshots || DEFAULT_MAX_SNAPSHOTS)),
  );
  const ephemeralSnapshots = new Map<string, AISnapshot>();
  const ephemeralExecutionIds: string[] = [];

  const getStorage = () => options.storage() || null;
  const requireStorageOrEphemeralStore = (
    operation: 'record' | 'get' | 'getLatest' | 'listExecutionIds',
  ): AIConfigStorageLike | null => {
    const storage = getStorage();
    if (storage) {
      return storage;
    }
    if (options.enableEphemeralStore === true) {
      return null;
    }
    throw new Error(
      `AISnapshot store ${operation} requires host storage or explicit enableEphemeralStore=true`,
    );
  };

  const trimExecutionIds = (ids: string[]): string[] => {
    const deduped = [...new Set(ids.map(normalizeExecutionId).filter(Boolean))];
    return deduped.slice(Math.max(0, deduped.length - maxSnapshots));
  };

  const readSnapshot = (storage: AIConfigStorageLike, executionId: string): AISnapshot | null => {
    const ids = readStringList(storage, indexKey);
    if (!ids.includes(executionId)) {
      return null;
    }
    const parsed = parseStorageJson(storage.getItem(snapshotKeyForExecution(executionId)));
    if (!parsed) {
      throw new Error(`AISnapshot ${executionId} is missing from host storage.`);
    }
    return parseAISnapshot(parsed, executionId);
  };

  return {
    record(snapshot: AISnapshot): AISnapshot {
      const normalized = parseAISnapshot(snapshot);
      const executionId = normalized.executionId;
      const storage = requireStorageOrEphemeralStore('record');
      if (storage) {
        const ids = trimExecutionIds([
          ...readStringList(storage, indexKey).filter((id) => id !== executionId),
          executionId,
        ]);
        writeStorageJson(storage, snapshotKeyForExecution(executionId), normalized);
        writeStorageJson(storage, indexKey, ids);
      } else {
        const existingIndex = ephemeralExecutionIds.indexOf(executionId);
        if (existingIndex >= 0) {
          ephemeralExecutionIds.splice(existingIndex, 1);
        }
        ephemeralExecutionIds.push(executionId);
        while (ephemeralExecutionIds.length > maxSnapshots) {
          const evictedId = ephemeralExecutionIds.shift();
          if (evictedId) {
            ephemeralSnapshots.delete(evictedId);
          }
        }
        ephemeralSnapshots.set(executionId, normalized);
      }
      return cloneSnapshot(normalized);
    },
    get(executionId: string): AISnapshot | null {
      const normalizedExecutionId = normalizeExecutionId(executionId);
      if (!normalizedExecutionId) {
        return null;
      }
      const storage = requireStorageOrEphemeralStore('get');
      if (storage) {
        return readSnapshot(storage, normalizedExecutionId);
      }
      const snapshot = ephemeralSnapshots.get(normalizedExecutionId);
      return snapshot ? cloneSnapshot(snapshot) : null;
    },
    getLatest(scopeRef: AIScopeRef): AISnapshot | null {
      const storage = requireStorageOrEphemeralStore('getLatest');
      const targetScopeKey = encodeAIScopeRefKey(scopeRef);
      const ids = storage
        ? readStringList(storage, indexKey)
        : [...ephemeralExecutionIds];
      for (const executionId of ids.slice().reverse()) {
        const snapshot = storage
          ? readSnapshot(storage, executionId)
          : ephemeralSnapshots.get(executionId) || null;
        if (snapshot && encodeAIScopeRefKey(snapshot.scopeRef) === targetScopeKey) {
          return cloneSnapshot(snapshot);
        }
      }
      return null;
    },
    listExecutionIds(): string[] {
      const storage = requireStorageOrEphemeralStore('listExecutionIds');
      return storage ? readStringList(storage, indexKey) : [...ephemeralExecutionIds];
    },
  };
}
