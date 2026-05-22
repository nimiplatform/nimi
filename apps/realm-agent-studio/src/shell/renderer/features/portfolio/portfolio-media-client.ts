import type {
  RealmServiceArgs,
  RealmServiceMethod,
  RealmServiceName,
  RealmServiceResult,
} from '@nimiplatform/sdk/realm';
import type { ImageGenerateInput, ImageGenerateOutput, SpeechSynthesizeInput, SpeechSynthesizeOutput } from '@nimiplatform/sdk/runtime/browser';
import { createStudioRealmClient } from '@renderer/data/realm-client.js';
import { createStudioRuntimeClient } from '@renderer/data/runtime-client.js';
import type { OwnerPortfolioAgentDetail } from './portfolio-data.js';
import {
  VISUAL_IMAGE_GENERATION_SOURCE,
  VOICE_DEMO_SYNTHESIS_SOURCE,
  buildReviewedVisualImageCandidatePayload,
  buildReviewedVisualImageGenerationPayload,
  buildReviewedVoiceDemoCandidatePayload,
  buildReviewedVoiceSynthesisPayload,
  type ReviewedVisualImageCandidatePayload,
  type ReviewedVoiceDemoCandidatePayload,
  type VisualImageGenerationInput,
  type VoiceDemoCandidateInput,
} from './media-voice-candidate.js';

type StudioRealmMethod<
  Service extends RealmServiceName,
  Method extends RealmServiceMethod<Service>,
> = (...args: RealmServiceArgs<Service, Method>) => Promise<RealmServiceResult<Service, Method>>;

type StudioRealmClient = {
  services: {
    AgentsService: {
      agentControllerSelectAvatar: StudioRealmMethod<'AgentsService', 'agentControllerSelectAvatar'>;
    };
  };
};

type RealmSelectAvatarInput = RealmServiceArgs<'AgentsService', 'agentControllerSelectAvatar'>[1];
type RealmSelectAvatarResponse = RealmServiceResult<'AgentsService', 'agentControllerSelectAvatar'>;

export const REALM_AGENT_AVATAR_SELECT_SOURCE = 'Realm AgentsService.agentControllerSelectAvatar';

type RuntimeVoiceClient = {
  media: {
    tts: {
      synthesize(input: SpeechSynthesizeInput): Promise<SpeechSynthesizeOutput>;
    };
  };
};

type RuntimeImageClient = {
  media: {
    image: {
      generate(input: ImageGenerateInput): Promise<ImageGenerateOutput>;
    };
  };
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
export type RuntimeVisualImageGenerationResult =
  | {
    ok: true;
    source: typeof VISUAL_IMAGE_GENERATION_SOURCE;
    candidate: true;
    publicTruth: false;
    draft: ReviewedVisualImageCandidatePayload;
    runtime: {
      jobId?: string;
      artifactIds: string[];
      artifactUris: string[];
      traceId?: string;
      modelResolved?: string;
    };
  }
  | {
    ok: false;
    source: typeof VISUAL_IMAGE_GENERATION_SOURCE;
    failure:
      | 'runtime-payload-invalid'
      | 'runtime-transport-unavailable'
      | 'runtime-generate-failed'
      | 'runtime-output-missing';
    message: string;
    draft: ReviewedVisualImageCandidatePayload | null;
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

function normalizeRuntimeVisualImageGenerationOutput(
  output: ImageGenerateOutput,
  draft: ReviewedVisualImageCandidatePayload,
): RuntimeVisualImageGenerationResult {
  const job = output.job && typeof output.job === 'object' ? output.job : null;
  const jobId = job ? readOptionalString(job as unknown as Record<string, unknown>, 'jobId') : undefined;
  const jobTraceId = job ? readOptionalString(job as unknown as Record<string, unknown>, 'traceId') : undefined;
  const modelResolved = job ? readOptionalString(job as unknown as Record<string, unknown>, 'modelResolved') : undefined;
  const outputTraceId = output.trace && typeof output.trace === 'object'
    ? readOptionalString(output.trace as unknown as Record<string, unknown>, 'traceId')
    : undefined;
  const artifacts = Array.isArray(output.artifacts) ? output.artifacts : [];
  const artifactIds = artifacts
    .map((artifact) => artifact && typeof artifact === 'object'
      ? readOptionalString(artifact as unknown as Record<string, unknown>, 'artifactId')
      : undefined)
    .filter((artifactId): artifactId is string => Boolean(artifactId));
  const artifactUris = artifacts
    .map((artifact) => artifact && typeof artifact === 'object'
      ? readOptionalString(artifact as unknown as Record<string, unknown>, 'uri')
      : undefined)
    .filter((uri): uri is string => Boolean(uri));

  if (!jobId && artifactIds.length === 0 && artifactUris.length === 0) {
    return {
      ok: false,
      source: VISUAL_IMAGE_GENERATION_SOURCE,
      failure: 'runtime-output-missing',
      message: 'Runtime media.image.generate output missing real job id, artifact id, or artifact URI.',
      draft,
    };
  }

  return {
    ok: true,
    source: VISUAL_IMAGE_GENERATION_SOURCE,
    candidate: true,
    publicTruth: false,
    draft,
    runtime: {
      ...(jobId ? { jobId } : {}),
      artifactIds,
      artifactUris,
      ...(outputTraceId || jobTraceId ? { traceId: outputTraceId || jobTraceId } : {}),
      ...(modelResolved ? { modelResolved } : {}),
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
export async function selectReviewedAgentAvatarUrl(
  agentId: string,
  avatarUrl: string,
  realm: StudioRealmClient = createStudioRealmClient(),
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
export async function generateReviewedVisualImageCandidate(
  input: VisualImageGenerationInput,
  agent: OwnerPortfolioAgentDetail,
  runtime?: RuntimeImageClient | null,
): Promise<RuntimeVisualImageGenerationResult> {
  const draft = buildReviewedVisualImageCandidatePayload(input, agent);
  const imagePayload = buildReviewedVisualImageGenerationPayload(input, agent);

  if (!draft.payload || !imagePayload.payload) {
    return {
      ok: false,
      source: VISUAL_IMAGE_GENERATION_SOURCE,
      failure: 'runtime-payload-invalid',
      message: imagePayload.errors.join('; ') || 'Runtime media.image.generate payload invalid.',
      draft: draft.payload,
    };
  }

  const runtimeClient = runtime === undefined ? await createStudioRuntimeClient() : runtime;

  if (!runtimeClient) {
    return {
      ok: false,
      source: VISUAL_IMAGE_GENERATION_SOURCE,
      failure: 'runtime-transport-unavailable',
      message: 'Runtime media.image.generate runtime transport unavailable: Tauri IPC runtime transport is required.',
      draft: draft.payload,
    };
  }

  try {
    const output = await runtimeClient.media.image.generate(imagePayload.payload);
    return normalizeRuntimeVisualImageGenerationOutput(output, draft.payload);
  } catch (error) {
    return {
      ok: false,
      source: VISUAL_IMAGE_GENERATION_SOURCE,
      failure: 'runtime-generate-failed',
      message: `Runtime media.image.generate failed: ${error instanceof Error ? error.message : 'runtime transport call failed.'}`,
      draft: draft.payload,
    };
  }
}
