import type { JsonValue } from '@nimiplatform/kit/shell/renderer/bridge';
import { isJsonObject } from '@nimiplatform/sdk/types';

import type { TesterRunHistory, TesterRunHistoryRecord } from './tester-history.js';
import { readTesterStandardStorageJson, writeTesterStandardStorageJson } from './tester-standard-storage.js';

const TESTER_RUN_HISTORY_STORAGE_PATH = 'tester-run-history.json';

function parseHistory(value: JsonValue | undefined): TesterRunHistory {
  if (value === undefined) return {};
  if (!isJsonObject(value)) {
    throw new Error('Tester run history payload must be an object.');
  }
  return value as TesterRunHistory;
}

export async function loadTesterRunHistory(): Promise<TesterRunHistory> {
  return parseHistory(await readTesterStandardStorageJson(TESTER_RUN_HISTORY_STORAGE_PATH));
}

export async function saveTesterRunHistory(history: TesterRunHistory): Promise<void> {
  await writeTesterStandardStorageJson(TESTER_RUN_HISTORY_STORAGE_PATH, history as JsonValue);
}

export async function appendTesterRunHistory(record: TesterRunHistoryRecord): Promise<TesterRunHistory> {
  const history = await loadTesterRunHistory();
  const existing = history[record.capabilityId] || [];
  const next = {
    ...history,
    [record.capabilityId]: [record, ...existing].slice(0, 40),
  };
  await saveTesterRunHistory(next);
  return next;
}
