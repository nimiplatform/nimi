import type { TesterCapabilityId } from './tester-capabilities.js';
import { readTesterStandardStorageJson, writeTesterStandardStorageJson } from './tester-standard-storage.js';
import type { JsonValue } from '@nimiplatform/kit/shell/renderer/bridge';
import { isJsonObject } from '@nimiplatform/sdk/types';

export type TesterImageHistoryRecord = {
  id: string;
  runId?: string;
  kind?: 'runtime-media';
  capabilityId: TesterCapabilityId | string;
  capabilityLabel?: string;
  title: string;
  status: 'unavailable' | 'ready' | 'failed';
  createdAt: string;
  artifactCount?: number;
  artifactLabel?: string;
  mimeType?: string;
  url?: string;
  jobId?: string;
  jobState?: string;
  message?: string;
  traceState?: 'captured' | 'not-captured';
  traceId?: string;
};

function normalizeRecord(record: TesterImageHistoryRecord): TesterImageHistoryRecord {
  return {
    ...record,
    runId: record.runId || record.id,
    traceState: record.traceState || 'not-captured',
  };
}

const TESTER_IMAGE_HISTORY_STORAGE_PATH = 'tester-image-history.json';
const imageHistoryMutationQueue = { tail: Promise.resolve() };

function imageHistoryPayloadError(path: string, detail: string): never {
  throw new Error(`Tester image history payload ${detail} at ${path}.`);
}

function optionalString(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== 'string') imageHistoryPayloadError(path, 'requires a string when present');
}

function parseRecord(value: unknown, index: number): TesterImageHistoryRecord {
  const path = `$[${index}]`;
  if (!isJsonObject(value)) imageHistoryPayloadError(path, 'requires an object');
  for (const key of ['id', 'capabilityId', 'title', 'createdAt'] as const) {
    if (typeof value[key] !== 'string') imageHistoryPayloadError(`${path}.${key}`, 'requires a string');
  }
  if (!['unavailable', 'ready', 'failed'].includes(String(value.status))) {
    imageHistoryPayloadError(`${path}.status`, 'has an unsupported value');
  }
  if (Number.isNaN(new Date(value.createdAt as string).valueOf())) {
    imageHistoryPayloadError(`${path}.createdAt`, 'requires a valid timestamp');
  }
  for (const key of ['runId', 'kind', 'capabilityLabel', 'artifactLabel', 'mimeType', 'url', 'jobId', 'jobState', 'message', 'traceState', 'traceId'] as const) {
    optionalString(value[key], `${path}.${key}`);
  }
  if (value.artifactCount !== undefined
    && (typeof value.artifactCount !== 'number' || !Number.isFinite(value.artifactCount) || value.artifactCount < 0)) {
    imageHistoryPayloadError(`${path}.artifactCount`, 'requires a non-negative finite number when present');
  }
  return normalizeRecord(value as unknown as TesterImageHistoryRecord);
}

function enqueueImageHistoryMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = imageHistoryMutationQueue.tail.then(operation, operation);
  imageHistoryMutationQueue.tail = result.then(() => undefined, () => undefined);
  return result;
}

function parseRecords(value: JsonValue | undefined): TesterImageHistoryRecord[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('Tester image history payload must be an array.');
  }
  return value.map(parseRecord);
}

export async function loadTesterImageHistory(): Promise<TesterImageHistoryRecord[]> {
  return parseRecords(await readTesterStandardStorageJson(TESTER_IMAGE_HISTORY_STORAGE_PATH));
}

export async function saveTesterImageHistory(records: TesterImageHistoryRecord[]): Promise<void> {
  await writeTesterStandardStorageJson(
    TESTER_IMAGE_HISTORY_STORAGE_PATH,
    records.slice(0, 80),
  );
}

export async function appendTesterImageHistoryRecord(record: TesterImageHistoryRecord): Promise<TesterImageHistoryRecord[]> {
  return enqueueImageHistoryMutation(async () => {
    const history = await loadTesterImageHistory();
    const linkageId = record.runId || record.id;
    const withoutDuplicate = history.filter((existing) => (existing.runId || existing.id) !== linkageId);
    const next = [normalizeRecord(record), ...withoutDuplicate].slice(0, 80);
    await saveTesterImageHistory(next);
    return next;
  });
}
