import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the platform client matching actual realm() access pattern
const mockWorldControlController = {
  worldControlControllerGetMyAccess: vi.fn(),
  worldControlControllerResolveLanding: vi.fn(),
  worldControlControllerCreateDraft: vi.fn(),
  worldControlControllerGetDraft: vi.fn(),
  worldControlControllerListDrafts: vi.fn(),
  worldControlControllerUpdateDraft: vi.fn(),
  worldControlControllerPublishDraft: vi.fn(),
  worldControlControllerGetState: vi.fn(),
  worldControlControllerCommitState: vi.fn(),
  worldControlControllerListMyWorlds: vi.fn(),
  worldControlControllerListWorldHistory: vi.fn(),
  worldControlControllerAppendWorldHistory: vi.fn(),
  worldControlControllerListWorldLorebooks: vi.fn(),
  worldControlControllerListWorldMediaBindings: vi.fn(),
};

const mockWorldsService = {
  worldControllerGetWorld: vi.fn(),
  worldControllerGetWorldview: vi.fn(),
};

const mockWorldRulesService = {
  worldRulesControllerGetRules: vi.fn(),
  worldRulesControllerCreateRule: vi.fn(),
  worldRulesControllerUpdateRule: vi.fn(),
  worldRulesControllerDeprecateRule: vi.fn(),
  worldRulesControllerArchiveRule: vi.fn(),
};

const mockAgentRulesService = {
  agentRulesControllerListRules: vi.fn(),
  agentRulesControllerCreateRule: vi.fn(),
  agentRulesControllerUpdateRule: vi.fn(),
  agentRulesControllerDeprecateRule: vi.fn(),
  agentRulesControllerArchiveRule: vi.fn(),
};

const mockCreatorService = {
  creatorControllerListAgents: vi.fn(),
  creatorControllerCreateAgent: vi.fn(),
  creatorControllerBatchCreateAgents: vi.fn(),
};

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => ({
    realm: {
      services: {
        WorldControlService: mockWorldControlController,
        WorldsService: mockWorldsService,
        WorldRulesService: mockWorldRulesService,
        AgentRulesService: mockAgentRulesService,
        CreatorService: mockCreatorService,
      },
    },
  }),
}));

vi.mock('@renderer/app-shell/providers/app-store.js', () => ({
  useAppStore: {
    getState: () => ({
      auth: {
        user: { id: 'user-1' },
      },
    }),
  },
}));

const wdc = await import('./world-data-client.js');

const buildDraftPayload = () => ({
  importSource: {
    sourceType: 'TEXT' as const,
    sourceRef: 'manual',
    sourceText: 'seed text',
  },
  truthDraft: {
    worldRules: [{
      ruleKey: 'axiom:time:flow',
      title: 'Time flows',
      statement: 'Time moves forward.',
      category: 'DEFINITION',
      domain: 'AXIOM',
      hardness: 'HARD',
      priority: 100,
      provenance: 'CREATOR',
      scope: 'WORLD',
    }],
    agentRules: [],
  },
  stateDraft: {
    worldState: {
      name: 'Realm',
      description: 'A realm',
    },
  },
  historyDraft: {
    events: {
      primary: [],
      secondary: [],
    },
  },
  workflowState: {
    workspaceVersion: 'ws-1',
    createStep: 'REVIEW',
    selectedCharacters: [],
  },
});

describe('world-data-client', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('getMyWorldAccess normalizes hasActiveAccess from backend', async () => {
    mockWorldControlController.worldControlControllerGetMyAccess.mockResolvedValue({ hasActiveAccess: true, canCreateWorld: true });
    const result = await wdc.getMyWorldAccess();
    expect(result).toEqual({ hasAccess: true });
  });

  it('getMyWorldAccess normalizes hasActiveAccess false', async () => {
    mockWorldControlController.worldControlControllerGetMyAccess.mockResolvedValue({ hasActiveAccess: false });
    const result = await wdc.getMyWorldAccess();
    expect(result).toEqual({ hasAccess: false });
  });

  it('getMyWorldAccess rejects legacy or invalid contract shapes', async () => {
    mockWorldControlController.worldControlControllerGetMyAccess.mockResolvedValue('unexpected');
    await expect(wdc.getMyWorldAccess()).rejects.toThrow('FORGE_WORLD_ACCESS_CONTRACT_INVALID');

    mockWorldControlController.worldControlControllerGetMyAccess.mockResolvedValue({ hasAccess: true });
    await expect(wdc.getMyWorldAccess()).rejects.toThrow('FORGE_WORLD_ACCESS_CONTRACT_INVALID');

    mockWorldControlController.worldControlControllerGetMyAccess.mockResolvedValue({ hasCreatorAccess: true });
    await expect(wdc.getMyWorldAccess()).rejects.toThrow('FORGE_WORLD_ACCESS_CONTRACT_INVALID');

    mockWorldControlController.worldControlControllerGetMyAccess.mockResolvedValue({ hasActiveAccess: 'true' });
    await expect(wdc.getMyWorldAccess()).rejects.toThrow('FORGE_WORLD_ACCESS_CONTRACT_INVALID');

    mockWorldControlController.worldControlControllerGetMyAccess.mockResolvedValue({ hasActiveAccess: 1 });
    await expect(wdc.getMyWorldAccess()).rejects.toThrow('FORGE_WORLD_ACCESS_CONTRACT_INVALID');

    mockWorldControlController.worldControlControllerGetMyAccess.mockResolvedValue({ hasActiveAccess: {} });
    await expect(wdc.getMyWorldAccess()).rejects.toThrow('FORGE_WORLD_ACCESS_CONTRACT_INVALID');
  });

  it('resolveWorldLanding', async () => {
    mockWorldControlController.worldControlControllerResolveLanding.mockResolvedValue({ mode: 'CREATE' });
    await wdc.resolveWorldLanding();
    expect(mockWorldControlController.worldControlControllerResolveLanding).toHaveBeenCalledOnce();
  });

  it('createWorldDraft passes payload', async () => {
    const body = {
      sourceType: 'TEXT' as const,
      sourceRef: 'manual',
      draftPayload: buildDraftPayload(),
    };
    await wdc.createWorldDraft(body);
    expect(mockWorldControlController.worldControlControllerCreateDraft).toHaveBeenCalledWith(body);
  });

  it('getWorldDraft passes draftId', async () => {
    await wdc.getWorldDraft('d1');
    expect(mockWorldControlController.worldControlControllerGetDraft).toHaveBeenCalledWith('d1');
  });

  it('listWorldDrafts', async () => {
    mockWorldControlController.worldControlControllerListDrafts.mockResolvedValue({ items: [] });
    const result = await wdc.listWorldDrafts();
    expect(result).toEqual({ items: [] });
  });

  it('updateWorldDraft passes draftId and patch', async () => {
    await wdc.updateWorldDraft('d1', { status: 'REVIEW' });
    expect(mockWorldControlController.worldControlControllerUpdateDraft).toHaveBeenCalledWith('d1', { status: 'REVIEW' });
  });

  it('publishWorldDraft passes draftId and empty payload', async () => {
    await wdc.publishWorldDraft('d1');
    expect(mockWorldControlController.worldControlControllerPublishDraft).toHaveBeenCalledWith('d1', {});
  });

  it('getWorldState passes worldId', async () => {
    await wdc.getWorldState('w1');
    expect(mockWorldControlController.worldControlControllerGetState).toHaveBeenCalledWith('w1');
  });

  it('getWorldTruth passes worldId', async () => {
    await wdc.getWorldTruth('w1');
    expect(mockWorldsService.worldControllerGetWorld).toHaveBeenCalledWith('w1');
  });

  it('getWorldviewTruth passes worldId', async () => {
    await wdc.getWorldviewTruth('w1');
    expect(mockWorldsService.worldControllerGetWorldview).toHaveBeenCalledWith('w1');
  });

  it('commitWorldState passes worldId and canonical writes', async () => {
    await wdc.commitWorldState('w1', {
      writes: [{
        scope: 'WORLD',
        scopeKey: 'w1',
        targetPath: wdc.FORGE_WORLD_WORKSPACE_TARGET_PATH,
        payload: { name: 'New' },
      }],
      reason: 'manual save',
      sessionId: 'ws-1',
    });
    expect(mockWorldControlController.worldControlControllerCommitState).toHaveBeenCalledWith(
      'w1',
      expect.objectContaining({
        writes: [{
          scope: 'WORLD',
          scopeKey: 'w1',
          targetPath: wdc.FORGE_WORLD_WORKSPACE_TARGET_PATH,
          payload: { name: 'New' },
        }],
        commit: expect.objectContaining({
          worldId: 'w1',
          appId: 'forge',
          sessionId: 'ws-1',
          effectClass: 'STATE_ONLY',
          schemaId: wdc.FORGE_WORLD_WORKSPACE_SCHEMA_ID,
          schemaVersion: wdc.FORGE_WORLD_WORKSPACE_SCHEMA_VERSION,
          reason: 'manual save',
          actorRefs: [{ actorType: 'USER', actorId: 'user-1', role: 'creator' }],
        }),
      }),
    );
  });

  it('listMyWorlds', async () => {
    await wdc.listMyWorlds();
    expect(mockWorldControlController.worldControlControllerListMyWorlds).toHaveBeenCalledOnce();
  });

  it('listWorldHistory passes worldId', async () => {
    await wdc.listWorldHistory('w1');
    expect(mockWorldControlController.worldControlControllerListWorldHistory).toHaveBeenCalledWith('w1');
  });

  it('appendWorldHistory passes worldId and payload', async () => {
    const body: Parameters<typeof wdc.appendWorldHistory>[1] = {
      historyAppends: [{
        eventType: wdc.FORGE_WORLD_HISTORY_EVENT_TYPE,
        title: 'E1',
        happenedAt: '2026-03-22T00:00:00.000Z',
        operation: 'APPEND' as const,
        visibility: 'WORLD' as const,
        relatedStateRefs: [{
          recordId: 'state-1' as const,
          scope: 'WORLD' as const,
          scopeKey: 'w1' as const,
          version: 'state-v1' as const,
        }],
        payload: { timelineSeq: 1, level: 'PRIMARY', eventHorizon: 'PAST' },
      }],
      reason: 'manual sync',
      sessionId: 'ws-1',
    };
    await wdc.appendWorldHistory('w1', body);
    expect(mockWorldControlController.worldControlControllerAppendWorldHistory).toHaveBeenCalledWith(
      'w1',
      expect.objectContaining({
        historyAppends: [{
          eventType: wdc.FORGE_WORLD_HISTORY_EVENT_TYPE,
          title: 'E1',
          happenedAt: '2026-03-22T00:00:00.000Z',
          operation: 'APPEND',
          visibility: 'WORLD',
          relatedStateRefs: [{
            recordId: 'state-1',
            scope: 'WORLD',
            scopeKey: 'w1',
            version: 'state-v1',
          }],
          payload: { timelineSeq: 1, level: 'PRIMARY', eventHorizon: 'PAST' },
        }],
        commit: expect.objectContaining({
          worldId: 'w1',
          appId: 'forge',
          sessionId: 'ws-1',
          effectClass: 'STATE_AND_HISTORY',
          schemaId: wdc.FORGE_WORLD_HISTORY_SCHEMA_ID,
          schemaVersion: wdc.FORGE_WORLD_HISTORY_SCHEMA_VERSION,
          reason: 'manual sync',
          actorRefs: [{ actorType: 'USER', actorId: 'user-1', role: 'creator' }],
        }),
      }),
    );
  });

  it('appendWorldHistory rejects legacy aliases and missing canonical historyAppends', async () => {
    await expect(
      wdc.appendWorldHistory('w1', { eventUpserts: [{ title: 'E1' }] } as unknown as Parameters<typeof wdc.appendWorldHistory>[1]),
    ).rejects.toThrow('FORGE_WORLD_HISTORY_APPENDS_REQUIRED');
    await expect(wdc.appendWorldHistory('w1', {} as Parameters<typeof wdc.appendWorldHistory>[1])).rejects.toThrow(
      'FORGE_WORLD_HISTORY_APPENDS_REQUIRED',
    );
  });

  it('listWorldLorebooks passes worldId', async () => {
    await wdc.listWorldLorebooks('w1');
    expect(mockWorldControlController.worldControlControllerListWorldLorebooks).toHaveBeenCalledWith('w1');
  });

  it('listWorldMediaBindings passes worldId', async () => {
    await wdc.listWorldMediaBindings('w1');
    expect(mockWorldControlController.worldControlControllerListWorldMediaBindings).toHaveBeenCalledWith('w1', undefined, undefined);
  });

  it('listWorldRules passes worldId and status', async () => {
    await wdc.listWorldRules('w1', 'ACTIVE');
    expect(mockWorldRulesService.worldRulesControllerGetRules).toHaveBeenCalledWith('w1', 'ACTIVE');
  });

  it('createWorldRule passes worldId and payload', async () => {
    const body = {
      ruleKey: 'axiom:time:module',
      title: 'Time Module',
      statement: 'Time flows forward.',
      category: 'DEFINITION',
      domain: 'AXIOM',
      hardness: 'HARD',
      priority: 100,
      provenance: 'CREATOR',
      scope: 'WORLD',
    } as const;
    await wdc.createWorldRule('w1', body);
    expect(mockWorldRulesService.worldRulesControllerCreateRule).toHaveBeenCalledWith('w1', body);
  });

  it('listAgentRules passes path params and query', async () => {
    await wdc.listAgentRules('w1', 'a1', { layer: 'IDENTITY', status: 'ACTIVE' });
    expect(mockAgentRulesService.agentRulesControllerListRules).toHaveBeenCalledWith('w1', 'a1', 'IDENTITY', 'ACTIVE');
  });

  it('createAgentRule passes path params and payload', async () => {
    const body = {
      ruleKey: 'identity:self:core',
      title: 'Identity Core',
      statement: 'Protect identity continuity.',
      category: 'DEFINITION',
      hardness: 'HARD',
      importance: 90,
      layer: 'DNA',
      priority: 100,
      provenance: 'CREATOR',
      scope: 'SELF',
    } as const;
    await wdc.createAgentRule('w1', 'a1', body);
    expect(mockAgentRulesService.agentRulesControllerCreateRule).toHaveBeenCalledWith('w1', 'a1', body);
  });

  it('listCreatorAgents', async () => {
    mockCreatorService.creatorControllerListAgents.mockResolvedValue({ items: [] });
    await wdc.listCreatorAgents();
    expect(mockCreatorService.creatorControllerListAgents).toHaveBeenCalledOnce();
  });

  it('createCreatorAgent passes payload without synthesizing required fields', async () => {
    const body = {
      handle: 'agent-1',
      displayName: 'Agent 1',
      concept: 'Guardian of the first gate',
      ownershipType: 'MASTER_OWNED' as const,
      worldId: 'world-1',
    };
    await wdc.createCreatorAgent(body);
    expect(mockCreatorService.creatorControllerCreateAgent).toHaveBeenCalledWith({
      handle: 'agent-1',
      displayName: 'Agent 1',
      concept: 'Guardian of the first gate',
      ownershipType: 'MASTER_OWNED',
      worldId: 'world-1',
    });
  });

  it('batchCreateCreatorAgents passes payload without synthesizing required fields', async () => {
    const body = {
      items: [{
        handle: 'agent-a1',
        displayName: 'A1',
        concept: 'Archive keeper',
        ownershipType: 'WORLD_OWNED' as const,
        worldId: 'world-1',
      }],
    };
    await wdc.batchCreateCreatorAgents(body);
    expect(mockCreatorService.creatorControllerBatchCreateAgents).toHaveBeenCalledWith({
      items: [{
        handle: 'agent-a1',
        displayName: 'A1',
        concept: 'Archive keeper',
        ownershipType: 'WORLD_OWNED',
        worldId: 'world-1',
      }],
      continueOnError: false,
    });
  });

  it('createCreatorAgent rejects missing handle or concept', async () => {
    await expect(
      wdc.createCreatorAgent({ displayName: 'Missing handle', concept: 'still invalid', worldId: 'world-1' }),
    ).rejects.toThrow('FORGE_CREATOR_AGENT_HANDLE_REQUIRED');

    await expect(
      wdc.createCreatorAgent({ handle: 'missing-concept', displayName: 'Missing concept', worldId: 'world-1' }),
    ).rejects.toThrow('FORGE_CREATOR_AGENT_CONCEPT_REQUIRED');

    await expect(
      wdc.createCreatorAgent({ handle: 'missing-world', displayName: 'Missing world', concept: 'still invalid' }),
    ).rejects.toThrow('FORGE_CREATOR_AGENT_WORLD_ID_REQUIRED');
  });

});
