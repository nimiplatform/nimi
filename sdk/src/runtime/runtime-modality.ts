import { ReasonCode } from '../types/index.js';
import { createNimiError } from './errors.js';
import {
  ExecutionMode,
  RoutePolicy,
  ScenarioType,
  type ArtifactChunk,
  type ScenarioArtifact,
  type ScenarioJob,
} from './generated/runtime/v1/ai';
import type { ListPresetVoicesRequest, VoicePresetDescriptor } from './generated/runtime/v1/voice';
import type { RuntimeInternalContext } from './internal-context.js';
import { buildMusicIterationExtensions, toSpeechTimingMode } from './runtime-media.js';
import type {
  ImageGenerateInput,
  ImageGenerateOutput,
  MusicIterateInput,
  MusicGenerateInput,
  MusicGenerateOutput,
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
  ensureText,
  extractScenarioArtifacts,
  extractSpeechTranscription,
  normalizeText,
  toRoutePolicy,
  toTraceInfo,
} from './helpers.js';
import { resolveStreamUsage } from '../internal/utils.js';
import { runtimeAiRequestRequiresSubject } from './runtime-guards.js';
import {
  runtimeGetScenarioArtifactsForMedia,
  runtimeSubmitScenarioJobForMedia,
  runtimeWaitForScenarioJobCompletion,
} from './runtime-media.js';

function requireTypedMediaArtifacts(
  response: Awaited<ReturnType<typeof runtimeGetScenarioArtifactsForMedia>>,
  kind: 'imageGenerate' | 'videoGenerate' | 'musicGenerate' | 'speechSynthesize',
): ScenarioArtifact[] {
  const output = response.output;
  if (!output?.output || output.output.oneofKind !== kind) {
    throw createNimiError({
      message: `runtime media output missing typed ${kind} result`,
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'regenerate_runtime_proto_and_sdk',
      source: 'runtime',
    });
  }
  const artifacts = extractScenarioArtifacts(output, kind);
  if (artifacts.length === 0) {
    throw createNimiError({
      message: `runtime media output missing artifacts for typed ${kind} result`,
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'check_runtime_media_contract',
      source: 'runtime',
    });
  }
  const byArtifactId = new Map<string, ScenarioArtifact>();
  for (const artifact of response.artifacts || []) {
    const artifactId = normalizeText(artifact.artifactId);
    if (artifactId) {
      byArtifactId.set(artifactId, artifact);
    }
  }

  return artifacts.map((artifact, index) => {
    const artifactId = normalizeText(artifact.artifactId);
    const hydrated = artifactId ? byArtifactId.get(artifactId) : undefined;
    const mergedArtifactId = artifactId || normalizeText(hydrated?.artifactId);
    const mergedMimeType = normalizeText(hydrated?.mimeType) || normalizeText(artifact.mimeType);
    if (!mergedArtifactId || !mergedMimeType) {
      throw createNimiError({
        message: `runtime media artifact ${index} is missing stable metadata`,
        reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
        actionHint: 'check_runtime_media_contract',
        source: 'runtime',
      });
    }
    return {
      ...hydrated,
      ...artifact,
      artifactId: mergedArtifactId,
      mimeType: mergedMimeType,
      bytes: hydrated?.bytes ?? artifact.bytes ?? new Uint8Array(0),
    };
  });
}

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
  const typedArtifacts = requireTypedMediaArtifacts(artifacts, 'imageGenerate');

  return {
    job,
    artifacts: typedArtifacts,
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
  const typedArtifacts = requireTypedMediaArtifacts(artifacts, 'videoGenerate');

  return {
    job,
    artifacts: typedArtifacts,
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
  const typedArtifacts = requireTypedMediaArtifacts(artifacts, 'speechSynthesize');

  return {
    job,
    artifacts: typedArtifacts,
    trace,
  };
}

export async function runtimeGenerateMusic(
  ctx: RuntimeInternalContext,
  input: MusicGenerateInput,
): Promise<MusicGenerateOutput> {
  const submitted = await runtimeSubmitScenarioJobForMedia(ctx, {
    modal: 'music',
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
    artifacts: requireTypedMediaArtifacts(artifacts, 'musicGenerate'),
    trace,
  };
}

export async function runtimeGenerateMusicIteration(
  ctx: RuntimeInternalContext,
  input: MusicIterateInput,
): Promise<MusicGenerateOutput> {
  return runtimeGenerateMusic(ctx, {
    ...input,
    extensions: buildMusicIterationExtensions(input.iteration),
  });
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
  const typedResult = extractSpeechTranscription(artifacts.output);
  const text = typedResult.text;

  const trace = toTraceInfo({
    traceId: artifacts.traceId || job.traceId,
    modelResolved: job.modelResolved,
    routeDecision: job.routeDecision,
  });

  return {
    job,
    text,
    artifacts: typedResult.artifacts,
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
    head: await ctx.normalizeScenarioHead({
      head: {
        appId: ctx.appId,
        subjectUserId: subjectUserId || '',
        modelId: ensureText(input.model, 'model'),
        routePolicy,
        timeoutMs: Number(input.timeoutMs || ctx.options.timeoutMs || 0),
        connectorId,
      },
      metadata: input.metadata,
    }),
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

  const fallbackModel = ensureText(input.model, 'model');
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<ArtifactChunk> {
      let streamModelResolved = fallbackModel;
      let streamRouteDecision = request.head.routePolicy || RoutePolicy.UNSPECIFIED;
      let streamMimeType = '';
      let sawArtifactChunk = false;
      let streamUsage: ArtifactChunk['usage'] | undefined = undefined;
      for await (const event of stream) {
        switch (event.payload.oneofKind) {
          case 'started': {
            const started = event.payload.started;
            streamModelResolved = normalizeText(started.modelResolved) || fallbackModel;
            streamRouteDecision = started.routeDecision || request.head.routePolicy || RoutePolicy.UNSPECIFIED;
            continue;
          }
          case 'delta': {
            const streamDelta = event.payload.delta;
            const deltaPayload = streamDelta.delta;
            const chunk = deltaPayload?.oneofKind === 'artifact'
              ? (deltaPayload.artifact.chunk || new Uint8Array(0))
              : new Uint8Array(0);
            if (chunk.length === 0) {
              continue;
            }
            const mimeType = normalizeText(deltaPayload?.oneofKind === 'artifact'
              ? deltaPayload.artifact.mimeType
              : '');
            if (!mimeType) {
              throw createNimiError({
                message: 'runtime speech stream artifact chunk missing mimeType',
                reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
                actionHint: 'check_runtime_stream_contract',
                source: 'runtime',
              });
            }
            streamMimeType = mimeType;
            sawArtifactChunk = true;
            yield {
              artifactId: 'speech-stream-artifact',
              mimeType,
              sequence: String(event.sequence || 0),
              chunk,
              eof: false,
              routeDecision: streamRouteDecision,
              modelResolved: streamModelResolved,
              traceId: normalizeText(event.traceId),
            };
            continue;
          }
          case 'usage':
            streamUsage = event.payload.usage;
            continue;
          case 'completed': {
            const completedMimeType = streamMimeType || normalizeText(input.audioFormat);
            if (!completedMimeType) {
              throw createNimiError({
                message: 'runtime speech stream completed without stable mimeType',
                reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
                actionHint: 'check_runtime_stream_contract',
                source: 'runtime',
              });
            }
            if (!sawArtifactChunk) {
              throw createNimiError({
                message: 'runtime speech stream completed without audio chunks',
                reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
                actionHint: 'check_runtime_stream_contract',
                source: 'runtime',
              });
            }
            yield {
              artifactId: 'speech-stream-artifact',
              mimeType: completedMimeType,
              sequence: String(event.sequence || 0),
              chunk: new Uint8Array(0),
              eof: true,
              usage: resolveStreamUsage(streamUsage, event.payload.completed.usage),
              routeDecision: streamRouteDecision,
              modelResolved: streamModelResolved,
              traceId: normalizeText(event.traceId),
            };
            return;
          }
          case 'failed':
            throw createNimiError({
              message: normalizeText(event.payload.failed.actionHint) || 'runtime stream failed',
              reasonCode: normalizeText(event.payload.failed.reasonCode) || ReasonCode.AI_STREAM_BROKEN,
              actionHint: 'retry_or_switch_route',
              source: 'runtime',
            });
          default:
            continue;
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
  if (output.artifacts.length === 0) {
    throw createNimiError({
      message: 'runtime media output is missing artifacts',
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'check_runtime_media_contract',
      source: 'runtime',
    });
  }

  const items = output.artifacts.flatMap((artifact, index) => {
    const artifactId = normalizeText(artifact.artifactId);
    const mimeType = normalizeText(artifact.mimeType);
    if (!artifactId || !mimeType) {
      throw createNimiError({
        message: `runtime media artifact ${index} is missing stable metadata`,
        reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
        actionHint: 'check_runtime_media_contract',
        source: 'runtime',
      });
    }
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
