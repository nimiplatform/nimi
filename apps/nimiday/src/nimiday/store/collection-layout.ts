import { DOCUMENT_ROOT, CollectionPersistenceError, chunkRecords } from './json-documents.js';

export type CollectionName = 'items' | 'notes' | 'runs';
export const COLLECTION_NAMES: readonly CollectionName[] = ['items', 'notes', 'runs'];
export const MAX_COLLECTION_CHUNKS = 64;
export type CollectionIndex = {
  readonly version: 2;
  readonly generation: number;
  readonly current: readonly string[];
  readonly pending?:
    | { readonly phase: 'prepared'; readonly generation: number; readonly next: readonly string[]; readonly created: readonly string[]; readonly obsolete: readonly string[] }
    | { readonly phase: 'published'; readonly obsolete: readonly string[] };
};
export type CollectionChunk = { readonly path: string; readonly records: readonly unknown[] };
export function chunkPath(name: CollectionName, generation: number, slot: number): string {
  return `${DOCUMENT_ROOT}/${name}.g${generation}-${slot}.json`;
}

// Previous local data has an explicit offline conversion; there is no product
// legacy reader or automatic format transition.
export function parseCollectionIndex(value: unknown, name: CollectionName): CollectionIndex | undefined {
  if (value === undefined) return undefined;
  const invalid = (): never => { throw new CollectionPersistenceError(`NimiDay ${name} index is damaged or unsupported. Saved data has not been replaced.`, 'invalid-data'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const row = value as Record<string, unknown>;
  if (row.version !== 2 || !Number.isSafeInteger(row.generation) || (row.generation as number) < 0) return invalid();
  const generation = row.generation as number;
  const refs = (raw: unknown, maxGeneration: number): string[] => {
    if (!Array.isArray(raw) || raw.length > MAX_COLLECTION_CHUNKS || new Set(raw).size !== raw.length) return invalid();
    return raw.map(ref => {
      if (typeof ref !== 'string') return invalid();
      const match = new RegExp(`^${DOCUMENT_ROOT}/${name}\\.g([0-9]+)-([0-9]+)\\.json$`).exec(ref);
      if (!match) return invalid();
      const gen = Number(match[1]); const slot = Number(match[2]);
      if (!Number.isSafeInteger(gen) || gen < 1 || gen > maxGeneration || !Number.isInteger(slot)
        || slot < 0 || slot >= MAX_COLLECTION_CHUNKS || ref !== chunkPath(name, gen, slot)) return invalid();
      return ref;
    });
  };
  const current = refs(row.current, generation);
  if (row.pending === undefined) return { version: 2, generation, current };
  if (!row.pending || typeof row.pending !== 'object' || Array.isArray(row.pending)) return invalid();
  const pending = row.pending as Record<string, unknown>;
  const obsolete = refs(pending.obsolete, generation);
  if (pending.phase === 'published') {
    if (obsolete.some(ref => current.includes(ref))) return invalid();
    return { version: 2, generation, current, pending: { phase: 'published', obsolete } };
  }
  if (pending.phase !== 'prepared' || !Number.isSafeInteger(generation + 1) || pending.generation !== generation + 1) return invalid();
  const next = refs(pending.next, generation + 1);
  const created = refs(pending.created, generation + 1);
  if (created.some(ref => current.includes(ref) || !next.includes(ref) || !ref.startsWith(`${DOCUMENT_ROOT}/${name}.g${generation + 1}-`))
    || next.some(ref => !current.includes(ref) && !created.includes(ref))
    || obsolete.length !== current.filter(ref => !next.includes(ref)).length
    || obsolete.some(ref => !current.includes(ref) || next.includes(ref))) return invalid();
  return { version: 2, generation, current, pending: { phase: 'prepared', generation: generation + 1, next, created, obsolete } };
}

export function recordKey(value: unknown): string {
  const id = value && typeof value === 'object' && !Array.isArray(value) ? (value as { id?: unknown }).id : undefined;
  if ((typeof id !== 'string' || !id) && (typeof id !== 'number' || !Number.isFinite(id))) {
    throw new CollectionPersistenceError('A NimiDay record has no valid identity.', 'invalid-data');
  }
  return `${typeof id}:${id}`;
}
function stableJSON(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
}

// Unchanged contiguous chunks are anchors. Editing/inserting/deleting within
// one chunk cannot reflow all later chunks; only each changed interval splits.
export function planCollectionChunks(name: CollectionName, generation: number, previous: readonly CollectionChunk[], records: readonly unknown[]): readonly CollectionChunk[] {
  chunkRecords(records);
  const keys = records.map(recordKey);
  if (new Set(keys).size !== keys.length) throw new CollectionPersistenceError('A NimiDay collection contains duplicate identities.', 'invalid-data');
  const text = records.map(stableJSON);
  const anchors = new Map<string, { chunk: CollectionChunk; text: readonly string[] }>();
  for (const chunk of previous) {
    if (chunk.records.length) anchors.set(recordKey(chunk.records[0]), { chunk, text: chunk.records.map(stableJSON) });
  }
  type Planned = { path?: string; records: readonly unknown[]; mayAbsorbNeighbor: boolean };
  const result: Planned[] = []; let changed: unknown[] = [];
  const append = (chunk: Planned) => {
    const left = result.at(-1);
    const canMerge = left && ((!left.path && left.mayAbsorbNeighbor) || (!chunk.path && chunk.mayAbsorbNeighbor));
    if (canMerge) {
      const combined = [...left.records, ...chunk.records];
      if (chunkRecords(combined).length === 1) {
        result[result.length - 1] = {
          records: combined,
          // An actual changed interval may absorb one unchanged neighbor,
          // without turning a small edit into whole-collection compaction.
          mayAbsorbNeighbor: !left.path && !chunk.path && left.mayAbsorbNeighbor && chunk.mayAbsorbNeighbor,
        };
        return;
      }
    }
    result.push(chunk);
  };
  const flush = () => {
    for (const part of chunkRecords(changed)) append({ records: part, mayAbsorbNeighbor: true });
    changed = [];
  };
  for (let index = 0; index < records.length;) {
    const anchor = anchors.get(keys[index]!);
    if (anchor && anchor.text.every((entry, offset) => text[index + offset] === entry)) {
      flush(); append({ ...anchor.chunk, mayAbsorbNeighbor: false }); index += anchor.text.length;
    } else { changed.push(records[index]); index++; }
  }
  flush();
  if (result.length > MAX_COLLECTION_CHUNKS) throw new CollectionPersistenceError(`NimiDay ${name} collection is too large to save. Saved data has not been replaced.`, 'capacity');
  let slot = 0;
  return result.map(chunk => ({ path: chunk.path ?? chunkPath(name, generation, slot++), records: chunk.records }));
}
