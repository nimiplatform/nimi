import { beforeEach, describe, expect, it } from 'vitest';

import { useImportSessionStore } from './import-session-store.js';

const STORAGE_KEY = 'nimi:forge:import:novel:session-1';

describe('import-session-store', () => {
  beforeEach(() => {
    localStorage.clear();
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
