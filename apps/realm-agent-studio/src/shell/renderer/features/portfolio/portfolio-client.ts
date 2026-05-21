import type { Realm } from '@nimiplatform/sdk/realm';
import { createStudioRealmClient } from '@renderer/data/realm-client.js';
import {
  normalizeOwnerPortfolio,
  normalizeOwnerPortfolioAgentDetail,
  type OwnerPortfolioAgent,
  type OwnerPortfolioAgentDetail,
} from './portfolio-data.js';
import {
  REALM_AGENT_CREATE_SOURCE,
  normalizeSelectableWorlds,
  normalizeSelectedWorldPreview,
  type RealmAgentCreationWorldDto,
  type RealmCreateAgentInput,
  type ReviewedCreateRealmAgentPayload,
  type SelectableRealmWorld,
  type SelectedWorldPreview,
} from './create-agent-draft.js';
import type { CandidatePostPayload } from './post-draft.js';

type RealmCreateAgentResponse = Awaited<ReturnType<Realm['services']['AgentsService']['agentControllerCreate']>>;
type RealmCreatePostInput = Parameters<Realm['services']['PostsService']['createPost']>[0];
type RealmCreatePostResponse = Awaited<ReturnType<Realm['services']['PostsService']['createPost']>>;

export const REALM_POST_PUBLISH_SOURCE = 'Realm PostsService.createPost';

export type RealmPostPublishCanonicalFields = {
  id: string;
  worldId?: string;
  moderationStatus?: string;
  status?: string;
  visibility?: string;
  contentRating?: string;
};

export type RealmPostPublishResult =
  | {
    ok: true;
    source: typeof REALM_POST_PUBLISH_SOURCE;
    post: RealmCreatePostResponse;
    canonical: RealmPostPublishCanonicalFields;
  }
  | {
    ok: false;
    source: typeof REALM_POST_PUBLISH_SOURCE;
    failure: 'realm-create-post-failed' | 'realm-create-post-missing-canonical-id';
    message: string;
  };

export type RealmAgentCreateCanonicalFields = {
  id: string;
  state?: string;
};

export type RealmAgentCreateResult =
  | {
    ok: true;
    source: typeof REALM_AGENT_CREATE_SOURCE;
    agent: RealmCreateAgentResponse;
    canonical: RealmAgentCreateCanonicalFields;
  }
  | {
    ok: false;
    source: typeof REALM_AGENT_CREATE_SOURCE;
    failure: 'realm-create-agent-failed' | 'realm-create-agent-missing-canonical-id';
    message: string;
  };

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function buildRealmCreateAgentInput(payload: ReviewedCreateRealmAgentPayload): RealmCreateAgentInput {
  const body = payload.body;
  return {
    handle: body.handle,
    displayName: body.displayName,
    worldId: body.worldId,
    concept: body.concept,
    ownershipType: 'MASTER_OWNED',
    ...(body.description ? { description: body.description } : {}),
    ...(body.rules
      ? {
        rules: {
          format: 'rule-lines-v1',
          lines: [...body.rules.lines],
          text: body.rules.text,
        },
      }
      : {}),
  };
}

export function normalizeRealmAgentCreateResult(agent: RealmCreateAgentResponse): RealmAgentCreateResult {
  if (!agent || typeof agent !== 'object') {
    return {
      ok: false,
      source: REALM_AGENT_CREATE_SOURCE,
      failure: 'realm-create-agent-missing-canonical-id',
      message: 'Realm Create Agent returned no agent object.',
    };
  }

  const record = agent as Record<string, unknown>;
  const id = readOptionalString(record, 'id');
  if (!id) {
    return {
      ok: false,
      source: REALM_AGENT_CREATE_SOURCE,
      failure: 'realm-create-agent-missing-canonical-id',
      message: 'Realm Create Agent returned no canonical agent id.',
    };
  }

  const state = readOptionalString(record, 'state');
  return {
    ok: true,
    source: REALM_AGENT_CREATE_SOURCE,
    agent,
    canonical: {
      id,
      ...(state ? { state } : {}),
    },
  };
}

export function buildRealmCreatePostInput(payload: CandidatePostPayload): RealmCreatePostInput {
  return {
    attachments: payload.realmCreatePost.attachments.map((attachment) => ({
      targetType: attachment.targetType,
      targetId: attachment.targetId,
    })),
    ...(payload.realmCreatePost.caption ? { caption: payload.realmCreatePost.caption } : {}),
    ...(payload.realmCreatePost.tags && payload.realmCreatePost.tags.length > 0 ? { tags: [...payload.realmCreatePost.tags] } : {}),
  };
}

export function normalizeRealmPostPublishResult(post: RealmCreatePostResponse): RealmPostPublishResult {
  if (!post || typeof post !== 'object') {
    return {
      ok: false,
      source: REALM_POST_PUBLISH_SOURCE,
      failure: 'realm-create-post-missing-canonical-id',
      message: 'Realm Create Post returned no post object.',
    };
  }

  const record = post as Record<string, unknown>;
  const id = readOptionalString(record, 'id');
  if (!id) {
    return {
      ok: false,
      source: REALM_POST_PUBLISH_SOURCE,
      failure: 'realm-create-post-missing-canonical-id',
      message: 'Realm Create Post returned no canonical post id.',
    };
  }

  const worldId = readOptionalString(record, 'worldId');
  const moderationStatus = readOptionalString(record, 'moderationStatus');
  const status = readOptionalString(record, 'status');
  const visibility = readOptionalString(record, 'visibility');
  const contentRating = readOptionalString(record, 'contentRating');

  return {
    ok: true,
    source: REALM_POST_PUBLISH_SOURCE,
    post,
    canonical: {
      id,
      ...(worldId ? { worldId } : {}),
      ...(moderationStatus ? { moderationStatus } : {}),
      ...(status ? { status } : {}),
      ...(visibility ? { visibility } : {}),
      ...(contentRating ? { contentRating } : {}),
    },
  };
}

export async function listOwnerPortfolioAgents(realm: Realm = createStudioRealmClient()): Promise<OwnerPortfolioAgent[]> {
  const agents = await realm.services.MeService.listMyRealmAgents();
  return normalizeOwnerPortfolio(agents);
}

export async function getOwnerPortfolioAgentDetail(
  agentId: string,
  realm: Realm = createStudioRealmClient(),
): Promise<OwnerPortfolioAgentDetail> {
  const agent = await realm.services.MeService.getMyRealmAgent(agentId);
  return normalizeOwnerPortfolioAgentDetail(agent);
}

export async function listCreateRealmAgentSelectableWorlds(
  realm: Realm = createStudioRealmClient(),
): Promise<SelectableRealmWorld[]> {
  const worlds = await realm.services.WorldsService.worldControllerListWorlds();
  return normalizeSelectableWorlds(worlds as RealmAgentCreationWorldDto[]);
}

export async function getCreateRealmAgentWorldPreview(
  worldId: string,
  realm: Realm = createStudioRealmClient(),
): Promise<SelectedWorldPreview> {
  const world = await realm.services.WorldsService.worldControllerGetWorldDetailWithAgents(worldId, 4);
  return normalizeSelectedWorldPreview(world);
}

export async function createReviewedRealmAgent(
  payload: ReviewedCreateRealmAgentPayload,
  realm: Realm = createStudioRealmClient(),
): Promise<RealmAgentCreateResult> {
  try {
    const agent = await realm.services.AgentsService.agentControllerCreate(buildRealmCreateAgentInput(payload));
    return normalizeRealmAgentCreateResult(agent);
  } catch (error) {
    return {
      ok: false,
      source: REALM_AGENT_CREATE_SOURCE,
      failure: 'realm-create-agent-failed',
      message: error instanceof Error ? error.message : 'Realm Create Agent failed.',
    };
  }
}

export async function publishReviewedPostDraft(
  payload: CandidatePostPayload,
  realm: Realm = createStudioRealmClient(),
): Promise<RealmPostPublishResult> {
  try {
    const post = await realm.services.PostsService.createPost(buildRealmCreatePostInput(payload));
    return normalizeRealmPostPublishResult(post);
  } catch (error) {
    return {
      ok: false,
      source: REALM_POST_PUBLISH_SOURCE,
      failure: 'realm-create-post-failed',
      message: error instanceof Error ? error.message : 'Realm Create Post failed.',
    };
  }
}
