import type { Realm } from '@nimiplatform/sdk/realm';
import type { SpeechSynthesizeInput, SpeechSynthesizeOutput } from '@nimiplatform/sdk/runtime/browser';
import { createStudioRealmClient } from '@renderer/data/realm-client.js';
import { createStudioRuntimeClient } from '@renderer/data/runtime-client.js';
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
import {
  VOICE_DEMO_SYNTHESIS_SOURCE,
  buildReviewedVoiceDemoCandidatePayload,
  buildReviewedVoiceSynthesisPayload,
  type ReviewedVoiceDemoCandidatePayload,
  type VoiceDemoCandidateInput,
} from './media-voice-candidate.js';

type RealmCreateAgentResponse = Awaited<ReturnType<Realm['services']['AgentsService']['agentControllerCreate']>>;
type RealmSelectAvatarInput = Parameters<Realm['services']['AgentsService']['agentControllerSelectAvatar']>[1];
type RealmSelectAvatarResponse = Awaited<ReturnType<Realm['services']['AgentsService']['agentControllerSelectAvatar']>>;
export type RealmAgentVisibilitySettings = Awaited<ReturnType<Realm['services']['AgentsService']['agentControllerGetVisibility']>>;
type RealmAgentVisibilityUpdateInput = Parameters<Realm['services']['AgentsService']['agentControllerUpdateVisibility']>[1];
type RealmCreatePostInput = Parameters<Realm['services']['PostsService']['createPost']>[0];
type RealmCreatePostResponse = Awaited<ReturnType<Realm['services']['PostsService']['createPost']>>;
type RealmCreateTextResourceInput = Parameters<Realm['services']['ResourcesService']['createTextResource']>[0];
type RealmCreateTextResourceResponse = Awaited<ReturnType<Realm['services']['ResourcesService']['createTextResource']>>;

export const REALM_POST_PUBLISH_SOURCE = 'Realm PostsService.createPost';
export const REALM_TEXT_RESOURCE_SOURCE = 'Realm ResourcesService.createTextResource';
export const REALM_AGENT_AVATAR_SELECT_SOURCE = 'Realm AgentsService.agentControllerSelectAvatar';
export const REALM_AGENT_VISIBILITY_SOURCE = 'Realm AgentsService.agentControllerUpdateVisibility';
export const AGENT_VISIBILITY_VALUES = ['PUBLIC', 'FRIENDS', 'PRIVATE'] as const;
export const AGENT_VISIBILITY_FIELDS = [
  'accountVisibility',
  'defaultPostVisibility',
  'dmVisibility',
  'profileVisibility',
] as const;

type RuntimeVoiceClient = {
  media: {
    tts: {
      synthesize(input: SpeechSynthesizeInput): Promise<SpeechSynthesizeOutput>;
    };
  };
};

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

export type RealmTextResourceCanonicalFields = {
  id: string;
  resourceType: string;
  status: string;
  deliveryAccess?: string;
};

export type RealmTextResourceCreateResult =
  | {
    ok: true;
    source: typeof REALM_TEXT_RESOURCE_SOURCE;
    attachmentTruth: true;
    resource: RealmCreateTextResourceResponse;
    canonical: RealmTextResourceCanonicalFields;
  }
  | {
    ok: false;
    source: typeof REALM_TEXT_RESOURCE_SOURCE;
    attachmentTruth: false;
    failure:
      | 'post-text-resource-payload-invalid'
      | 'realm-create-text-resource-failed'
      | 'realm-create-text-resource-missing-id'
      | 'realm-create-text-resource-not-ready';
    message: string;
    submitted: RealmCreateTextResourceInput | null;
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

export type RealmAgentAvatarSelectResult =
  | {
    ok: true;
    source: typeof REALM_AGENT_AVATAR_SELECT_SOURCE;
    publicTruth: true;
    submitted: RealmSelectAvatarInput;
    realm: {
      success: true;
    };
  }
  | {
    ok: false;
    source: typeof REALM_AGENT_AVATAR_SELECT_SOURCE;
    publicTruth: false;
    failure: 'avatar-url-invalid' | 'realm-select-avatar-failed' | 'realm-select-avatar-rejected';
    message: string;
    submitted: RealmSelectAvatarInput | null;
  };

export type AgentVisibilityValue = typeof AGENT_VISIBILITY_VALUES[number];
export type AgentVisibilityField = typeof AGENT_VISIBILITY_FIELDS[number];
export type AgentVisibilityDraft = Record<AgentVisibilityField, string>;

export type RealmAgentVisibilityUpdateResult =
  | {
    ok: true;
    source: typeof REALM_AGENT_VISIBILITY_SOURCE;
    lifecycleTruth: false;
    submitted: RealmAgentVisibilityUpdateInput;
    settings: RealmAgentVisibilitySettings;
  }
  | {
    ok: false;
    source: typeof REALM_AGENT_VISIBILITY_SOURCE;
    lifecycleTruth: false;
    failure: 'visibility-payload-invalid' | 'visibility-no-changes' | 'realm-update-visibility-failed';
    message: string;
    submitted: RealmAgentVisibilityUpdateInput | null;
    draft: AgentVisibilityDraft;
  };

export type RuntimeVoiceDemoSynthesisResult =
  | {
    ok: true;
    source: typeof VOICE_DEMO_SYNTHESIS_SOURCE;
    candidate: true;
    publicTruth: false;
    draft: ReviewedVoiceDemoCandidatePayload;
    runtime: {
      jobId?: string;
      artifactIds: string[];
      traceId?: string;
      modelResolved?: string;
    };
  }
  | {
    ok: false;
    source: typeof VOICE_DEMO_SYNTHESIS_SOURCE;
    failure:
      | 'runtime-payload-invalid'
      | 'runtime-transport-unavailable'
      | 'runtime-synthesize-failed'
      | 'runtime-output-missing';
    message: string;
    draft: ReviewedVoiceDemoCandidatePayload | null;
  };

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function normalizeAvatarUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function isAgentVisibilityValue(value: string): value is AgentVisibilityValue {
  return AGENT_VISIBILITY_VALUES.includes(value as AgentVisibilityValue);
}

function normalizeRuntimeVoiceDemoSynthesisOutput(
  output: SpeechSynthesizeOutput,
  draft: ReviewedVoiceDemoCandidatePayload,
): RuntimeVoiceDemoSynthesisResult {
  const job = output.job && typeof output.job === 'object' ? output.job : null;
  const jobId = job ? readOptionalString(job as unknown as Record<string, unknown>, 'jobId') : undefined;
  const jobTraceId = job ? readOptionalString(job as unknown as Record<string, unknown>, 'traceId') : undefined;
  const modelResolved = job ? readOptionalString(job as unknown as Record<string, unknown>, 'modelResolved') : undefined;
  const outputTraceId = output.trace && typeof output.trace === 'object'
    ? readOptionalString(output.trace as unknown as Record<string, unknown>, 'traceId')
    : undefined;
  const artifactIds = Array.isArray(output.artifacts)
    ? output.artifacts
      .map((artifact) => artifact && typeof artifact === 'object'
        ? readOptionalString(artifact as unknown as Record<string, unknown>, 'artifactId')
        : undefined)
      .filter((artifactId): artifactId is string => Boolean(artifactId))
    : [];

  if (!jobId && artifactIds.length === 0) {
    return {
      ok: false,
      source: VOICE_DEMO_SYNTHESIS_SOURCE,
      failure: 'runtime-output-missing',
      message: 'Runtime media.tts.synthesize output missing real job id or artifact id.',
      draft,
    };
  }

  return {
    ok: true,
    source: VOICE_DEMO_SYNTHESIS_SOURCE,
    candidate: true,
    publicTruth: false,
    draft,
    runtime: {
      ...(jobId ? { jobId } : {}),
      artifactIds,
      ...(outputTraceId || jobTraceId ? { traceId: outputTraceId || jobTraceId } : {}),
      ...(modelResolved ? { modelResolved } : {}),
    },
  };
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

export function buildRealmSelectAvatarInput(avatarUrl: string): RealmSelectAvatarInput | null {
  const normalizedAvatarUrl = normalizeAvatarUrl(avatarUrl);
  if (!normalizedAvatarUrl) {
    return null;
  }

  return {
    avatarUrl: normalizedAvatarUrl,
  };
}

export function createAgentVisibilityDraft(settings: RealmAgentVisibilitySettings): AgentVisibilityDraft {
  return {
    accountVisibility: settings.accountVisibility,
    defaultPostVisibility: settings.defaultPostVisibility,
    dmVisibility: settings.dmVisibility,
    profileVisibility: settings.profileVisibility,
  };
}

export function buildRealmUpdateVisibilityInput(
  draft: AgentVisibilityDraft,
  current: RealmAgentVisibilitySettings,
): { input: RealmAgentVisibilityUpdateInput | null; errors: string[] } {
  const input: RealmAgentVisibilityUpdateInput = {};
  const errors: string[] = [];

  for (const field of AGENT_VISIBILITY_FIELDS) {
    const value = draft[field];
    if (!isAgentVisibilityValue(value)) {
      errors.push(`${field} must be PUBLIC, FRIENDS, or PRIVATE`);
      continue;
    }
    if (value !== current[field]) {
      input[field] = value;
    }
  }

  if (errors.length > 0) {
    return { input: null, errors };
  }

  if (Object.keys(input).length === 0) {
    return { input: null, errors: ['visibility settings have no reviewed changes'] };
  }

  return { input, errors: [] };
}

export function normalizeRealmAgentAvatarSelectResult(
  response: RealmSelectAvatarResponse,
  submitted: RealmSelectAvatarInput,
): RealmAgentAvatarSelectResult {
  if (!response || typeof response !== 'object' || (response as Record<string, unknown>).success !== true) {
    return {
      ok: false,
      source: REALM_AGENT_AVATAR_SELECT_SOURCE,
      publicTruth: false,
      failure: 'realm-select-avatar-rejected',
      message: 'Realm avatar selection did not confirm success.',
      submitted,
    };
  }

  return {
    ok: true,
    source: REALM_AGENT_AVATAR_SELECT_SOURCE,
    publicTruth: true,
    submitted,
    realm: {
      success: true,
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

function normalizeResourceTitle(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

export function buildRealmPostTextResourceInput(payload: CandidatePostPayload): RealmCreateTextResourceInput | null {
  const content = payload.realmCreatePost.caption?.trim();
  if (!content) {
    return null;
  }

  return {
    content,
    agentId: payload.agentRef.agentKey,
    deliveryAccess: 'SIGNED',
    label: `Reviewed post text for ${payload.agentRef.handle ? `@${payload.agentRef.handle}` : payload.agentRef.displayName}`,
    mimeType: 'text/plain; charset=utf-8',
    sourceRef: 'realm-agent-studio.reviewed-post-text-resource',
    title: normalizeResourceTitle(content),
    ...(payload.realmCreatePost.tags && payload.realmCreatePost.tags.length > 0 ? { tags: [...payload.realmCreatePost.tags] } : {}),
    metadata: {
      source: 'realm-agent-studio.reviewed-post-text-resource',
      agentKey: payload.agentRef.agentKey,
      attachmentPurpose: 'post',
      humanReviewed: true,
    },
  };
}

export function normalizeRealmTextResourceCreateResult(
  resource: RealmCreateTextResourceResponse,
  submitted: RealmCreateTextResourceInput,
): RealmTextResourceCreateResult {
  if (!resource || typeof resource !== 'object') {
    return {
      ok: false,
      source: REALM_TEXT_RESOURCE_SOURCE,
      attachmentTruth: false,
      failure: 'realm-create-text-resource-missing-id',
      message: 'Realm Create Text Resource returned no resource object.',
      submitted,
    };
  }

  const record = resource as Record<string, unknown>;
  const id = readOptionalString(record, 'id');
  if (!id) {
    return {
      ok: false,
      source: REALM_TEXT_RESOURCE_SOURCE,
      attachmentTruth: false,
      failure: 'realm-create-text-resource-missing-id',
      message: 'Realm Create Text Resource returned no canonical resource id.',
      submitted,
    };
  }

  const resourceType = readOptionalString(record, 'resourceType');
  const status = readOptionalString(record, 'status');
  const deliveryAccess = readOptionalString(record, 'deliveryAccess');
  if (resourceType !== 'TEXT' || status !== 'READY') {
    return {
      ok: false,
      source: REALM_TEXT_RESOURCE_SOURCE,
      attachmentTruth: false,
      failure: 'realm-create-text-resource-not-ready',
      message: `Realm text resource ${id} is not a READY TEXT resource.`,
      submitted,
    };
  }

  return {
    ok: true,
    source: REALM_TEXT_RESOURCE_SOURCE,
    attachmentTruth: true,
    resource,
    canonical: {
      id,
      resourceType,
      status,
      ...(deliveryAccess ? { deliveryAccess } : {}),
    },
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

export async function selectReviewedAgentAvatarUrl(
  agentId: string,
  avatarUrl: string,
  realm: Realm = createStudioRealmClient(),
): Promise<RealmAgentAvatarSelectResult> {
  const submitted = buildRealmSelectAvatarInput(avatarUrl);
  if (!submitted) {
    return {
      ok: false,
      source: REALM_AGENT_AVATAR_SELECT_SOURCE,
      publicTruth: false,
      failure: 'avatar-url-invalid',
      message: 'Avatar URL selection requires a valid http(s) URL.',
      submitted: null,
    };
  }

  try {
    const response = await realm.services.AgentsService.agentControllerSelectAvatar(agentId, submitted);
    return normalizeRealmAgentAvatarSelectResult(response, submitted);
  } catch (error) {
    return {
      ok: false,
      source: REALM_AGENT_AVATAR_SELECT_SOURCE,
      publicTruth: false,
      failure: 'realm-select-avatar-failed',
      message: error instanceof Error ? error.message : 'Realm avatar selection failed.',
      submitted,
    };
  }
}

export async function getAgentVisibilitySettings(
  agentId: string,
  realm: Realm = createStudioRealmClient(),
): Promise<RealmAgentVisibilitySettings> {
  return realm.services.AgentsService.agentControllerGetVisibility(agentId);
}

export async function updateReviewedAgentVisibility(
  agentId: string,
  draft: AgentVisibilityDraft,
  current: RealmAgentVisibilitySettings,
  realm: Realm = createStudioRealmClient(),
): Promise<RealmAgentVisibilityUpdateResult> {
  const { input, errors } = buildRealmUpdateVisibilityInput(draft, current);
  if (!input) {
    return {
      ok: false,
      source: REALM_AGENT_VISIBILITY_SOURCE,
      lifecycleTruth: false,
      failure: errors.some((error) => error.includes('no reviewed changes'))
        ? 'visibility-no-changes'
        : 'visibility-payload-invalid',
      message: errors.join('; ') || 'visibility payload invalid',
      submitted: null,
      draft,
    };
  }

  try {
    const settings = await realm.services.AgentsService.agentControllerUpdateVisibility(agentId, input);
    return {
      ok: true,
      source: REALM_AGENT_VISIBILITY_SOURCE,
      lifecycleTruth: false,
      submitted: input,
      settings,
    };
  } catch (error) {
    return {
      ok: false,
      source: REALM_AGENT_VISIBILITY_SOURCE,
      lifecycleTruth: false,
      failure: 'realm-update-visibility-failed',
      message: error instanceof Error ? error.message : 'Realm visibility update failed.',
      submitted: input,
      draft,
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

export async function createReviewedPostTextResource(
  payload: CandidatePostPayload,
  realm: Realm = createStudioRealmClient(),
): Promise<RealmTextResourceCreateResult> {
  const submitted = buildRealmPostTextResourceInput(payload);
  if (!submitted) {
    return {
      ok: false,
      source: REALM_TEXT_RESOURCE_SOURCE,
      attachmentTruth: false,
      failure: 'post-text-resource-payload-invalid',
      message: 'Reviewed post text resource requires caption content.',
      submitted: null,
    };
  }

  try {
    const resource = await realm.services.ResourcesService.createTextResource(submitted);
    return normalizeRealmTextResourceCreateResult(resource, submitted);
  } catch (error) {
    return {
      ok: false,
      source: REALM_TEXT_RESOURCE_SOURCE,
      attachmentTruth: false,
      failure: 'realm-create-text-resource-failed',
      message: error instanceof Error ? error.message : 'Realm Create Text Resource failed.',
      submitted,
    };
  }
}

export async function synthesizeReviewedVoiceDemo(
  input: VoiceDemoCandidateInput,
  agent: OwnerPortfolioAgentDetail,
  runtime?: RuntimeVoiceClient | null,
): Promise<RuntimeVoiceDemoSynthesisResult> {
  const draft = buildReviewedVoiceDemoCandidatePayload(input, agent);
  const synthesisPayload = buildReviewedVoiceSynthesisPayload(input, agent);

  if (!draft.payload || !synthesisPayload.payload) {
    return {
      ok: false,
      source: VOICE_DEMO_SYNTHESIS_SOURCE,
      failure: 'runtime-payload-invalid',
      message: synthesisPayload.errors.join('; ') || 'Runtime media.tts.synthesize payload invalid.',
      draft: draft.payload,
    };
  }

  const runtimeClient = runtime === undefined ? await createStudioRuntimeClient() : runtime;

  if (!runtimeClient) {
    return {
      ok: false,
      source: VOICE_DEMO_SYNTHESIS_SOURCE,
      failure: 'runtime-transport-unavailable',
      message: 'Runtime media.tts.synthesize runtime transport unavailable: Tauri IPC runtime transport is required.',
      draft: draft.payload,
    };
  }

  try {
    const output = await runtimeClient.media.tts.synthesize(synthesisPayload.payload);
    return normalizeRuntimeVoiceDemoSynthesisOutput(output, draft.payload);
  } catch (error) {
    return {
      ok: false,
      source: VOICE_DEMO_SYNTHESIS_SOURCE,
      failure: 'runtime-synthesize-failed',
      message: `Runtime media.tts.synthesize failed: ${error instanceof Error ? error.message : 'runtime transport call failed.'}`,
      draft: draft.payload,
    };
  }
}
