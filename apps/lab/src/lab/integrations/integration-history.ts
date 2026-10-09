import { enqueueHistoryMutation, readLabHistoryDocuments, retryLabHistoryChunkCleanup, writeLabHistoryDocuments } from '../lab-history-storage.js';
import { readLabStandardStorageJson } from '../lab-standard-storage.js';

import { mergeIntegrationHistoryRecord, parseLabIntegrationHistory, type LabIntegrationHistoryRecord } from './integration-history-model.js';
export { parseLabIntegrationHistory, integrationHistoryRecord, observeIntegrationHistory, exportLabIntegrationHistory, savedIntegrationHistoryRecord, type LabIntegrationHistoryRecord } from './integration-history-model.js';
const ROOT = 'lab-integration-history.json';
async function readSnapshot() {
  await retryLabHistoryChunkCleanup(ROOT,'integration');
  const index = await readLabStandardStorageJson(ROOT);
  return { index, records: index === undefined ? [] : parseLabIntegrationHistory(await readLabHistoryDocuments(index,'integration')) };
}
export function loadLabIntegrationHistory(): Promise<readonly LabIntegrationHistoryRecord[]> {
  return enqueueHistoryMutation(async () => (await readSnapshot()).records);
}
export function appendLabIntegrationHistory(record: LabIntegrationHistoryRecord): Promise<readonly LabIntegrationHistoryRecord[]> {
  return enqueueHistoryMutation(async () => {
    const previous = await readSnapshot();
    const merged = mergeIntegrationHistoryRecord(previous.records.find(item => item.id === record.id),record);
    const records = parseLabIntegrationHistory([merged,...previous.records.filter(item => item.id !== record.id)]);
    await writeLabHistoryDocuments(ROOT,'integration',records,previous.index); return records;
  });
}
export function removeLabIntegrationHistory(recordId: string): Promise<readonly LabIntegrationHistoryRecord[]> {
  return enqueueHistoryMutation(async () => {
    const previous = await readSnapshot(); const records = previous.records.filter(item => item.id !== recordId);
    await writeLabHistoryDocuments(ROOT,'integration',records,previous.index); return records;
  });
}
