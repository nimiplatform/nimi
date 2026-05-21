import type { Realm } from '@nimiplatform/sdk/realm';
import { describe, expect, it, vi } from 'vitest';
import {
  getCreateRealmAgentWorldPreview,
  getOwnerPortfolioAgentDetail,
  listCreateRealmAgentSelectableWorlds,
  listOwnerPortfolioAgents,
} from './portfolio-client.js';
import type { MyRealmAgentDto } from './portfolio-data.js';
import type { RealmAgentCreationWorldDto } from './create-agent-draft.js';

const agent: MyRealmAgentDto = {
  id: 'agent-1',
  handle: 'mira',
  displayName: 'Mira',
  createdAt: '2026-05-21T00:00:00.000Z',
  isAgent: true,
};

const world: RealmAgentCreationWorldDto = {
  id: 'world-oasis',
  name: 'OASIS',
  type: 'OASIS',
  status: 'ACTIVE',
  contentRating: 'PG13',
  createdAt: '2026-05-21T00:00:00.000Z',
  level: 1,
  lorebookEntryLimit: 10,
  nativeAgentLimit: 10,
  nativeCreationState: 'OPEN',
  scoreA: 0,
  scoreC: 0,
  scoreE: 0,
  scoreEwma: 0,
  scoreQ: 0,
  transitInLimit: 10,
  agentCount: 0,
  computed: {
    entry: { recommendedAgents: [] },
    featuredAgentCount: 0,
    languages: { common: [] },
    score: { scoreEwma: 0 },
    time: { flowRatio: 1, isPaused: false },
  },
  truth: {
    rules: [],
  },
};

function mockRealm() {
  return {
    services: {
      CreatorService: {
        creatorControllerCreateAgent: vi.fn(async () => {
          throw new Error('create must not be called');
        }),
      },
      MeService: {
        listMyRealmAgents: vi.fn(async () => [agent]),
        getMyRealmAgent: vi.fn(async (agentId: string) => ({ ...agent, id: agentId, bio: 'Detail bio' })),
      },
      WorldsService: {
        worldControllerListWorlds: vi.fn(async () => [world]),
        worldControllerGetWorldDetailWithAgents: vi.fn(async (worldId: string) => ({
          ...world,
          id: worldId,
          agentRuleSummary: {
            byLayer: {
              BEHAVIORAL: 0,
              CONTEXTUAL: 0,
              DNA: 0,
              RELATIONAL: 0,
            },
            totalAgentRuleCount: 0,
            worldLinkedRuleCount: 0,
          },
          agents: [],
        })),
      },
    },
  } as unknown as Realm;
}

describe('owner portfolio client', () => {
  it('uses listMyRealmAgents only for portfolio list data', async () => {
    const realm = mockRealm();
    const agents = await listOwnerPortfolioAgents(realm);

    expect(realm.services.MeService.listMyRealmAgents).toHaveBeenCalledTimes(1);
    expect(realm.services.MeService.getMyRealmAgent).not.toHaveBeenCalled();
    expect(agents[0]?.source).toBe('Realm MeService.listMyRealmAgents');
  });

  it('fetches selected detail through getMyRealmAgent', async () => {
    const realm = mockRealm();
    const detail = await getOwnerPortfolioAgentDetail('agent-detail-1', realm);

    expect(realm.services.MeService.getMyRealmAgent).toHaveBeenCalledWith('agent-detail-1');
    expect(realm.services.MeService.listMyRealmAgents).not.toHaveBeenCalled();
    expect(detail.id).toBe('agent-detail-1');
    expect(detail.bio.value).toBe('Detail bio');
    expect(detail.source).toBe('Realm MeService.getMyRealmAgent');
  });

  it('uses WorldsService only for create readiness world list reads', async () => {
    const realm = mockRealm();
    const worlds = await listCreateRealmAgentSelectableWorlds(realm);

    expect(realm.services.WorldsService.worldControllerListWorlds).toHaveBeenCalledTimes(1);
    expect(realm.services.CreatorService.creatorControllerCreateAgent).not.toHaveBeenCalled();
    expect(worlds[0]).toMatchObject({
      id: 'world-oasis',
      source: 'Realm WorldsService.worldControllerListWorlds',
    });
  });

  it('uses WorldsService detail-with-agents for selected world preview', async () => {
    const realm = mockRealm();
    const preview = await getCreateRealmAgentWorldPreview('world-oasis', realm);

    expect(realm.services.WorldsService.worldControllerGetWorldDetailWithAgents).toHaveBeenCalledWith('world-oasis', 4);
    expect(realm.services.CreatorService.creatorControllerCreateAgent).not.toHaveBeenCalled();
    expect(preview.source).toBe('Realm WorldsService.worldControllerGetWorldDetailWithAgents');
  });
});
