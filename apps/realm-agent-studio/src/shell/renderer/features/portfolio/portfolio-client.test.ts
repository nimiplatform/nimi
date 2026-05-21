import type { Realm } from '@nimiplatform/sdk/realm';
import { describe, expect, it, vi } from 'vitest';
import {
  buildRealmCreateAgentInput,
  buildRealmCreatePostInput,
  createReviewedRealmAgent,
  getCreateRealmAgentWorldPreview,
  getOwnerPortfolioAgentDetail,
  listCreateRealmAgentSelectableWorlds,
  listOwnerPortfolioAgents,
  normalizeRealmAgentCreateResult,
  normalizeRealmPostPublishResult,
  publishReviewedPostDraft,
} from './portfolio-client.js';
import type { MyRealmAgentDto } from './portfolio-data.js';
import {
  REALM_AGENT_CREATE_PATH,
  REALM_AGENT_CREATE_SOURCE,
  type RealmAgentCreationWorldDto,
  type ReviewedCreateRealmAgentPayload,
} from './create-agent-draft.js';
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
      AgentsService: {
        agentControllerCreate: vi.fn(async () => ({
          id: 'agent-created-1',
          state: 'INCUBATING',
          dna: {},
          user: {
            id: 'agent-created-1',
            handle: 'mira.agent',
            displayName: 'Mira Agent',
          },
        })),
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

const createPayload: ReviewedCreateRealmAgentPayload = {
  source: REALM_AGENT_CREATE_SOURCE,
  path: REALM_AGENT_CREATE_PATH,
  publicFields: {
    handle: 'mira.agent',
    displayName: 'Mira Agent',
    publicBio: 'Local draft only',
    concept: 'Durable public Realm Agent',
    description: 'Owner-created public identity',
    rulesText: 'Stay visible.\nStay owner-reviewed.',
  },
  body: {
    handle: 'mira.agent',
    displayName: 'Mira Agent',
    concept: 'Durable public Realm Agent',
    description: 'Owner-created public identity',
    worldId: 'world-oasis',
    ownershipType: 'MASTER_OWNED',
    rules: {
      format: 'rule-lines-v1',
      lines: ['Stay visible.', 'Stay owner-reviewed.'],
      text: 'Stay visible.\nStay owner-reviewed.',
    },
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
    expect(realm.services.AgentsService.agentControllerCreate).not.toHaveBeenCalled();
    expect(worlds[0]).toMatchObject({
      id: 'world-oasis',
      source: 'Realm WorldsService.worldControllerListWorlds',
    });
  });

  it('uses WorldsService detail-with-agents for selected world preview', async () => {
    const realm = mockRealm();
    const preview = await getCreateRealmAgentWorldPreview('world-oasis', realm);

    expect(realm.services.WorldsService.worldControllerGetWorldDetailWithAgents).toHaveBeenCalledWith('world-oasis', 4);
    expect(realm.services.AgentsService.agentControllerCreate).not.toHaveBeenCalled();
    expect(preview.source).toBe('Realm WorldsService.worldControllerGetWorldDetailWithAgents');
  });

  it('creates a Realm Agent through AgentsService.agentControllerCreate with CreateAgentDto allowlist only', async () => {
    const realm = mockRealm();
    const result = await createReviewedRealmAgent(createPayload, realm);
    const createAgent = realm.services.AgentsService.agentControllerCreate;
    const submittedPayload = vi.mocked(createAgent).mock.calls[0]?.[0];

    expect(createAgent).toHaveBeenCalledTimes(1);
    expect(submittedPayload).toEqual(createPayload.body);
    expect(Object.keys(submittedPayload || {}).sort()).toEqual([
      'concept',
      'description',
      'displayName',
      'handle',
      'ownershipType',
      'rules',
      'worldId',
    ]);
    expect(collectKeys(submittedPayload).has('publicBio')).toBe(false);
    expect(collectKeys(submittedPayload).has('id')).toBe(false);
    expect(collectKeys(submittedPayload).has('authorId')).toBe(false);
    expect(collectKeys(submittedPayload).has('ownerId')).toBe(false);
    expect(collectKeys(submittedPayload).has('creatorId')).toBe(false);
    expect(collectKeys(submittedPayload).has('maintainerId')).toBe(false);
    expect(collectKeys(submittedPayload).has('state')).toBe(false);
    expect(collectKeys(submittedPayload).has('lifecycle')).toBe(false);
    expect(collectKeys(submittedPayload).has('provider')).toBe(false);
    expect(collectKeys(submittedPayload).has('model')).toBe(false);
    expect(collectKeys(submittedPayload).has('LocalAgent')).toBe(false);
    expect(collectKeys(submittedPayload).has('dna')).toBe(false);
    expect(collectKeys(submittedPayload).has('dnaPrimary')).toBe(false);
    expect(collectKeys(submittedPayload).has('dnaSecondary')).toBe(false);
    expect(collectKeys(submittedPayload).has('referenceImageUrl')).toBe(false);
    expect(result).toMatchObject({
      ok: true,
      source: REALM_AGENT_CREATE_SOURCE,
      canonical: {
        id: 'agent-created-1',
        state: 'INCUBATING',
      },
    });
  });

  it('does not require or call a Creator service for create reads or writes', async () => {
    const realm = mockRealm();

    expect(Object.hasOwn(realm.services, 'CreatorService')).toBe(false);
    await listCreateRealmAgentSelectableWorlds(realm);
    await getCreateRealmAgentWorldPreview('world-oasis', realm);
    await createReviewedRealmAgent(createPayload, realm);

    expect(realm.services.AgentsService.agentControllerCreate).toHaveBeenCalledTimes(1);
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

  it('normalizes Create Agent responses without canonical id as create failure', () => {
    const result = normalizeRealmAgentCreateResult({} as Awaited<ReturnType<Realm['services']['AgentsService']['agentControllerCreate']>>);

    expect(result).toMatchObject({
      ok: false,
      source: REALM_AGENT_CREATE_SOURCE,
      failure: 'realm-create-agent-missing-canonical-id',
    });
  });

  it('builds CreateAgentDto shape from reviewed payload body only', () => {
    const input = buildRealmCreateAgentInput(createPayload);

    expect(input).toEqual(createPayload.body);
    expect(collectKeys(input).has('publicFields')).toBe(false);
    expect(collectKeys(input).has('path')).toBe(false);
    expect(collectKeys(input).has('source')).toBe(false);
  });

  it('rebuilds CreateAgentDto from a narrow allowlist and forces MASTER_OWNED at submit boundary', () => {
    const dirtyPayload = {
      ...createPayload,
      body: {
        ...createPayload.body,
        ownershipType: 'WORLD_OWNED',
        dna: { hidden: true },
        dnaPrimary: 'MYSTERIOUS',
        dnaSecondary: ['CALM'],
        referenceImageUrl: 'https://cdn.example.test/reference.png',
        lifecycle: 'ACTIVE',
        provider: 'forbidden',
        model: 'forbidden',
        ownerId: 'owner-1',
      },
    } as unknown as ReviewedCreateRealmAgentPayload;
    const input = buildRealmCreateAgentInput(dirtyPayload);

    expect(input).toEqual(createPayload.body);
    expect(input.ownershipType).toBe('MASTER_OWNED');
    expect(collectKeys(input).has('dna')).toBe(false);
    expect(collectKeys(input).has('dnaPrimary')).toBe(false);
    expect(collectKeys(input).has('dnaSecondary')).toBe(false);
    expect(collectKeys(input).has('referenceImageUrl')).toBe(false);
    expect(collectKeys(input).has('lifecycle')).toBe(false);
    expect(collectKeys(input).has('provider')).toBe(false);
    expect(collectKeys(input).has('model')).toBe(false);
    expect(collectKeys(input).has('ownerId')).toBe(false);
  });

  it('builds CreatePostDto shape from reviewed payload only', () => {
    const input = buildRealmCreatePostInput(candidatePayload);

    expect(input).toEqual(candidatePayload.realmCreatePost);
    expect(collectKeys(input).has('agentRef')).toBe(false);
    expect(collectKeys(input).has('review')).toBe(false);
  });
});
