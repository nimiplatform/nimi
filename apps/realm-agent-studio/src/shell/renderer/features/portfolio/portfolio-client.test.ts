import type { Realm } from '@nimiplatform/sdk/realm';
import { describe, expect, it, vi } from 'vitest';
import { getOwnerPortfolioAgentDetail, listOwnerPortfolioAgents } from './portfolio-client.js';
import type { MyRealmAgentDto } from './portfolio-data.js';

const agent: MyRealmAgentDto = {
  id: 'agent-1',
  handle: 'mira',
  displayName: 'Mira',
  createdAt: '2026-05-21T00:00:00.000Z',
  isAgent: true,
};

function mockRealm() {
  return {
    services: {
      MeService: {
        listMyRealmAgents: vi.fn(async () => [agent]),
        getMyRealmAgent: vi.fn(async (agentId: string) => ({ ...agent, id: agentId, bio: 'Detail bio' })),
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
});
