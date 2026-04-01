import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAgentPortraitBinding,
  getLookdevAgent,
  getLookdevAgentAuthoringContext,
  getLookdevAgentTruthBundle,
  listLookdevAgents,
  listLookdevWorldAgents,
  listLookdevWorlds,
  upsertAgentPortraitBinding,
} from './lookdev-data-client.js';

const mockWorldsService = {
  worldControllerGetWorldAgents: vi.fn(),
};

const mockCreatorService = {
  creatorControllerListAgents: vi.fn(),
  creatorControllerGetAgent: vi.fn(),
};

const mockAgentRulesService = {
  agentRulesControllerListRules: vi.fn(),
};

const mockWorldControlService = {
  worldControlControllerListWorldBindings: vi.fn(),
  worldControlControllerBatchUpsertWorldBindings: vi.fn(),
  worldControlControllerListMyWorlds: vi.fn(),
};

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => ({
    domains: {
      resources: {
        createImageDirectUpload: vi.fn(),
        finalizeResource: vi.fn(),
      },
    },
    realm: {
      services: {
        WorldsService: mockWorldsService,
        CreatorService: mockCreatorService,
        AgentRulesService: mockAgentRulesService,
        WorldControlService: mockWorldControlService,
      },
    },
  }),
}));

describe('lookdev data client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes worlds for batch creation', async () => {
    mockWorldControlService.worldControlControllerListMyWorlds.mockResolvedValue({
      items: [{ id: 'w1', name: 'Aurora Harbor', status: 'ACTIVE', agentCount: 7 }],
    });

    await expect(listLookdevWorlds()).resolves.toEqual([
      { id: 'w1', name: 'Aurora Harbor', status: 'ACTIVE', agentCount: 7 },
    ]);
  });

  it('keeps unknown world agent counts as null instead of coercing them to zero', async () => {
    mockWorldControlService.worldControlControllerListMyWorlds.mockResolvedValue({
      items: [{ id: 'w1', name: 'Aurora Harbor', status: 'ACTIVE' }],
    });
    mockWorldsService.worldControllerGetWorldAgents.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]);

    await expect(listLookdevWorlds()).resolves.toEqual([
      { id: 'w1', name: 'Aurora Harbor', status: 'ACTIVE', agentCount: 2 },
    ]);
  });

  it('keeps unknown world agent counts null if cast enrichment fails', async () => {
    mockWorldControlService.worldControlControllerListMyWorlds.mockResolvedValue({
      items: [{ id: 'w1', name: 'Aurora Harbor', status: 'ACTIVE' }],
    });
    mockWorldsService.worldControllerGetWorldAgents.mockRejectedValue(new Error('cast unavailable'));

    await expect(listLookdevWorlds()).resolves.toEqual([
      { id: 'w1', name: 'Aurora Harbor', status: 'ACTIVE', agentCount: null },
    ]);
  });

  it('normalizes creator agents and discards empty ids', async () => {
    mockCreatorService.creatorControllerListAgents.mockResolvedValue([
      {
        id: 'a1',
        handle: 'iris',
        displayName: 'Iris',
        concept: 'anchor agent',
        user: { agent: { worldId: 'w1' } },
      },
      {},
    ]);

    await expect(listLookdevAgents()).resolves.toEqual([
      {
        id: 'a1',
        handle: 'iris',
        displayName: 'Iris',
        concept: 'anchor agent',
        worldId: 'w1',
        avatarUrl: null,
        importance: 'UNKNOWN',
        status: 'UNKNOWN',
      },
    ]);
  });

  it('falls back to agentProfile worldId when creator list item does not expose agent.worldId', async () => {
    mockCreatorService.creatorControllerListAgents.mockResolvedValue([
      {
        id: 'a9',
        handle: 'luo-ji',
        displayName: '罗辑',
        concept: 'strategist',
        user: { agent: {} },
        agentProfile: { worldId: 'three-body', importance: 'PRIMARY' },
      },
    ]);

    await expect(listLookdevAgents()).resolves.toEqual([
      {
        id: 'a9',
        handle: 'luo-ji',
        displayName: '罗辑',
        concept: 'strategist',
        worldId: 'three-body',
        avatarUrl: null,
        importance: 'PRIMARY',
        status: 'UNKNOWN',
      },
    ]);
  });

  it('lists world-scoped agents from the selected world cast, even when they are not creator-owned', async () => {
    mockWorldsService.worldControllerGetWorldAgents.mockResolvedValue([
      {
        id: 'a20',
        name: '章北海',
        handle: 'zhang-beihai',
        bio: '坚定的战略执行者',
        avatarUrl: 'https://example.com/zhang.png',
      },
    ]);

    await expect(listLookdevWorldAgents('three-body')).resolves.toEqual([
      {
        id: 'a20',
        handle: 'zhang-beihai',
        displayName: '章北海',
        concept: '坚定的战略执行者',
        worldId: 'three-body',
        avatarUrl: 'https://example.com/zhang.png',
        importance: 'UNKNOWN',
        status: 'UNKNOWN',
      },
    ]);
  });

  it('reads portrait bindings from world control service', async () => {
    mockWorldControlService.worldControlControllerListWorldBindings.mockResolvedValue({
      items: [{
        id: 'binding-1',
        objectId: 'resource-1',
        createdAt: '2026-03-28T00:00:00.000Z',
        resource: {
          id: 'resource-1',
          url: 'https://example.com/p1.png',
          mimeType: 'image/png',
          width: 1024,
          height: 1536,
        },
      }],
      worldId: 'w1',
    });

    await expect(getAgentPortraitBinding('w1', 'a1')).resolves.toEqual({
      bindingId: 'binding-1',
      resourceId: 'resource-1',
      url: 'https://example.com/p1.png',
      mimeType: 'image/png',
      width: 1024,
      height: 1536,
      createdAt: '2026-03-28T00:00:00.000Z',
    });
  });

  it('fails closed on portrait bindings without mimeType', async () => {
    mockWorldControlService.worldControlControllerListWorldBindings.mockResolvedValue({
      items: [{
        id: 'binding-1',
        objectId: 'resource-1',
        createdAt: '2026-03-28T00:00:00.000Z',
        resource: {
          id: 'resource-1',
          url: 'https://example.com/p1.png',
          width: 1024,
          height: 1536,
        },
      }],
      worldId: 'w1',
    });

    await expect(getAgentPortraitBinding('w1', 'a1')).resolves.toBeNull();
  });

  it('upserts AGENT_PORTRAIT bindings through typed world control service', async () => {
    mockWorldControlService.worldControlControllerBatchUpsertWorldBindings.mockResolvedValue({});

    await upsertAgentPortraitBinding({
      worldId: 'w1',
      agentId: 'a1',
      resourceId: 'resource-1',
      intentPrompt: 'anchor portrait',
    });

    expect(mockWorldControlService.worldControlControllerBatchUpsertWorldBindings).toHaveBeenCalledWith('w1', {
      bindingUpserts: [{
        hostId: 'a1',
        hostType: 'AGENT',
        objectId: 'resource-1',
        objectType: 'RESOURCE',
        bindingKind: 'PRESENTATION',
        bindingPoint: 'AGENT_PORTRAIT',
        intentPrompt: 'anchor portrait',
        tags: ['lookdev', 'portrait'],
        priority: 0,
      }],
    });
  });

  it('reads creator-scoped agent detail for lookdev agent hydration', async () => {
    mockCreatorService.creatorControllerGetAgent.mockResolvedValue({
      id: 'a1',
      description: 'Station core observer',
      scenario: 'Monitors the reactor spine.',
      greeting: 'All systems nominal.',
    });

    await expect(getLookdevAgent('a1')).resolves.toEqual({
      description: 'Station core observer',
      scenario: 'Monitors the reactor spine.',
      greeting: 'All systems nominal.',
    });
    expect(mockCreatorService.creatorControllerGetAgent).toHaveBeenCalledWith('a1');
  });

  it('hydrates a truth bundle from creator detail plus AgentRule DNA truth', async () => {
    mockCreatorService.creatorControllerGetAgent.mockResolvedValue({
      id: 'a1',
      description: 'Station core observer',
      scenario: 'Monitors the reactor spine.',
      greeting: 'All systems nominal.',
      wakeStrategy: 'PROACTIVE',
      dna: {
        identity: {
          role: 'Systems observer',
          worldview: 'Order sustains survival',
          species: 'Synthetic humanoid',
          summary: 'A calm systems sentinel.',
        },
        biological: {
          gender: 'androgynous',
          visualAge: 'ageless adult',
          ethnicity: 'n/a',
          heightCm: 188,
          weightKg: 82,
        },
        appearance: {
          artStyle: 'clean industrial realism',
          hair: 'smooth plated cranial shell',
          eyes: 'cool cyan optics',
          skin: 'porcelain alloy skin',
          fashionStyle: 'modular station uniform',
          signatureItems: ['reactor keyline collar'],
        },
        personality: {
          summary: 'Measured and precise',
          mbti: 'INTJ',
          interests: ['systems', 'oversight'],
          goals: ['maintain station order'],
          relationshipMode: 'distant',
          emotionBaseline: 'cool',
        },
        communication: {
          summary: 'Short and exact',
          responseLength: 'short',
          formality: 'formal',
          sentiment: 'neutral',
        },
      },
      rules: {
        format: 'rule-lines-v1',
        lines: ['Never dramatize failures.', 'Keep operator guidance concise.'],
        text: 'Never dramatize failures.\nKeep operator guidance concise.',
      },
    });
    mockAgentRulesService.agentRulesControllerListRules.mockResolvedValue([
      {
        ruleKey: 'dna:appearance:visual',
        statement: 'Keep a clean modular station silhouette with restrained cyan accents.',
        structured: {
          artStyle: 'clean industrial realism',
          hair: 'smooth plated cranial shell',
          eyes: 'cool cyan optics',
          skin: 'porcelain alloy skin',
          fashionStyle: 'modular station uniform',
          signatureItems: ['reactor keyline collar'],
        },
      },
      {
        ruleKey: 'identity:soul_prime:core',
        statement: 'Backstory: Built to watch over the station core.\n\nCore Values: Order before ego.',
        structured: {
          backstory: 'Built to watch over the station core.',
          coreValues: 'Order before ego.',
          personalityDescription: 'Calm and surgical under pressure.',
          guidelines: 'Never waste motion or words.',
          catchphrase: 'Order holds.',
        },
      },
    ]);

    await expect(getLookdevAgentTruthBundle('w1', 'a1')).resolves.toEqual(expect.objectContaining({
      description: 'Station core observer',
      scenario: 'Monitors the reactor spine.',
      greeting: 'All systems nominal.',
      wakeStrategy: 'PROACTIVE',
      behavioralRules: ['Never dramatize failures.', 'Keep operator guidance concise.'],
      dna: expect.objectContaining({
        identity: expect.objectContaining({
          role: 'Systems observer',
          species: 'Synthetic humanoid',
        }),
        appearance: expect.objectContaining({
          hair: 'smooth plated cranial shell',
          fashionStyle: 'modular station uniform',
          signatureItems: ['reactor keyline collar'],
        }),
      }),
      soulPrime: expect.objectContaining({
        coreValues: 'Order before ego.',
        catchphrase: 'Order holds.',
      }),
      ruleTruth: expect.objectContaining({
        appearance: expect.objectContaining({
          statement: 'Keep a clean modular station silhouette with restrained cyan accents.',
        }),
      }),
    }));
    expect(mockAgentRulesService.agentRulesControllerListRules).toHaveBeenCalledWith('w1', 'a1', 'DNA', 'ACTIVE');
  });

  it('preserves creator detail in authoring context when rule truth is unavailable', async () => {
    mockCreatorService.creatorControllerGetAgent.mockResolvedValue({
      id: 'a1',
      description: 'Station receptionist with calm posture.',
      scenario: 'Greets arrivals at the main hall.',
      greeting: 'Welcome to Oasis.',
      wakeStrategy: 'PASSIVE',
      dna: {
        identity: {
          role: 'Receptionist',
          summary: 'First point of contact for visitors.',
        },
      },
    });
    mockAgentRulesService.agentRulesControllerListRules.mockRejectedValue(new Error('rules unavailable'));

    await expect(getLookdevAgentAuthoringContext('w1', 'a1')).resolves.toEqual({
      detail: {
        description: 'Station receptionist with calm posture.',
        scenario: 'Greets arrivals at the main hall.',
        greeting: 'Welcome to Oasis.',
      },
      truthBundle: expect.objectContaining({
        description: 'Station receptionist with calm posture.',
        scenario: 'Greets arrivals at the main hall.',
        greeting: 'Welcome to Oasis.',
        dna: expect.objectContaining({
          identity: expect.objectContaining({
            role: 'Receptionist',
            summary: 'First point of contact for visitors.',
          }),
        }),
      }),
      fullTruthReadable: false,
    });
  });
});
