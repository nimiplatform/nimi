import { ReasonCode } from '../types/index.js';
import type { JsonObject } from '../internal/utils.js';
import { createNimiError } from './errors.js';
import {
  ExecutionMode,
  ScenarioJobStatus,
  ScenarioType,
  SpeechTimingMode,
  VideoContentRole,
  VideoContentType,
  VideoMode,
  type ScenarioArtifact,
  type ScenarioOutput,
  type ScenarioExtension,
  type ScenarioJob,
  type ScenarioJobEvent,
  type SubmitScenarioJobRequest,
} from './generated/runtime/v1/ai';
import type { RuntimeInternalContext } from './internal-context.js';
import type {
  ImageGenerateInput,
  MusicIterationExtensionInput,
  MusicGenerateInput,
  NimiRoutePolicy,
  ScenarioJobSubmitInput,
  SpeechSynthesizeInput,
  SpeechTranscribeInput,
  VideoGenerateInput,
} from './types.js';
import {
  DEFAULT_MEDIA_POLL_INTERVAL_MS,
  DEFAULT_MEDIA_TIMEOUT_MS,
  ensureText,
  mediaStatusToString,
  normalizeText,
  nowIso,
  sleep,
  toLabels,
  toProtoStruct,
  toRoutePolicy,
  wrapModeBMediaStream,
} from './helpers.js';
import { runtimeAiRequestRequiresSubject } from './runtime-guards.js';

export interface LocalImageWorkflowComponentSelection {
  slot: string;
  localArtifactId: string;
}

export interface LocalImageWorkflowExtensionInput {
  components?: LocalImageWorkflowComponentSelection[];
  profileOverrides?: JsonObject;
}

const MUSIC_ITERATION_MODES = new Set(['extend', 'remix', 'reference']);

export function buildMusicIterationExtensions(
  input: MusicIterationExtensionInput,
): JsonObject {
  const mode = normalizeText(input.mode).toLowerCase();
  const sourceAudioBase64 = normalizeText(input.sourceAudioBase64);
  const trimStartSec = normalizeOptionalMusicIterationSecond(input.trimStartSec, 'trimStartSec');
  const trimEndSec = normalizeOptionalMusicIterationSecond(input.trimEndSec, 'trimEndSec');

  if (!MUSIC_ITERATION_MODES.has(mode)) {
    throw createMusicIterationValidationError('music iteration mode must be extend, remix, or reference');
  }
  if (!sourceAudioBase64 || !isValidMusicIterationBase64(sourceAudioBase64)) {
    throw createMusicIterationValidationError('music iteration sourceAudioBase64 must be valid base64 audio content');
  }
  if (
    trimStartSec !== undefined
    && trimEndSec !== undefined
    && trimEndSec <= trimStartSec
  ) {
    throw createMusicIterationValidationError('music iteration trimEndSec must be greater than trimStartSec');
  }

  const payload: JsonObject = {
    mode,
    source_audio_base64: sourceAudioBase64,
  };
  if (input.sourceMimeType) {
    payload.source_mime_type = normalizeText(input.sourceMimeType);
  }
  if (trimStartSec !== undefined) {
    payload.trim_start_sec = trimStartSec;
  }
  if (trimEndSec !== undefined) {
    payload.trim_end_sec = trimEndSec;
  }
  return payload;
}

function normalizeOptionalMusicIterationSecond(
  value: number | undefined,
  field: 'trimStartSec' | 'trimEndSec',
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw createMusicIterationValidationError(`music iteration ${field} must be a non-negative finite number`);
  }
  return normalized;
}

function createMusicIterationValidationError(message: string) {
  return createNimiError({
    message,
    reasonCode: ReasonCode.AI_MEDIA_SPEC_INVALID,
    actionHint: 'fix_music_iteration_input',
    source: 'sdk',
  });
}

function isValidMusicIterationBase64(value: string): boolean {
  const normalized = value.replace(/\s+/g, '');
  if (!normalized) {
    return false;
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 === 1) {
    return false;
  }
  if (typeof Buffer !== 'undefined') {
    try {
      const decoded = Buffer.from(normalized, 'base64');
      if (decoded.length === 0) {
        return false;
      }
      const canonical = decoded.toString('base64').replace(/=+$/u, '');
      return canonical === normalized.replace(/=+$/u, '');
    } catch {
      return false;
    }
  }
  if (typeof atob !== 'undefined') {
    try {
      return atob(normalized).length > 0;
    } catch {
      return false;
    }
  }
  return false;
}

export function buildLocalImageWorkflowExtensions(
  workflow: LocalImageWorkflowExtensionInput,
  baseExtensions?: JsonObject,
): JsonObject {
  const merged: JsonObject = { ...(baseExtensions || {}) };
  const components = Array.isArray(workflow.components)
    ? workflow.components
      .map((item) => ({
        slot: normalizeText(item.slot),
        localArtifactId: normalizeText(item.localArtifactId),
      }))
      .filter((item) => item.slot && item.localArtifactId)
    : [];
  if (components.length > 0) {
    merged.components = components;
  }
  if (workflow.profileOverrides && Object.keys(workflow.profileOverrides).length > 0) {
    merged.profile_overrides = workflow.profileOverrides;
  }
  return merged;
}

export async function runtimeSubmitScenarioJobForMedia(
  ctx: RuntimeInternalContext,
  input: ScenarioJobSubmitInput,
): Promise<ScenarioJob> {
  const request = await runtimeBuildSubmitScenarioJobRequestForMedia(ctx, input);
  const metadata = input.input.metadata;

  const response = await ctx.invokeWithClient(async (client) => client.ai.submitScenarioJob(
    request,
    ctx.resolveRuntimeCallOptions({
      timeoutMs: request.head?.timeoutMs,
      idempotencyKey: request.idempotencyKey,
      metadata,
    }),
  ));

  if (!response.job) {
    throw createNimiError({
      message: 'submitScenarioJob returned empty job',
      reasonCode: ReasonCode.AI_PROVIDER_UNAVAILABLE,
      actionHint: 'retry_scenario_job_request',
      source: 'runtime',
    });
  }

  const job = response.job;
  ctx.emitTelemetry('media.job.status', {
    jobId: job.jobId,
    status: mediaStatusToString(job.status),
    at: nowIso(),
  });

  return job;
}

export async function runtimeGetScenarioJobForMedia(
  ctx: RuntimeInternalContext,
  jobId: string,
): Promise<ScenarioJob> {
  const response = await ctx.invokeWithClient(async (client) => client.ai.getScenarioJob({
    jobId: ensureText(jobId, 'jobId'),
  }));

  if (!response.job) {
    throw createNimiError({
      message: `scenario job not found: ${jobId}`,
      reasonCode: ReasonCode.AI_MODEL_NOT_FOUND,
      actionHint: 'check_job_id_or_retry_submit',
      source: 'runtime',
    });
  }

  return response.job;
}

export async function runtimeCancelScenarioJobForMedia(
  ctx: RuntimeInternalContext,
  input: { jobId: string; reason?: string },
): Promise<ScenarioJob> {
  const response = await ctx.invokeWithClient(async (client) => client.ai.cancelScenarioJob({
    jobId: ensureText(input.jobId, 'jobId'),
    reason: normalizeText(input.reason),
  }));

  if (!response.job) {
    throw createNimiError({
      message: `cancelScenarioJob returned empty job: ${input.jobId}`,
      reasonCode: ReasonCode.AI_PROVIDER_UNAVAILABLE,
      actionHint: 'retry_or_check_job_status',
      source: 'runtime',
    });
  }

  const job = response.job;
  ctx.emitTelemetry('media.job.status', {
    jobId: job.jobId,
    status: mediaStatusToString(job.status),
    at: nowIso(),
  });

  return job;
}

export async function runtimeSubscribeScenarioJobForMedia(
  ctx: RuntimeInternalContext,
  jobId: string,
): Promise<AsyncIterable<ScenarioJobEvent>> {
  const raw = await ctx.invokeWithClient(async (client) => client.ai.subscribeScenarioJobEvents({
    jobId: ensureText(jobId, 'jobId'),
  }));
  return wrapModeBMediaStream(raw);
}

export async function runtimeGetScenarioArtifactsForMedia(
  ctx: RuntimeInternalContext,
  jobId: string,
): Promise<{ artifacts: ScenarioArtifact[]; traceId?: string; output?: ScenarioOutput }> {
  const response = await ctx.invokeWithClient(async (client) => client.ai.getScenarioArtifacts({
    jobId: ensureText(jobId, 'jobId'),
  }));

  return {
    artifacts: response.artifacts || [],
    traceId: normalizeText(response.traceId) || undefined,
    output: response.output,
  };
}

export async function runtimeBuildSubmitScenarioJobRequestForMedia(
  ctx: RuntimeInternalContext,
  input: ScenarioJobSubmitInput,
): Promise<SubmitScenarioJobRequest> {
  switch (input.modal) {
    case 'image': {
      const value = input.input;
      const base = await buildBaseSubmitScenarioJobRequest(ctx, input.modal, value);
      return {
        ...base,
        spec: {
          spec: {
            oneofKind: 'imageGenerate',
            imageGenerate: {
              prompt: normalizeText(value.prompt),
              negativePrompt: normalizeText(value.negativePrompt),
              n: Number(value.n || 0),
              size: normalizeText(value.size),
              aspectRatio: normalizeText(value.aspectRatio),
              quality: normalizeText(value.quality),
              style: normalizeText(value.style),
              seed: String(value.seed || 0),
              referenceImages: Array.isArray(value.referenceImages) ? value.referenceImages : [],
              mask: normalizeText(value.mask),
              responseFormat: normalizeText(value.responseFormat),
            },
          },
        },
      };
    }
    case 'video': {
      const value = input.input;
      const base = await buildBaseSubmitScenarioJobRequest(ctx, input.modal, value);
      const options = value.options || {};
      const videoContent = Array.isArray(value.content)
        ? value.content.map((entry) => {
          if (entry.type === 'text') {
            return {
              type: VideoContentType.TEXT,
              role: toVideoContentRole(entry.role || 'prompt'),
              text: normalizeText(entry.text),
              imageUrl: undefined,
            };
          }
          return {
            type: VideoContentType.IMAGE_URL,
            role: toVideoContentRole(entry.role),
            text: '',
            imageUrl: { url: normalizeText(entry.imageUrl) },
          };
        })
        : [];

      return {
        ...base,
        spec: {
          spec: {
            oneofKind: 'videoGenerate',
            videoGenerate: {
              prompt: normalizeText(value.prompt),
              negativePrompt: normalizeText(value.negativePrompt),
              mode: toVideoMode(value.mode),
              content: videoContent,
              options: {
                resolution: normalizeText(options.resolution),
                ratio: normalizeText(options.ratio),
                durationSec: Number(options.durationSec || 0),
                frames: Number(options.frames || 0),
                fps: Number(options.fps || 0),
                seed: String(options.seed || 0),
                cameraFixed: Boolean(options.cameraFixed),
                watermark: Boolean(options.watermark),
                generateAudio: Boolean(options.generateAudio),
                draft: Boolean(options.draft),
                serviceTier: normalizeText(options.serviceTier),
                executionExpiresAfterSec: Number(options.executionExpiresAfterSec || 0),
                returnLastFrame: Boolean(options.returnLastFrame),
              },
            },
          },
        },
      };
    }
    case 'tts': {
      const value = input.input;
      const base = await buildBaseSubmitScenarioJobRequest(ctx, input.modal, value);
      return {
        ...base,
        spec: {
          spec: {
            oneofKind: 'speechSynthesize',
            speechSynthesize: {
              text: normalizeText(value.text),
              language: normalizeText(value.language),
              audioFormat: normalizeText(value.audioFormat),
              sampleRateHz: Number(value.sampleRateHz || 0),
              speed: Number(value.speed || 0),
              pitch: Number(value.pitch || 0),
              volume: Number(value.volume || 0),
              emotion: normalizeText(value.emotion),
              voiceRef: toVoiceRef(value.voice),
              timingMode: toSpeechTimingMode(value.timingMode),
              voiceRenderHints: value.voiceRenderHints
                ? {
                  stability: Number(value.voiceRenderHints.stability || 0),
                  similarityBoost: Number(value.voiceRenderHints.similarityBoost || 0),
                  style: Number(value.voiceRenderHints.style || 0),
                  useSpeakerBoost: Boolean(value.voiceRenderHints.useSpeakerBoost),
                  speed: Number(value.voiceRenderHints.speed || 0),
                }
                : undefined,
            },
          },
        },
      };
    }
    case 'music': {
      const value = input.input;
      const base = await buildBaseSubmitScenarioJobRequest(ctx, input.modal, value);
      return {
        ...base,
        spec: {
          spec: {
            oneofKind: 'musicGenerate',
            musicGenerate: {
              prompt: normalizeText(value.prompt),
              negativePrompt: normalizeText(value.negativePrompt),
              lyrics: normalizeText(value.lyrics),
              style: normalizeText(value.style),
              title: normalizeText(value.title),
              durationSeconds: Number(value.durationSeconds || 0),
              instrumental: Boolean(value.instrumental),
            },
          },
        },
      };
    }
    case 'stt': {
      const value = input.input;
      const base = await buildBaseSubmitScenarioJobRequest(ctx, input.modal, value);
      return {
        ...base,
        spec: {
          spec: {
            oneofKind: 'speechTranscribe',
            speechTranscribe: {
              mimeType: ensureText(value.mimeType, 'mimeType'),
              language: normalizeText(value.language),
              timestamps: Boolean(value.timestamps),
              diarization: Boolean(value.diarization),
              speakerCount: Number(value.speakerCount || 0),
              prompt: normalizeText(value.prompt),
              audioSource: toSpeechTranscribeAudioSource(value.audio),
              responseFormat: normalizeText(value.responseFormat),
            },
          },
        },
      };
    }
  }
}

type ScenarioCommonInput = {
  model: string;
  subjectUserId?: string;
  route?: NimiRoutePolicy;
  timeoutMs?: number;
  connectorId?: string;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
  requestId?: string;
  labels?: Record<string, string>;
  extensions?: JsonObject;
};

async function buildBaseSubmitScenarioJobRequest(
  ctx: RuntimeInternalContext,
  modal: ScenarioJobSubmitInput['modal'],
  input: ScenarioCommonInput,
): Promise<SubmitScenarioJobRequest> {
  const timeoutMs = Number(input.timeoutMs || ctx.options.timeoutMs || 0);
  const route = toRoutePolicy(input.route);
  const connectorId = normalizeText(input.connectorId);
  const subjectUserId = runtimeAiRequestRequiresSubject({
    request: {
      head: {
        routePolicy: route,
        connectorId,
      },
    },
    metadata: input.metadata,
  })
    ? await ctx.resolveSubjectUserId(input.subjectUserId)
    : await ctx.resolveOptionalSubjectUserId(input.subjectUserId);
  const head = await ctx.normalizeScenarioHead({
    head: {
      appId: ctx.appId,
      subjectUserId: subjectUserId || '',
      modelId: ensureText(input.model, 'model'),
      routePolicy: route,
      timeoutMs,
      connectorId,
    },
    metadata: input.metadata,
  });

  return {
    head,
    scenarioType: scenarioTypeFromModal(modal),
    executionMode: ExecutionMode.ASYNC_JOB,
    requestId: normalizeText(input.requestId),
    idempotencyKey: normalizeText(input.idempotencyKey),
    labels: toLabels(input.labels),
    spec: { spec: { oneofKind: undefined } },
    extensions: toScenarioExtensions(modal, input.extensions),
  };
}

function toSpeechTranscribeAudioSource(
  audio: SpeechTranscribeInput['audio'],
): {
  source:
    | { oneofKind: 'audioBytes'; audioBytes: Uint8Array }
    | { oneofKind: 'audioUri'; audioUri: string }
    | { oneofKind: 'audioChunks'; audioChunks: { chunks: Uint8Array[] } };
} {
  switch (audio.kind) {
    case 'bytes':
      return {
        source: {
          oneofKind: 'audioBytes',
          audioBytes: audio.bytes,
        },
      };
    case 'url':
      return {
        source: {
          oneofKind: 'audioUri',
          audioUri: normalizeText(audio.url),
        },
      };
    case 'chunks':
      return {
        source: {
          oneofKind: 'audioChunks',
          audioChunks: {
            chunks: audio.chunks,
          },
        },
      };
  }
}

function toVoiceRef(voice: string | undefined): {
  kind: number;
  reference: { oneofKind: 'providerVoiceRef'; providerVoiceRef: string };
} | undefined {
  const providerVoiceRef = normalizeText(voice);
  if (!providerVoiceRef) {
    return undefined;
  }
  return {
    kind: 3,
    reference: {
      oneofKind: 'providerVoiceRef',
      providerVoiceRef,
    },
  };
}

function scenarioTypeFromModal(modal: ScenarioJobSubmitInput['modal']): ScenarioType {
  switch (modal) {
    case 'image':
      return ScenarioType.IMAGE_GENERATE;
    case 'video':
      return ScenarioType.VIDEO_GENERATE;
    case 'tts':
      return ScenarioType.SPEECH_SYNTHESIZE;
    case 'stt':
      return ScenarioType.SPEECH_TRANSCRIBE;
    case 'music':
      return ScenarioType.MUSIC_GENERATE;
    default:
      return ScenarioType.UNSPECIFIED;
  }
}

const MODAL_EXTENSION_NAMESPACE: Record<ScenarioJobSubmitInput['modal'], string> = {
  image: 'nimi.scenario.image.request',
  video: 'nimi.scenario.video.request',
  tts: 'nimi.scenario.speech_synthesize.request',
  stt: 'nimi.scenario.speech_transcribe.request',
  music: 'nimi.scenario.music_generate.request',
};

function toScenarioExtensions(
  modal: ScenarioJobSubmitInput['modal'],
  extensions: JsonObject | undefined,
): ScenarioExtension[] {
  if (!extensions || Object.keys(extensions).length === 0) {
    return [];
  }
  const payload = toProtoStruct(extensions);
  if (!payload) {
    return [];
  }
  return [{
    namespace: MODAL_EXTENSION_NAMESPACE[modal],
    payload,
  }];
}

function toVideoMode(value: VideoGenerateInput['mode']): VideoMode {
  switch (value) {
    case 't2v':
      return VideoMode.T2V;
    case 'i2v-first-frame':
      return VideoMode.I2V_FIRST_FRAME;
    case 'i2v-first-last':
      return VideoMode.I2V_FIRST_LAST;
    case 'i2v-reference':
      return VideoMode.I2V_REFERENCE;
    default:
      return VideoMode.UNSPECIFIED;
  }
}

function toVideoContentRole(value: 'prompt' | 'first_frame' | 'last_frame' | 'reference_image'): VideoContentRole {
  switch (value) {
    case 'prompt':
      return VideoContentRole.PROMPT;
    case 'first_frame':
      return VideoContentRole.FIRST_FRAME;
    case 'last_frame':
      return VideoContentRole.LAST_FRAME;
    case 'reference_image':
      return VideoContentRole.REFERENCE_IMAGE;
    default:
      return VideoContentRole.UNSPECIFIED;
  }
}

export function toSpeechTimingMode(value: SpeechSynthesizeInput['timingMode']): SpeechTimingMode {
  switch (value) {
    case 'word':
      return SpeechTimingMode.WORD;
    case 'char':
      return SpeechTimingMode.CHAR;
    case 'none':
      return SpeechTimingMode.NONE;
    default:
      return SpeechTimingMode.UNSPECIFIED;
  }
}

export async function runtimeWaitForScenarioJobCompletion(
  ctx: RuntimeInternalContext,
  jobId: string,
  input: {
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<ScenarioJob> {
  const timeoutMs = Number(input.timeoutMs || ctx.options.timeoutMs || DEFAULT_MEDIA_TIMEOUT_MS)
    || DEFAULT_MEDIA_TIMEOUT_MS;
  const startedAt = Date.now();

  let cancelRequested = false;

  const cancel = async (reason: string): Promise<void> => {
    if (cancelRequested) {
      return;
    }
    cancelRequested = true;
    try {
      await runtimeCancelScenarioJobForMedia(ctx, {
        jobId,
        reason,
      });
    } catch {
      // best effort cancellation
    }
  };

  while (true) {
    if (input.signal?.aborted) {
      await cancel('aborted_by_abort_signal');
      throw createNimiError({
        message: 'scenario job aborted',
        reasonCode: ReasonCode.OPERATION_ABORTED,
        actionHint: 'retry_scenario_job_request',
        source: 'runtime',
      });
    }

    const job = await runtimeGetScenarioJobForMedia(ctx, jobId);

    ctx.emitTelemetry('media.job.status', {
      jobId,
      status: mediaStatusToString(job.status),
      at: nowIso(),
    });

    if (job.status === ScenarioJobStatus.COMPLETED) {
      return job;
    }

    if (
      job.status === ScenarioJobStatus.FAILED
      || job.status === ScenarioJobStatus.CANCELED
      || job.status === ScenarioJobStatus.TIMEOUT
    ) {
      throw createNimiError({
        message: normalizeText(job.reasonDetail) || `scenario job failed: ${job.reasonCode}`,
        reasonCode: normalizeText(job.reasonCode) || ReasonCode.AI_PROVIDER_UNAVAILABLE,
        actionHint: 'retry_scenario_job_request',
        source: 'runtime',
      });
    }

    if ((Date.now() - startedAt) > timeoutMs) {
      await cancel('aborted_by_sdk_timeout');
      throw createNimiError({
        message: 'scenario job timeout',
        reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
        actionHint: 'retry_scenario_job_request',
        source: 'runtime',
      });
    }

    await sleep(DEFAULT_MEDIA_POLL_INTERVAL_MS);
  }
}
