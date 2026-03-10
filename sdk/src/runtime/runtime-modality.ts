import { ReasonCode } from '../types/index.js';
import { createNimiError } from './errors.js';
import {
  ExecutionMode,
  RoutePolicy,
  ScenarioType,
  type ArtifactChunk,
  type ScenarioJob,
} from './generated/runtime/v1/ai';
import type { ListPresetVoicesRequest, VoicePresetDescriptor } from './generated/runtime/v1/voice';
import type { RuntimeInternalContext } from './internal-context.js';
import { toSpeechTimingMode } from './runtime-media.js';
import type {
  ImageGenerateInput,
  ImageGenerateOutput,
  NimiTraceInfo,
  SpeechListVoicesInput,
  SpeechListVoicesOutput,
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
  toRoutePolicy,
  toTraceInfo,
} from './helpers.js';
import { runtimeAiRequestRequiresSubject } from './runtime-guards.js';
import {
  runtimeGetScenarioArtifactsForMedia,
  runtimeSubmitScenarioJobForMedia,
  runtimeWaitForScenarioJobCompletion,
} from './runtime-media.js';

export async function runtimeGenerateImage(
  ctx: RuntimeInternalContext,
  input: ImageGenerateInput,
): Promise<ImageGenerateOutput> {
  const submitted = await runtimeSubmitScenarioJobForMedia(ctx, {
    modal: 'image',
    input,
  });

  const job = await runtimeWaitForScenarioJobCompletion(ctx, submitted.jobId, {
    timeoutMs: input.timeoutMs,
    signal: input.signal,
  });
  const artifacts = await runtimeGetScenarioArtifactsForMedia(ctx, job.jobId);

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
  const submitted = await runtimeSubmitScenarioJobForMedia(ctx, {
    modal: 'video',
    input,
  });

  const job = await runtimeWaitForScenarioJobCompletion(ctx, submitted.jobId, {
    timeoutMs: input.timeoutMs,
    signal: input.signal,
  });
  const artifacts = await runtimeGetScenarioArtifactsForMedia(ctx, job.jobId);

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
  const submitted = await runtimeSubmitScenarioJobForMedia(ctx, {
    modal: 'tts',
    input,
  });

  const job = await runtimeWaitForScenarioJobCompletion(ctx, submitted.jobId, {
    timeoutMs: input.timeoutMs,
    signal: input.signal,
  });
  const artifacts = await runtimeGetScenarioArtifactsForMedia(ctx, job.jobId);

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
  const submitted = await runtimeSubmitScenarioJobForMedia(ctx, {
    modal: 'stt',
    input,
  });

  const job = await runtimeWaitForScenarioJobCompletion(ctx, submitted.jobId, {
    timeoutMs: input.timeoutMs,
    signal: input.signal,
  });

  const artifacts = await runtimeGetScenarioArtifactsForMedia(ctx, job.jobId);
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
  return runtimeStreamSpeechSynthesis(ctx, input);
}

export async function runtimeListSpeechVoices(
  ctx: RuntimeInternalContext,
  input: SpeechListVoicesInput,
): Promise<SpeechListVoicesOutput> {
  const subjectUserId = await ctx.resolveSubjectUserId(input.subjectUserId);
  const responseMetadata: Record<string, string> = {};
  const modelId = normalizeSpeechListModel(input.model, input.route);
  const request: ListPresetVoicesRequest = {
    appId: ctx.appId,
    subjectUserId,
    modelId,
    targetModelId: '',
    connectorId: normalizeText(input.connectorId),
  };

  const response = await ctx.invokeWithClient(async (client) => client.ai.listPresetVoices(
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
    voices: (response.voices || []).map((v: VoicePresetDescriptor) => ({
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

function normalizeSpeechListModel(
  model: string,
  route: SpeechListVoicesInput['route'],
): string {
  const normalizedModel = ensureText(model, 'model');
  if (route !== 'cloud') {
    return normalizedModel;
  }
  const lowerModel = normalizedModel.toLowerCase();
  if (lowerModel.startsWith('cloud/') || normalizedModel.includes('/')) {
    return normalizedModel;
  }
  return `cloud/${normalizedModel}`;
}

export async function runtimeStreamSpeechSynthesis(
  ctx: RuntimeInternalContext,
  input: SpeechSynthesizeInput,
): Promise<AsyncIterable<ArtifactChunk>> {
  const routePolicy = toRoutePolicy(input.route);
  const connectorId = normalizeText(input.connectorId);
  const subjectUserId = runtimeAiRequestRequiresSubject({
    request: {
      head: {
        routePolicy,
        connectorId,
      },
    },
    metadata: input.metadata,
  })
    ? await ctx.resolveSubjectUserId(input.subjectUserId)
    : await ctx.resolveOptionalSubjectUserId(input.subjectUserId);
  const request = {
    head: {
      appId: ctx.appId,
      subjectUserId: subjectUserId || '',
      modelId: ensureText(input.model, 'model'),
      routePolicy,
      fallback: toFallbackPolicy(input.fallback),
      timeoutMs: Number(input.timeoutMs || ctx.options.timeoutMs || 0),
      connectorId,
    },
    scenarioType: ScenarioType.SPEECH_SYNTHESIZE,
    executionMode: ExecutionMode.STREAM,
    spec: {
      spec: {
        oneofKind: 'speechSynthesize' as const,
        speechSynthesize: {
          text: normalizeText(input.text),
          language: normalizeText(input.language),
          audioFormat: normalizeText(input.audioFormat),
          sampleRateHz: Number(input.sampleRateHz || 0),
          speed: Number(input.speed || 0),
          pitch: Number(input.pitch || 0),
          volume: Number(input.volume || 0),
          emotion: normalizeText(input.emotion),
          voiceRef: normalizeText(input.voice)
            ? {
              kind: 3,
              reference: {
                oneofKind: 'providerVoiceRef' as const,
                providerVoiceRef: normalizeText(input.voice),
              },
            }
            : undefined,
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
        },
      },
    },
    extensions: [],
  };

  const stream = await ctx.invokeWithClient(async (client) => client.ai.streamScenario(
    request,
    ctx.resolveRuntimeStreamOptions({
      timeoutMs: input.timeoutMs,
      metadata: input.metadata,
    }),
  ));

  const fallbackMimeType = normalizeText(input.audioFormat) || 'audio/wav';
  const fallbackModel = ensureText(input.model, 'model');
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<ArtifactChunk> {
      let streamModelResolved = fallbackModel;
      let streamRouteDecision = request.head.routePolicy || RoutePolicy.UNSPECIFIED;
      for await (const event of stream) {
        const payload = (event.payload || { oneofKind: undefined }) as { oneofKind?: string };
        if (payload.oneofKind === 'started') {
          const started = (event.payload as { started?: { modelResolved?: string; routeDecision?: RoutePolicy } }).started || {};
          streamModelResolved = normalizeText(started.modelResolved) || fallbackModel;
          streamRouteDecision = started.routeDecision || request.head.routePolicy || RoutePolicy.UNSPECIFIED;
          continue;
        }

        if (payload.oneofKind === 'delta') {
          const delta = (event.payload as { delta?: { chunk?: Uint8Array; text?: string; mimeType?: string } }).delta || {};
          const chunk = delta.chunk || new Uint8Array(0);
          if (chunk.length === 0) {
            continue;
          }
          yield {
            artifactId: 'speech-stream-artifact',
            mimeType: normalizeText(delta.mimeType) || fallbackMimeType,
            sequence: String(event.sequence || 0),
            chunk,
            eof: false,
            routeDecision: streamRouteDecision,
            modelResolved: streamModelResolved,
            traceId: normalizeText(event.traceId),
          };
          continue;
        }

        if (payload.oneofKind === 'completed') {
          const completed = (event.payload as { completed?: { usage?: ArtifactChunk['usage'] } }).completed || {};
          yield {
            artifactId: 'speech-stream-artifact',
            mimeType: fallbackMimeType,
            sequence: String(event.sequence || 0),
            chunk: new Uint8Array(0),
            eof: true,
            usage: completed.usage,
            routeDecision: streamRouteDecision,
            modelResolved: streamModelResolved,
            traceId: normalizeText(event.traceId),
          };
          return;
        }

        if (payload.oneofKind === 'failed') {
          const failed = (event.payload as { failed?: { reasonCode?: string; actionHint?: string } }).failed || {};
          throw createNimiError({
            message: normalizeText(failed.actionHint) || 'runtime stream failed',
            reasonCode: normalizeText(failed.reasonCode) || ReasonCode.AI_STREAM_BROKEN,
            actionHint: 'retry_or_switch_route',
            source: 'runtime',
          });
        }
      }
    },
  };
}


export function streamArtifactsFromMediaOutput(
  output: {
    job: ScenarioJob;
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
