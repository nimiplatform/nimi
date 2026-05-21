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
  normalizeCreateRealmAgentDraft,
  normalizeRealmAgentHandleAvailability,
  normalizeSelectableWorlds,
  normalizeSelectedWorldPreview,
  type NormalizedRealmAgentHandleAvailability,
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
import {
  OWNER_SETTINGS_SAVE_SOURCE,
  buildRealmOwnerAgentSettingsUpdateInput,
  type OwnerAgentSettingsDraft,
} from './setting-proposal.js';

type RealmCreateAgentResponse = Awaited<ReturnType<Realm['services']['AgentsService']['agentControllerCreate']>>;
type RealmAgentHandleAvailabilityResponse = Awaited<ReturnType<Realm['services']['AgentsService']['agentControllerCheckHandle']>>;
type RealmSelectAvatarInput = Parameters<Realm['services']['AgentsService']['agentControllerSelectAvatar']>[1];
type RealmSelectAvatarResponse = Awaited<ReturnType<Realm['services']['AgentsService']['agentControllerSelectAvatar']>>;
export type RealmAgentVisibilitySettings = Awaited<ReturnType<Realm['services']['AgentsService']['agentControllerGetVisibility']>>;
type RealmAgentVisibilityUpdateInput = Parameters<Realm['services']['AgentsService']['agentControllerUpdateVisibility']>[1];
export type RealmOwnerAgentSettings = Awaited<ReturnType<Realm['services']['MeService']['getMyRealmAgentSettings']>>;
type RealmOwnerAgentSettingsUpdateInput = Parameters<Realm['services']['MeService']['updateMyRealmAgentSettings']>[1];
type RealmCreatePostInput = Parameters<Realm['services']['PostsService']['createPost']>[0];
type RealmCreatePostResponse = Awaited<ReturnType<Realm['services']['PostsService']['createPost']>>;
type RealmCreateTextResourceInput = Parameters<Realm['services']['ResourcesService']['createTextResource']>[0];
type RealmCreateTextResourceResponse = Awaited<ReturnType<Realm['services']['ResourcesService']['createTextResource']>>;
type RealmResourceListResponse = Awaited<ReturnType<Realm['services']['ResourcesService']['listResources']>>;
type RealmCreateImageUploadResponse = Awaited<ReturnType<Realm['services']['ResourcesService']['createImageDirectUpload']>>;
type RealmCreateVideoUploadResponse = Awaited<ReturnType<Realm['services']['ResourcesService']['createVideoDirectUpload']>>;
type RealmCreateAudioUploadInput = Parameters<Realm['services']['ResourcesService']['createAudioDirectUpload']>[0];
type RealmCreateAudioUploadResponse = Awaited<ReturnType<Realm['services']['ResourcesService']['createAudioDirectUpload']>>;
type RealmFinalizeResourceInput = Parameters<Realm['services']['ResourcesService']['finalizeResource']>[1];
type RealmFinalizeResourceResponse = Awaited<ReturnType<Realm['services']['ResourcesService']['finalizeResource']>>;
type RealmRuntimeProjectionInput = Parameters<Realm['services']['RuntimeProjectionsService']['projectRuntimePayload']>[0];
type RealmRuntimeProjectionResponse = Awaited<ReturnType<Realm['services']['RuntimeProjectionsService']['projectRuntimePayload']>>;

export const REALM_POST_PUBLISH_SOURCE = 'Realm PostsService.createPost';
export const REALM_TEXT_RESOURCE_SOURCE = 'Realm ResourcesService.createTextResource';
export const REALM_RESOURCE_LIST_SOURCE = 'Realm ResourcesService.listResources';
export const REALM_MEDIA_RESOURCE_UPLOAD_SOURCE = 'Realm ResourcesService direct upload + finalizeResource';
export const REALM_RUNTIME_PROJECTION_SOURCE = 'Realm RuntimeProjectionsService.projectRuntimePayload';
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

export type PostAttachmentResourceOption = {
  id: string;
  resourceType: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'TEXT';
  status: 'READY';
  label: string;
  deliveryAccess?: string;
  source: typeof REALM_RESOURCE_LIST_SOURCE;
};

export type DirectMediaResourceType = Extract<PostAttachmentResourceOption['resourceType'], 'IMAGE' | 'VIDEO' | 'AUDIO'>;

export type DirectMediaResourceUploadFile = {
  name: string;
  type: string;
  size: number;
};

export type DirectMediaResourceUploadInput = {
  resourceType: DirectMediaResourceType;
  file: DirectMediaResourceUploadFile;
  agent: OwnerPortfolioAgentDetail;
  tags?: string[];
};

type DirectMediaResourceUploadSession =
  | RealmCreateImageUploadResponse
  | RealmCreateVideoUploadResponse
  | RealmCreateAudioUploadResponse;

type DirectMediaResourceCanonicalFields = {
  id: string;
  resourceType: DirectMediaResourceType;
  status: 'READY';
  deliveryAccess?: string;
};

export type DirectMediaResourceUploadResult =
  | {
    ok: true;
    source: typeof REALM_MEDIA_RESOURCE_UPLOAD_SOURCE;
    attachmentTruth: true;
    publicTruth: false;
    session: {
      resourceId: string;
      resourceType: DirectMediaResourceType;
      status: string;
    };
    resource: RealmFinalizeResourceResponse;
    canonical: DirectMediaResourceCanonicalFields;
  }
  | {
    ok: false;
    source: typeof REALM_MEDIA_RESOURCE_UPLOAD_SOURCE;
    attachmentTruth: false;
    publicTruth: false;
    failure:
      | 'media-upload-file-invalid'
      | 'media-upload-type-invalid'
      | 'realm-direct-upload-session-failed'
      | 'realm-direct-upload-session-invalid'
      | 'storage-direct-upload-failed'
      | 'realm-finalize-resource-failed'
      | 'realm-finalize-resource-not-ready';
    message: string;
      submitted: RealmFinalizeResourceInput | RealmCreateAudioUploadInput | null;
  };

type StorageUploadRequest = {
  uploadUrl: string;
  resourceType: DirectMediaResourceType;
  file: DirectMediaResourceUploadFile;
};

type StorageUploadTransport = (request: StorageUploadRequest) => Promise<void>;

export type RuntimeProjectionSummary = {
  source: typeof REALM_RUNTIME_PROJECTION_SOURCE;
  consumerSurface: 'RUNTIME_PAYLOAD';
  worldId: string;
  checksum: string;
  selectedInputCount: number;
  suppressedInputCount: number;
  worldRuleCount: number;
  rawRuleContentExposed: false;
};

export type RuntimeProjectionSummaryResult =
  | {
    ok: true;
    source: typeof REALM_RUNTIME_PROJECTION_SOURCE;
    truthWrite: false;
    summary: RuntimeProjectionSummary;
    submitted: RealmRuntimeProjectionInput;
  }
  | {
    ok: false;
    source: typeof REALM_RUNTIME_PROJECTION_SOURCE;
    truthWrite: false;
    failure:
      | 'runtime-projection-world-unavailable'
      | 'runtime-projection-failed'
      | 'runtime-projection-invalid-response';
    message: string;
    submitted: RealmRuntimeProjectionInput | null;
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

export type RealmAgentHandleAvailabilityResult =
  | {
    ok: true;
    truthWrite: false;
    availability: NormalizedRealmAgentHandleAvailability;
    response: RealmAgentHandleAvailabilityResponse;
  }
  | {
    ok: false;
    truthWrite: false;
    failure: 'agent-handle-invalid' | 'realm-agent-handle-check-failed' | 'realm-agent-handle-check-invalid-response';
    message: string;
    availability: null;
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

export type RealmOwnerAgentSettingsUpdateResult =
  | {
    ok: true;
    source: typeof OWNER_SETTINGS_SAVE_SOURCE;
    truthWrite: true;
    submitted: RealmOwnerAgentSettingsUpdateInput;
    settings: RealmOwnerAgentSettings;
  }
  | {
    ok: false;
    source: typeof OWNER_SETTINGS_SAVE_SOURCE;
    truthWrite: false;
    failure: 'owner-settings-payload-invalid' | 'owner-settings-no-changes' | 'realm-update-owner-settings-failed';
    message: string;
    submitted: RealmOwnerAgentSettingsUpdateInput | null;
    draft: OwnerAgentSettingsDraft;
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

function isPostAttachmentResourceType(value: string): value is PostAttachmentResourceOption['resourceType'] {
  return value === 'IMAGE' || value === 'VIDEO' || value === 'AUDIO' || value === 'TEXT';
}

function isDirectMediaResourceType(value: string): value is DirectMediaResourceType {
  return value === 'IMAGE' || value === 'VIDEO' || value === 'AUDIO';
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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

export function normalizePostAttachmentResourceOptions(response: RealmResourceListResponse): PostAttachmentResourceOption[] {
  const items = response && typeof response === 'object' && Array.isArray((response as Record<string, unknown>).items)
    ? (response as { items: unknown[] }).items
    : [];

  return items.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }
    const record = item as Record<string, unknown>;
    const id = readOptionalString(record, 'id');
    const resourceType = readOptionalString(record, 'resourceType');
    const status = readOptionalString(record, 'status');
    if (!id || !resourceType || !isPostAttachmentResourceType(resourceType) || status !== 'READY') {
      return [];
    }

    const title = readOptionalString(record, 'title');
    const label = readOptionalString(record, 'label');
    const storageRef = readOptionalString(record, 'storageRef');
    const deliveryAccess = readOptionalString(record, 'deliveryAccess');

    return [{
      id,
      resourceType,
      status,
      label: title || label || storageRef || id,
      ...(deliveryAccess ? { deliveryAccess } : {}),
      source: REALM_RESOURCE_LIST_SOURCE,
    }];
  });
}

function isUploadableMediaFile(input: DirectMediaResourceUploadInput): boolean {
  if (!isDirectMediaResourceType(input.resourceType)) {
    return false;
  }
  if (!input.file.name.trim() || input.file.size <= 0) {
    return false;
  }
  if (input.resourceType === 'IMAGE') {
    return input.file.type.startsWith('image/');
  }
  if (input.resourceType === 'VIDEO') {
    return input.file.type.startsWith('video/');
  }
  return input.file.type.startsWith('audio/');
}

function normalizeDirectMediaTitle(fileName: string): string {
  return normalizeResourceTitle(fileName.replace(/\s+/g, ' ').trim() || 'Studio media upload');
}

export function buildFinalizeDirectMediaResourceInput(input: DirectMediaResourceUploadInput): RealmFinalizeResourceInput | null {
  if (!isUploadableMediaFile(input)) {
    return null;
  }

  const tags = input.tags?.map((tag) => tag.trim()).filter(Boolean) ?? [];
  return {
    agentId: input.agent.id,
    deliveryAccess: 'SIGNED',
    label: `Reviewed ${input.resourceType.toLowerCase()} upload for ${input.agent.handle.value ? `@${input.agent.handle.value}` : input.agent.displayName.value}`,
    mimeType: input.file.type,
    sizeBytes: input.file.size,
    sourceRef: 'realm-agent-studio.reviewed-post-media-resource',
    title: normalizeDirectMediaTitle(input.file.name),
    ...(tags.length > 0 ? { tags } : {}),
    metadata: {
      source: 'realm-agent-studio.reviewed-post-media-resource',
      agentKey: input.agent.id,
      attachmentPurpose: 'post',
      resourceType: input.resourceType,
      humanReviewed: true,
    },
  };
}

function normalizeDirectMediaUploadSession(
  session: DirectMediaResourceUploadSession,
  expectedResourceType: DirectMediaResourceType,
): { resourceId: string; resourceType: DirectMediaResourceType; uploadUrl: string; status: string } | null {
  if (!session || typeof session !== 'object') {
    return null;
  }
  const record = session as Record<string, unknown>;
  const resourceId = readOptionalString(record, 'resourceId');
  const resourceType = readOptionalString(record, 'resourceType');
  const uploadUrl = readOptionalString(record, 'uploadUrl');
  const status = readOptionalString(record, 'status');
  if (!resourceId || resourceType !== expectedResourceType || !uploadUrl || status !== 'PENDING') {
    return null;
  }
  return {
    resourceId,
    resourceType,
    uploadUrl,
    status,
  };
}

export function normalizeFinalizedDirectMediaResource(
  resource: RealmFinalizeResourceResponse,
  expectedResourceType: DirectMediaResourceType,
): DirectMediaResourceCanonicalFields | null {
  if (!resource || typeof resource !== 'object') {
    return null;
  }
  const record = resource as Record<string, unknown>;
  const id = readOptionalString(record, 'id');
  const resourceType = readOptionalString(record, 'resourceType');
  const status = readOptionalString(record, 'status');
  const deliveryAccess = readOptionalString(record, 'deliveryAccess');
  if (!id || resourceType !== expectedResourceType || status !== 'READY') {
    return null;
  }
  return {
    id,
    resourceType,
    status,
    ...(deliveryAccess ? { deliveryAccess } : {}),
  };
}

export function buildRuntimeProjectionInput(agent: OwnerPortfolioAgentDetail): RealmRuntimeProjectionInput | null {
  if (agent.world.status !== 'available' || !agent.world.value.trim()) {
    return null;
  }

  return {
    worldId: agent.world.value.trim(),
    contextEnvelope: {
      allowedWorldScopes: ['WORLD', 'REGION', 'FACTION', 'INDIVIDUAL', 'SCENE'],
      includeInheritedAgentRules: false,
      focusKeywords: ['realm-agent-studio', 'owner-reviewed-runtime-context'],
    },
  };
}

export function normalizeRuntimeProjectionSummary(response: RealmRuntimeProjectionResponse): RuntimeProjectionSummary | null {
  if (!response || typeof response !== 'object') {
    return null;
  }
  const record = response as Record<string, unknown>;
  const consumerSurface = record.consumerSurface;
  const worldId = readOptionalString(record, 'worldId');
  const checksum = readOptionalString(record, 'checksum');
  if (consumerSurface !== 'RUNTIME_PAYLOAD' || !worldId || !checksum) {
    return null;
  }

  const payload = record.payload && typeof record.payload === 'object' ? record.payload as Record<string, unknown> : {};
  const trace = record.trace && typeof record.trace === 'object' ? record.trace as Record<string, unknown> : {};

  return {
    source: REALM_RUNTIME_PROJECTION_SOURCE,
    consumerSurface,
    worldId,
    checksum,
    selectedInputCount: readArray(record.selectedInputs).length,
    suppressedInputCount: readArray(trace.suppressedInputs).length,
    worldRuleCount: readArray(payload.worldRules).length,
    rawRuleContentExposed: false,
  };
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

export async function checkCreateRealmAgentHandleAvailability(
  handle: string,
  realm: Realm = createStudioRealmClient(),
): Promise<RealmAgentHandleAvailabilityResult> {
  const normalizedHandle = normalizeCreateRealmAgentDraft({
    handle,
    displayName: '',
    publicBio: '',
    concept: '',
    description: '',
    ruleText: '',
    selectedWorldId: '',
  }).handle;
  if (!normalizedHandle) {
    return {
      ok: false,
      truthWrite: false,
      failure: 'agent-handle-invalid',
      message: 'Agent handle check requires a non-empty normalized handle.',
      availability: null,
    };
  }

  try {
    const response = await realm.services.AgentsService.agentControllerCheckHandle(normalizedHandle);
    if (!response || typeof response !== 'object' || typeof (response as Record<string, unknown>).available !== 'boolean') {
      return {
        ok: false,
        truthWrite: false,
        failure: 'realm-agent-handle-check-invalid-response',
        message: 'Realm handle availability check did not return an availability boolean.',
        availability: null,
      };
    }
    return {
      ok: true,
      truthWrite: false,
      availability: normalizeRealmAgentHandleAvailability(normalizedHandle, response),
      response,
    };
  } catch (error) {
    return {
      ok: false,
      truthWrite: false,
      failure: 'realm-agent-handle-check-failed',
      message: error instanceof Error ? error.message : 'Realm handle availability check failed.',
      availability: null,
    };
  }
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

export async function getOwnerAgentSettings(
  agentId: string,
  realm: Realm = createStudioRealmClient(),
): Promise<RealmOwnerAgentSettings> {
  return realm.services.MeService.getMyRealmAgentSettings(agentId);
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

export async function updateReviewedOwnerAgentSettings(
  agentId: string,
  draft: OwnerAgentSettingsDraft,
  current: RealmOwnerAgentSettings,
  realm: Realm = createStudioRealmClient(),
): Promise<RealmOwnerAgentSettingsUpdateResult> {
  const built = buildRealmOwnerAgentSettingsUpdateInput(draft, current);
  if (!built.ok) {
    return {
      ok: false,
      source: OWNER_SETTINGS_SAVE_SOURCE,
      truthWrite: false,
      failure: built.failure === 'owner-settings-invalid' ? 'owner-settings-payload-invalid' : 'owner-settings-no-changes',
      message: built.errors.join('; ') || 'Owner settings payload invalid.',
      submitted: null,
      draft,
    };
  }

  const submitted = built.input as RealmOwnerAgentSettingsUpdateInput;
  try {
    const settings = await realm.services.MeService.updateMyRealmAgentSettings(agentId, submitted);
    return {
      ok: true,
      source: OWNER_SETTINGS_SAVE_SOURCE,
      truthWrite: true,
      submitted,
      settings,
    };
  } catch (error) {
    return {
      ok: false,
      source: OWNER_SETTINGS_SAVE_SOURCE,
      truthWrite: false,
      failure: 'realm-update-owner-settings-failed',
      message: error instanceof Error ? error.message : 'Realm owner settings update failed.',
      submitted,
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

export async function listReadyPostAttachmentResources(
  realm: Realm = createStudioRealmClient(),
): Promise<PostAttachmentResourceOption[]> {
  const response = await realm.services.ResourcesService.listResources();
  return normalizePostAttachmentResourceOptions(response);
}

async function defaultStorageUploadTransport(request: StorageUploadRequest): Promise<void> {
  const response = request.resourceType === 'AUDIO'
    ? await fetch(request.uploadUrl, {
      method: 'PUT',
      body: request.file as unknown as BodyInit,
      headers: request.file.type ? { 'content-type': request.file.type } : undefined,
    })
    : await fetch(request.uploadUrl, {
      method: 'POST',
      body: (() => {
        const formData = new FormData();
        formData.append('file', request.file as unknown as Blob, request.file.name);
        return formData;
      })(),
    });

  if (!response.ok) {
    throw new Error(`storage upload failed with HTTP ${response.status}`);
  }
}

export async function uploadReviewedPostMediaResource(
  input: DirectMediaResourceUploadInput,
  realm: Realm = createStudioRealmClient(),
  storageUpload: StorageUploadTransport = defaultStorageUploadTransport,
): Promise<DirectMediaResourceUploadResult> {
  const finalizeInput = buildFinalizeDirectMediaResourceInput(input);
  if (!finalizeInput) {
    return {
      ok: false,
      source: REALM_MEDIA_RESOURCE_UPLOAD_SOURCE,
      attachmentTruth: false,
      publicTruth: false,
      failure: isDirectMediaResourceType(input.resourceType) ? 'media-upload-file-invalid' : 'media-upload-type-invalid',
      message: 'Reviewed media Resource upload requires a matching non-empty image, video, or audio file.',
      submitted: null,
    };
  }

  let rawSession: DirectMediaResourceUploadSession;
  try {
    if (input.resourceType === 'IMAGE') {
      rawSession = await realm.services.ResourcesService.createImageDirectUpload('true');
    } else if (input.resourceType === 'VIDEO') {
      rawSession = await realm.services.ResourcesService.createVideoDirectUpload('true');
    } else {
      rawSession = await realm.services.ResourcesService.createAudioDirectUpload({
        ...finalizeInput,
        filename: input.file.name,
      });
    }
  } catch (error) {
    return {
      ok: false,
      source: REALM_MEDIA_RESOURCE_UPLOAD_SOURCE,
      attachmentTruth: false,
      publicTruth: false,
      failure: 'realm-direct-upload-session-failed',
      message: error instanceof Error ? error.message : 'Realm direct upload session failed.',
      submitted: input.resourceType === 'AUDIO' ? { ...finalizeInput, filename: input.file.name } : finalizeInput,
    };
  }

  const session = normalizeDirectMediaUploadSession(rawSession, input.resourceType);
  if (!session) {
    return {
      ok: false,
      source: REALM_MEDIA_RESOURCE_UPLOAD_SOURCE,
      attachmentTruth: false,
      publicTruth: false,
      failure: 'realm-direct-upload-session-invalid',
      message: 'Realm direct upload session did not return a PENDING resource id and upload URL.',
      submitted: finalizeInput,
    };
  }

  try {
    await storageUpload({
      uploadUrl: session.uploadUrl,
      resourceType: input.resourceType,
      file: input.file,
    });
  } catch (error) {
    return {
      ok: false,
      source: REALM_MEDIA_RESOURCE_UPLOAD_SOURCE,
      attachmentTruth: false,
      publicTruth: false,
      failure: 'storage-direct-upload-failed',
      message: error instanceof Error ? error.message : 'Storage direct upload failed.',
      submitted: finalizeInput,
    };
  }

  try {
    const resource = await realm.services.ResourcesService.finalizeResource(session.resourceId, finalizeInput);
    const canonical = normalizeFinalizedDirectMediaResource(resource, input.resourceType);
    if (!canonical) {
      return {
        ok: false,
        source: REALM_MEDIA_RESOURCE_UPLOAD_SOURCE,
        attachmentTruth: false,
        publicTruth: false,
        failure: 'realm-finalize-resource-not-ready',
        message: 'Realm finalizeResource did not return a READY media Resource.',
        submitted: finalizeInput,
      };
    }
    return {
      ok: true,
      source: REALM_MEDIA_RESOURCE_UPLOAD_SOURCE,
      attachmentTruth: true,
      publicTruth: false,
      session: {
        resourceId: session.resourceId,
        resourceType: session.resourceType,
        status: session.status,
      },
      resource,
      canonical,
    };
  } catch (error) {
    return {
      ok: false,
      source: REALM_MEDIA_RESOURCE_UPLOAD_SOURCE,
      attachmentTruth: false,
      publicTruth: false,
      failure: 'realm-finalize-resource-failed',
      message: error instanceof Error ? error.message : 'Realm finalizeResource failed.',
      submitted: finalizeInput,
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

export async function projectAgentRuntimeContextSummary(
  agent: OwnerPortfolioAgentDetail,
  realm: Realm = createStudioRealmClient(),
): Promise<RuntimeProjectionSummaryResult> {
  const submitted = buildRuntimeProjectionInput(agent);
  if (!submitted) {
    return {
      ok: false,
      source: REALM_RUNTIME_PROJECTION_SOURCE,
      truthWrite: false,
      failure: 'runtime-projection-world-unavailable',
      message: 'Runtime projection requires worldId evidence from Realm MeService.getMyRealmAgent.',
      submitted: null,
    };
  }

  try {
    const response = await realm.services.RuntimeProjectionsService.projectRuntimePayload(submitted);
    const summary = normalizeRuntimeProjectionSummary(response);
    if (!summary) {
      return {
        ok: false,
        source: REALM_RUNTIME_PROJECTION_SOURCE,
        truthWrite: false,
        failure: 'runtime-projection-invalid-response',
        message: 'Runtime projection response did not include RUNTIME_PAYLOAD checksum summary.',
        submitted,
      };
    }
    return {
      ok: true,
      source: REALM_RUNTIME_PROJECTION_SOURCE,
      truthWrite: false,
      summary,
      submitted,
    };
  } catch (error) {
    return {
      ok: false,
      source: REALM_RUNTIME_PROJECTION_SOURCE,
      truthWrite: false,
      failure: 'runtime-projection-failed',
      message: error instanceof Error ? error.message : 'Realm runtime projection failed.',
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
