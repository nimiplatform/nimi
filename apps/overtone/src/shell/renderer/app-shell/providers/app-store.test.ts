import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from './app-store.js';

function resetStore() {
  useAppStore.setState(useAppStore.getInitialState());
}

describe('app-store', () => {
  beforeEach(() => {
    resetStore();
  });

  describe('setRuntimeStatus', () => {
    it('sets status and error', () => {
      useAppStore.getState().setRuntimeStatus('unavailable', 'daemon crashed');
      const state = useAppStore.getState();
      expect(state.runtimeStatus).toBe('unavailable');
      expect(state.runtimeError).toBe('daemon crashed');
    });

    it('clears error when not provided', () => {
      useAppStore.getState().setRuntimeStatus('unavailable', 'err');
      useAppStore.getState().setRuntimeStatus('ready');
      expect(useAppStore.getState().runtimeError).toBeNull();
    });
  });

  describe('setRealmConnection', () => {
    it('sets configured and authenticated', () => {
      useAppStore.getState().setRealmConnection(true, true);
      const state = useAppStore.getState();
      expect(state.realmConfigured).toBe(true);
      expect(state.realmAuthenticated).toBe(true);
    });
  });

  describe('setReadiness', () => {
    it('sets connector availability from IDs', () => {
      useAppStore.getState().setReadiness({
        textConnectorId: 'tc-1',
        textModelId: 'tm-1',
        musicConnectorId: 'mc-1',
        musicModelId: 'mm-1',
        musicIterationSupported: true,
        issues: ['minor issue'],
      });
      const state = useAppStore.getState();
      expect(state.textConnectorAvailable).toBe(true);
      expect(state.musicConnectorAvailable).toBe(true);
      expect(state.musicIterationSupported).toBe(true);
      expect(state.selectedMusicConnectorId).toBe('mc-1');
      expect(state.readinessIssues).toEqual(['minor issue']);
    });

    it('reports unavailable when IDs are missing', () => {
      useAppStore.getState().setReadiness({
        musicIterationSupported: false,
        issues: [],
      });
      const state = useAppStore.getState();
      expect(state.textConnectorAvailable).toBe(false);
      expect(state.musicConnectorAvailable).toBe(false);
    });
  });

  describe('brief and lyrics', () => {
    it('sets and clears brief', () => {
      const brief = { title: 'Test', genre: 'pop', mood: 'happy', tempo: '120', description: 'desc' };
      useAppStore.getState().setBrief(brief);
      expect(useAppStore.getState().brief).toEqual(brief);
      useAppStore.getState().setBrief(null);
      expect(useAppStore.getState().brief).toBeNull();
    });

    it('sets lyrics', () => {
      useAppStore.getState().setLyrics('verse one');
      expect(useAppStore.getState().lyrics).toBe('verse one');
    });
  });

  describe('takes', () => {
    const makeTake = (id: string) => ({
      takeId: id,
      origin: 'prompt' as const,
      title: `Take ${id}`,
      jobId: `job-${id}`,
      promptSnapshot: 'prompt',
      createdAt: Date.now(),
    });

    it('addTake appends and selects', () => {
      const take = makeTake('t1');
      useAppStore.getState().addTake(take);
      expect(useAppStore.getState().takes).toHaveLength(1);
      expect(useAppStore.getState().selectedTakeId).toBe('t1');
    });

    it('selectTake changes selection', () => {
      useAppStore.getState().addTake(makeTake('t1'));
      useAppStore.getState().addTake(makeTake('t2'));
      useAppStore.getState().selectTake('t1');
      expect(useAppStore.getState().selectedTakeId).toBe('t1');
    });

    it('toggleFavorite flips favorite flag', () => {
      useAppStore.getState().addTake(makeTake('t1'));
      useAppStore.getState().toggleFavorite('t1');
      expect(useAppStore.getState().takes[0]!.favorite).toBe(true);
      useAppStore.getState().toggleFavorite('t1');
      expect(useAppStore.getState().takes[0]!.favorite).toBe(false);
    });

    it('renameTake updates title', () => {
      useAppStore.getState().addTake(makeTake('t1'));
      useAppStore.getState().renameTake('t1', 'New Title');
      expect(useAppStore.getState().takes[0]!.title).toBe('New Title');
    });

    it('discardTake removes take and cleans up', () => {
      useAppStore.getState().addTake(makeTake('t1'));
      useAppStore.getState().addTake(makeTake('t2'));
      useAppStore.getState().setAudioBuffer('t1', new ArrayBuffer(8));
      useAppStore.getState().discardTake('t1');
      expect(useAppStore.getState().takes).toHaveLength(1);
      expect(useAppStore.getState().audioBuffers.has('t1')).toBe(false);
    });

    it('discardTake selects next take when active take is discarded', () => {
      useAppStore.getState().addTake(makeTake('t1'));
      useAppStore.getState().addTake(makeTake('t2'));
      useAppStore.getState().selectTake('t1');
      useAppStore.getState().discardTake('t1');
      expect(useAppStore.getState().selectedTakeId).toBe('t2');
    });
  });

  describe('compare', () => {
    it('setCompareTakeSlot sets individual slots', () => {
      useAppStore.getState().setCompareTakeSlot(0, 'a');
      useAppStore.getState().setCompareTakeSlot(1, 'b');
      expect(useAppStore.getState().compareTakeIds).toEqual(['a', 'b']);
    });

    it('clearCompareTakeIds resets both slots', () => {
      useAppStore.getState().setCompareTakeSlot(0, 'a');
      useAppStore.getState().clearCompareTakeIds();
      expect(useAppStore.getState().compareTakeIds).toEqual([null, null]);
    });
  });

  describe('jobs', () => {
    it('setJobStatus adds and updates jobs', () => {
      useAppStore.getState().setJobStatus('j1', { jobId: 'j1', status: 'pending' });
      expect(useAppStore.getState().activeJobs.get('j1')?.status).toBe('pending');
      useAppStore.getState().setJobStatus('j1', { jobId: 'j1', status: 'running' });
      expect(useAppStore.getState().activeJobs.get('j1')?.status).toBe('running');
    });

    it('removeJob deletes from map', () => {
      useAppStore.getState().setJobStatus('j1', { jobId: 'j1', status: 'pending' });
      useAppStore.getState().removeJob('j1');
      expect(useAppStore.getState().activeJobs.has('j1')).toBe(false);
    });
  });

  describe('audio buffers', () => {
    it('setAudioBuffer stores buffer', () => {
      const buf = new ArrayBuffer(16);
      useAppStore.getState().setAudioBuffer('t1', buf);
      expect(useAppStore.getState().audioBuffers.get('t1')).toBe(buf);
    });
  });

  describe('trim', () => {
    it('setTrimStart and setTrimEnd set values', () => {
      useAppStore.getState().setTrimStart(5.5);
      useAppStore.getState().setTrimEnd(30.0);
      expect(useAppStore.getState().trimStart).toBe(5.5);
      expect(useAppStore.getState().trimEnd).toBe(30.0);
    });

    it('clearTrim resets both to null', () => {
      useAppStore.getState().setTrimStart(5);
      useAppStore.getState().setTrimEnd(10);
      useAppStore.getState().clearTrim();
      expect(useAppStore.getState().trimStart).toBeNull();
      expect(useAppStore.getState().trimEnd).toBeNull();
    });
  });

  describe('project lifecycle', () => {
    it('startProject generates a project ID', () => {
      useAppStore.getState().startProject();
      expect(useAppStore.getState().projectId).toMatch(/^proj-/);
    });

    it('resetProject clears all project state including trim', () => {
      useAppStore.getState().startProject();
      useAppStore.getState().setBrief({ title: 'T', genre: 'g', mood: 'm', tempo: 't', description: 'd' });
      useAppStore.getState().setLyrics('lyrics');
      useAppStore.getState().setTrimStart(5);
      useAppStore.getState().setTrimEnd(10);
      useAppStore.getState().addTake({
        takeId: 't1',
        origin: 'prompt',
        title: 'T',
        jobId: 'j1',
        promptSnapshot: 'p',
        createdAt: Date.now(),
      });

      useAppStore.getState().resetProject();
      const state = useAppStore.getState();
      expect(state.projectId).toBeNull();
      expect(state.brief).toBeNull();
      expect(state.lyrics).toBe('');
      expect(state.takes).toHaveLength(0);
      expect(state.trimStart).toBeNull();
      expect(state.trimEnd).toBeNull();
      expect(state.selectedTakeId).toBeNull();
    });
  });
});
