import type { Realm } from '@nimiplatform/sdk/realm';
import { describe, expect, it, vi } from 'vitest';
import {
  buildRealmCreateAgentInput,
  buildRealmAgentResourceBindingInput,
  buildRealmCreatePostInput,
  buildFinalizeDirectMediaResourceInput,
  buildRealmPostTextResourceInput,
  buildRuntimeProjectionInput,
  buildRealmSelectAvatarInput,
  buildRealmUpdateVisibilityInput,
  createAgentVisibilityDraft,
  bindReviewedAgentResource,
  createReviewedPostTextResource,
  createReviewedRealmAgent,
  getAgentVisibilitySettings,
  getCreateRealmAgentWorldPreview,
  getOwnerPortfolioAgentDetail,
  listCreateRealmAgentSelectableWorlds,
  listOwnerPortfolioAgents,
  normalizeRealmAgentAvatarSelectResult,
  normalizeRealmAgentCreateResult,
  normalizeRealmPostPublishResult,
  normalizeRealmTextResourceCreateResult,
  normalizePostAttachmentResourceOptions,
  normalizeAgentResourceBindingResult,
  normalizeFinalizedDirectMediaResource,
  normalizeRuntimeProjectionSummary,
  listReadyPostAttachmentResources,
  projectAgentRuntimeContextSummary,
  publishReviewedPostDraft,
  selectReviewedAgentAvatarUrl,
  synthesizeReviewedVoiceDemo,
  updateReviewedAgentVisibility,
  uploadReviewedPostMediaResource,
  type AgentVisibilityDraft,
  type RealmAgentVisibilitySettings,
} from './portfolio-client.js';
import type { MyRealmAgentDto, OwnerPortfolioAgentDetail, SettingField } from './portfolio-data.js';
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
        agentControllerSelectAvatar: vi.fn(async () => ({
          success: true,
        })),
        agentControllerGetVisibility: vi.fn(async () => ({
          accountVisibility: 'PUBLIC',
          defaultPostVisibility: 'PUBLIC',
          dmVisibility: 'FRIENDS',
          profileVisibility: 'PUBLIC',
        })),
        agentControllerUpdateVisibility: vi.fn(async (_agentId: string, input: Partial<RealmAgentVisibilitySettings>) => ({
          accountVisibility: input.accountVisibility || 'PUBLIC',
          defaultPostVisibility: input.defaultPostVisibility || 'PUBLIC',
          dmVisibility: input.dmVisibility || 'FRIENDS',
          profileVisibility: input.profileVisibility || 'PUBLIC',
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
      ResourcesService: {
        listResources: vi.fn(async () => ({
          items: [
            {
              id: 'resource-text-1',
              resourceType: 'TEXT',
              provider: 'S3_OBJECT',
              status: 'READY',
              storageRef: 'text/user-1/resource-text-1.txt',
              mimeType: 'text/plain; charset=utf-8',
              provenance: 'UPLOADED',
              uploaderAccountId: 'user-1',
              controllerKind: 'ACCOUNT',
              controllerId: 'user-1',
              deliveryAccess: 'SIGNED',
              agentId: 'agent-1',
              label: 'Reviewed post text for @mira',
              tags: ['studio'],
              title: 'Published caption',
              createdAt: '2026-05-21T00:00:00.000Z',
              updatedAt: '2026-05-21T00:00:00.000Z',
            },
            {
              id: 'resource-pending-image',
              resourceType: 'IMAGE',
              provider: 'CF_IMAGE',
              status: 'PENDING',
              storageRef: 'image/user-1/pending',
              provenance: 'UPLOADED',
              uploaderAccountId: 'user-1',
              controllerKind: 'ACCOUNT',
              controllerId: 'user-1',
              deliveryAccess: 'SIGNED',
              tags: [],
              createdAt: '2026-05-21T00:00:00.000Z',
              updatedAt: '2026-05-21T00:00:00.000Z',
            },
          ],
        })),
        createImageDirectUpload: vi.fn(async () => ({
          resourceId: 'resource-image-upload',
          resourceType: 'IMAGE',
          provider: 'CF_IMAGE',
          storageRef: 'cf-image-1',
          uploadUrl: 'https://upload.example.test/image',
          expiresIn: null,
          status: 'PENDING',
          deliveryAccess: 'SIGNED',
        })),
        createVideoDirectUpload: vi.fn(async () => ({
          resourceId: 'resource-video-upload',
          resourceType: 'VIDEO',
          provider: 'CF_STREAM',
          storageRef: 'cf-video-1',
          uploadUrl: 'https://upload.example.test/video',
          expiresIn: null,
          status: 'PENDING',
          deliveryAccess: 'SIGNED',
        })),
        createAudioDirectUpload: vi.fn(async () => ({
          resourceId: 'resource-audio-upload',
          resourceType: 'AUDIO',
          provider: 'S3_OBJECT',
          storageRef: 'audio/user-1/audio.mp3',
          uploadUrl: 'https://upload.example.test/audio',
          expiresIn: 3600,
          status: 'PENDING',
          deliveryAccess: 'SIGNED',
        })),
        finalizeResource: vi.fn(async (resourceId: string, input: Record<string, unknown>) => ({
          id: resourceId,
          resourceType: input.metadata && typeof input.metadata === 'object'
            ? (input.metadata as Record<string, unknown>).resourceType
            : 'IMAGE',
          provider: 'S3_OBJECT',
          status: 'READY',
          storageRef: resourceId,
          mimeType: input.mimeType,
          provenance: 'UPLOADED',
          uploaderAccountId: 'user-1',
          controllerKind: 'ACCOUNT',
          controllerId: 'user-1',
          deliveryAccess: input.deliveryAccess || 'SIGNED',
          agentId: input.agentId,
          label: input.label,
          tags: input.tags || [],
          title: input.title,
          metadata: input.metadata,
          createdAt: '2026-05-21T00:00:00.000Z',
          updatedAt: '2026-05-21T00:00:00.000Z',
        })),
        createTextResource: vi.fn(async () => ({
          id: 'resource-text-1',
          resourceType: 'TEXT',
          provider: 'S3_OBJECT',
          status: 'READY',
          storageRef: 'text/user-1/resource-text-1.txt',
          mimeType: 'text/plain; charset=utf-8',
          provenance: 'UPLOADED',
          uploaderAccountId: 'user-1',
          controllerKind: 'ACCOUNT',
          controllerId: 'user-1',
          deliveryAccess: 'SIGNED',
          agentId: 'agent-1',
          label: 'Reviewed post text for @mira',
          tags: ['studio'],
          title: 'Published caption',
          createdAt: '2026-05-21T00:00:00.000Z',
          updatedAt: '2026-05-21T00:00:00.000Z',
        })),
      },
      RuntimeProjectionsService: {
        projectRuntimePayload: vi.fn(async () => ({
          worldId: 'OASIS',
          consumerSurface: 'RUNTIME_PAYLOAD',
          releaseAnchor: null,
          checksum: 'checksum-runtime-1',
          selectedInputs: [{
            id: 'rule-input-1',
            sourceType: 'WORLD_RULE',
            sourceId: 'world-rule-1',
            lineageId: 'lineage-1',
            worldId: 'OASIS',
            ruleKey: 'hidden.raw.rule',
            title: 'Hidden raw rule title',
            statement: 'Hidden raw rule statement that must not reach Studio UI.',
            hardness: 'HARD',
            priority: 1,
            scope: 'WORLD',
            provenance: 'WORLD',
          }],
          trace: {
            selectedInputIds: ['rule-input-1'],
            suppressedInputs: [{
              input: {
                id: 'rule-input-suppressed',
                sourceType: 'AGENT_RULE',
                sourceId: 'agent-rule-1',
                lineageId: 'lineage-suppressed',
                worldId: 'OASIS',
                agentId: 'agent-1',
                ruleKey: 'hidden.agent.rule',
                title: 'Suppressed raw rule title',
                statement: 'Suppressed raw rule statement that must not reach Studio UI.',
                hardness: 'SOFT',
                priority: 1,
                scope: 'SELF',
                provenance: 'OWNER',
              },
              reason: 'SURFACE_POLICY',
            }],
            resolutionOutcomes: [],
          },
          payload: {
            worldRules: [{
              id: 'rule-input-1',
              sourceType: 'WORLD_RULE',
              sourceId: 'world-rule-1',
              lineageId: 'lineage-1',
              worldId: 'OASIS',
              ruleKey: 'hidden.raw.rule',
              title: 'Hidden raw rule title',
              statement: 'Hidden raw rule statement that must not reach Studio UI.',
              hardness: 'HARD',
              priority: 1,
              scope: 'WORLD',
              provenance: 'WORLD',
            }],
            agentRules: [],
          },
        })),
      },
      WorldControlService: {
        worldControlControllerBatchUpsertWorldBindings: vi.fn(async (worldId: string, body: { bindingUpserts: Array<Record<string, unknown>> }) => ({
          worldId,
          items: body.bindingUpserts.map((binding, index) => ({
            id: `binding-${index + 1}`,
            bindingKind: binding.bindingKind,
            bindingPoint: binding.bindingPoint,
            conditionHash: 'condition-none',
            conditions: {},
            createdAt: '2026-05-21T00:00:00.000Z',
            createdBy: 'user-1',
            hostId: binding.hostId,
            hostType: binding.hostType,
            objectId: binding.objectId,
            objectType: binding.objectType,
            priority: binding.priority || 0,
            scopeWorldId: worldId,
            tags: binding.tags || [],
            updatedAt: '2026-05-21T00:00:00.000Z',
            versionPin: null,
          })),
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

function detailField(key: SettingField['key'], label: string, value: string): SettingField {
  return {
    key,
    label,
    value,
    status: value ? 'available' : 'source-unavailable',
    source: 'Realm MeService.getMyRealmAgent',
    readOnly: true,
    ...(value ? {} : { unavailableLabel: 'setting read unavailable' }),
  };
}

function ownerAgentDetail(): OwnerPortfolioAgentDetail {
  return {
    id: 'agent-1',
    displayName: detailField('displayName', 'Display name', 'Mira'),
    handle: detailField('handle', 'Handle', 'mira'),
    bio: detailField('bio', 'Bio', ''),
    greeting: detailField('greeting', 'Greeting', ''),
    profileCoverUrl: detailField('profileCoverUrl', 'Profile cover URL', ''),
    ownership: detailField('ownership', 'Ownership evidence', 'MASTER_OWNED'),
    world: detailField('world', 'World evidence', 'OASIS'),
    state: detailField('state', 'State evidence', 'ACTIVE'),
    avatarUrl: null,
    friendCount: { status: 'source-unavailable', label: 'friendCount source unavailable' },
    source: 'Realm MeService.getMyRealmAgent',
  };
}

function ownerAgentDetailWithWorldId(worldId = 'world-oasis'): OwnerPortfolioAgentDetail {
  return {
    ...ownerAgentDetail(),
    world: detailField('world', 'World id evidence', worldId),
  };
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

  it('selects a reviewed avatar URL through AgentsService.agentControllerSelectAvatar only', async () => {
    const realm = mockRealm();
    const result = await selectReviewedAgentAvatarUrl('agent-1', ' https://cdn.example.test/avatar.png ', realm);
    const selectAvatar = realm.services.AgentsService.agentControllerSelectAvatar;
    const submittedPayload = vi.mocked(selectAvatar).mock.calls[0]?.[1];

    expect(selectAvatar).toHaveBeenCalledWith('agent-1', {
      avatarUrl: 'https://cdn.example.test/avatar.png',
    });
    expect(submittedPayload).toEqual({
      avatarUrl: 'https://cdn.example.test/avatar.png',
    });
    expect(Object.keys(submittedPayload || {})).toEqual(['avatarUrl']);
    expect(collectKeys(submittedPayload).has('profileCoverUrl')).toBe(false);
    expect(collectKeys(submittedPayload).has('resourceId')).toBe(false);
    expect(collectKeys(submittedPayload).has('bindingId')).toBe(false);
    expect(collectKeys(submittedPayload).has('provider')).toBe(false);
    expect(collectKeys(submittedPayload).has('model')).toBe(false);
    expect(Object.hasOwn(realm.services, 'CreatorService')).toBe(false);
    expect(result).toMatchObject({
      ok: true,
      source: 'Realm AgentsService.agentControllerSelectAvatar',
      publicTruth: true,
      realm: {
        success: true,
      },
    });
  });

  it('rejects invalid avatar URLs before calling Realm', async () => {
    const realm = mockRealm();
    const result = await selectReviewedAgentAvatarUrl('agent-1', 'data:text/plain,avatar', realm);

    expect(realm.services.AgentsService.agentControllerSelectAvatar).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      source: 'Realm AgentsService.agentControllerSelectAvatar',
      publicTruth: false,
      failure: 'avatar-url-invalid',
      submitted: null,
    });
  });

  it('fails closed when Realm rejects avatar selection success confirmation', () => {
    const submitted = {
      avatarUrl: 'https://cdn.example.test/avatar.png',
    };
    const result = normalizeRealmAgentAvatarSelectResult({ success: false }, submitted);

    expect(result).toMatchObject({
      ok: false,
      source: 'Realm AgentsService.agentControllerSelectAvatar',
      publicTruth: false,
      failure: 'realm-select-avatar-rejected',
      submitted,
    });
  });

  it('builds SelectAvatarDto from a narrow URL allowlist', () => {
    expect(buildRealmSelectAvatarInput(' https://cdn.example.test/avatar.png ')).toEqual({
      avatarUrl: 'https://cdn.example.test/avatar.png',
    });
    expect(buildRealmSelectAvatarInput('ftp://cdn.example.test/avatar.png')).toBeNull();
    expect(buildRealmSelectAvatarInput('')).toBeNull();
  });

  it('reads owner visibility through AgentsService.agentControllerGetVisibility', async () => {
    const realm = mockRealm();
    const settings = await getAgentVisibilitySettings('agent-1', realm);

    expect(realm.services.AgentsService.agentControllerGetVisibility).toHaveBeenCalledWith('agent-1');
    expect(settings).toEqual({
      accountVisibility: 'PUBLIC',
      defaultPostVisibility: 'PUBLIC',
      dmVisibility: 'FRIENDS',
      profileVisibility: 'PUBLIC',
    });
    expect(Object.hasOwn(realm.services, 'CreatorService')).toBe(false);
  });

  it('updates owner visibility through AgentsService.agentControllerUpdateVisibility with changed allowlisted fields only', async () => {
    const realm = mockRealm();
    const current: RealmAgentVisibilitySettings = {
      accountVisibility: 'PUBLIC',
      defaultPostVisibility: 'PUBLIC',
      dmVisibility: 'FRIENDS',
      profileVisibility: 'PUBLIC',
    };
    const draft: AgentVisibilityDraft = {
      accountVisibility: 'FRIENDS',
      defaultPostVisibility: 'PUBLIC',
      dmVisibility: 'PRIVATE',
      profileVisibility: 'PUBLIC',
    };
    const result = await updateReviewedAgentVisibility('agent-1', draft, current, realm);
    const updateVisibility = realm.services.AgentsService.agentControllerUpdateVisibility;
    const submittedPayload = vi.mocked(updateVisibility).mock.calls[0]?.[1];

    expect(updateVisibility).toHaveBeenCalledWith('agent-1', {
      accountVisibility: 'FRIENDS',
      dmVisibility: 'PRIVATE',
    });
    expect(Object.keys(submittedPayload || {}).sort()).toEqual(['accountVisibility', 'dmVisibility']);
    expect(collectKeys(submittedPayload).has('state')).toBe(false);
    expect(collectKeys(submittedPayload).has('lifecycle')).toBe(false);
    expect(collectKeys(submittedPayload).has('moderationStatus')).toBe(false);
    expect(collectKeys(submittedPayload).has('worldId')).toBe(false);
    expect(collectKeys(submittedPayload).has('provider')).toBe(false);
    expect(collectKeys(submittedPayload).has('model')).toBe(false);
    expect(result).toMatchObject({
      ok: true,
      source: 'Realm AgentsService.agentControllerUpdateVisibility',
      lifecycleTruth: false,
      submitted: {
        accountVisibility: 'FRIENDS',
        dmVisibility: 'PRIVATE',
      },
    });
  });

  it('fails closed on visibility no-op or invalid enum without calling Realm', async () => {
    const realm = mockRealm();
    const current: RealmAgentVisibilitySettings = {
      accountVisibility: 'PUBLIC',
      defaultPostVisibility: 'PUBLIC',
      dmVisibility: 'FRIENDS',
      profileVisibility: 'PUBLIC',
    };

    const noChange = await updateReviewedAgentVisibility('agent-1', createAgentVisibilityDraft(current), current, realm);
    const invalidDraft = {
      ...createAgentVisibilityDraft(current),
      dmVisibility: 'EVERYONE',
    } as AgentVisibilityDraft;
    const invalid = await updateReviewedAgentVisibility('agent-1', invalidDraft, current, realm);

    expect(realm.services.AgentsService.agentControllerUpdateVisibility).not.toHaveBeenCalled();
    expect(noChange).toMatchObject({
      ok: false,
      source: 'Realm AgentsService.agentControllerUpdateVisibility',
      lifecycleTruth: false,
      failure: 'visibility-no-changes',
      submitted: null,
    });
    expect(invalid).toMatchObject({
      ok: false,
      source: 'Realm AgentsService.agentControllerUpdateVisibility',
      lifecycleTruth: false,
      failure: 'visibility-payload-invalid',
      submitted: null,
    });
  });

  it('builds UpdateAgentVisibilityDto from changed visibility fields only', () => {
    const current: RealmAgentVisibilitySettings = {
      accountVisibility: 'PUBLIC',
      defaultPostVisibility: 'PUBLIC',
      dmVisibility: 'FRIENDS',
      profileVisibility: 'PUBLIC',
    };
    const draft: AgentVisibilityDraft = {
      ...createAgentVisibilityDraft(current),
      profileVisibility: 'PRIVATE',
    };

    expect(buildRealmUpdateVisibilityInput(draft, current)).toEqual({
      input: {
        profileVisibility: 'PRIVATE',
      },
      errors: [],
    });
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

  it('creates a reviewed post text Resource through ResourcesService.createTextResource only', async () => {
    const realm = mockRealm();
    const result = await createReviewedPostTextResource(candidatePayload, realm);
    const createTextResource = realm.services.ResourcesService.createTextResource;
    const submittedPayload = vi.mocked(createTextResource).mock.calls[0]?.[0];

    expect(createTextResource).toHaveBeenCalledTimes(1);
    expect(submittedPayload).toEqual({
      content: 'Published caption',
      agentId: 'agent-1',
      deliveryAccess: 'SIGNED',
      label: 'Reviewed post text for @mira',
      mimeType: 'text/plain; charset=utf-8',
      sourceRef: 'realm-agent-studio.reviewed-post-text-resource',
      title: 'Published caption',
      tags: ['studio'],
      metadata: {
        source: 'realm-agent-studio.reviewed-post-text-resource',
        agentKey: 'agent-1',
        attachmentPurpose: 'post',
        humanReviewed: true,
      },
    });
    expect(Object.keys(submittedPayload || {}).sort()).toEqual([
      'agentId',
      'content',
      'deliveryAccess',
      'label',
      'metadata',
      'mimeType',
      'sourceRef',
      'tags',
      'title',
    ]);
    expect(collectKeys(submittedPayload).has('worldId')).toBe(false);
    expect(collectKeys(submittedPayload).has('authorId')).toBe(false);
    expect(collectKeys(submittedPayload).has('postId')).toBe(false);
    expect(collectKeys(submittedPayload).has('id')).toBe(false);
    expect(collectKeys(submittedPayload).has('provider')).toBe(false);
    expect(collectKeys(submittedPayload).has('model')).toBe(false);
    expect(Object.hasOwn(realm.services, 'CreatorService')).toBe(false);
    expect(result).toMatchObject({
      ok: true,
      source: 'Realm ResourcesService.createTextResource',
      attachmentTruth: true,
      canonical: {
        id: 'resource-text-1',
        resourceType: 'TEXT',
        status: 'READY',
        deliveryAccess: 'SIGNED',
      },
    });
  });

  it('lists READY Resource attachment options without treating non-ready resources as publishable', async () => {
    const realm = mockRealm();
    const resources = await listReadyPostAttachmentResources(realm);

    expect(realm.services.ResourcesService.listResources).toHaveBeenCalledTimes(1);
    expect(resources).toEqual([{
      id: 'resource-text-1',
      resourceType: 'TEXT',
      status: 'READY',
      label: 'Published caption',
      deliveryAccess: 'SIGNED',
      source: 'Realm ResourcesService.listResources',
    }]);
    expect(Object.hasOwn(realm.services, 'CreatorService')).toBe(false);
  });

  it('normalizes Resource attachment options from READY resources only', () => {
    expect(normalizePostAttachmentResourceOptions({
      items: [
        { id: 'resource-ready-image', resourceType: 'IMAGE', status: 'READY', title: 'Ready portrait' },
        { id: 'resource-ready-video', resourceType: 'VIDEO', status: 'READY', label: 'Ready trailer' },
        { id: 'resource-ready-audio', resourceType: 'AUDIO', status: 'READY', storageRef: 'audio/user-1/ready.mp3' },
        { id: 'resource-pending-video', resourceType: 'VIDEO', status: 'PENDING', title: 'Pending video' },
        { id: 'resource-deleted-audio', resourceType: 'AUDIO', status: 'DELETED', title: 'Deleted audio' },
        { id: 'resource-unknown', resourceType: 'VOICE', status: 'READY', title: 'Unknown type' },
      ],
    } as Awaited<ReturnType<Realm['services']['ResourcesService']['listResources']>>)).toEqual([{
      id: 'resource-ready-image',
      resourceType: 'IMAGE',
      status: 'READY',
      label: 'Ready portrait',
      source: 'Realm ResourcesService.listResources',
    }, {
      id: 'resource-ready-video',
      resourceType: 'VIDEO',
      status: 'READY',
      label: 'Ready trailer',
      source: 'Realm ResourcesService.listResources',
    }, {
      id: 'resource-ready-audio',
      resourceType: 'AUDIO',
      status: 'READY',
      label: 'audio/user-1/ready.mp3',
      source: 'Realm ResourcesService.listResources',
    }]);
  });

  it('uploads reviewed image Resource through direct upload and finalize only', async () => {
    const realm = mockRealm();
    const storageUpload = vi.fn(async () => undefined);
    const result = await uploadReviewedPostMediaResource({
      resourceType: 'IMAGE',
      file: { name: 'portrait.png', type: 'image/png', size: 2048 },
      agent: ownerAgentDetailWithWorldId(),
    }, realm, storageUpload);
    const finalizeResource = realm.services.ResourcesService.finalizeResource;
    const finalizePayload = vi.mocked(finalizeResource).mock.calls[0]?.[1];

    expect(realm.services.ResourcesService.createImageDirectUpload).toHaveBeenCalledWith('true');
    expect(storageUpload).toHaveBeenCalledWith({
      uploadUrl: 'https://upload.example.test/image',
      resourceType: 'IMAGE',
      file: { name: 'portrait.png', type: 'image/png', size: 2048 },
    });
    expect(finalizeResource).toHaveBeenCalledWith('resource-image-upload', {
      agentId: 'agent-1',
      deliveryAccess: 'SIGNED',
      label: 'Reviewed image upload for @mira',
      mimeType: 'image/png',
      sizeBytes: 2048,
      sourceRef: 'realm-agent-studio.reviewed-post-media-resource',
      title: 'portrait.png',
      metadata: {
        source: 'realm-agent-studio.reviewed-post-media-resource',
        agentKey: 'agent-1',
        attachmentPurpose: 'post',
        resourceType: 'IMAGE',
        humanReviewed: true,
      },
    });
    expect(collectKeys(finalizePayload).has('worldId')).toBe(false);
    expect(collectKeys(finalizePayload).has('authorId')).toBe(false);
    expect(collectKeys(finalizePayload).has('id')).toBe(false);
    expect(collectKeys(finalizePayload).has('provider')).toBe(false);
    expect(collectKeys(finalizePayload).has('model')).toBe(false);
    expect(result).toMatchObject({
      ok: true,
      source: 'Realm ResourcesService direct upload + finalizeResource',
      attachmentTruth: true,
      publicTruth: false,
      canonical: {
        id: 'resource-image-upload',
        resourceType: 'IMAGE',
        status: 'READY',
      },
    });
  });

  it('creates audio upload session with metadata and finalizes after storage upload', async () => {
    const realm = mockRealm();
    const storageUpload = vi.fn(async () => undefined);
    const result = await uploadReviewedPostMediaResource({
      resourceType: 'AUDIO',
      file: { name: 'voice.mp3', type: 'audio/mpeg', size: 4096 },
      agent: ownerAgentDetailWithWorldId(),
    }, realm, storageUpload);
    const audioPayload = vi.mocked(realm.services.ResourcesService.createAudioDirectUpload).mock.calls[0]?.[0];

    expect(audioPayload).toMatchObject({
      agentId: 'agent-1',
      filename: 'voice.mp3',
      mimeType: 'audio/mpeg',
      metadata: {
        source: 'realm-agent-studio.reviewed-post-media-resource',
        resourceType: 'AUDIO',
      },
    });
    expect(storageUpload).toHaveBeenCalledWith({
      uploadUrl: 'https://upload.example.test/audio',
      resourceType: 'AUDIO',
      file: { name: 'voice.mp3', type: 'audio/mpeg', size: 4096 },
    });
    expect(result).toMatchObject({
      ok: true,
      canonical: {
        id: 'resource-audio-upload',
        resourceType: 'AUDIO',
        status: 'READY',
      },
    });
  });

  it('fails closed before direct upload for mismatched media file types', async () => {
    const realm = mockRealm();
    const result = await uploadReviewedPostMediaResource({
      resourceType: 'VIDEO',
      file: { name: 'not-video.png', type: 'image/png', size: 10 },
      agent: ownerAgentDetail(),
    }, realm, vi.fn(async () => undefined));

    expect(realm.services.ResourcesService.createVideoDirectUpload).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      failure: 'media-upload-file-invalid',
      submitted: null,
    });
  });

  it('fails closed when Realm direct upload session creation throws', async () => {
    const realm = mockRealm();
    vi.mocked(realm.services.ResourcesService.createImageDirectUpload).mockRejectedValueOnce(new Error('Cloudflare unavailable'));

    const result = await uploadReviewedPostMediaResource({
      resourceType: 'IMAGE',
      file: { name: 'portrait.png', type: 'image/png', size: 2048 },
      agent: ownerAgentDetail(),
    }, realm, vi.fn(async () => undefined));

    expect(realm.services.ResourcesService.finalizeResource).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      failure: 'realm-direct-upload-session-failed',
      message: 'Cloudflare unavailable',
    });
  });

  it('fails closed when Realm direct upload session is not a PENDING matching Resource', async () => {
    const realm = mockRealm();
    vi.mocked(realm.services.ResourcesService.createImageDirectUpload).mockResolvedValueOnce({
      resourceId: 'resource-wrong',
      resourceType: 'VIDEO',
      provider: 'CF_STREAM',
      storageRef: 'wrong',
      uploadUrl: 'https://upload.example.test/wrong',
      status: 'PENDING',
      deliveryAccess: 'SIGNED',
    });

    const result = await uploadReviewedPostMediaResource({
      resourceType: 'IMAGE',
      file: { name: 'portrait.png', type: 'image/png', size: 2048 },
      agent: ownerAgentDetail(),
    }, realm, vi.fn(async () => undefined));

    expect(realm.services.ResourcesService.finalizeResource).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      failure: 'realm-direct-upload-session-invalid',
    });
  });

  it('fails closed when storage direct upload fails before finalize', async () => {
    const realm = mockRealm();
    const storageUpload = vi.fn(async () => {
      throw new Error('storage rejected upload');
    });

    const result = await uploadReviewedPostMediaResource({
      resourceType: 'IMAGE',
      file: { name: 'portrait.png', type: 'image/png', size: 2048 },
      agent: ownerAgentDetail(),
    }, realm, storageUpload);

    expect(realm.services.ResourcesService.finalizeResource).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      failure: 'storage-direct-upload-failed',
      message: 'storage rejected upload',
    });
  });

  it('fails closed when finalizeResource throws after storage upload', async () => {
    const realm = mockRealm();
    vi.mocked(realm.services.ResourcesService.finalizeResource).mockRejectedValueOnce(new Error('finalize rejected'));

    const result = await uploadReviewedPostMediaResource({
      resourceType: 'IMAGE',
      file: { name: 'portrait.png', type: 'image/png', size: 2048 },
      agent: ownerAgentDetail(),
    }, realm, vi.fn(async () => undefined));

    expect(result).toMatchObject({
      ok: false,
      failure: 'realm-finalize-resource-failed',
      message: 'finalize rejected',
    });
  });

  it('fails closed when finalizeResource returns a non-ready media Resource', async () => {
    const realm = mockRealm();
    vi.mocked(realm.services.ResourcesService.finalizeResource).mockResolvedValueOnce({
      id: 'resource-image-upload',
      resourceType: 'IMAGE',
      provider: 'CF_IMAGE',
      status: 'PENDING',
      storageRef: 'resource-image-upload',
      provenance: 'UPLOADED',
      uploaderAccountId: 'user-1',
      controllerKind: 'ACCOUNT',
      controllerId: 'user-1',
      deliveryAccess: 'SIGNED',
      tags: [],
      createdAt: '2026-05-21T00:00:00.000Z',
      updatedAt: '2026-05-21T00:00:00.000Z',
    });

    const result = await uploadReviewedPostMediaResource({
      resourceType: 'IMAGE',
      file: { name: 'portrait.png', type: 'image/png', size: 2048 },
      agent: ownerAgentDetail(),
    }, realm, vi.fn(async () => undefined));

    expect(result).toMatchObject({
      ok: false,
      failure: 'realm-finalize-resource-not-ready',
    });
  });

  it('fails closed when finalized direct media Resource is not READY', () => {
    expect(buildFinalizeDirectMediaResourceInput({
      resourceType: 'VIDEO',
      file: { name: 'clip.mp4', type: 'video/mp4', size: 1024 },
      agent: ownerAgentDetail(),
    })).toMatchObject({
      agentId: 'agent-1',
      mimeType: 'video/mp4',
    });
    expect(normalizeFinalizedDirectMediaResource({
      id: 'resource-video-upload',
      resourceType: 'VIDEO',
      status: 'PENDING',
    } as Awaited<ReturnType<Realm['services']['ResourcesService']['finalizeResource']>>, 'VIDEO')).toBeNull();
  });

  it('projects Runtime context through world-only RuntimeProjectionsService and returns summary counts only', async () => {
    const realm = mockRealm();
    const result = await projectAgentRuntimeContextSummary(ownerAgentDetail(), realm);
    const projectRuntimePayload = realm.services.RuntimeProjectionsService.projectRuntimePayload;
    const submittedPayload = vi.mocked(projectRuntimePayload).mock.calls[0]?.[0];

    expect(projectRuntimePayload).toHaveBeenCalledWith({
      worldId: 'OASIS',
      contextEnvelope: {
        allowedWorldScopes: ['WORLD', 'REGION', 'FACTION', 'INDIVIDUAL', 'SCENE'],
        includeInheritedAgentRules: false,
        focusKeywords: ['realm-agent-studio', 'owner-reviewed-runtime-context'],
      },
    });
    expect(collectKeys(submittedPayload).has('agentId')).toBe(false);
    expect(collectKeys(submittedPayload).has('statement')).toBe(false);
    expect(result).toMatchObject({
      ok: true,
      source: 'Realm RuntimeProjectionsService.projectRuntimePayload',
      truthWrite: false,
      summary: {
        consumerSurface: 'RUNTIME_PAYLOAD',
        worldId: 'OASIS',
        checksum: 'checksum-runtime-1',
        selectedInputCount: 1,
        suppressedInputCount: 1,
        worldRuleCount: 1,
        rawRuleContentExposed: false,
      },
    });
    expect(collectKeys(result).has('statement')).toBe(false);
    expect(collectKeys(result).has('ruleKey')).toBe(false);
    expect(collectKeys(result).has('selectedInputs')).toBe(false);
  });

  it('normalizes Runtime projection summary without exposing raw rule content', () => {
    const summary = normalizeRuntimeProjectionSummary({
      worldId: 'world-1',
      agentId: 'agent-1',
      consumerSurface: 'RUNTIME_PAYLOAD',
      checksum: 'checksum-1',
      selectedInputs: [{ statement: 'raw statement' }],
      trace: {
        selectedInputIds: ['rule-1'],
        suppressedInputs: [{ input: { statement: 'suppressed raw' }, reason: 'SURFACE_POLICY' }],
        resolutionOutcomes: [],
      },
      payload: {
        worldRules: [{ statement: 'world raw' }],
      },
    } as unknown as Awaited<ReturnType<Realm['services']['RuntimeProjectionsService']['projectRuntimePayload']>>);

    expect(summary).toEqual({
      source: 'Realm RuntimeProjectionsService.projectRuntimePayload',
      consumerSurface: 'RUNTIME_PAYLOAD',
      worldId: 'world-1',
      checksum: 'checksum-1',
      selectedInputCount: 1,
      suppressedInputCount: 1,
      worldRuleCount: 1,
      rawRuleContentExposed: false,
    });
    expect(collectKeys(summary).has('statement')).toBe(false);
    expect(collectKeys(summary).has('agentId')).toBe(false);
  });

  it('fails closed before Runtime projection when world evidence is missing', async () => {
    const realm = mockRealm();
    const result = await projectAgentRuntimeContextSummary({
      ...ownerAgentDetail(),
      world: detailField('world', 'World evidence', ''),
    }, realm);

    expect(realm.services.RuntimeProjectionsService.projectRuntimePayload).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      truthWrite: false,
      failure: 'runtime-projection-world-unavailable',
      submitted: null,
    });
  });

  it('builds no agent-specific Runtime projection request for owner-facing summary UI', () => {
    expect(buildRuntimeProjectionInput(ownerAgentDetail())).toMatchObject({
      worldId: 'OASIS',
    });
    expect(collectKeys(buildRuntimeProjectionInput(ownerAgentDetail())).has('agentId')).toBe(false);
  });

  it('defers owner-reviewed Resource-backed Agent Binding until Realm exposes owner-scoped ingress', async () => {
    const realm = mockRealm();
    const result = await bindReviewedAgentResource({
      agent: ownerAgentDetailWithWorldId(),
      resourceId: ' resource-image-1 ',
      resourceType: 'IMAGE',
      bindingPoint: 'AGENT_PORTRAIT',
      humanReviewed: true,
      intentPrompt: ' Owner selected portrait ',
    }, realm);
    const upsert = realm.services.WorldControlService.worldControlControllerBatchUpsertWorldBindings;

    expect(upsert).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      source: 'Realm owner-scoped Agent Binding ingress (deferred)',
      bindingTruth: false,
      publicProfileTruth: false,
      customVoiceTruth: false,
      publishTruth: false,
      failure: 'agent-binding-owner-surface-deferred',
      submitted: {
        worldId: 'world-oasis',
        body: {
          bindingUpserts: [{
            bindingKind: 'PRESENTATION',
            bindingPoint: 'AGENT_PORTRAIT',
            hostId: 'agent-1',
            hostType: 'AGENT',
            objectId: 'resource-image-1',
            objectType: 'RESOURCE',
            priority: 0,
            tags: ['realm-agent-studio', 'owner-reviewed'],
            intentPrompt: 'Owner selected portrait',
          }],
        },
      },
    });
    expect(collectKeys(result.submitted).has('profileCoverUrl')).toBe(false);
    expect(collectKeys(result.submitted).has('avatarUrl')).toBe(false);
    expect(Object.hasOwn(realm.services, 'CreatorService')).toBe(false);
    expect(Object.hasOwn(realm.services, 'AgentRulesService')).toBe(false);
  });

  it('builds an AUDIO voice sample Binding payload without Resource VOICE or custom voice truth', () => {
    expect(buildRealmAgentResourceBindingInput({
      agent: ownerAgentDetailWithWorldId(),
      resourceId: 'resource-audio-1',
      resourceType: 'AUDIO',
      bindingPoint: 'AGENT_VOICE_SAMPLE',
      humanReviewed: true,
    })).toEqual({
      worldId: 'world-oasis',
      body: {
        bindingUpserts: [{
          bindingKind: 'PRESENTATION',
          bindingPoint: 'AGENT_VOICE_SAMPLE',
          hostId: 'agent-1',
          hostType: 'AGENT',
          objectId: 'resource-audio-1',
          objectType: 'RESOURCE',
          priority: 0,
          tags: ['realm-agent-studio', 'owner-reviewed'],
        }],
      },
    });
  });

  it('fails closed before Agent Binding when world, resource, or binding matrix evidence is invalid', async () => {
    const realm = mockRealm();

    await expect(bindReviewedAgentResource({
      agent: { ...ownerAgentDetailWithWorldId(), world: detailField('world', 'World evidence', '') },
      resourceId: 'resource-image-1',
      resourceType: 'IMAGE',
      bindingPoint: 'AGENT_PORTRAIT',
      humanReviewed: true,
    }, realm)).resolves.toMatchObject({
      ok: false,
      failure: 'agent-binding-world-unavailable',
      submitted: null,
    });

    await expect(bindReviewedAgentResource({
      agent: ownerAgentDetailWithWorldId(),
      resourceId: 'resource-image-1',
      resourceType: 'IMAGE',
      bindingPoint: 'AGENT_PORTRAIT',
      humanReviewed: false,
    }, realm)).resolves.toMatchObject({
      ok: false,
      failure: 'agent-binding-review-missing',
      submitted: null,
    });

    await expect(bindReviewedAgentResource({
      agent: ownerAgentDetailWithWorldId(),
      resourceId: '',
      resourceType: 'IMAGE',
      bindingPoint: 'AGENT_PORTRAIT',
      humanReviewed: true,
    }, realm)).resolves.toMatchObject({
      ok: false,
      failure: 'agent-binding-resource-invalid',
      submitted: null,
    });

    await expect(bindReviewedAgentResource({
      agent: ownerAgentDetailWithWorldId(),
      resourceId: 'resource-audio-1',
      resourceType: 'AUDIO',
      bindingPoint: 'AGENT_PORTRAIT',
      humanReviewed: true,
    }, realm)).resolves.toMatchObject({
      ok: false,
      failure: 'agent-binding-point-invalid',
      submitted: null,
    });

    expect(realm.services.WorldControlService.worldControlControllerBatchUpsertWorldBindings).not.toHaveBeenCalled();
  });

  it('fails closed when Agent Binding response omits the canonical binding id', () => {
    const submitted = buildRealmAgentResourceBindingInput({
      agent: ownerAgentDetailWithWorldId(),
      resourceId: 'resource-image-1',
      resourceType: 'IMAGE',
      bindingPoint: 'AGENT_CANDIDATE',
      humanReviewed: true,
    });
    expect(submitted).not.toBeNull();
    expect(normalizeAgentResourceBindingResult({
      worldId: 'OASIS',
      items: [{
        hostId: 'agent-1',
        hostType: 'AGENT',
        objectId: 'resource-image-1',
        objectType: 'RESOURCE',
        bindingKind: 'PRESENTATION',
        bindingPoint: 'AGENT_CANDIDATE',
        scopeWorldId: 'world-oasis',
      }],
    }, submitted as NonNullable<typeof submitted>)).toMatchObject({
      ok: false,
      failure: 'realm-agent-binding-missing-canonical-id',
      bindingTruth: false,
    });
  });

  it('fails closed when Agent Binding response returns a different scope world id', () => {
    const submitted = buildRealmAgentResourceBindingInput({
      agent: ownerAgentDetailWithWorldId(),
      resourceId: 'resource-image-1',
      resourceType: 'IMAGE',
      bindingPoint: 'AGENT_PORTRAIT',
      humanReviewed: true,
    });
    expect(submitted).not.toBeNull();
    expect(normalizeAgentResourceBindingResult({
      worldId: 'different-world',
      items: [{
        id: 'binding-cross-world',
        hostId: 'agent-1',
        hostType: 'AGENT',
        objectId: 'resource-image-1',
        objectType: 'RESOURCE',
        bindingKind: 'PRESENTATION',
        bindingPoint: 'AGENT_PORTRAIT',
        scopeWorldId: 'different-world',
      }],
    }, submitted as NonNullable<typeof submitted>)).toMatchObject({
      ok: false,
      failure: 'realm-agent-binding-missing-canonical-id',
      bindingTruth: false,
    });
  });

  it('fails closed before text Resource creation when reviewed caption content is missing', async () => {
    const realm = mockRealm();
    const result = await createReviewedPostTextResource({
      ...candidatePayload,
      realmCreatePost: {
        attachments: [],
      },
    }, realm);

    expect(realm.services.ResourcesService.createTextResource).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      source: 'Realm ResourcesService.createTextResource',
      attachmentTruth: false,
      failure: 'post-text-resource-payload-invalid',
      submitted: null,
    });
  });

  it('fails closed when text Resource creation does not return a READY TEXT resource', () => {
    const submitted = buildRealmPostTextResourceInput(candidatePayload);
    expect(submitted).not.toBeNull();

    const result = normalizeRealmTextResourceCreateResult({
      id: 'resource-image-1',
      resourceType: 'IMAGE',
      status: 'PENDING',
    } as Awaited<ReturnType<Realm['services']['ResourcesService']['createTextResource']>>, submitted!);

    expect(result).toMatchObject({
      ok: false,
      source: 'Realm ResourcesService.createTextResource',
      attachmentTruth: false,
      failure: 'realm-create-text-resource-not-ready',
      submitted,
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

  it('calls Runtime media.tts.synthesize with the allowlisted reviewed voice body', async () => {
    const runtime = {
      media: {
        tts: {
          synthesize: vi.fn(async (_input: unknown) => ({
            job: {
              jobId: 'job-voice-1',
              modelResolved: 'runtime-tts-model',
              traceId: 'trace-job-1',
            },
            artifacts: [{
              artifactId: 'artifact-audio-1',
              mimeType: 'audio/wav',
            }],
            trace: {
              traceId: 'trace-output-1',
            },
          })),
        },
      },
    };

    const result = await synthesizeReviewedVoiceDemo({
      scriptText: '  Welcome in.  ',
      model: 'runtime-tts-model',
    }, ownerAgentDetail(), runtime as unknown as Parameters<typeof synthesizeReviewedVoiceDemo>[2]);

    expect(runtime.media.tts.synthesize).toHaveBeenCalledWith({
      model: 'runtime-tts-model',
      text: 'Welcome in.',
      metadata: {
        source: 'realm-agent-studio.reviewed-voice-demo-candidate',
        agentKey: 'agent-1',
      },
    });
    const submittedPayload = vi.mocked(runtime.media.tts.synthesize).mock.calls[0]?.[0];
    expect(Object.keys(submittedPayload || {}).sort()).toEqual(['metadata', 'model', 'text']);
    expect(collectKeys(submittedPayload).has('provider')).toBe(false);
    expect(collectKeys(submittedPayload).has('localAgent')).toBe(false);
    expect(collectKeys(submittedPayload).has('emotion')).toBe(false);
    expect(result).toMatchObject({
      ok: true,
      source: 'Runtime media.tts.synthesize',
      candidate: true,
      publicTruth: false,
      runtime: {
        jobId: 'job-voice-1',
        artifactIds: ['artifact-audio-1'],
        traceId: 'trace-output-1',
        modelResolved: 'runtime-tts-model',
      },
    });
  });

  it('fails closed when Runtime media.tts.synthesize model config is missing', async () => {
    const runtime = {
      media: {
        tts: {
          synthesize: vi.fn(),
        },
      },
    };
    const result = await synthesizeReviewedVoiceDemo({
      scriptText: 'Welcome in.',
      model: '',
    }, ownerAgentDetail(), runtime as unknown as Parameters<typeof synthesizeReviewedVoiceDemo>[2]);

    expect(runtime.media.tts.synthesize).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      source: 'Runtime media.tts.synthesize',
      failure: 'runtime-payload-invalid',
      message: 'Runtime media.tts.synthesize model config missing',
    });
  });

  it('fails closed when Runtime Tauri IPC transport is unavailable', async () => {
    const result = await synthesizeReviewedVoiceDemo({
      scriptText: 'Welcome in.',
      model: 'runtime-tts-model',
    }, ownerAgentDetail(), null);

    expect(result).toMatchObject({
      ok: false,
      source: 'Runtime media.tts.synthesize',
      failure: 'runtime-transport-unavailable',
      message: 'Runtime media.tts.synthesize runtime transport unavailable: Tauri IPC runtime transport is required.',
    });
    expect(result.draft).toMatchObject({
      candidate: true,
      publicTruth: false,
    });
  });

  it('fails closed when Runtime media.tts.synthesize output has no real job or artifact id', async () => {
    const runtime = {
      media: {
        tts: {
          synthesize: vi.fn(async (_input: unknown) => ({
            job: {},
            artifacts: [],
            trace: {},
          })),
        },
      },
    };
    const result = await synthesizeReviewedVoiceDemo({
      scriptText: 'Welcome in.',
      model: 'runtime-tts-model',
    }, ownerAgentDetail(), runtime as unknown as Parameters<typeof synthesizeReviewedVoiceDemo>[2]);

    expect(result).toMatchObject({
      ok: false,
      source: 'Runtime media.tts.synthesize',
      failure: 'runtime-output-missing',
      message: 'Runtime media.tts.synthesize output missing real job id or artifact id.',
    });
  });

  it('fails closed and preserves draft when Runtime media.tts.synthesize throws', async () => {
    const runtime = {
      media: {
        tts: {
          synthesize: vi.fn(async () => {
            throw new Error('runtime unavailable');
          }),
        },
      },
    };
    const result = await synthesizeReviewedVoiceDemo({
      scriptText: 'Welcome in.',
      model: 'runtime-tts-model',
    }, ownerAgentDetail(), runtime as unknown as Parameters<typeof synthesizeReviewedVoiceDemo>[2]);

    expect(runtime.media.tts.synthesize).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: false,
      source: 'Runtime media.tts.synthesize',
      failure: 'runtime-synthesize-failed',
      message: 'Runtime media.tts.synthesize failed: runtime unavailable',
      draft: {
        candidate: true,
        publicTruth: false,
      },
    });
  });
});
