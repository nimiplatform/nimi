import { ReasonCode } from '../types/index.js';
import { createNimiError } from './errors.js';
import {
  MediaJobStatus,
  Modal,
  SpeechTimingMode,
  VideoContentRole,
  VideoContentType,
  VideoMode,
  type CancelMediaJobRequest,
  type MediaJob,
  type MediaJobEvent,
  type SubmitMediaJobRequest,
} from './generated/runtime/v1/ai';
import { Struct } from './generated/google/protobuf/struct.js';
import type { RuntimeInternalContext } from './internal-context.js';
import type {
  ImageGenerateInput,
  MediaJobSubmitInput,
  NimiFallbackPolicy,
  NimiRoutePolicy,
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
  toFallbackPolicy,
  toLabels,
  toProtoStruct,
  toRoutePolicy,
  wrapModeBMediaStream,
} from './helpers.js';

export async function runtimeSubmitMediaJob(
  ctx: RuntimeInternalContext,
  input: MediaJobSubmitInput,
): Promise<MediaJob> {
  const request = await runtimeBuildSubmitMediaJobRequest(ctx, input);
  const metadata = input.input.metadata;

  const response = await ctx.invokeWithClient(async (client) => client.ai.submitMediaJob(
    request,
    ctx.resolveRuntimeCallOptions({
      timeoutMs: request.timeoutMs,
      idempotencyKey: request.idempotencyKey,
      metadata,
    }),
  ));

  if (!response.job) {
    throw createNimiError({
      message: 'submitMediaJob returned empty job',
      reasonCode: ReasonCode.AI_PROVIDER_UNAVAILABLE,
      actionHint: 'retry_media_job_request',
      source: 'runtime',
    });
  }

  ctx.emitTelemetry('media.job.status', {
    jobId: response.job.jobId,
    status: mediaStatusToString(response.job.status),
    at: nowIso(),
  });

  return response.job;
}

export async function runtimeGetMediaJob(
  ctx: RuntimeInternalContext,
  jobId: string,
): Promise<MediaJob> {
  const response = await ctx.invokeWithClient(async (client) => client.ai.getMediaJob({
    jobId: ensureText(jobId, 'jobId'),
  }));

  if (!response.job) {
    throw createNimiError({
      message: `media job not found: ${jobId}`,
      reasonCode: ReasonCode.AI_MODEL_NOT_FOUND,
      actionHint: 'check_job_id_or_retry_submit',
      source: 'runtime',
    });
  }

  return response.job;
}

export async function runtimeCancelMediaJob(
  ctx: RuntimeInternalContext,
  input: { jobId: string; reason?: string },
): Promise<MediaJob> {
  const request: CancelMediaJobRequest = {
    jobId: ensureText(input.jobId, 'jobId'),
    reason: normalizeText(input.reason),
  };

  const response = await ctx.invokeWithClient(async (client) => client.ai.cancelMediaJob(request));
  if (!response.job) {
    throw createNimiError({
      message: `cancelMediaJob returned empty job: ${request.jobId}`,
      reasonCode: ReasonCode.AI_PROVIDER_UNAVAILABLE,
      actionHint: 'retry_or_check_job_status',
      source: 'runtime',
    });
  }

  ctx.emitTelemetry('media.job.status', {
    jobId: response.job.jobId,
    status: mediaStatusToString(response.job.status),
    at: nowIso(),
  });

  return response.job;
}

export async function runtimeSubscribeMediaJob(
  ctx: RuntimeInternalContext,
  jobId: string,
): Promise<AsyncIterable<MediaJobEvent>> {
  const raw = await ctx.invokeWithClient(async (client) => client.ai.subscribeMediaJobEvents({
    jobId: ensureText(jobId, 'jobId'),
  }));
  return wrapModeBMediaStream(raw);
}

export async function runtimeGetMediaArtifacts(
  ctx: RuntimeInternalContext,
  jobId: string,
): Promise<{ artifacts: import('./generated/runtime/v1/ai').MediaArtifact[]; traceId?: string }> {
  const response = await ctx.invokeWithClient(async (client) => client.ai.getMediaResult({
    jobId: ensureText(jobId, 'jobId'),
  }));

  return {
    artifacts: response.artifacts,
    traceId: normalizeText(response.traceId) || undefined,
  };
}

export async function runtimeBuildSubmitMediaJobRequest(
  ctx: RuntimeInternalContext,
  input: MediaJobSubmitInput,
): Promise<SubmitMediaJobRequest> {
  const timeoutMs = Number(
    (input.input as { timeoutMs?: unknown }).timeoutMs || ctx.options.timeoutMs || 0,
  );
  const route = toRoutePolicy((input.input as { route?: NimiRoutePolicy }).route);
  const fallback = toFallbackPolicy((input.input as { fallback?: NimiFallbackPolicy }).fallback);

  const subjectUserId = await ctx.resolveSubjectUserId(
    (input.input as { subjectUserId?: string }).subjectUserId,
  );

  const base: SubmitMediaJobRequest = {
    appId: ctx.appId,
    subjectUserId,
    modelId: ensureText((input.input as { model: string }).model, 'model'),
    modal: Modal.UNSPECIFIED,
    routePolicy: route,
    fallback,
    timeoutMs,
    requestId: normalizeText((input.input as { requestId?: string }).requestId),
    idempotencyKey: normalizeText((input.input as { idempotencyKey?: string }).idempotencyKey),
    labels: toLabels((input.input as { labels?: Record<string, string> }).labels),
    spec: { oneofKind: undefined },
    connectorId: normalizeText((input.input as { connectorId?: string }).connectorId),
  };

  if (input.modal === 'image') {
    const value = input.input as ImageGenerateInput;
    return {
      ...base,
      modal: Modal.IMAGE,
      spec: {
        oneofKind: 'imageSpec',
        imageSpec: {
          prompt: normalizeText(value.prompt),
          negativePrompt: normalizeText(value.negativePrompt),
          n: Number(value.n || 0),
          size: normalizeText(value.size),
          aspectRatio: normalizeText(value.aspectRatio),
          quality: normalizeText(value.quality),
          style: normalizeText(value.style),
          seed: String(value.seed || 0),
          referenceImages: Array.isArray(value.referenceImages) ? value.referenceImages : [],
          providerOptions: toProtoStruct(value.providerOptions),
          mask: normalizeText(value.mask),
          responseFormat: normalizeText(value.responseFormat),
        },
      },
    };
  }

  if (input.modal === 'video') {
    const value = input.input as VideoGenerateInput;
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
      modal: Modal.VIDEO,
      spec: {
        oneofKind: 'videoSpec',
        videoSpec: {
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
    };
  }

  if (input.modal === 'tts') {
    const value = input.input as SpeechSynthesizeInput;
    return {
      ...base,
      modal: Modal.TTS,
      spec: {
        oneofKind: 'speechSpec',
        speechSpec: {
          text: normalizeText(value.text),
          voice: normalizeText(value.voice),
          language: normalizeText(value.language),
          audioFormat: normalizeText(value.audioFormat),
          sampleRateHz: Number(value.sampleRateHz || 0),
          speed: Number(value.speed || 0),
          pitch: Number(value.pitch || 0),
          volume: Number(value.volume || 0),
          emotion: normalizeText(value.emotion),
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
          providerOptions: toProtoStruct(value.providerOptions),
        },
      },
    };
  }

  const value = input.input as SpeechTranscribeInput;
  const audioSource = value.audio.kind === 'bytes'
    ? {
      source: {
        oneofKind: 'audioBytes' as const,
        audioBytes: value.audio.bytes,
      },
    }
    : value.audio.kind === 'url'
      ? {
        source: {
          oneofKind: 'audioUri' as const,
          audioUri: normalizeText(value.audio.url),
        },
      }
      : {
        source: {
          oneofKind: 'audioChunks' as const,
          audioChunks: {
            chunks: value.audio.chunks,
          },
        },
      };

  return {
    ...base,
    modal: Modal.STT,
    spec: {
      oneofKind: 'transcriptionSpec',
      transcriptionSpec: {
        audioBytes: value.audio.kind === 'bytes' ? value.audio.bytes : new Uint8Array(0),
        audioUri: value.audio.kind === 'url' ? normalizeText(value.audio.url) : '',
        mimeType: normalizeText(value.mimeType || 'audio/wav'),
        language: normalizeText(value.language),
        timestamps: Boolean(value.timestamps),
        diarization: Boolean(value.diarization),
        speakerCount: Number(value.speakerCount || 0),
        prompt: normalizeText(value.prompt),
        audioSource,
        responseFormat: normalizeText(value.responseFormat),
        providerOptions: toProtoStruct(value.providerOptions),
      },
    },
  };
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

function toSpeechTimingMode(value: SpeechSynthesizeInput['timingMode']): SpeechTimingMode {
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

export async function runtimeWaitForMediaJobCompletion(
  ctx: RuntimeInternalContext,
  jobId: string,
  input: {
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<MediaJob> {
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
      await runtimeCancelMediaJob(ctx, {
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
        message: 'media job aborted',
        reasonCode: ReasonCode.OPERATION_ABORTED,
        actionHint: 'retry_media_job_request',
        source: 'runtime',
      });
    }

    const job = await runtimeGetMediaJob(ctx, jobId);

    ctx.emitTelemetry('media.job.status', {
      jobId,
      status: mediaStatusToString(job.status),
      at: nowIso(),
    });

    if (job.status === MediaJobStatus.COMPLETED) {
      return job;
    }

    if (
      job.status === MediaJobStatus.FAILED
      || job.status === MediaJobStatus.CANCELED
      || job.status === MediaJobStatus.TIMEOUT
    ) {
      throw createNimiError({
        message: normalizeText(job.reasonDetail) || `media job failed: ${job.reasonCode}`,
        reasonCode: normalizeText(job.reasonCode) || ReasonCode.AI_PROVIDER_UNAVAILABLE,
        actionHint: 'retry_media_job_request',
        source: 'runtime',
      });
    }

    if ((Date.now() - startedAt) > timeoutMs) {
      await cancel('aborted_by_sdk_timeout');
      throw createNimiError({
        message: 'media job timeout',
        reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
        actionHint: 'retry_media_job_request',
        source: 'runtime',
      });
    }

    await sleep(DEFAULT_MEDIA_POLL_INTERVAL_MS);
  }
}
