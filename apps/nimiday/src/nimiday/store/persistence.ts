// Runtime-managed JSON storage for NimiDay (nimi-mediated-default policy).
// Each document stays well under the 256 KiB per-document limit: large
// collections are written as generation-numbered chunks behind an index, so
// an interrupted save leaves the previous generation readable.

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

const ROOT = 'nimiday/v1';
export const CHUNK_BUDGET_BYTES = 180 * 1024;
const encoder = new TextEncoder();

export function documentPath(name: string): string {
  return `${ROOT}/${name}.json`;
}

function chunkPath(name: string, generation: number, index: number): string {
  return `${ROOT}/${name}.g${generation}-${index}.json`;
}

type CollectionIndex = { readonly generation: number; readonly chunks: number };

function parseIndex(value: unknown): CollectionIndex | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const generation = record.generation;
  const chunks = record.chunks;
  if (typeof generation !== 'number' || !Number.isInteger(generation) || generation < 0) return null;
  if (typeof chunks !== 'number' || !Number.isInteger(chunks) || chunks < 0 || chunks > 64) return null;
  return { generation, chunks };
}

/** Split records into chunks whose serialized size stays under the budget. */
export function chunkRecords<T>(records: readonly T[], budget = CHUNK_BUDGET_BYTES): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let used = 2;
  for (const record of records) {
    const size = encoder.encode(JSON.stringify(record)).byteLength + 1;
    if (current.length > 0 && used + size > budget) {
      chunks.push(current);
      current = [];
      used = 2;
    }
    current.push(record);
    used += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export async function readCollection(store: JsonDocumentStore, name: string): Promise<unknown[] | undefined> {
  const index = parseIndex(await store.read(documentPath(`${name}.index`)));
  if (!index) return undefined;
  const records: unknown[] = [];
  for (let chunk = 0; chunk < index.chunks; chunk += 1) {
    const value = await store.read(chunkPath(name, index.generation, chunk));
    if (!Array.isArray(value)) throw new Error(`NimiDay ${name} chunk ${chunk} is missing or damaged.`);
    records.push(...value);
  }
  return records;
}

export async function writeCollection(
  store: JsonDocumentStore,
  name: string,
  records: readonly unknown[],
): Promise<void> {
  const previous = parseIndex(await store.read(documentPath(`${name}.index`)));
  const generation = (previous?.generation ?? 0) + 1;
  const chunks = chunkRecords(records);
  for (let chunk = 0; chunk < chunks.length; chunk += 1) {
    await store.write(chunkPath(name, generation, chunk), chunks[chunk]);
  }
  await store.write(documentPath(`${name}.index`), { generation, chunks: chunks.length });
  if (previous) {
    for (let chunk = 0; chunk < previous.chunks; chunk += 1) {
      await store.remove(chunkPath(name, previous.generation, chunk)).catch(() => undefined);
    }
  }
}
