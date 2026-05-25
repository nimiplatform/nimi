import { invokeTesterCommand } from './tester-tauri.js';

export type TesterImageHistoryRecord = {
  id: string;
  capabilityId: 'image.generate' | 'video.generate';
  title: string;
  status: 'unavailable' | 'ready' | 'failed';
  createdAt: string;
};

function parseRecords(raw: string): TesterImageHistoryRecord[] {
  const parsed = JSON.parse(raw || '[]');
  if (!Array.isArray(parsed)) {
    throw new Error('Tester image history payload must be an array.');
  }
  return parsed as TesterImageHistoryRecord[];
}

export async function loadTesterImageHistory(): Promise<TesterImageHistoryRecord[]> {
  return parseRecords(await invokeTesterCommand<string>('tester_image_history_load'));
}

export async function saveTesterImageHistory(records: TesterImageHistoryRecord[]): Promise<void> {
  await invokeTesterCommand('tester_image_history_save', { payload: { recordsJson: JSON.stringify(records.slice(0, 80)) } });
}
