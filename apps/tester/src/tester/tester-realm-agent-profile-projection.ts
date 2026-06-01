import {
  createRealmMasterAgent,
  loadRealmAgentDetails,
  loadRealmCreatorAgents,
} from '@nimiplatform/sdk/realm';

export type TesterRealmAgentProfileProjection = {
  agentId: string;
  worldBannerUrl: string;
  creatorCount: number;
  createdOwnershipType: string;
};

export async function loadTesterRealmAgentProfileProjection(): Promise<TesterRealmAgentProfileProjection> {
  const callRealm = async <T>(task: (realm: {
    services: {
      AgentsService: {
        getAgent: (agentId: string) => Promise<unknown>;
        getAgentByHandle: (handle: string) => Promise<unknown>;
      };
      WorldsService: {
        worldControllerGetWorld: (worldId: string) => Promise<unknown>;
      };
      CreatorService: {
        creatorControllerListAgents: () => Promise<unknown[]>;
        creatorControllerCreateAgent: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
      };
    };
  }) => Promise<T>) =>
    task({
      services: {
        AgentsService: {
          getAgent: async (agentId) => ({ id: agentId, isAgent: true, worldId: 'tester-world' }),
          getAgentByHandle: async (handle) => ({ id: 'agent-by-handle', handle, isAgent: true }),
        },
        WorldsService: {
          worldControllerGetWorld: async (worldId) => ({
            id: worldId,
            name: 'Tester World',
            bannerUrl: 'https://media.nimi.test/tester-world.png',
          }),
        },
        CreatorService: {
          creatorControllerListAgents: async () => [{ id: 'creator-agent-1' }],
          creatorControllerCreateAgent: async (input) => ({ id: 'creator-agent-2', ...input }),
        },
      },
    });

  const detail = await loadRealmAgentDetails(callRealm as never, () => undefined, 'tester-agent');
  const creators = await loadRealmCreatorAgents(callRealm as never);
  const created = await createRealmMasterAgent(callRealm as never, {
    worldId: 'tester-world',
    handle: ' tester-created ',
    concept: ' tester concept ',
  });

  return {
    agentId: String(detail.id || 'none'),
    worldBannerUrl: String(detail.worldBannerUrl || 'none'),
    creatorCount: creators.length,
    createdOwnershipType: String(created.ownershipType || 'none'),
  };
}
