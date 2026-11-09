import { createNimiAppRecordStore } from '@nimiplatform/kit/core/app-record-storage';
import { parseStudioRunHistoryRecord, studioHistoryFromRecords } from '../ai-studio-core/history-policy.js';
import type { StudioRunHistory, StudioRunHistoryRecord } from '../ai-studio-core/history.js';
import { getLabLocalAppClient } from '../shell/local-app-runtime-platform.js';

type HistoryAssets = Parameters<typeof createNimiAppRecordStore>[0];
function repository(assets: HistoryAssets) {
  return createNimiAppRecordStore(assets, 'studio/history/run', parseStudioRunHistoryRecord);
}
async function readRecords(store: ReturnType<typeof repository>): Promise<StudioRunHistory> {
  return studioHistoryFromRecords((await store.list()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
}
export async function loadLabRunHistory(assets: HistoryAssets = getLabLocalAppClient().storage.assets): Promise<StudioRunHistory> {
  return readRecords(repository(assets));
}
export async function appendLabRunHistory(record: StudioRunHistoryRecord, assets: HistoryAssets = getLabLocalAppClient().storage.assets): Promise<StudioRunHistory> {
  const store = repository(assets);
  try {
    await store.write(record);
    return await readRecords(store);
  } catch (cause) {
    // Preserve generated assets when publication may have committed before
    // transport/readback failed. The user can explicitly retry saving the record.
    throw Object.assign(new Error(cause instanceof Error ? cause.message : String(cause)), { historyPublicationUncertain: true, cause });
  }
}
export async function removeLabRunHistoryRecord(recordId: string, assets: HistoryAssets = getLabLocalAppClient().storage.assets): Promise<StudioRunHistory> {
  const store = repository(assets);
  await store.remove(recordId);
  return readRecords(store);
}
export async function clearLabRunHistory(capabilityId?: string, assets: HistoryAssets = getLabLocalAppClient().storage.assets): Promise<StudioRunHistory> {
  const store = repository(assets);
  const selected = (await store.list()).filter(record => capabilityId === undefined || record.capabilityId === capabilityId);
  for (const record of selected) await store.remove(record.id);
  return readRecords(store);
}
