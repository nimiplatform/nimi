import {
  boundStudioRunHistoryWithRecord,
  clearStudioRunHistory,
  parseStudioRunHistory,
  removeStudioRunHistoryRecord,
  studioHistoryEvictedDocumentPaths,
} from '../ai-studio-core/history-policy.js';
import type { StudioRunHistory, StudioRunHistoryRecord } from '../ai-studio-core/history.js';
import {
  readLabStandardStorageJson,
  removeLabStandardStorageAsset,
  writeLabStandardStorageJson,
} from './lab-standard-storage.js';

const LAB_RUN_HISTORY_STORAGE_PATH = 'lab-run-history.json';
const runHistoryMutationQueue = { tail: Promise.resolve() };

function enqueueHistoryMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = runHistoryMutationQueue.tail.then(operation, operation);
  runHistoryMutationQueue.tail = result.then(() => undefined, () => undefined);
  return result;
}

export async function loadLabRunHistory(): Promise<StudioRunHistory> {
  return parseStudioRunHistory(await readLabStandardStorageJson(LAB_RUN_HISTORY_STORAGE_PATH));
}

export async function saveLabRunHistory(history: StudioRunHistory): Promise<void> {
  const normalized = parseStudioRunHistory(JSON.parse(JSON.stringify(history)) as unknown);
  await writeLabStandardStorageJson(LAB_RUN_HISTORY_STORAGE_PATH, normalized);
}

// Bounding the history can evict older records. A saved result document that
// only an evicted record referenced is released in the same mutation; its
// failure is reported, while the newly appended record stays saved.
export async function appendLabRunHistory(
  record: StudioRunHistoryRecord,
  reportEvictedDocumentCleanupFailure?: (failures: readonly string[]) => void,
): Promise<StudioRunHistory> {
  return enqueueHistoryMutation(async () => {
    const previous = await loadLabRunHistory();
    const next = boundStudioRunHistoryWithRecord(previous, record);
    await saveLabRunHistory(next);
    const failures: string[] = [];
    for (const relativePath of studioHistoryEvictedDocumentPaths(previous, record, next)) {
      try {
        await removeLabStandardStorageAsset(relativePath);
      } catch (error) {
        failures.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (failures.length > 0) reportEvictedDocumentCleanupFailure?.(failures);
    return next;
  });
}

export async function removeLabRunHistoryRecord(recordId: string): Promise<StudioRunHistory> {
  return enqueueHistoryMutation(async () => {
    const next = removeStudioRunHistoryRecord(await loadLabRunHistory(), recordId);
    await saveLabRunHistory(next);
    return next;
  });
}

export async function clearLabRunHistory(capabilityId?: string): Promise<StudioRunHistory> {
  return enqueueHistoryMutation(async () => {
    const next = clearStudioRunHistory(await loadLabRunHistory(), capabilityId ?? null);
    await saveLabRunHistory(next);
    return next;
  });
}
