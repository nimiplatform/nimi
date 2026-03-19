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
  worldControlControllerGetMaintenance: vi.fn(),
  worldControlControllerUpdateMaintenance: vi.fn(),
  worldControlControllerListMyWorlds: vi.fn(),
  worldControlControllerListWorldMutations: vi.fn(),
  worldControlControllerListWorldEvents: vi.fn(),
  worldControlControllerBatchUpsertWorldEvents: vi.fn(),
  worldControlControllerDeleteWorldEvent: vi.fn(),
  worldControlControllerListWorldLorebooks: vi.fn(),
  worldControlControllerListWorldMediaBindings: vi.fn(),
  worldControlControllerBatchUpsertWorldMediaBindings: vi.fn(),
  worldControlControllerDeleteWorldMediaBinding: vi.fn(),
  worldControlControllerListWorldNarrativeContexts: vi.fn(),
  worldControlControllerListWorldScenes: vi.fn(),
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

vi.mock('@runtime/platform-client.js', () => ({
  getPlatformClient: () => ({
    realm: {
      services: {
        WorldControlService: mockWorldControlController,
        WorldRulesService: mockWorldRulesService,
        AgentRulesService: mockAgentRulesService,
        CreatorService: mockCreatorService,
      },
    },
  }),
}));

const wdc = await import('./world-data-client.js');

describe('world-data-client', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('getMyWorldAccess', async () => {
    mockWorldControlController.worldControlControllerGetMyAccess.mockResolvedValue({ hasAccess: true });
    const result = await wdc.getMyWorldAccess();
    expect(result).toEqual({ hasAccess: true });
  });

  it('resolveWorldLanding', async () => {
    mockWorldControlController.worldControlControllerResolveLanding.mockResolvedValue({ mode: 'CREATE' });
    await wdc.resolveWorldLanding();
    expect(mockWorldControlController.worldControlControllerResolveLanding).toHaveBeenCalledOnce();
  });

  it('createWorldDraft passes payload', async () => {
    const body = { sourceType: 'TEXT' };
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

  it('getWorldMaintenance passes worldId', async () => {
    await wdc.getWorldMaintenance('w1');
    expect(mockWorldControlController.worldControlControllerGetMaintenance).toHaveBeenCalledWith('w1');
  });

  it('updateWorldMaintenance passes worldId and patch', async () => {
    await wdc.updateWorldMaintenance('w1', { name: 'New' });
    expect(mockWorldControlController.worldControlControllerUpdateMaintenance).toHaveBeenCalledWith('w1', { name: 'New' });
  });

  it('listMyWorlds', async () => {
    await wdc.listMyWorlds();
    expect(mockWorldControlController.worldControlControllerListMyWorlds).toHaveBeenCalledOnce();
  });

  it('listWorldMutations passes worldId', async () => {
    await wdc.listWorldMutations('w1');
    expect(mockWorldControlController.worldControlControllerListWorldMutations).toHaveBeenCalledWith('w1');
  });

  it('listWorldEvents passes worldId', async () => {
    await wdc.listWorldEvents('w1');
    expect(mockWorldControlController.worldControlControllerListWorldEvents).toHaveBeenCalledWith('w1');
  });

  it('batchUpsertWorldEvents passes worldId and payload', async () => {
    const body = { events: [{ title: 'E1' }] };
    await wdc.batchUpsertWorldEvents('w1', body);
    expect(mockWorldControlController.worldControlControllerBatchUpsertWorldEvents).toHaveBeenCalledWith('w1', body);
  });

  it('deleteWorldEvent passes worldId and eventId', async () => {
    await wdc.deleteWorldEvent('w1', 'e1');
    expect(mockWorldControlController.worldControlControllerDeleteWorldEvent).toHaveBeenCalledWith('w1', 'e1');
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
    const body = { ruleKey: 'axiom:time:module' };
    await wdc.createWorldRule('w1', body);
    expect(mockWorldRulesService.worldRulesControllerCreateRule).toHaveBeenCalledWith('w1', body);
  });

  it('listAgentRules passes path params and query', async () => {
    await wdc.listAgentRules('w1', 'a1', { layer: 'IDENTITY', status: 'ACTIVE' });
    expect(mockAgentRulesService.agentRulesControllerListRules).toHaveBeenCalledWith('w1', 'a1', 'IDENTITY', 'ACTIVE');
  });

  it('createAgentRule passes path params and payload', async () => {
    const body = { ruleKey: 'identity:self:core' };
    await wdc.createAgentRule('w1', 'a1', body);
    expect(mockAgentRulesService.agentRulesControllerCreateRule).toHaveBeenCalledWith('w1', 'a1', body);
  });

  it('listCreatorAgents', async () => {
    mockCreatorService.creatorControllerListAgents.mockResolvedValue({ items: [] });
    await wdc.listCreatorAgents();
    expect(mockCreatorService.creatorControllerListAgents).toHaveBeenCalledOnce();
  });

  it('createCreatorAgent passes payload', async () => {
    const body = { name: 'Agent1' };
    await wdc.createCreatorAgent(body);
    expect(mockCreatorService.creatorControllerCreateAgent).toHaveBeenCalledWith(body);
  });

  it('batchCreateCreatorAgents passes payload', async () => {
    const body = { items: [{ name: 'A1' }] };
    await wdc.batchCreateCreatorAgents(body);
    expect(mockCreatorService.creatorControllerBatchCreateAgents).toHaveBeenCalledWith(body);
  });
});
