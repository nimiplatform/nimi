import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreatorService = {
  creatorControllerListAgents: vi.fn(),
  creatorControllerCreateAgent: vi.fn(),
  creatorControllerBatchCreateAgents: vi.fn(),
  creatorControllerGetAgent: vi.fn(),
  creatorControllerUpdateAgent: vi.fn(),
  creatorControllerDeleteAgent: vi.fn(),
  creatorControllerListKeys: vi.fn(),
  creatorControllerCreateKey: vi.fn(),
  creatorControllerRevokeKey: vi.fn(),
};

const mockAgentsService = {
  getAgentByHandle: vi.fn(),
  agentControllerUpdateDna: vi.fn(),
  agentControllerGetVisibility: vi.fn(),
  agentControllerUpdateVisibility: vi.fn(),
};

const mockAgentRulesService = {
  agentRulesControllerListRules: vi.fn(),
  agentRulesControllerCreateRule: vi.fn(),
  agentRulesControllerUpdateRule: vi.fn(),
};

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => ({
    realm: {
      services: {
        CreatorService: mockCreatorService,
        AgentsService: mockAgentsService,
        AgentRulesService: mockAgentRulesService,
      },
    },
  }),
}));

const adc = await import('./agent-data-client.js');

describe('agent-data-client', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // Creator-scoped ops
  it('listCreatorAgents', async () => {
    mockCreatorService.creatorControllerListAgents.mockResolvedValue({ items: [] });
    const result = await adc.listCreatorAgents();
    expect(result).toEqual({ items: [] });
    expect(mockCreatorService.creatorControllerListAgents).toHaveBeenCalledOnce();
  });

  it('createCreatorAgent passes payload', async () => {
    const payload = {
      displayName: 'Agent 1',
      handle: 'agent-1',
      concept: 'test',
      worldId: 'world-1',
    };
    await adc.createCreatorAgent(payload);
    expect(mockCreatorService.creatorControllerCreateAgent).toHaveBeenCalledWith(payload);
  });

  it('batchCreateCreatorAgents passes items and continueOnError', async () => {
    const payload = {
      items: [{
        displayName: 'A',
        handle: 'agent-a',
        concept: 'A',
        worldId: 'world-1',
      }],
      continueOnError: true,
    };
    await adc.batchCreateCreatorAgents(payload);
    expect(mockCreatorService.creatorControllerBatchCreateAgents).toHaveBeenCalledWith({
      continueOnError: true,
      items: payload.items,
    });
  });

  // Agent detail ops (creator-scoped)
  it('getAgent passes agentId via CreatorService', async () => {
    await adc.getAgent('agent-1');
    expect(mockCreatorService.creatorControllerGetAgent).toHaveBeenCalledWith('agent-1');
  });

  it('updateAgent passes agentId and payload via CreatorService', async () => {
    const payload = { displayName: 'Updated', bio: 'new bio' };
    await adc.updateAgent('agent-1', payload);
    expect(mockCreatorService.creatorControllerUpdateAgent).toHaveBeenCalledWith('agent-1', payload);
  });

  it('deleteAgent passes agentId via CreatorService', async () => {
    await adc.deleteAgent('agent-1');
    expect(mockCreatorService.creatorControllerDeleteAgent).toHaveBeenCalledWith('agent-1');
  });

  it('getAgentByHandle passes handle', async () => {
    await adc.getAgentByHandle('my-agent');
    expect(mockAgentsService.getAgentByHandle).toHaveBeenCalledWith('my-agent');
  });

  // DNA ops
  it('updateAgentDna passes agentId and dna', async () => {
    const dna = { primaryType: 'CARING', secondaryTraits: ['WISE'] };
    await adc.updateAgentDna('a1', dna);
    expect(mockAgentsService.agentControllerUpdateDna).toHaveBeenCalledWith('a1', { dna });
  });

  it('getAgentSoulPrime reads Soul Prime from canonical AgentRule truth', async () => {
    mockAgentRulesService.agentRulesControllerListRules.mockResolvedValue([
      {
        id: 'rule-1',
        ruleKey: 'identity:soul_prime:core',
        statement: 'Guidelines: You are a kind helper.',
        structured: { guidelines: 'You are a kind helper.' },
      },
    ]);

    const result = await adc.getAgentSoulPrime('world-1', 'a1');

    expect(mockAgentRulesService.agentRulesControllerListRules).toHaveBeenCalledWith(
      'world-1',
      'a1',
      'ACTIVE',
      'DNA',
    );
    expect(result).toEqual({
      ruleId: 'rule-1',
      ruleKey: 'identity:soul_prime:core',
      statement: 'Guidelines: You are a kind helper.',
      text: 'Guidelines: You are a kind helper.',
      structured: { guidelines: 'You are a kind helper.' },
    });
  });

  it('updateAgentSoulPrime creates canonical Soul Prime truth when missing', async () => {
    mockAgentRulesService.agentRulesControllerListRules.mockResolvedValue([]);
    mockAgentRulesService.agentRulesControllerCreateRule.mockResolvedValue({ id: 'rule-1' });

    const sp = { text: 'You are a kind helper.' };
    await adc.updateAgentSoulPrime('world-1', 'a1', sp);
    expect(mockAgentRulesService.agentRulesControllerCreateRule).toHaveBeenCalledWith(
      'world-1',
      'a1',
      expect.objectContaining({
        ruleKey: 'identity:soul_prime:core',
        layer: 'DNA',
        category: 'DEFINITION',
        hardness: 'FIRM',
        scope: 'SELF',
        importance: 100,
        structured: { guidelines: 'You are a kind helper.' },
      }),
    );
  });

  // API Keys
  it('listCreatorKeys', async () => {
    await adc.listCreatorKeys();
    expect(mockCreatorService.creatorControllerListKeys).toHaveBeenCalledOnce();
  });

  it('createCreatorKey passes payload', async () => {
    const payload = { name: 'dev-key' };
    await adc.createCreatorKey(payload);
    expect(mockCreatorService.creatorControllerCreateKey).toHaveBeenCalledWith({
      name: 'dev-key',
      label: 'dev-key',
      type: 'PERSONAL',
    });
  });

  it('revokeCreatorKey passes keyId', async () => {
    await adc.revokeCreatorKey('k1');
    expect(mockCreatorService.creatorControllerRevokeKey).toHaveBeenCalledWith('k1');
  });

  // Visibility
  it('getAgentVisibility passes agentId', async () => {
    await adc.getAgentVisibility('a1');
    expect(mockAgentsService.agentControllerGetVisibility).toHaveBeenCalledWith('a1');
  });

  it('updateAgentVisibility passes agentId and payload', async () => {
    const payload = { visibility: 'public' };
    await adc.updateAgentVisibility('a1', payload);
    expect(mockAgentsService.agentControllerUpdateVisibility).toHaveBeenCalledWith('a1', {
      accountVisibility: 'PUBLIC',
      defaultPostVisibility: 'PUBLIC',
      dmVisibility: 'PUBLIC',
      profileVisibility: 'PUBLIC',
    });
  });
});
