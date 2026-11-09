import { createNimiAppRecordStore } from '@nimiplatform/kit/core/app-record-storage';
import { getLabLocalAppClient } from '../../shell/local-app-runtime-platform.js';
import { mergeIntegrationHistoryRecord, parseLabIntegrationHistory, type LabIntegrationHistoryRecord } from './integration-history-model.js';
export { parseLabIntegrationHistory, integrationHistoryRecord, observeIntegrationHistory, exportLabIntegrationHistory, savedIntegrationHistoryRecord, type LabIntegrationHistoryRecord } from './integration-history-model.js';
type HistoryAssets = Parameters<typeof createNimiAppRecordStore>[0];
function repository(assets: HistoryAssets) {
  return createNimiAppRecordStore(assets, 'studio/history/integration', value => parseLabIntegrationHistory([value])[0]!);
}
export async function loadLabIntegrationHistory(assets: HistoryAssets = getLabLocalAppClient().storage.assets): Promise<readonly LabIntegrationHistoryRecord[]> {
  return repository(assets).list();
}
export async function appendLabIntegrationHistory(record: LabIntegrationHistoryRecord, assets: HistoryAssets = getLabLocalAppClient().storage.assets): Promise<readonly LabIntegrationHistoryRecord[]> {
  const store = repository(assets);
  const merged = mergeIntegrationHistoryRecord(await store.read(record.id) ?? undefined, record);
  await store.write(merged);
  return store.list();
}
export async function removeLabIntegrationHistory(recordId: string, assets: HistoryAssets = getLabLocalAppClient().storage.assets): Promise<readonly LabIntegrationHistoryRecord[]> {
  const store = repository(assets);
  await store.remove(recordId);
  return store.list();
}
