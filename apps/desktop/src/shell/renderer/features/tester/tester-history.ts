import { useCallback, useEffect, useRef, useState } from 'react';
import { invokeTauri } from '@runtime/tauri-api';
import type { CapabilityId, CapabilityState, CapabilityStates } from './tester-types.js';
import { asString } from './tester-utils.js';

export type TesterHistoryEntry = {
  id: string;
  capabilityId: CapabilityId;
  at: number;
  status: 'passed' | 'failed';
  prompt: string;
  outputSummary: string;
  error?: string;
  elapsedMs?: number;
  modelResolved?: string;
  source?: 'local' | 'cloud';
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type TesterHistoryByCap = Record<CapabilityId, TesterHistoryEntry[]>;

const MAX_PER_CAP = 30;

async function readFromStorage(): Promise<TesterHistoryByCap> {
  const raw = await invokeTauri<string>('tester_run_history_load');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Tester run history payload must be an object.');
  }
  return parsed as TesterHistoryByCap;
}

async function writeToStorage(history: TesterHistoryByCap): Promise<void> {
  await invokeTauri('tester_run_history_save', { payload: { recordsJson: JSON.stringify(history) } });
}

function summarizeOutput(state: CapabilityState): string {
  const output = state.output;
  if (output == null) return '';
  if (typeof output === 'string') return output.trim().slice(0, 600);
  try {
    return JSON.stringify(output).slice(0, 600);
  } catch {
    return String(output).slice(0, 600);
  }
}

function extractPrompt(state: CapabilityState): string {
  const params = state.diagnostics.requestParams;
  if (!params) return '';
  const preferKeys = ['input', 'prompt', 'text', 'content'];
  for (const key of preferKeys) {
    const value = params[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim().slice(0, 400);
    }
    if (Array.isArray(value)) {
      const firstString = value.find((entry) => typeof entry === 'string') as string | undefined;
      if (firstString && firstString.trim()) return firstString.trim().slice(0, 400);
    }
  }
  return '';
}

function buildEntry(
  capabilityId: CapabilityId,
  state: CapabilityState,
  previousElapsed: number | undefined,
): TesterHistoryEntry {
  const meta = state.diagnostics.responseMetadata;
  const route = state.diagnostics.resolvedRoute;
  const source = route?.source === 'local' || route?.source === 'cloud' ? (route.source as 'local' | 'cloud') : undefined;
  return {
    id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    capabilityId,
    at: Date.now(),
    status: state.result === 'failed' ? 'failed' : 'passed',
    prompt: extractPrompt(state),
    outputSummary: state.result === 'failed' ? '' : summarizeOutput(state),
    error: state.result === 'failed' ? asString(state.error) : undefined,
    elapsedMs: typeof meta?.elapsed === 'number' ? meta.elapsed : previousElapsed,
    modelResolved: meta?.modelResolved || route?.modelId || route?.model || route?.localModelId,
    source,
    inputTokens: meta?.inputTokens,
    outputTokens: meta?.outputTokens,
    totalTokens: meta?.totalTokens,
  };
}

export function useTesterHistory(states: CapabilityStates) {
  const [history, setHistory] = useState<TesterHistoryByCap>({} as TesterHistoryByCap);
  const [storageError, setStorageError] = useState('');
  const lastRecordedStampRef = useRef<Record<string, string>>({});
  const previousBusyRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    void readFromStorage().then((loaded) => {
      if (!cancelled) {
        setHistory(loaded);
        setStorageError('');
      }
    }).catch((error) => {
      if (!cancelled) {
        setStorageError(error instanceof Error ? error.message : String(error || 'Failed to load Tester run history.'));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const pendingEntries: Array<{ capabilityId: CapabilityId; entry: TesterHistoryEntry }> = [];

    for (const [capabilityId, state] of Object.entries(states) as Array<[CapabilityId, CapabilityState]>) {
      const prevBusy = previousBusyRef.current[capabilityId] === true;
      const nowIdle = state.busy === false;
      const wasBusyTransition = prevBusy && nowIdle;
      previousBusyRef.current[capabilityId] = state.busy === true;
      if (!wasBusyTransition) continue;
      if (state.result !== 'passed' && state.result !== 'failed') continue;

      const stamp = state.diagnostics.responseMetadata?.elapsed;
      const stampKey = `${capabilityId}:${state.result}:${stamp ?? ''}:${(state.output as unknown as string)?.length ?? 0}:${state.error?.length ?? 0}`;
      const lastKey = lastRecordedStampRef.current[capabilityId];
      if (lastKey === stampKey) continue;

      lastRecordedStampRef.current[capabilityId] = stampKey;
      pendingEntries.push({
        capabilityId,
        entry: buildEntry(capabilityId, state, stamp),
      });
    }

    if (pendingEntries.length === 0) return;

    setHistory((prev) => {
      const nextHistory: TesterHistoryByCap = { ...prev };
      for (const { capabilityId, entry } of pendingEntries) {
        const existing = nextHistory[capabilityId] ?? [];
        nextHistory[capabilityId] = [entry, ...existing].slice(0, MAX_PER_CAP);
      }
      void writeToStorage(nextHistory).then(() => setStorageError('')).catch((error) => {
        setStorageError(error instanceof Error ? error.message : String(error || 'Failed to save Tester run history.'));
      });
      return nextHistory;
    });
  }, [states]);

  const clearCapability = useCallback((capabilityId: CapabilityId) => {
    setHistory((prev) => {
      if (!prev[capabilityId] || prev[capabilityId].length === 0) return prev;
      const next = { ...prev, [capabilityId]: [] };
      void writeToStorage(next).then(() => setStorageError('')).catch((error) => {
        setStorageError(error instanceof Error ? error.message : String(error || 'Failed to save Tester run history.'));
      });
      return next;
    });
  }, []);

  const removeEntry = useCallback((capabilityId: CapabilityId, entryId: string) => {
    setHistory((prev) => {
      const entries = prev[capabilityId];
      if (!entries || entries.length === 0) return prev;
      const remaining = entries.filter((entry) => entry.id !== entryId);
      if (remaining.length === entries.length) return prev;
      const next = { ...prev, [capabilityId]: remaining };
      void writeToStorage(next).then(() => setStorageError('')).catch((error) => {
        setStorageError(error instanceof Error ? error.message : String(error || 'Failed to save Tester run history.'));
      });
      return next;
    });
  }, []);

  return { history, clearCapability, removeEntry, storageError };
}
