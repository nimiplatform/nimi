import { ReasonCode } from '../types/index.js';
import { createNimiError } from './errors.js';
import {
  RoutePolicy,
  SpeechTimingMode,
  type ArtifactChunk,
  type GetSpeechVoicesRequest,
  type MediaJob,
  type SpeechVoiceDescriptor,
  type StreamSpeechSynthesisRequest,
} from './generated/runtime/v1/ai';
import type { RuntimeInternalContext } from './internal-context.js';
import type {
  ImageGenerateInput,
  ImageGenerateOutput,
  NimiTraceInfo,
  SpeechListVoicesInput,
  SpeechListVoicesOutput,
  SpeechStreamSynthesisInput,
  SpeechSynthesizeInput,
  SpeechSynthesizeOutput,
  SpeechTranscribeInput,
  SpeechTranscribeOutput,
  VideoGenerateInput,
  VideoGenerateOutput,
} from './types.js';
import {
  decodeUtf8,
  ensureText,
  normalizeText,
  toFallbackPolicy,
  toProtoStruct,
  toRoutePolicy,
  toTraceInfo,
} from './helpers.js';
import {
  runtimeGetMediaArtifacts,
  runtimeSubmitMediaJob,
  runtimeWaitForMediaJobCompletion,
} from './runtime-media.js';

export async function runtimeGenerateImage(
  ctx: RuntimeInternalContext,
  input: ImageGenerateInput,
): Promise<ImageGenerateOutput> {
  const submitted = await runtimeSubmitMediaJob(ctx, {
    modal: 'image',
    input,
  });

  const job = await runtimeWaitForMediaJobCompletion(ctx, submitted.jobId, {
    timeoutMs: input.timeoutMs,
    signal: input.signal,
  });
  const artifacts = await runtimeGetMediaArtifacts(ctx, job.jobId);

  const trace = toTraceInfo({
    traceId: artifacts.traceId || job.traceId,
    modelResolved: job.modelResolved,
    routeDecision: job.routeDecision,
  });

  return {
    job,
    artifacts: artifacts.artifacts,
    trace,
  };
}

export async function runtimeGenerateVideo(
  ctx: RuntimeInternalContext,
  input: VideoGenerateInput,
): Promise<VideoGenerateOutput> {
  const submitted = await runtimeSubmitMediaJob(ctx, {
    modal: 'video',
    input,
  });

  const job = await runtimeWaitForMediaJobCompletion(ctx, submitted.jobId, {
    timeoutMs: input.timeoutMs,
    signal: input.signal,
  });
  const artifacts = await runtimeGetMediaArtifacts(ctx, job.jobId);

  const trace = toTraceInfo({
    traceId: artifacts.traceId || job.traceId,
    modelResolved: job.modelResolved,
    routeDecision: job.routeDecision,
  });

  return {
    job,
    artifacts: artifacts.artifacts,
    trace,
  };
}

export async function runtimeSynthesizeSpeech(
  ctx: RuntimeInternalContext,
  input: SpeechSynthesizeInput,
): Promise<SpeechSynthesizeOutput> {
  const submitted = await runtimeSubmitMediaJob(ctx, {
    modal: 'tts',
    input,
  });

  const job = await runtimeWaitForMediaJobCompletion(ctx, submitted.jobId, {
    timeoutMs: input.timeoutMs,
    signal: input.signal,
  });
  const artifacts = await runtimeGetMediaArtifacts(ctx, job.jobId);

  const trace = toTraceInfo({
    traceId: artifacts.traceId || job.traceId,
    modelResolved: job.modelResolved,
    routeDecision: job.routeDecision,
  });

  return {
    job,
    artifacts: artifacts.artifacts,
    trace,
  };
}

export async function runtimeTranscribeSpeech(
  ctx: RuntimeInternalContext,
  input: SpeechTranscribeInput,
): Promise<SpeechTranscribeOutput> {
  const submitted = await runtimeSubmitMediaJob(ctx, {
    modal: 'stt',
    input,
  });

  const job = await runtimeWaitForMediaJobCompletion(ctx, submitted.jobId, {
    timeoutMs: input.timeoutMs,
    signal: input.signal,
  });

  const artifacts = await runtimeGetMediaArtifacts(ctx, job.jobId);
  const first = artifacts.artifacts[0];
  const text = first ? decodeUtf8(first.bytes) : '';

  const trace = toTraceInfo({
    traceId: artifacts.traceId || job.traceId,
    modelResolved: job.modelResolved,
    routeDecision: job.routeDecision,
  });

  return {
    job,
    text,
    trace,
  };
}

export async function runtimeStreamImage(
  ctx: RuntimeInternalContext,
  input: ImageGenerateInput,
): Promise<AsyncIterable<ArtifactChunk>> {
  const output = await runtimeGenerateImage(ctx, input);
  return streamArtifactsFromMediaOutput(output);
}

export async function runtimeStreamVideo(
  ctx: RuntimeInternalContext,
  input: VideoGenerateInput,
): Promise<AsyncIterable<ArtifactChunk>> {
  const output = await runtimeGenerateVideo(ctx, input);
  return streamArtifactsFromMediaOutput(output);
}

export async function runtimeStreamSpeech(
  ctx: RuntimeInternalContext,
  input: SpeechSynthesizeInput,
): Promise<AsyncIterable<ArtifactChunk>> {
  const output = await runtimeSynthesizeSpeech(ctx, input);
  return streamArtifactsFromMediaOutput(output);
}

export async function runtimeListSpeechVoices(
  ctx: RuntimeInternalContext,
  input: SpeechListVoicesInput,
): Promise<SpeechListVoicesOutput> {
  const subjectUserId = await ctx.resolveSubjectUserId(input.subjectUserId);
  const responseMetadata: Record<string, string> = {};
  const request: GetSpeechVoicesRequest = {
    appId: ctx.appId,
    subjectUserId,
    modelId: ensureText(input.model, 'model'),
    routePolicy: toRoutePolicy(input.route),
    fallback: toFallbackPolicy(input.fallback),
    connectorId: normalizeText(input.connectorId),
  };

  const response = await ctx.invokeWithClient(async (client) => client.ai.getSpeechVoices(
    request,
    ctx.resolveRuntimeCallOptions({
      metadata: input.metadata,
      _responseMetadataObserver: (metadata) => {
        Object.assign(responseMetadata, metadata);
      },
    }),
  ));
  const voiceCatalogSource = normalizeText(responseMetadata['x-nimi-voice-catalog-source']);
  const voiceCatalogVersion = normalizeText(responseMetadata['x-nimi-voice-catalog-version']);
  const voiceCountRaw = Number.parseInt(normalizeText(responseMetadata['x-nimi-voice-count']), 10);
  const voiceCount = Number.isFinite(voiceCountRaw) ? voiceCountRaw : undefined;

  return {
    voices: (response.voices || []).map((v: SpeechVoiceDescriptor) => ({
      voiceId: normalizeText(v.voiceId),
      name: normalizeText(v.name),
      lang: normalizeText(v.lang),
      supportedLangs: v.supportedLangs || [],
    })),
    modelResolved: normalizeText(response.modelResolved),
    traceId: normalizeText(response.traceId),
    voiceCatalogSource: voiceCatalogSource || undefined,
    voiceCatalogVersion: voiceCatalogVersion || undefined,
    voiceCount,
  };
}

export async function runtimeStreamSpeechSynthesis(
  ctx: RuntimeInternalContext,
  input: SpeechStreamSynthesisInput,
): Promise<AsyncIterable<ArtifactChunk>> {
  const subjectUserId = await ctx.resolveSubjectUserId(input.subjectUserId);
  const request: StreamSpeechSynthesisRequest = {
    appId: ctx.appId,
    subjectUserId,
    modelId: ensureText(input.model, 'model'),
    speechSpec: {
      text: normalizeText(input.text),
      voice: normalizeText(input.voice),
      language: normalizeText(input.language),
      audioFormat: normalizeText(input.audioFormat),
      sampleRateHz: Number(input.sampleRateHz || 0),
      speed: Number(input.speed || 0),
      pitch: Number(input.pitch || 0),
      volume: Number(input.volume || 0),
      emotion: normalizeText(input.emotion),
      timingMode: toSpeechTimingMode(input.timingMode),
      voiceRenderHints: input.voiceRenderHints
        ? {
          stability: Number(input.voiceRenderHints.stability || 0),
          similarityBoost: Number(input.voiceRenderHints.similarityBoost || 0),
          style: Number(input.voiceRenderHints.style || 0),
          useSpeakerBoost: Boolean(input.voiceRenderHints.useSpeakerBoost),
          speed: Number(input.voiceRenderHints.speed || 0),
        }
        : undefined,
      providerOptions: toProtoStruct(input.providerOptions),
    },
    routePolicy: toRoutePolicy(input.route),
    fallback: toFallbackPolicy(input.fallback),
    timeoutMs: Number(input.timeoutMs || ctx.options.timeoutMs || 0),
    connectorId: normalizeText(input.connectorId),
  };

  return ctx.invokeWithClient(async (client) => client.ai.synthesizeSpeechStream(
    request,
    ctx.resolveRuntimeStreamOptions({
      timeoutMs: input.timeoutMs,
      metadata: input.metadata,
    }),
  ));
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

export function streamArtifactsFromMediaOutput(
  output: {
    job: MediaJob;
    artifacts: Array<{
      artifactId: string;
      mimeType: string;
      bytes: Uint8Array;
    }>;
    trace: NimiTraceInfo;
  },
): AsyncIterable<ArtifactChunk> {
  const chunkSize = 64 * 1024;
  const routeDecision = output.job.routeDecision || RoutePolicy.UNSPECIFIED;
  const modelResolved = normalizeText(output.job.modelResolved);
  const traceId = normalizeText(output.trace.traceId || output.job.traceId);
  const usage = output.job.usage;
  const fallbackArtifactId = normalizeText(output.job.jobId);
  const fallbackMimeType = 'application/octet-stream';

  const sourceArtifacts = output.artifacts.length > 0
    ? output.artifacts
    : [
        {
          artifactId: fallbackArtifactId,
          mimeType: fallbackMimeType,
          bytes: new Uint8Array(0),
        },
      ];

  const items = sourceArtifacts.flatMap((artifact) => {
    const artifactId = normalizeText(artifact.artifactId) || fallbackArtifactId;
    const mimeType = normalizeText(artifact.mimeType) || fallbackMimeType;
    const bytes = artifact.bytes ?? new Uint8Array(0);
    if (bytes.length === 0) {
      return [{
        artifactId,
        mimeType,
        chunk: new Uint8Array(0),
      }];
    }

    const parts: Array<{
      artifactId: string;
      mimeType: string;
      chunk: Uint8Array;
    }> = [];
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      parts.push({
        artifactId,
        mimeType,
        chunk: bytes.slice(offset, Math.min(bytes.length, offset + chunkSize)),
      });
    }
    return parts;
  });

  return (async function* (): AsyncIterable<ArtifactChunk> {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!item) {
        continue;
      }
      const isLastChunk = index === items.length - 1;
      yield {
        artifactId: item.artifactId,
        mimeType: item.mimeType,
        sequence: String(index),
        chunk: item.chunk,
        eof: isLastChunk,
        usage: isLastChunk ? usage : undefined,
        routeDecision,
        modelResolved,
        traceId,
      };
    }
  }());
}
