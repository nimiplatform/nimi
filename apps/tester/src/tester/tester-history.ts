import { invokeTesterCommand } from './tester-tauri.js';
import { getTesterCapability, type TesterCapabilityId } from './tester-capabilities.js';

export type TesterRunHistoryRecord = {
  id: string;
  capabilityId: string;
  prompt: string;
  status: 'unavailable' | 'ready' | 'failed' | 'local-fixture';
  message: string;
  createdAt: string;
};

export type TesterRunHistory = Record<string, TesterRunHistoryRecord[]>;

export type TesterFlatRunRecord = TesterRunHistoryRecord & {
  capabilityLabel: string;
};

export type TesterRunStatusTone = 'success' | 'warning' | 'danger' | 'info';

export function flattenTesterRunHistory(history: TesterRunHistory | null): TesterFlatRunRecord[] {
  if (!history) return [];
  const records: TesterFlatRunRecord[] = [];
  for (const [capabilityId, list] of Object.entries(history)) {
    let capabilityLabel = capabilityId;
    try {
      capabilityLabel = getTesterCapability(capabilityId as TesterCapabilityId).label;
    } catch {
      capabilityLabel = capabilityId;
    }
    for (const record of list) {
      records.push({ ...record, capabilityLabel });
    }
  }
  records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return records;
}

export function getTesterRunStatusLabel(status: TesterRunHistoryRecord['status']): string {
  if (status === 'ready') return 'runtime ready';
  if (status === 'unavailable') return 'sdk unavailable';
  if (status === 'failed') return 'failed';
  return 'local fixture';
}

export function getTesterRunStatusTone(status: TesterRunHistoryRecord['status']): TesterRunStatusTone {
  if (status === 'ready') return 'success';
  if (status === 'local-fixture') return 'info';
  if (status === 'failed') return 'danger';
  return 'warning';
}

export function formatTesterRunTimestamp(value: string): string {
  try {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return value;
    return date.toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: '2-digit' });
  } catch {
    return value;
  }
}

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
