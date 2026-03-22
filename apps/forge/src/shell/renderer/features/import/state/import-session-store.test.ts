import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useImportSessionStore } from './import-session-store.js';

const STORAGE_KEY = 'nimi:forge:import:novel:session-1';
const storage = new Map<string, string>();

vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, value);
  },
  removeItem: (key: string) => {
    storage.delete(key);
  },
  clear: () => {
    storage.clear();
  },
});

function clearLocalStorage(): void {
  localStorage.clear();
}

describe('import-session-store', () => {
  beforeEach(() => {
    clearLocalStorage();
    useImportSessionStore.setState(useImportSessionStore.getInitialState());
  });

  it('rejects restoring malformed persisted novel sessions', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      sessionId: 'session-1',
      novelImport: 'bad-shape',
    }));

    expect(useImportSessionStore.getState().restoreNovelSession('session-1')).toBe(false);
    expect(useImportSessionStore.getState().sessionId).toBe('');
  });

  it('restores validated novel session payloads', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      sessionId: 'session-1',
      novelImport: {
        machineState: 'PAUSED',
        mode: 'manual',
        sourceManifest: null,
        accumulator: null,
        currentChapterResult: null,
        progress: { current: 2, total: 5 },
        error: 'paused',
      },
      targetWorldId: 'world-1',
      targetWorldName: 'World 1',
    }));

    expect(useImportSessionStore.getState().restoreNovelSession('session-1')).toBe(true);
    const state = useImportSessionStore.getState();
    expect(state.sessionId).toBe('session-1');
    expect(state.novelImport.machineState).toBe('PAUSED');
    expect(state.novelImport.progress).toEqual({ current: 2, total: 5 });
    expect(state.targetWorldId).toBe('world-1');
  });
});
