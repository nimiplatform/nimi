import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockWorldDataClient = vi.hoisted(() => ({
  createWorldDraft: vi.fn(),
  publishWorldDraft: vi.fn(),
  createWorldRule: vi.fn(),
  createAgentRule: vi.fn(),
}));

const mockAgentDataClient = vi.hoisted(() => ({
  createCreatorAgent: vi.fn(),
  batchCreateCreatorAgents: vi.fn(),
  updateAgent: vi.fn(),
}));

vi.mock('@renderer/data/world-data-client.js', () => mockWorldDataClient);
vi.mock('@renderer/data/agent-data-client.js', () => mockAgentDataClient);

const {
  publishCharacterCardImport,
  publishForgeWorkspacePlan,
} = await import('./import-publish-client.js');

describe('publishCharacterCardImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('guards against publishing character imports without a target world', async () => {
    const result = await publishCharacterCardImport({
      characterName: 'Ari',
      agentRules: [],
      worldRules: [],
      targetWorldId: null,
      ownerType: 'MASTER_OWNED',
    });

    expect(result.errors[0]?.message).toContain('Target world is required');
    expect(mockAgentDataClient.createCreatorAgent).not.toHaveBeenCalled();
    expect(mockWorldDataClient.createAgentRule).not.toHaveBeenCalled();
  });

  it('retries transient agent creation failures before succeeding', async () => {
    mockAgentDataClient.createCreatorAgent
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({ id: 'agent_1' });
    mockWorldDataClient.createAgentRule.mockResolvedValue({ id: 'ar_1' });

    const result = await publishCharacterCardImport({
      characterName: 'Ari',
      agentRules: [{
        ruleKey: 'identity:self:core',
        title: 'Core Identity',
        statement: 'Ari is a brave scout.',
        layer: 'DNA',
        category: 'DEFINITION',
        hardness: 'FIRM',
        importance: 90,
        provenance: 'CREATOR',
      }],
      worldRules: [],
      targetWorldId: 'world_1',
      ownerType: 'WORLD_OWNED',
    });

    expect(mockAgentDataClient.createCreatorAgent).toHaveBeenCalledTimes(2);
    expect(result.agentIds.Ari).toBe('agent_1');
    expect(result.errors).toEqual([]);
  });
});

describe('publishForgeWorkspacePlan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates world, creates world-owned agents, then writes rules', async () => {
    mockWorldDataClient.createWorldDraft.mockResolvedValue({ id: 'draft_1' });
    mockWorldDataClient.publishWorldDraft.mockResolvedValue({ worldId: 'world_1' });
    mockAgentDataClient.batchCreateCreatorAgents.mockResolvedValue({
      created: [{ id: 'agent_1', displayName: 'Ari' }],
    });
    mockWorldDataClient.createWorldRule.mockResolvedValue({ id: 'wr_1' });
    mockWorldDataClient.createAgentRule.mockResolvedValue({ id: 'ar_1' });

    const result = await publishForgeWorkspacePlan({
      plan: {
        workspaceId: 'ws_1',
        worldAction: 'CREATE',
        agents: [{
          draftAgentId: 'draft_agent_1',
          action: 'CREATE_WORLD_AGENT',
          sourceAgentId: null,
          displayName: 'Ari',
          handle: 'ari',
          concept: 'Brave scout',
          description: 'Ari is a brave scout.',
          avatarUrl: 'https://cdn.example.com/ari.png',
        }],
        worldRules: [{
          ruleKey: 'world:seed:scenario',
          title: 'Scenario',
          statement: 'A ruined world.',
          domain: 'NARRATIVE',
          category: 'DEFINITION',
          hardness: 'SOFT',
          scope: 'WORLD',
          provenance: 'SEED',
        }],
        agentRules: [{
          draftAgentId: 'draft_agent_1',
          agentId: null,
          characterName: 'Ari',
          rules: [{
            ruleKey: 'identity:self:core',
            title: 'Core Identity',
            statement: 'Ari is a brave scout.',
            layer: 'DNA',
            category: 'DEFINITION',
            hardness: 'FIRM',
            importance: 90,
            provenance: 'CREATOR',
          }],
        }],
        sourceManifestPolicy: 'LOCAL_ONLY',
      },
      worldName: 'My World',
      worldDescription: 'desc',
      targetWorldId: null,
      agentBundles: [{
        draftAgentId: 'draft_agent_1',
        characterName: 'Ari',
        rules: [{
          ruleKey: 'identity:self:core',
          title: 'Core Identity',
          statement: 'Ari is a brave scout.',
          layer: 'DNA',
          category: 'DEFINITION',
          hardness: 'FIRM',
          importance: 90,
          provenance: 'CREATOR',
        }],
      }],
    });

    expect(mockWorldDataClient.createWorldDraft).toHaveBeenCalledOnce();
    expect(mockAgentDataClient.batchCreateCreatorAgents).toHaveBeenCalledOnce();
    expect(mockAgentDataClient.batchCreateCreatorAgents).toHaveBeenCalledWith(expect.objectContaining({
      items: [expect.objectContaining({
        description: 'Ari is a brave scout.',
        referenceImageUrl: 'https://cdn.example.com/ari.png',
      })],
    }));
    expect(mockWorldDataClient.createWorldRule).toHaveBeenCalledWith('world_1', expect.objectContaining({
      ruleKey: 'world:seed:scenario',
    }));
    expect(mockWorldDataClient.createAgentRule).toHaveBeenCalledWith('world_1', 'agent_1', expect.objectContaining({
      ruleKey: 'identity:self:core',
    }));
    expect(result.worldId).toBe('world_1');
    expect(result.draftAgentIds).toEqual({ draft_agent_1: 'agent_1' });
  });
});
