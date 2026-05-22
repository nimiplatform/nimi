import type { Realm } from '@nimiplatform/sdk/realm';
import { vi } from 'vitest';
import type { MyRealmAgentDto, OwnerPortfolioAgentDetail, SettingField } from './portfolio-data.js';
import {
  REALM_AGENT_CREATE_PATH,
  REALM_AGENT_CREATE_SOURCE,
  type RealmAgentCreationWorldDto,
  type ReviewedCreateRealmAgentPayload,
} from './create-agent-draft.js';
import type { CandidatePostPayload } from './post-draft.js';
import type { RealmAgentVisibilitySettings } from './portfolio-settings-client.js';

export const agent: MyRealmAgentDto = {
  id: 'agent-1',
  handle: 'mira',
  displayName: 'Mira',
  createdAt: '2026-05-21T00:00:00.000Z',
  isAgent: true,
};

export const world: RealmAgentCreationWorldDto = {
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

export function mockRealm() {
  return {
    services: {
      AgentsService: {
        agentControllerCheckHandle: vi.fn(async (handle: string) => ({
          available: handle !== 'taken.agent',
          normalized: handle,
          ...(handle === 'taken.agent' ? { message: 'Handle already taken.' } : {}),
        })),
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
        getMyRealmAgentSettings: vi.fn(async (agentId: string) => ({
          agentId,
          worldId: 'world-oasis',
          agentRuleVersion: 3,
          displayName: 'Mira',
          description: 'Quiet strategist',
          greeting: 'Welcome in.',
          naturalLanguageIntent: null,
          identity: {
            publicRole: 'Guide',
            worldview: 'Layered world.',
          },
          personality: {
            summary: 'Patient strategist.',
            relationshipMode: 'mentor',
            interests: ['strategy'],
            goals: ['keep lore coherent'],
          },
          communication: {
            contentStyle: 'Concise.',
            formality: 'casual',
            responseLength: 'medium',
            sentiment: 'neutral',
          },
          boundaries: {
            allowedThemes: ['adventure'],
            disallowedThemes: ['gore'],
          },
          positioning: {
            targetAudience: 'builders',
            positioning: 'guide',
          },
          updatedAt: '2026-05-21T00:00:00.000Z',
        })),
        updateMyRealmAgentSettings: vi.fn(async (agentId: string, input: Record<string, unknown>) => ({
          agentId,
          worldId: 'world-oasis',
          agentRuleVersion: 4,
          displayName: typeof input.displayName === 'string' ? input.displayName : 'Mira',
          description: typeof input.description === 'string' ? input.description : 'Quiet strategist',
          greeting: typeof input.greeting === 'string' ? input.greeting : 'Welcome in.',
          naturalLanguageIntent: typeof input.naturalLanguageIntent === 'string' ? input.naturalLanguageIntent : null,
          identity: {
            publicRole: 'Guide',
            worldview: 'Layered world.',
            ...((input.identity && typeof input.identity === 'object') ? input.identity as Record<string, unknown> : {}),
          },
          personality: {
            summary: 'Patient strategist.',
            relationshipMode: 'mentor',
            interests: ['strategy'],
            goals: ['keep lore coherent'],
            ...((input.personality && typeof input.personality === 'object') ? input.personality as Record<string, unknown> : {}),
          },
          communication: {
            contentStyle: 'Concise.',
            formality: 'casual',
            responseLength: 'medium',
            sentiment: 'neutral',
            ...((input.communication && typeof input.communication === 'object') ? input.communication as Record<string, unknown> : {}),
          },
          boundaries: {
            allowedThemes: ['adventure'],
            disallowedThemes: ['gore'],
            ...((input.boundaries && typeof input.boundaries === 'object') ? input.boundaries as Record<string, unknown> : {}),
          },
          positioning: {
            targetAudience: 'builders',
            positioning: 'guide',
            ...((input.positioning && typeof input.positioning === 'object') ? input.positioning as Record<string, unknown> : {}),
          },
          updatedAt: '2026-05-22T00:00:00.000Z',
        })),
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
    },
  } as unknown as Realm;
}

export function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (!value || typeof value !== 'object') {
    return keys;
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    keys.add(key);
    collectKeys(nested, keys);
  }

  return keys;
}

export function detailField(key: SettingField['key'], label: string, value: string): SettingField {
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

export function ownerAgentDetail(): OwnerPortfolioAgentDetail {
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

export function ownerAgentDetailWithWorldId(worldId = 'world-oasis'): OwnerPortfolioAgentDetail {
  return {
    ...ownerAgentDetail(),
    world: detailField('world', 'World id evidence', worldId),
  };
}

export const candidatePayload: CandidatePostPayload = {
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

export const createPayload: ReviewedCreateRealmAgentPayload = {
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
