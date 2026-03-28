import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAgentPortraitBinding,
  listLookdevAgents,
  listLookdevWorlds,
  upsertAgentPortraitBinding,
} from './lookdev-data-client.js';

const mockWorldsService = {
  worldControllerListWorlds: vi.fn(),
};

const mockCreatorService = {
  creatorControllerListAgents: vi.fn(),
};

const mockWorldControlService = {
  worldControlControllerListWorldBindings: vi.fn(),
  worldControlControllerBatchUpsertWorldBindings: vi.fn(),
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
    mockWorldsService.worldControllerListWorlds.mockResolvedValue([
      { id: 'w1', name: 'Aurora Harbor', status: 'ACTIVE', agentCount: 7 },
    ]);

    await expect(listLookdevWorlds()).resolves.toEqual([
      { id: 'w1', name: 'Aurora Harbor', status: 'ACTIVE', agentCount: 7 },
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
});
