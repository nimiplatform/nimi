import {
  createNimiRealmMasterAgent,
  loadNimiRealmAgentDetails,
  loadNimiRealmCreatorAgents,
  type NimiRealmAgentProfileApi,
} from '@nimiplatform/sdk/realm';

export type TesterRealmAgentProfileProjection = {
  agentId: string;
  worldBannerUrl: string;
  creatorCount: number;
  createdOwnershipType: string;
};

export async function loadTesterRealmAgentProfileProjection(): Promise<TesterRealmAgentProfileProjection> {
  const realm = {
    agents: {
      getAgent: async ({ path }: { path: { id: string } }) => ({ id: path.id, isAgent: true, worldId: 'tester-world' }),
      getAgentByHandle: async ({ path }: { path: { handle: string } }) => ({ id: 'agent-by-handle', handle: path.handle, isAgent: true }),
      creatorControllerListAgents: async () => [{ id: 'creator-agent-1' }],
      creatorControllerCreateAgent: async ({ body }: { body: Record<string, unknown> }) => ({ id: 'creator-agent-2', ...body }),
    },
    world: {
      worldControllerGetWorld: async ({ path }: { path: { id: string } }) => ({
        id: path.id,
        name: 'Tester World',
        bannerUrl: 'https://media.nimi.test/tester-world.png',
      }),
    },
  } as unknown as NimiRealmAgentProfileApi;

  const detail = await loadNimiRealmAgentDetails(realm, 'tester-agent');
  const creators = await loadNimiRealmCreatorAgents(realm);
  const created = await createNimiRealmMasterAgent(realm, {
    worldId: 'tester-world',
    handle: ' tester-created ',
    concept: ' tester concept ',
  });

  return {
    agentId: String(detail.id || 'none'),
    worldBannerUrl: String(detail.worldBannerUrl || 'none'),
    creatorCount: creators.length,
    createdOwnershipType: created.isAgent === true ? 'agent' : 'account',
  };
}
