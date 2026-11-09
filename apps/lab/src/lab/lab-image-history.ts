import type { LabCapabilityId } from './lab-capabilities.js';
import { getLabLocalAppClient } from '../shell/local-app-runtime-platform.js';
import { createNimiAppRecordStore } from '@nimiplatform/kit/core/app-record-storage';
import { isJsonObject } from '@nimiplatform/sdk/types';

export type LabImageHistoryRecord = {
  id: string;
  runId?: string;
  kind?: 'runtime-media';
  capabilityId: LabCapabilityId | string;
  capabilityLabel?: string;
  title: string;
  status: 'unavailable' | 'ready' | 'failed';
  createdAt: string;
  artifactCount?: number;
  artifactLabel?: string;
  relativePath?: string;
  mediaType?: string;
  sizeBytes?: number;
  sha256?: string;
  jobId?: string;
  jobState?: string;
  message?: string;
  traceState?: 'captured' | 'not-captured';
  traceId?: string;
};

function normalizeRecord(record: LabImageHistoryRecord): LabImageHistoryRecord {
  return {
    ...record,
    runId: record.runId || record.id,
    traceState: record.traceState || 'not-captured',
  };
}

function imageHistoryPayloadError(path: string, detail: string): never {
  throw new Error(`Lab image history payload ${detail} at ${path}.`);
}

function optionalString(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== 'string') imageHistoryPayloadError(path, 'requires a string when present');
}

function parseRecord(value: unknown, index: number): LabImageHistoryRecord {
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
  for (const key of ['runId', 'kind', 'capabilityLabel', 'artifactLabel', 'relativePath', 'mediaType', 'sha256', 'jobId', 'jobState', 'message', 'traceState', 'traceId'] as const) {
    optionalString(value[key], `${path}.${key}`);
  }
  if (value.artifactCount !== undefined
    && (typeof value.artifactCount !== 'number' || !Number.isFinite(value.artifactCount) || value.artifactCount < 0)) {
    imageHistoryPayloadError(`${path}.artifactCount`, 'requires a non-negative finite number when present');
  }
  if (value.sizeBytes !== undefined
    && (typeof value.sizeBytes !== 'number' || !Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 0)) {
    imageHistoryPayloadError(`${path}.sizeBytes`, 'requires a non-negative safe integer when present');
  }
  if (value.sha256 !== undefined && !/^sha256:[0-9a-f]{64}$/u.test(String(value.sha256))) {
    imageHistoryPayloadError(`${path}.sha256`, 'requires a canonical SHA-256 digest when present');
  }
  if (value.status === 'ready' && value.kind === 'runtime-media'
    && (typeof value.relativePath !== 'string'
      || typeof value.sizeBytes !== 'number'
      || typeof value.sha256 !== 'string')) {
    imageHistoryPayloadError(path, 'requires managed asset metadata for ready Runtime media');
  }
  return normalizeRecord(value as unknown as LabImageHistoryRecord);
}

function parseRecords(value: unknown): LabImageHistoryRecord[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('Lab image history payload must be an array.');
  }
  return value.map(parseRecord);
}

type HistoryAssets = Parameters<typeof createNimiAppRecordStore>[0];
function repository(assets: HistoryAssets) {
  return createNimiAppRecordStore(assets, 'studio/history/media', value => parseRecords([value])[0]!);
}
async function readRecords(store: ReturnType<typeof repository>): Promise<LabImageHistoryRecord[]> {
  return (await store.list()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function loadLabImageHistory(assets: HistoryAssets = getLabLocalAppClient().storage.assets): Promise<LabImageHistoryRecord[]> {
  return readRecords(repository(assets));
}
export async function appendLabImageHistoryRecord(record: LabImageHistoryRecord, assets: HistoryAssets = getLabLocalAppClient().storage.assets): Promise<LabImageHistoryRecord[]> {
  const store = repository(assets);
  await store.write(normalizeRecord(record));
  return readRecords(store);
}
export async function removeLabImageHistoryRecord(runId: string, assets: HistoryAssets = getLabLocalAppClient().storage.assets): Promise<LabImageHistoryRecord[]> {
  const store = repository(assets);
  for (const record of await store.list()) if ((record.runId || record.id) === runId) await store.remove(record.id);
  return readRecords(store);
}
export async function clearLabImageHistory(capabilityId?: string, assets: HistoryAssets = getLabLocalAppClient().storage.assets): Promise<LabImageHistoryRecord[]> {
  const store = repository(assets);
  const selected = (await store.list()).filter(record => capabilityId === undefined || record.capabilityId === capabilityId);
  for (const record of selected) await store.remove(record.id);
  return readRecords(store);
}
