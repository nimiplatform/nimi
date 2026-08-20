import {
  boundStudioRunHistoryWithRecord,
  clearStudioRunHistory,
  parseStudioRunHistory,
  removeStudioRunHistoryRecord,
  type StudioRunHistory,
  type StudioRunHistoryRecord,
} from '../ai-studio-core/index.js';
import {
  readLabStandardStorageJson,
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

export async function appendLabRunHistory(record: StudioRunHistoryRecord): Promise<StudioRunHistory> {
  return enqueueHistoryMutation(async () => {
    const next = boundStudioRunHistoryWithRecord(await loadLabRunHistory(), record);
    await saveLabRunHistory(next);
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
