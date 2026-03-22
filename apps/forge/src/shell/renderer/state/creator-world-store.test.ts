import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock default snapshot ────────────────────────────────────
const mockDefaultSnapshot = {
  createStep: 'SOURCE',
  sourceText: '',
  sourceRef: '',
  selectedStartTimeId: '',
  selectedCharacters: [],
  panel: { searchText: '', selectedWorldId: '', selectedDraftId: '', activeMaintainTab: 'WORLD' },
  parseJob: {
    phase: 'idle',
    chunkTotal: 0,
    chunkProcessed: 0,
    chunkCompleted: 0,
    chunkFailed: 0,
    progress: 0,
    etaSeconds: null,
    startedAt: null,
    updatedAt: null,
  },
  knowledgeGraph: { events: { primary: [], secondary: [] }, characters: [], locations: [] },
  worldPatch: {},
  worldviewPatch: {},
  ruleTruthDraft: { worldRules: [], agentRules: [] },
  eventsDraft: { primary: [], secondary: [] },
  lorebooksDraft: [],
  phase1Artifact: null,
  assets: {
    worldCover: { status: 'idle', imageUrl: null },
    characterPortraits: {},
    locationImages: {},
  },
  agentSync: { selectedCharacterIds: [], draftsByCharacter: {} },
  eventGraphLayout: { selectedEventId: '', expandedPrimaryIds: [] },
  embeddingIndex: { entries: {} },
  finalDraftAccumulator: {
    world: {},
    worldview: {},
    worldLorebooks: [],
    futureHistoricalEvents: [],
    agentDraftsByCharacter: {},
    revisions: [],
    lastUpdatedChunk: -1,
  },
  taskState: { activeTask: null, recentTasks: [], expertMode: false },
  editorSnapshotVersion: '',
  unsavedChangesByPanel: {},
  futureEventsText: '',
};

function freshSnapshot() {
  return JSON.parse(JSON.stringify(mockDefaultSnapshot));
}

// ── Mocks ────────────────────────────────────────────────────
vi.mock('@world-engine/state/workspace/defaults.js', () => ({
  cloneDefaultSnapshot: vi.fn(() => freshSnapshot()),
}));
vi.mock('@world-engine/state/workspace/normalize.js', () => ({
  syncSnapshot: vi.fn((s: unknown) => s),
}));

const mockLoadLocalStorageJson = vi.fn<(...args: unknown[]) => unknown>(() => null);
const mockSaveLocalStorageJson = vi.fn<(...args: unknown[]) => void>();

vi.mock('@nimiplatform/sdk/mod', () => ({
  asRecord: (v: unknown) => (v && typeof v === 'object' ? v : {}),
  loadLocalStorageJson: (...args: unknown[]) => mockLoadLocalStorageJson(...(args as [unknown?, unknown?, unknown?])),
  saveLocalStorageJson: (...args: unknown[]) => mockSaveLocalStorageJson(...(args as [unknown?, unknown?])),
}));

const { useCreatorWorldStore } = await import('./creator-world-store.js');
const {
  toForgeWorkspaceSnapshot,
  toPersistedForgeWorkspaceSnapshot,
  toWorldStudioWorkspacePatch,
} = await import('./creator-world-workspace.js');

describe('creator-world-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCreatorWorldStore.setState({ snapshot: freshSnapshot() });
  });

  // ── setCreateStep ────────────────────────────────────────────

  describe('setCreateStep', () => {
    it('updates createStep in snapshot', () => {
      useCreatorWorldStore.getState().setCreateStep('CHARACTERS' as never);
      expect(useCreatorWorldStore.getState().snapshot.createStep).toBe('CHARACTERS');
    });

    it('preserves other snapshot fields', () => {
      useCreatorWorldStore.setState({
        snapshot: { ...freshSnapshot(), sourceText: 'keep-me' },
      });
      useCreatorWorldStore.getState().setCreateStep('EVENTS' as never);
      const snap = useCreatorWorldStore.getState().snapshot;
      expect(snap.createStep).toBe('EVENTS');
      expect(snap.sourceText).toBe('keep-me');
    });
  });

  // ── patchSnapshot ────────────────────────────────────────────

  describe('patchSnapshot', () => {
    it('patches sourceText', () => {
      useCreatorWorldStore.getState().patchSnapshot({ sourceText: 'new text' } as never);
      expect(useCreatorWorldStore.getState().snapshot.sourceText).toBe('new text');
    });

    it('patches selectedCharacters', () => {
      useCreatorWorldStore.getState().patchSnapshot({ selectedCharacters: ['c1', 'c2'] } as never);
      expect(useCreatorWorldStore.getState().snapshot.selectedCharacters).toEqual(['c1', 'c2']);
    });

    it('filters empty strings from selectedCharacters', () => {
      useCreatorWorldStore.getState().patchSnapshot({ selectedCharacters: ['c1', '', 'c2'] } as never);
      expect(useCreatorWorldStore.getState().snapshot.selectedCharacters).toEqual(['c1', 'c2']);
    });

    it('deep merges panel', () => {
      useCreatorWorldStore.setState({
        snapshot: { ...freshSnapshot(), panel: { activeSection: 'BASE', extra: 'keep' } as never },
      });
      useCreatorWorldStore.getState().patchSnapshot({ panel: { activeSection: 'WORLD_EVENTS' } } as never);
      const panel = useCreatorWorldStore.getState().snapshot.panel;
      expect(panel.activeSection).toBe('WORLD_EVENTS');
      expect((panel as Record<string, unknown>).extra).toBe('keep');
    });

    it('deep merges parseJob', () => {
      useCreatorWorldStore.getState().patchSnapshot({ parseJob: { phase: 'extract' } } as never);
      const parseJob = useCreatorWorldStore.getState().snapshot.parseJob;
      expect(parseJob.phase).toBe('extract');
      expect(parseJob.chunkTotal).toBe(0);
    });

    it('deep merges knowledgeGraph events', () => {
      const primaryEvent = { id: 'e1', title: 'Event 1' };
      useCreatorWorldStore.getState().patchSnapshot({
        knowledgeGraph: { events: { primary: [primaryEvent] } },
      } as never);
      const kg = useCreatorWorldStore.getState().snapshot.knowledgeGraph;
      expect(kg.events.primary).toEqual([primaryEvent]);
      expect(kg.events.secondary).toEqual([]);
    });

    it('patches worldStateDraft through the workspace adapter', () => {
      useCreatorWorldStore.getState().patchSnapshot(
        toWorldStudioWorkspacePatch({ worldStateDraft: { name: 'My World' } }) as never,
      );
      expect(toForgeWorkspaceSnapshot(useCreatorWorldStore.getState().snapshot).worldStateDraft).toEqual({
        name: 'My World',
      });
    });

    it('patches worldviewPatch', () => {
      useCreatorWorldStore.getState().patchSnapshot({ worldviewPatch: { tone: 'dark' } } as never);
      expect(useCreatorWorldStore.getState().snapshot.worldviewPatch).toEqual({ tone: 'dark' });
    });

    it('patches eventsDraft primary', () => {
      const events = [{ id: 'e1' }, { id: 'e2' }];
      useCreatorWorldStore.getState().patchSnapshot({ eventsDraft: { primary: events } } as never);
      expect(useCreatorWorldStore.getState().snapshot.eventsDraft.primary).toEqual(events);
      expect(useCreatorWorldStore.getState().snapshot.eventsDraft.secondary).toEqual([]);
    });

    it('patches eventsDraft secondary', () => {
      const events = [{ id: 's1' }];
      useCreatorWorldStore.getState().patchSnapshot({ eventsDraft: { secondary: events } } as never);
      expect(useCreatorWorldStore.getState().snapshot.eventsDraft.secondary).toEqual(events);
      expect(useCreatorWorldStore.getState().snapshot.eventsDraft.primary).toEqual([]);
    });

    it('patches lorebooksDraft with array', () => {
      const lorebooks = [{ id: 'lb1', title: 'Lore' }];
      useCreatorWorldStore.getState().patchSnapshot({ lorebooksDraft: lorebooks } as never);
      expect(useCreatorWorldStore.getState().snapshot.lorebooksDraft).toEqual(lorebooks);
    });

    it('keeps existing lorebooksDraft when patch is not array', () => {
      const existing = [{ id: 'lb1' }];
      useCreatorWorldStore.setState({
        snapshot: { ...freshSnapshot(), lorebooksDraft: existing },
      });
      useCreatorWorldStore.getState().patchSnapshot({ lorebooksDraft: 'invalid' } as never);
      expect(useCreatorWorldStore.getState().snapshot.lorebooksDraft).toEqual(existing);
    });

    it('deep merges assets worldCover', () => {
      useCreatorWorldStore.getState().patchSnapshot({
        assets: { worldCover: { status: 'complete', url: 'https://img.png' } },
      } as never);
      expect(useCreatorWorldStore.getState().snapshot.assets.worldCover).toEqual({
        imageUrl: null,
        status: 'complete',
        url: 'https://img.png',
      });
    });

    it('deep merges assets characterPortraits', () => {
      useCreatorWorldStore.getState().patchSnapshot({
        assets: { characterPortraits: { char1: { url: 'https://c1.png' } } },
      } as never);
      expect(useCreatorWorldStore.getState().snapshot.assets.characterPortraits).toEqual({
        char1: { url: 'https://c1.png' },
      });
    });

    it('deep merges assets locationImages', () => {
      useCreatorWorldStore.getState().patchSnapshot({
        assets: { locationImages: { loc1: { url: 'https://l1.png' } } },
      } as never);
      expect(useCreatorWorldStore.getState().snapshot.assets.locationImages).toEqual({
        loc1: { url: 'https://l1.png' },
      });
    });

    it('deep merges agentSync selectedCharacterIds', () => {
      useCreatorWorldStore.getState().patchSnapshot({
        agentSync: { selectedCharacterIds: ['a1', 'a2'] },
      } as never);
      expect(useCreatorWorldStore.getState().snapshot.agentSync.selectedCharacterIds).toEqual(['a1', 'a2']);
    });

    it('deep merges agentSync draftsByCharacter', () => {
      useCreatorWorldStore.getState().patchSnapshot({
        agentSync: {
          draftsByCharacter: {
            Alice: { handle: 'alice_handle', concept: 'hero' },
          },
        },
      } as never);
      const drafts = useCreatorWorldStore.getState().snapshot.agentSync.draftsByCharacter;
      const alice = drafts.Alice;
      expect(alice).toBeDefined();
      expect(alice?.handle).toBe('alice_handle');
      expect(alice?.concept).toBe('hero');
      expect(alice?.characterName).toBe('Alice');
    });

    it('deep merges eventGraphLayout', () => {
      useCreatorWorldStore.getState().patchSnapshot({
        eventGraphLayout: { selectedEventId: 'ev1', expandedPrimaryIds: ['p1'] },
      } as never);
      const layout = useCreatorWorldStore.getState().snapshot.eventGraphLayout;
      expect(layout.selectedEventId).toBe('ev1');
      expect(layout.expandedPrimaryIds).toEqual(['p1']);
    });

    it('patches finalDraftAccumulator world and worldview', () => {
      useCreatorWorldStore.getState().patchSnapshot({
        finalDraftAccumulator: {
          world: { name: 'Test World' },
          worldview: { genre: 'fantasy' },
        },
      } as never);
      const fda = useCreatorWorldStore.getState().snapshot.finalDraftAccumulator;
      expect(fda.world).toEqual({ name: 'Test World' });
      expect(fda.worldview).toEqual({ genre: 'fantasy' });
    });

    it('patches finalDraftAccumulator arrays', () => {
      const lorebooks = [{ id: 'lb1' }];
      const events = [{ id: 'fhe1' }];
      const revisions = [{ id: 'rev1' }];
      useCreatorWorldStore.getState().patchSnapshot({
        finalDraftAccumulator: {
          worldLorebooks: lorebooks,
          futureHistoricalEvents: events,
          revisions,
        },
      } as never);
      const fda = useCreatorWorldStore.getState().snapshot.finalDraftAccumulator;
      expect(fda.worldLorebooks).toEqual(lorebooks);
      expect(fda.futureHistoricalEvents).toEqual(events);
      expect(fda.revisions).toEqual(revisions);
    });

    it('patches finalDraftAccumulator lastUpdatedChunk', () => {
      useCreatorWorldStore.getState().patchSnapshot({
        finalDraftAccumulator: { lastUpdatedChunk: 5 },
      } as never);
      expect(useCreatorWorldStore.getState().snapshot.finalDraftAccumulator.lastUpdatedChunk).toBe(5);
    });

    it('patches finalDraftAccumulator agentDraftsByCharacter', () => {
      useCreatorWorldStore.getState().patchSnapshot({
        finalDraftAccumulator: {
          agentDraftsByCharacter: { Bob: { name: 'Bob' } },
        },
      } as never);
      expect(useCreatorWorldStore.getState().snapshot.finalDraftAccumulator.agentDraftsByCharacter).toEqual({
        Bob: { name: 'Bob' },
      });
    });

    it('patches taskState', () => {
      useCreatorWorldStore.getState().patchSnapshot({
        taskState: { expertMode: true },
      } as never);
      const ts = useCreatorWorldStore.getState().snapshot.taskState;
      expect(ts.expertMode).toBe(true);
      expect(ts.recentTasks).toEqual([]);
    });

    it('patches taskState recentTasks', () => {
      const tasks = [{ id: 't1' }];
      useCreatorWorldStore.getState().patchSnapshot({
        taskState: { recentTasks: tasks },
      } as never);
      expect(useCreatorWorldStore.getState().snapshot.taskState.recentTasks).toEqual(tasks);
    });

    it('patches workspaceVersion through the workspace adapter', () => {
      useCreatorWorldStore.getState().patchSnapshot(
        toWorldStudioWorkspacePatch({ workspaceVersion: 'v2' }) as never,
      );
      expect(toForgeWorkspaceSnapshot(useCreatorWorldStore.getState().snapshot).workspaceVersion).toBe('v2');
    });

    it('patches unsavedChangesByPanel', () => {
      useCreatorWorldStore.getState().patchSnapshot({
        unsavedChangesByPanel: { events: true },
      } as never);
      expect(useCreatorWorldStore.getState().snapshot.unsavedChangesByPanel).toEqual({ events: true });
    });
  });

  // ── patchPanel ─────────────────────────────────────────────

  describe('patchPanel', () => {
    it('shallow merges panel', () => {
      useCreatorWorldStore.getState().patchPanel({ activeSection: 'WORLD_EVENTS' } as never);
      expect(useCreatorWorldStore.getState().snapshot.panel.activeSection).toBe('WORLD_EVENTS');
    });

    it('preserves existing panel fields', () => {
      useCreatorWorldStore.setState({
        snapshot: { ...freshSnapshot(), panel: { activeSection: 'BASE', tab: 'info' } as never },
      });
      useCreatorWorldStore.getState().patchPanel({ activeSection: 'LOREBOOKS' } as never);
      const panel = useCreatorWorldStore.getState().snapshot.panel as Record<string, unknown>;
      expect(panel.activeSection).toBe('LOREBOOKS');
      expect(panel.tab).toBe('info');
    });
  });

  // ── hydrateForUser ─────────────────────────────────────────

  describe('hydrateForUser', () => {
    it('loads snapshot from localStorage when stored data exists under Forge workspace keys', () => {
      const stored = {
        ...toPersistedForgeWorkspaceSnapshot(freshSnapshot()),
        sourceText: 'stored text',
        createStep: 'EVENTS',
        worldStateDraft: { name: 'Stored Realm' },
        workspaceVersion: 'workspace-v1',
      };
      mockLoadLocalStorageJson.mockReturnValue(stored);
      useCreatorWorldStore.getState().hydrateForUser('user-1');
      expect(mockLoadLocalStorageJson).toHaveBeenCalled();
      const snap = useCreatorWorldStore.getState().snapshot;
      expect(snap.sourceText).toBe('stored text');
      expect(toForgeWorkspaceSnapshot(snap).worldStateDraft).toEqual({ name: 'Stored Realm' });
      expect(toForgeWorkspaceSnapshot(snap).workspaceVersion).toBe('workspace-v1');
    });

    it('resets to default snapshot when no stored data', () => {
      mockLoadLocalStorageJson.mockReturnValue(null);
      useCreatorWorldStore.setState({
        snapshot: { ...freshSnapshot(), sourceText: 'dirty' },
      });
      useCreatorWorldStore.getState().hydrateForUser('user-2');
      expect(useCreatorWorldStore.getState().snapshot.sourceText).toBe('');
    });

    it('does not load for empty userId', () => {
      useCreatorWorldStore.setState({
        snapshot: { ...freshSnapshot(), sourceText: 'before' },
      });
      useCreatorWorldStore.getState().hydrateForUser('');
      // With empty userId, readSnapshotFromStorage returns null, so defaults are set
      expect(useCreatorWorldStore.getState().snapshot.createStep).toBe('SOURCE');
    });
  });

  // ── persistForUser ─────────────────────────────────────────

  describe('persistForUser', () => {
    it('saves snapshot to localStorage with Forge workspace keys', () => {
      useCreatorWorldStore.setState({
        snapshot: {
          ...freshSnapshot(),
          sourceText: 'save me',
          worldPatch: { name: 'Persisted Realm' },
          editorSnapshotVersion: 'workspace-v2',
        },
      });
      useCreatorWorldStore.getState().persistForUser('user-1');
      expect(mockSaveLocalStorageJson).toHaveBeenCalled();
      const firstCall = mockSaveLocalStorageJson.mock.calls[0] || [];
      const [key, payload] = firstCall;
      expect(key).toContain('user-1');
      expect(payload).toMatchObject({
        sourceText: 'save me',
        worldStateDraft: { name: 'Persisted Realm' },
        workspaceVersion: 'workspace-v2',
      });
      expect(payload).not.toHaveProperty('worldPatch');
      expect(payload).not.toHaveProperty('editorSnapshotVersion');
    });

    it('does not save for empty userId', () => {
      useCreatorWorldStore.getState().persistForUser('');
      expect(mockSaveLocalStorageJson).not.toHaveBeenCalled();
    });
  });

  // ── resetSnapshot ──────────────────────────────────────────

  describe('resetSnapshot', () => {
    it('resets to default snapshot', () => {
      useCreatorWorldStore.setState({
        snapshot: { ...freshSnapshot(), sourceText: 'dirty', createStep: 'EVENTS' },
      });
      useCreatorWorldStore.getState().resetSnapshot();
      const snap = useCreatorWorldStore.getState().snapshot;
      expect(snap.createStep).toBe('SOURCE');
      expect(snap.sourceText).toBe('');
    });
  });
});
