import { invokeTesterCommand } from './tester-tauri.js';

export type TesterRunHistoryRecord = {
  id: string;
  capabilityId: string;
  prompt: string;
  status: 'unavailable' | 'ready' | 'failed';
  message: string;
  createdAt: string;
};

export type TesterRunHistory = Record<string, TesterRunHistoryRecord[]>;

function parseHistory(raw: string): TesterRunHistory {
  const parsed = JSON.parse(raw || '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Tester run history payload must be an object.');
  }
  return parsed as TesterRunHistory;
}

export async function loadTesterRunHistory(): Promise<TesterRunHistory> {
  return parseHistory(await invokeTesterCommand<string>('tester_run_history_load'));
}

export async function saveTesterRunHistory(history: TesterRunHistory): Promise<void> {
  await invokeTesterCommand('tester_run_history_save', { payload: { recordsJson: JSON.stringify(history) } });
}

export async function appendTesterRunHistory(record: TesterRunHistoryRecord): Promise<TesterRunHistory> {
  const history = await loadTesterRunHistory().catch(() => ({} as TesterRunHistory));
  const existing = history[record.capabilityId] || [];
  const next = {
    ...history,
    [record.capabilityId]: [record, ...existing].slice(0, 40),
  };
  await saveTesterRunHistory(next);
  return next;
}
