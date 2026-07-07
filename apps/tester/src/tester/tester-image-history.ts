import type { TesterCapabilityId } from './tester-capabilities.js';
import { readTesterStandardStorageJson, writeTesterStandardStorageJson } from './tester-standard-storage.js';
import type { JsonValue } from '@nimiplatform/kit/shell/renderer/bridge';

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

function parseRecords(value: JsonValue | undefined): TesterImageHistoryRecord[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('Tester image history payload must be an array.');
  }
  return (value as TesterImageHistoryRecord[]).map(normalizeRecord);
}

export async function loadTesterImageHistory(): Promise<TesterImageHistoryRecord[]> {
  return parseRecords(await readTesterStandardStorageJson(TESTER_IMAGE_HISTORY_STORAGE_PATH));
}

export async function saveTesterImageHistory(records: TesterImageHistoryRecord[]): Promise<void> {
  await writeTesterStandardStorageJson(
    TESTER_IMAGE_HISTORY_STORAGE_PATH,
    records.slice(0, 80) as unknown as JsonValue,
  );
}

export async function appendTesterImageHistoryRecord(record: TesterImageHistoryRecord): Promise<TesterImageHistoryRecord[]> {
  const history = await loadTesterImageHistory().catch(() => [] as TesterImageHistoryRecord[]);
  const linkageId = record.runId || record.id;
  const withoutDuplicate = history.filter((existing) => (existing.runId || existing.id) !== linkageId);
  const next = [normalizeRecord(record), ...withoutDuplicate].slice(0, 80);
  await saveTesterImageHistory(next);
  return next;
}
