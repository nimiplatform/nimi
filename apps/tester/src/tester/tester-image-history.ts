import { invokeTesterCommand } from './tester-tauri.js';
import type { TesterCapabilityId } from './tester-capabilities.js';

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

function parseRecords(raw: string): TesterImageHistoryRecord[] {
  const parsed = JSON.parse(raw || '[]');
  if (!Array.isArray(parsed)) {
    throw new Error('Tester image history payload must be an array.');
  }
  return (parsed as TesterImageHistoryRecord[]).map(normalizeRecord);
}

export async function loadTesterImageHistory(): Promise<TesterImageHistoryRecord[]> {
  return parseRecords(await invokeTesterCommand<string>('tester_image_history_load'));
}

export async function saveTesterImageHistory(records: TesterImageHistoryRecord[]): Promise<void> {
  await invokeTesterCommand('tester_image_history_save', { payload: { recordsJson: JSON.stringify(records.slice(0, 80)) } });
}

export async function appendTesterImageHistoryRecord(record: TesterImageHistoryRecord): Promise<TesterImageHistoryRecord[]> {
  const history = await loadTesterImageHistory().catch(() => [] as TesterImageHistoryRecord[]);
  const linkageId = record.runId || record.id;
  const withoutDuplicate = history.filter((existing) => (existing.runId || existing.id) !== linkageId);
  const next = [normalizeRecord(record), ...withoutDuplicate].slice(0, 80);
  await saveTesterImageHistory(next);
  return next;
}
