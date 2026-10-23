import { assertDocument, CollectionPersistenceError, documentPath, persistenceReason, type JsonDocumentStore } from './json-documents.js';
import { parseCollectionIndex, planCollectionChunks, recordKey, type CollectionChunk, type CollectionIndex, type CollectionName } from './collection-layout.js';

export type Maintenance = { readonly cleanupPending: boolean; readonly recoveryRequired: boolean; readonly recoveryPending: boolean };
export type CollectionRead = Maintenance & { readonly records: unknown[] | undefined };
export type DayPersistence = JsonDocumentStore & {
  readonly readCollection: (name: CollectionName) => Promise<CollectionRead>;
  readonly writeCollection: (name: CollectionName, records: readonly unknown[]) => Promise<Maintenance>;
  readonly maintain: () => Promise<Maintenance>;
  readonly status: () => Maintenance;
  readonly close: () => void;
};
type CollectionState = { index: CollectionIndex | undefined; chunks: readonly CollectionChunk[] };
// Include the actual native carrier projection, not just Runtime wire reasons.
const DEFINITE_REFUSALS = new Set(['RESOURCE_EXHAUSTED', 'INVALID_PATH', 'INVALID_PAYLOAD', 'APP_STORAGE_QUOTA_EXCEEDED', 'APP_STORAGE_PATH_INVALID', 'PROTOCOL_ENVELOPE_INVALID', 'LOCAL_APP_ACCESS_DENIED', 'LOCAL_APP_OPERATION_UNAVAILABLE']);
const CLOSED_SCOPES = new Set(['ACCOUNT_CHANGED', 'RUNTIME_UNAUTHENTICATED', 'PROCESS_REPLACED', 'RUNTIME_RESTARTED', 'REVOKED', 'PROJECT_CHANGED', 'LOCAL_APP_SNAPSHOT_UNAVAILABLE', 'LOCAL_APP_SESSION_REVOKED', 'LOCAL_APP_ACCOUNT_CHANGED', 'SESSION_INVALID']);
function uncertain(): CollectionPersistenceError {
  return new CollectionPersistenceError('The save result cannot be confirmed. Preserve unsaved content, then stop and reopen NimiDay from Home before trying again.', 'uncertain');
}

// One instance per verified Host scope. Renderer requests and background reads
// use this same queue. A renderer reload does not create another writer.
export function createDayPersistence(documents: JsonDocumentStore): DayPersistence {
  const collections = new Map<CollectionName, CollectionState>();
  let tail: Promise<unknown> = Promise.resolve();
  let closed = false;
  let paused = false;
  const check = () => {
    if (closed) throw new CollectionPersistenceError('NimiDay storage session has ended.', 'closed');
    if (paused) throw uncertain();
  };
  const queue = <T>(action: () => Promise<T>): Promise<T> => {
    const operation = tail.then(async () => { check(); return action(); });
    tail = operation.catch(() => undefined);
    return operation;
  };
  const read = async (path: string) => { check(); const value = await documents.read(path); check(); return value; };
  const mutate = async (action: () => Promise<void>) => {
    check();
    try { await action(); check(); }
    catch (error) {
      if (CLOSED_SCOPES.has(persistenceReason(error))) closed = true;
      if (closed) throw new CollectionPersistenceError('NimiDay storage session has ended.', 'closed');
      if (error instanceof CollectionPersistenceError || DEFINITE_REFUSALS.has(persistenceReason(error))) throw error;
      // A rejected transport promise is not a server-side write barrier.
      // Supported scope invalidation/restart is required before recovery.
      paused = true;
      throw uncertain();
    }
  };
  const write = async (path: string, value: unknown) => { assertDocument(value); await mutate(() => documents.write(path, value)); };
  const remove = async (path: string) => { await mutate(() => documents.remove(path)); };
  const status = (): Maintenance => ({
    cleanupPending: [...collections.values()].some(state => Boolean(state.index?.pending)),
    recoveryPending: [...collections.values()].some(state => state.index?.pending?.phase === 'prepared'),
    recoveryRequired: paused,
  });
  const clean = async (name: CollectionName, state: CollectionState) => {
    const index = state.index;
    if (!index?.pending) return;
    const garbage = index.pending.phase === 'prepared' ? index.pending.created : index.pending.obsolete;
    for (const ref of garbage) await remove(ref);
    const cleared: CollectionIndex = { version: 2, generation: index.generation, current: index.current };
    await write(documentPath(`${name}.index`), cleared);
    state.index = cleared;
  };
  const load = async (name: CollectionName): Promise<CollectionState> => {
    const cached = collections.get(name);
    if (cached) return cached;
    const index = parseCollectionIndex(await read(documentPath(`${name}.index`)), name);
    const chunks: CollectionChunk[] = [];
    const identities = new Set<string>();
    for (const ref of index?.current ?? []) {
      const value = await read(ref);
      if (!Array.isArray(value)) throw new CollectionPersistenceError(`NimiDay ${name} chunk is missing or damaged.`, 'invalid-data');
      for (const record of value) {
        const key = recordKey(record);
        if (identities.has(key)) throw new CollectionPersistenceError(`NimiDay ${name} contains duplicate identities.`, 'invalid-data');
        identities.add(key);
      }
      chunks.push({ path: ref, records: value });
    }
    const state: CollectionState = { index, chunks };
    collections.set(name, state);
    return state;
  };
  const cleanPending = async () => {
    for (const [name, state] of collections) if (state.index?.pending) await clean(name, state);
  };
  return {
    read: path => queue(() => read(path)),
    write: (path, value) => queue(async () => { await cleanPending(); await write(path, value); }),
    remove: path => queue(() => remove(path)),
    readCollection: name => queue(async () => {
      const state = await load(name);
      return { records: state.index ? structuredClone(state.chunks.flatMap(chunk => chunk.records)) : undefined, ...status() };
    }),
    writeCollection: (name, input) => {
      const records = structuredClone(input);
      return queue(async () => {
      const state = await load(name);
      await cleanPending();
      check();
      const base = state.index ?? { version: 2 as const, generation: 0, current: [] };
      const generation = base.generation + 1;
      if (!Number.isSafeInteger(generation)) throw new CollectionPersistenceError(`NimiDay ${name} generation cannot advance. Saved data has not been replaced.`, 'invalid-data');
      const chunks = planCollectionChunks(name, generation, state.chunks, records);
      const next = chunks.map(chunk => chunk.path);
      const created = chunks.filter(chunk => !base.current.includes(chunk.path));
      const obsolete = base.current.filter(ref => !next.includes(ref));
      if (state.index && next.length === base.current.length && next.every((ref, slot) => ref === base.current[slot])) return status();
      const prepared: CollectionIndex = { ...base, pending: { phase: 'prepared', generation, next, created: created.map(chunk => chunk.path), obsolete } };
      const published: CollectionIndex = { version: 2, generation, current: next, pending: { phase: 'published', obsolete } };
      assertDocument(prepared); assertDocument(published);
      try {
        await write(documentPath(`${name}.index`), prepared);
        state.index = prepared;
        for (const chunk of created) await write(chunk.path, chunk.records);
        await write(documentPath(`${name}.index`), published);
      } catch (error) {
        // Only a definitive refusal permits same-scope cleanup. A timed-out
        // publish never chooses a cleanup set from the old in-memory index.
        if (!paused && !closed && state.index?.pending) {
          try { await clean(name, state); } catch { /* exact pending remains */ }
        }
        if (paused) throw uncertain();
        throw error;
      }
      state.index = published;
      state.chunks = chunks;
      try { await clean(name, state); } catch { /* Acknowledged data commit; maintenance is separate. */ }
      return status();
      });
    },
    maintain: () => queue(async () => {
      await cleanPending();
      return status();
    }),
    status,
    close: () => { closed = true; collections.clear(); },
  };
}
