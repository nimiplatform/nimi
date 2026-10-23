// NimiDay's document adapter and request preflight. Runtime owns actual
// canonical JSON admission and quota; collection transactions are App-owned.

export type JsonDocumentStore = {
  /** Resolves `undefined` when the document does not exist. */
  readonly read: (path: string) => Promise<unknown>;
  readonly write: (path: string, value: unknown) => Promise<void>;
  readonly remove: (path: string) => Promise<void>;
};

type StorageClientLike = {
  readonly readJson: (path: string) => Promise<{ readonly value: unknown }>;
  readonly writeJson: (path: string, value: never) => Promise<unknown>;
  readonly removeJson: (path: string) => Promise<unknown>;
};

export function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { reasonCode?: unknown; code?: unknown };
  return record.reasonCode === 'not-found' || record.code === 'not-found'
    || record.reasonCode === 'APP_STORAGE_ENTRY_NOT_FOUND';
}

export function runtimeDocumentStore(storage: StorageClientLike): JsonDocumentStore {
  return {
    read: async (path) => {
      try {
        return (await storage.readJson(path)).value;
      } catch (error) {
        if (isNotFound(error)) return undefined;
        throw error;
      }
    },
    write: async (path, value) => {
      await storage.writeJson(path, value as never);
    },
    remove: async (path) => {
      try {
        await storage.removeJson(path);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    },
  };
}

export const DOCUMENT_ROOT = 'nimiday/v1';
export const CHUNK_BUDGET_BYTES = 180 * 1024;
// @nimi-authority: rule.nimi.runtime.app-surface.r043
// Preflight the encoded request; Runtime still owns canonicalization and quota admission.
export const MAX_DOCUMENT_BYTES = 256 * 1024;
const encoder = new TextEncoder();

export type PersistenceFailureKind = 'capacity' | 'invalid-data' | 'temporary' | 'uncertain' | 'closed';
export class CollectionPersistenceError extends Error {
  readonly kind: PersistenceFailureKind;
  constructor(message: string, kind: PersistenceFailureKind) {
    super(message);
    this.name = 'CollectionPersistenceError';
    this.kind = kind;
  }
}

export function documentPath(name: string): string {
  return `${DOCUMENT_ROOT}/${name}.json`;
}

/** Target the chunk budget; an indivisible record may use the remaining document capacity. */
export function chunkRecords<T>(records: readonly T[], budget = CHUNK_BUDGET_BYTES): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let used = 2;
  for (const record of records) {
    let serialized: string | undefined;
    try { serialized = JSON.stringify(record); } catch { /* refuse non-JSON records before I/O */ }
    if (serialized === undefined) throw new CollectionPersistenceError('NimiDay cannot save a record without a JSON value.', 'invalid-data');
    const size = encoder.encode(serialized).byteLength;
    if (size + 2 > MAX_DOCUMENT_BYTES) throw new CollectionPersistenceError('A NimiDay record is too large to save. Shorten it and save again.', 'capacity');
    if (current.length > 0 && used + 1 + size > Math.min(budget, MAX_DOCUMENT_BYTES)) {
      chunks.push(current);
      current = [];
      used = 2;
    }
    used += size + (current.length > 0 ? 1 : 0);
    current.push(record);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export function persistenceReason(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const record = error as { reasonCode?: unknown; code?: unknown };
  return String(record.reasonCode ?? record.code ?? '').replaceAll('-', '_').toUpperCase();
}

export function assertDocument(value: unknown): void {
  let text: string | undefined;
  try { text = JSON.stringify(value); } catch { /* invalid JSON */ }
  if (text === undefined) throw new CollectionPersistenceError('NimiDay cannot save a record without a JSON value.', 'invalid-data');
  if (encoder.encode(text).byteLength > MAX_DOCUMENT_BYTES) throw new CollectionPersistenceError('A NimiDay record is too large to save. Shorten it and save again.', 'capacity');
}
