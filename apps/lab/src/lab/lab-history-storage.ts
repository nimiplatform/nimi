import { t } from '../shell/i18n/index.js';
import {
  appendStudioRunHistoryRecord, clearStudioRunHistory, parseStudioRunHistory,
  removeStudioRunHistoryRecord,
} from '../ai-studio-core/history-policy.js';
import type { StudioRunHistory, StudioRunHistoryRecord } from '../ai-studio-core/history.js';
import { readLabStandardStorageJson, removeLabStandardStorageJson, writeLabStandardStorageJson } from './lab-standard-storage.js';

const LAB_RUN_HISTORY_STORAGE_PATH = 'lab-run-history.json';
const JSON_DOCUMENT_LIMIT_BYTES = 256 * 1024;
// Even six-byte JSON escapes fit below the public document limit. Splitting
// serialized text also supports one record larger than a document.
const CHUNK_TEXT_LENGTH = 32 * 1024;
const runHistoryMutationQueue = { tail: Promise.resolve() };
type HistoryIndex = { readonly format: 'lab-history-v1'; readonly kind: 'run' | 'media' | 'integration'; readonly generation: string;
  readonly chunks: readonly string[]; readonly textBytes: number };
type HistoryChunk = { readonly format: 'lab-history-chunk-v1'; readonly text: string };
type HistoryGeneration = { readonly generation: string; readonly parts: number };
type HistoryMaintenance = { readonly format: 'lab-history-maintenance-v1'; readonly kind: 'run' | 'media' | 'integration';
  readonly generations: readonly HistoryGeneration[] };
const GENERATION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function maintenancePath(kind: 'run' | 'media' | 'integration'): string { return `studio/history/${kind}/maintenance.json`; }
async function readMaintenance(kind: 'run' | 'media' | 'integration'): Promise<HistoryMaintenance | undefined> {
  const value = await readLabStandardStorageJson(maintenancePath(kind)) as Partial<HistoryMaintenance> | undefined;
  if (value === undefined) return undefined;
  if (!value || value.format !== 'lab-history-maintenance-v1' || value.kind !== kind || !Array.isArray(value.generations)
    || Object.keys(value).some(key => !['format', 'kind', 'generations'].includes(key))) throw new Error(t('Common.historyStorage.invalidIndex'));
  const ids = new Set<string>();
  for (const item of value.generations) {
    if (!item || !GENERATION_PATTERN.test(item.generation) || ids.has(item.generation)
      || !Number.isSafeInteger(item.parts) || item.parts < 1 || item.parts > 4096
      || Object.keys(item).some(key => !['generation', 'parts'].includes(key))) throw new Error(t('Common.historyStorage.invalidReference'));
    ids.add(item.generation);
  }
  checkDocument(value);
  return value as HistoryMaintenance;
}

// Only generations this writer recorded are eligible for internal JSON cleanup.
// JSON and asset paths are separate public storage domains.
export async function retryLabHistoryChunkCleanup(rootPath: 'lab-run-history.json' | 'lab-image-history.json' | 'lab-integration-history.json', kind: 'run' | 'media' | 'integration'): Promise<void> {
  const maintenance = await readMaintenance(kind);
  if (!maintenance) return;
  const root = await readLabStandardStorageJson(rootPath);
  const current = root === undefined ? undefined : parseIndex(root, kind);
  const remaining: HistoryGeneration[] = [];
  for (const item of maintenance.generations) {
    if (item.generation === current?.generation) continue;
    let failed = false;
    for (let part = 0; part < item.parts; part += 1) {
      try { await removeLabStandardStorageJson(`studio/history/${kind}/${item.generation}/${part}.json`); }
      catch { failed = true; }
    }
    if (failed) remaining.push(item);
  }
  // A failed maintenance update leaves the prior durable list available to the
  // next read/write. A published generation is always protected by the root.
  try {
    if (remaining.length) await writeLabStandardStorageJson(maintenancePath(kind), { ...maintenance, generations: remaining });
    else await removeLabStandardStorageJson(maintenancePath(kind));
  } catch { /* Retry the same known generations on the next repository action. */ }
}

export function enqueueHistoryMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = runHistoryMutationQueue.tail.then(operation, operation);
  runHistoryMutationQueue.tail = result.then(() => undefined, () => undefined);
  return result;
}
function checkDocument(value: unknown): void {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > JSON_DOCUMENT_LIMIT_BYTES) {
    throw new Error(t('Common.historyStorage.documentTooLarge'));
  }
}
function parseIndex(value: unknown, kind: 'run' | 'media' | 'integration'): HistoryIndex {
  const index = value as Partial<HistoryIndex> | undefined;
  if (!index || index.format !== 'lab-history-v1' || index.kind !== kind
    || typeof index.generation !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(index.generation)
    || !Array.isArray(index.chunks) || !index.chunks.length
    || !Number.isSafeInteger(index.textBytes) || (index.textBytes ?? 0) < 2
    || Object.keys(index).some(key => !['format', 'kind', 'generation', 'chunks', 'textBytes'].includes(key))) {
    throw new Error(t('Common.historyStorage.invalidIndex'));
  }
  index.chunks.forEach((path, part) => {
    if (path !== `studio/history/${kind}/${index.generation}/${part}.json`) throw new Error(t('Common.historyStorage.invalidReference'));
  });
  checkDocument(index);
  return index as HistoryIndex;
}

/** Complete immutable business documents, also used by one-time operator
 * conversion. The product reader accepts only this format. */
export function encodeLabHistoryDocuments(value: unknown, kind: 'run' | 'media' | 'integration'): {
  readonly index: HistoryIndex; readonly chunks: readonly HistoryChunk[];
} {
  const text = JSON.stringify(value);
  const generation = crypto.randomUUID();
  const chunks: HistoryChunk[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + CHUNK_TEXT_LENGTH, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1])) end -= 1;
    const chunk: HistoryChunk = { format: 'lab-history-chunk-v1', text: text.slice(start, end) };
    checkDocument(chunk); chunks.push(chunk); start = end;
  }
  const index: HistoryIndex = { format: 'lab-history-v1', kind, generation,
    chunks: chunks.map((_, part) => `studio/history/${kind}/${generation}/${part}.json`),
    textBytes: new TextEncoder().encode(text).byteLength };
  checkDocument(index);
  return { index, chunks };
}
export async function readLabHistoryDocuments(value: unknown, kind: 'run' | 'media' | 'integration'): Promise<unknown> {
  const index = parseIndex(value, kind);
  const parts: string[] = [];
  for (const path of index.chunks) {
    const chunk = await readLabStandardStorageJson(path) as Partial<HistoryChunk> | undefined;
    if (!chunk || chunk.format !== 'lab-history-chunk-v1' || typeof chunk.text !== 'string'
      || !chunk.text || chunk.text.length > CHUNK_TEXT_LENGTH
      || Object.keys(chunk).some(key => !['format', 'text'].includes(key))) {
      throw new Error(t('Common.historyStorage.missingChunk', { path }));
    }
    checkDocument(chunk); parts.push(chunk.text);
  }
  const text = parts.join('');
  if (new TextEncoder().encode(text).byteLength !== index.textBytes) throw new Error(t('Common.historyStorage.incompleteChunks'));
  return JSON.parse(text) as unknown;
}
export function encodeLabRunHistory(history: StudioRunHistory) {
  return encodeLabHistoryDocuments(parseStudioRunHistory(JSON.parse(JSON.stringify(history)) as unknown), 'run');
}
export async function readLabRunHistoryDocuments(value: unknown): Promise<StudioRunHistory> {
  return parseStudioRunHistory(await readLabHistoryDocuments(value, 'run'));
}
async function readSnapshot(): Promise<{ readonly index: HistoryIndex | undefined; readonly history: StudioRunHistory }> {
  await retryLabHistoryChunkCleanup(LAB_RUN_HISTORY_STORAGE_PATH, 'run');
  const root = await readLabStandardStorageJson(LAB_RUN_HISTORY_STORAGE_PATH);
  // Only a new, uninitialized App has no index. Missing indexed content errors.
  if (root === undefined) return { index: undefined, history: {} };
  const index = parseIndex(root, 'run');
  return { index, history: await readLabRunHistoryDocuments(index) };
}
export async function loadLabRunHistory(): Promise<StudioRunHistory> {
  return enqueueHistoryMutation(async () => (await readSnapshot()).history);
}
export async function writeLabHistoryDocuments(
  rootPath: 'lab-run-history.json' | 'lab-image-history.json' | 'lab-integration-history.json', kind: 'run' | 'media' | 'integration', value: unknown,
  previous: unknown,
): Promise<void> {
  const prior = previous === undefined ? undefined : parseIndex(previous, kind);
  await retryLabHistoryChunkCleanup(rootPath, kind);
  const { index, chunks } = encodeLabHistoryDocuments(value, kind);
  const pending = await readMaintenance(kind);
  const generations = new Map((pending?.generations ?? []).map(item => [item.generation, item]));
  if (prior) generations.set(prior.generation, { generation: prior.generation, parts: prior.chunks.length });
  generations.set(index.generation, { generation: index.generation, parts: chunks.length });
  const maintenance: HistoryMaintenance = { format: 'lab-history-maintenance-v1', kind, generations: [...generations.values()] };
  checkDocument(maintenance);
  await writeLabStandardStorageJson(maintenancePath(kind), maintenance);
  let publishing = false;
  try {
    for (let part = 0; part < chunks.length; part += 1) await writeLabStandardStorageJson(index.chunks[part], chunks[part]);
    const staged = await readLabHistoryDocuments(index, kind);
    if (JSON.stringify(staged) !== JSON.stringify(value)) throw new Error(t('Common.historyStorage.verificationFailed'));
    publishing = true;
    await writeLabStandardStorageJson(rootPath, index);
  } catch (cause) {
    if (publishing) {
      let published: unknown;
      try { published = await readLabStandardStorageJson(rootPath); }
      catch { throw Object.assign(new Error(t('Common.historyStorage.publicationUncertain')), { historyPublicationUncertain: true, cause }); }
      let current: HistoryIndex | undefined;
      try { current = published === undefined ? undefined : parseIndex(published, kind); }
      catch { throw Object.assign(new Error(t('Common.historyStorage.publicationUncertain')), { historyPublicationUncertain: true, cause }); }
      if (current?.generation === index.generation) {
        try {
          const committed = await readLabHistoryDocuments(current, kind);
          if (JSON.stringify(committed) !== JSON.stringify(value)) throw new Error('Committed history differs');
        } catch { throw Object.assign(new Error(t('Common.historyStorage.publicationUncertain')), { historyPublicationUncertain: true, cause }); }
        // The root actually committed; losing its response is not a failed save.
        try { await retryLabHistoryChunkCleanup(rootPath, kind); } catch { /* Durable maintenance remains. */ }
        return;
      }
    }
    try { await retryLabHistoryChunkCleanup(rootPath, kind); } catch { /* Keep the durable known-generation list. */ }
    throw cause;
  }
  try { await retryLabHistoryChunkCleanup(rootPath, kind); } catch { /* Committed results keep their assets; retry maintenance later. */ }
}
async function writeSnapshot(history: StudioRunHistory, previous: HistoryIndex | undefined): Promise<void> {
  const normalized = parseStudioRunHistory(JSON.parse(JSON.stringify(history)) as unknown);
  await writeLabHistoryDocuments(LAB_RUN_HISTORY_STORAGE_PATH, 'run', normalized, previous);
}
export async function saveLabRunHistory(history: StudioRunHistory): Promise<void> {
  return enqueueHistoryMutation(async () => { const previous = await readSnapshot(); await writeSnapshot(history, previous.index); });
}
export async function appendLabRunHistory(record: StudioRunHistoryRecord): Promise<StudioRunHistory> {
  return enqueueHistoryMutation(async () => {
    const previous = await readSnapshot();
    const next = appendStudioRunHistoryRecord(previous.history, record);
    await writeSnapshot(next, previous.index); return next;
  });
}
export async function removeLabRunHistoryRecord(recordId: string): Promise<StudioRunHistory> {
  return enqueueHistoryMutation(async () => {
    const previous = await readSnapshot();
    const next = removeStudioRunHistoryRecord(previous.history, recordId);
    await writeSnapshot(next, previous.index); return next;
  });
}
export async function clearLabRunHistory(capabilityId?: string): Promise<StudioRunHistory> {
  return enqueueHistoryMutation(async () => {
    const previous = await readSnapshot();
    const next = clearStudioRunHistory(previous.history, capabilityId ?? null);
    await writeSnapshot(next, previous.index); return next;
  });
}
