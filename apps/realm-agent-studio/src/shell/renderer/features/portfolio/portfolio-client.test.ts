import type { Realm } from '@nimiplatform/sdk/realm';
import { describe, expect, it, vi } from 'vitest';
import {
  buildRealmCreatePostInput,
  getCreateRealmAgentWorldPreview,
  getOwnerPortfolioAgentDetail,
  listCreateRealmAgentSelectableWorlds,
  listOwnerPortfolioAgents,
  normalizeRealmPostPublishResult,
  publishReviewedPostDraft,
} from './portfolio-client.js';
import type { MyRealmAgentDto } from './portfolio-data.js';
import type { RealmAgentCreationWorldDto } from './create-agent-draft.js';
import type { CandidatePostPayload } from './post-draft.js';

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
      PostsService: {
        createPost: vi.fn(async () => ({
          id: 'post-1',
          authorId: 'author-from-realm',
          author: {
            id: 'author-from-realm',
            displayName: 'Mira',
          },
          attachments: [],
          caption: 'Published caption',
          createdAt: '2026-05-21T00:00:00.000Z',
          moderationStatus: 'PENDING',
          tags: ['studio'],
          visibility: 'PUBLIC',
          worldId: 'world-from-realm',
        })),
      },
    },
  } as unknown as Realm;
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (!value || typeof value !== 'object') {
    return keys;
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    keys.add(key);
    collectKeys(nested, keys);
  }

  return keys;
}

const candidatePayload: CandidatePostPayload = {
  candidate: true,
  source: 'realm-agent-studio.local-post-draft',
  agentRef: {
    source: 'Realm MeService.getMyRealmAgent',
    agentKey: 'agent-1',
    handle: 'mira',
    displayName: 'Mira',
  },
  realmCreatePost: {
    attachments: [{
      targetType: 'RESOURCE',
      targetId: 'resource-1',
    }],
    caption: 'Published caption',
    tags: ['studio'],
  },
  review: {
    humanReviewed: true,
  },
};

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

  it('publishes a reviewed post draft through PostsService.createPost without forbidden caller-owned keys', async () => {
    const realm = mockRealm();
    const result = await publishReviewedPostDraft(candidatePayload, realm);
    const createPost = realm.services.PostsService.createPost;
    const submittedPayload = vi.mocked(createPost).mock.calls[0]?.[0];

    expect(createPost).toHaveBeenCalledTimes(1);
    expect(submittedPayload).toEqual({
      attachments: [{
        targetType: 'RESOURCE',
        targetId: 'resource-1',
      }],
      caption: 'Published caption',
      tags: ['studio'],
    });
    expect(collectKeys(submittedPayload).has('id')).toBe(false);
    expect(collectKeys(submittedPayload).has('authorId')).toBe(false);
    expect(collectKeys(submittedPayload).has('worldId')).toBe(false);
    expect(collectKeys(submittedPayload).has('scheduledAt')).toBe(false);
    expect(result).toMatchObject({
      ok: true,
      canonical: {
        id: 'post-1',
        worldId: 'world-from-realm',
        moderationStatus: 'PENDING',
        visibility: 'PUBLIC',
      },
    });
  });

  it('normalizes Create Post responses without canonical id as publish failure', () => {
    const result = normalizeRealmPostPublishResult({} as Awaited<ReturnType<Realm['services']['PostsService']['createPost']>>);

    expect(result).toMatchObject({
      ok: false,
      failure: 'realm-create-post-missing-canonical-id',
    });
  });

  it('builds CreatePostDto shape from reviewed payload only', () => {
    const input = buildRealmCreatePostInput(candidatePayload);

    expect(input).toEqual(candidatePayload.realmCreatePost);
    expect(collectKeys(input).has('agentRef')).toBe(false);
    expect(collectKeys(input).has('review')).toBe(false);
  });
});
