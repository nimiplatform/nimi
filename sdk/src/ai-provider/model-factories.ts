import type {
  EmbeddingModelV3,
  EmbeddingModelV3CallOptions,
  EmbeddingModelV3Result,
  ImageModelV3,
  ImageModelV3CallOptions,
  ImageModelV3ProviderMetadata,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from '@ai-sdk/provider';
import { createNimiError } from '../runtime/index.js';
import { ReasonCode } from '../types/index.js';
import {
  MODAL_IMAGE,
  MODAL_STT,
  MODAL_TEXT,
  MODAL_TTS,
  MODAL_VIDEO,
  type NimiRuntimeSpeechModel,
  type NimiRuntimeTranscriptionModel,
  type NimiRuntimeVideoModel,
  type RuntimeDefaults,
  type RuntimeForAiProvider,
} from './types.js';
import {
  asRecord,
  executeMediaJob,
  extractGenerateText,
  normalizeProviderError,
  normalizeText,
  parseCount,
  resolveFallbackPolicy,
  resolveRoutePolicy,
  toBase64,
  toCallOptions,
  toEmbeddingVectors,
  toFinishReason,
  toImageFileSource,
  toImageFileSources,
  toLabels,
  toProtoStruct,
  toProviderMetadata,
  toRuntimePrompt,
  toStreamOptions,
  toUsage,
  toUtf8,
} from './helpers.js';

function withOptionalSubjectUserId<T extends Record<string, unknown>>(
  request: T,
  subjectUserId: string | undefined,
): T | (T & { subjectUserId: string }) {
  const normalized = normalizeText(subjectUserId);
  if (!normalized) {
    return request;
  }
  return {
    ...request,
    subjectUserId: normalized,
  };
}

function flattenImageProviderOptions(value: unknown): Record<string, unknown> {
  const topLevel = asRecord(value);
  const flattened: Record<string, unknown> = {};

  const applyLayer = (layer: Record<string, unknown>): void => {
    for (const [key, item] of Object.entries(layer)) {
      const normalizedKey = normalizeText(key);
      if (!normalizedKey || normalizedKey === 'nimi' || normalizedKey === 'localai' || normalizedKey === 'nexa') {
        continue;
      }
      flattened[normalizedKey] = item;
    }
  };

  applyLayer(asRecord(topLevel.nexa));
  applyLayer(asRecord(topLevel.localai));
  applyLayer(asRecord(topLevel.nimi));
  applyLayer(topLevel);
  return flattened;
}

export function createLanguageModel(
  runtime: RuntimeForAiProvider,
  defaults: RuntimeDefaults,
  modelId: string,
): LanguageModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'nimi',
    modelId,
    supportedUrls: {},
    doGenerate: async (options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> => {
      try {
        const prompt = toRuntimePrompt(options.prompt);
        if (prompt.input.length === 0) {
          throw createNimiError({
            message: 'language model prompt must include at least one non-system text message',
            reasonCode: ReasonCode.AI_INPUT_INVALID,
            actionHint: 'add_user_or_assistant_text_message',
            source: 'sdk',
          });
        }

        const response = await runtime.ai.generate(withOptionalSubjectUserId({
          appId: defaults.appId,
          modelId,
          modal: MODAL_TEXT,
          input: prompt.input,
          systemPrompt: prompt.systemPrompt,
          tools: [],
          temperature: options.temperature || 0,
          topP: options.topP || 0,
          maxTokens: options.maxOutputTokens || 0,
          routePolicy: resolveRoutePolicy(defaults.routePolicy),
          fallback: resolveFallbackPolicy(defaults.fallback),
          timeoutMs: defaults.timeoutMs || 0,
          connectorId: '',
        }, defaults.subjectUserId), toCallOptions(defaults, {
          timeoutMs: defaults.timeoutMs,
        }));

        return {
          content: [{
            type: 'text',
            text: extractGenerateText(response.output),
          }],
          finishReason: toFinishReason(response.finishReason),
          usage: toUsage(response.usage),
          warnings: [],
          providerMetadata: toProviderMetadata({
            traceId: response.traceId,
            routeDecision: response.routeDecision,
            modelResolved: response.modelResolved,
          }),
          response: {
            id: normalizeText(response.traceId) || undefined,
            modelId: normalizeText(response.modelResolved) || modelId,
          },
        };
      } catch (error) {
        throw normalizeProviderError(error);
      }
    },
    doStream: async (options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> => {
      try {
        const prompt = toRuntimePrompt(options.prompt);
        if (prompt.input.length === 0) {
          throw createNimiError({
            message: 'language model prompt must include at least one non-system text message',
            reasonCode: ReasonCode.AI_INPUT_INVALID,
            actionHint: 'add_user_or_assistant_text_message',
            source: 'sdk',
          });
        }

        const runtimeStream = await runtime.ai.streamGenerate(withOptionalSubjectUserId({
          appId: defaults.appId,
          modelId,
          modal: MODAL_TEXT,
          input: prompt.input,
          systemPrompt: prompt.systemPrompt,
          tools: [],
          temperature: options.temperature || 0,
          topP: options.topP || 0,
          maxTokens: options.maxOutputTokens || 0,
          routePolicy: resolveRoutePolicy(defaults.routePolicy),
          fallback: resolveFallbackPolicy(defaults.fallback),
          timeoutMs: defaults.timeoutMs || 0,
          connectorId: '',
        }, defaults.subjectUserId), toStreamOptions(defaults, {
          timeoutMs: defaults.timeoutMs,
          signal: options.abortSignal,
        }));

        const stream = new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            void (async () => {
              const textId = 'nimi-text-1';
              let textOpen = false;
              controller.enqueue({
                type: 'stream-start',
                warnings: [],
              });

              for await (const event of runtimeStream) {
                const payload = asRecord(event).payload;
                const oneofKind = normalizeText(asRecord(payload).oneofKind);
                if (oneofKind === 'delta') {
                  const delta = normalizeText(asRecord(asRecord(payload).delta).text);
                  if (!delta) {
                    continue;
                  }
                  if (!textOpen) {
                    textOpen = true;
                    controller.enqueue({
                      type: 'text-start',
                      id: textId,
                    });
                  }
                  controller.enqueue({
                    type: 'text-delta',
                    id: textId,
                    delta,
                  });
                  continue;
                }

                if (oneofKind === 'failed') {
                  controller.enqueue({
                    type: 'error',
                    error: createNimiError({
                      message: normalizeText(asRecord(asRecord(payload).failed).actionHint) || 'runtime stream failed',
                      reasonCode: normalizeText(asRecord(asRecord(payload).failed).reasonCode) || 'AI_STREAM_BROKEN',
                      actionHint: 'retry_or_switch_route',
                      source: 'runtime',
                    }),
                  });
                  continue;
                }

                if (oneofKind === 'completed') {
                  if (textOpen) {
                    controller.enqueue({
                      type: 'text-end',
                      id: textId,
                    });
                    textOpen = false;
                  }
                  controller.enqueue({
                    type: 'finish',
                    finishReason: toFinishReason(
                      asRecord(asRecord(payload).completed).finishReason,
                    ),
                    usage: toUsage(asRecord(event).usage),
                    providerMetadata: toProviderMetadata({
                      traceId: normalizeText(asRecord(event).traceId) || undefined,
                      routeDecision: asRecord(event).routeDecision,
                      modelResolved: normalizeText(asRecord(event).modelResolved) || undefined,
                    }),
                  });
                }
              }

              if (textOpen) {
                controller.enqueue({
                  type: 'text-end',
                  id: textId,
                });
              }
              controller.close();
            })().catch((error) => {
              controller.enqueue({
                type: 'error',
                error: normalizeProviderError(error),
              });
              controller.close();
            });
          },
        });

        return { stream };
      } catch (error) {
        throw normalizeProviderError(error);
      }
    },
  };
}

export function createEmbeddingModel(
  runtime: RuntimeForAiProvider,
  defaults: RuntimeDefaults,
  modelId: string,
): EmbeddingModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'nimi',
    modelId,
    maxEmbeddingsPerCall: undefined,
    supportsParallelCalls: true,
    doEmbed: async (options: EmbeddingModelV3CallOptions): Promise<EmbeddingModelV3Result> => {
      try {
        const response = await runtime.ai.embed(withOptionalSubjectUserId({
          appId: defaults.appId,
          modelId,
          inputs: options.values,
          routePolicy: resolveRoutePolicy(defaults.routePolicy),
          fallback: resolveFallbackPolicy(defaults.fallback),
          timeoutMs: defaults.timeoutMs || 0,
          connectorId: '',
        }, defaults.subjectUserId), toCallOptions(defaults, {
          timeoutMs: defaults.timeoutMs,
          metadata: undefined,
        }));

        return {
          embeddings: toEmbeddingVectors(response.vectors),
          usage: {
            tokens: parseCount(asRecord(response.usage).inputTokens) || 0,
          },
          warnings: [],
          providerMetadata: toProviderMetadata({
            traceId: response.traceId,
            routeDecision: response.routeDecision,
            modelResolved: response.modelResolved,
          }),
        };
      } catch (error) {
        throw normalizeProviderError(error);
      }
    },
  };
}

export function createImageModel(
  runtime: RuntimeForAiProvider,
  defaults: RuntimeDefaults,
  modelId: string,
): ImageModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'nimi',
    modelId,
    maxImagesPerCall: undefined,
    doGenerate: async (options: ImageModelV3CallOptions) => {
      try {
        const timeoutMs = defaults.timeoutMs || 0;
        const optionRecord = asRecord(options as unknown as Record<string, unknown>);
        const flattenedProviderOptions = flattenImageProviderOptions(options.providerOptions);
        const requestLabels = toLabels(flattenedProviderOptions.labels);
        const referenceImages = toImageFileSources(optionRecord.files);
        const mask = toImageFileSource(optionRecord.mask);
        const media = await executeMediaJob(runtime, defaults, {
          appId: defaults.appId,
          ...(normalizeText(defaults.subjectUserId)
            ? { subjectUserId: normalizeText(defaults.subjectUserId) }
            : {}),
          modelId,
          modal: MODAL_IMAGE,
          routePolicy: resolveRoutePolicy(defaults.routePolicy),
          fallback: resolveFallbackPolicy(defaults.fallback),
          timeoutMs,
          requestId: normalizeText(flattenedProviderOptions.requestId),
          idempotencyKey: normalizeText(flattenedProviderOptions.idempotencyKey),
          labels: requestLabels,
          spec: {
            oneofKind: 'imageSpec',
            imageSpec: {
              prompt: normalizeText(options.prompt),
              negativePrompt: normalizeText(optionRecord.negativePrompt),
              n: Number(optionRecord.n || 0),
              size: normalizeText(optionRecord.size),
              aspectRatio: normalizeText(optionRecord.aspectRatio),
              quality: normalizeText(flattenedProviderOptions.quality),
              style: normalizeText(flattenedProviderOptions.style),
              seed: Number(optionRecord.seed || 0),
              referenceImages,
              mask,
              responseFormat: normalizeText(flattenedProviderOptions.responseFormat),
              providerOptions: toProtoStruct(flattenedProviderOptions),
            },
          },
        }, timeoutMs, options.abortSignal);
        const artifacts = media.artifacts;
        const providerMetadata = {
          nimi: {
            images: artifacts.map((artifact) => ({
              artifactId: artifact.artifactId,
              mimeType: artifact.mimeType,
              traceId: artifact.traceId,
            })),
          },
        } as unknown as ImageModelV3ProviderMetadata;

        return {
          images: artifacts.map((artifact) => toBase64(artifact.bytes)),
          warnings: [],
          providerMetadata,
          response: {
            timestamp: new Date(),
            modelId,
            headers: undefined,
          },
        };
      } catch (error) {
        throw normalizeProviderError(error);
      }
    },
  };
}

export function createVideoModel(
  runtime: RuntimeForAiProvider,
  defaults: RuntimeDefaults,
  modelId: string,
): NimiRuntimeVideoModel {
  return {
    generate: async (options) => {
      try {
        const resolvedRoute = options.routePolicy || defaults.routePolicy;
        const resolvedFallback = options.fallback || defaults.fallback;
        const timeoutMs = options.timeoutMs || defaults.timeoutMs || 0;
        const media = await executeMediaJob(runtime, defaults, {
          appId: defaults.appId,
          ...(normalizeText(defaults.subjectUserId)
            ? { subjectUserId: normalizeText(defaults.subjectUserId) }
            : {}),
          modelId,
          modal: MODAL_VIDEO,
          routePolicy: resolveRoutePolicy(resolvedRoute),
          fallback: resolveFallbackPolicy(resolvedFallback),
          timeoutMs,
          requestId: normalizeText(options.requestId),
          idempotencyKey: normalizeText(options.idempotencyKey),
          labels: toLabels(options.labels),
          spec: {
            oneofKind: 'videoSpec',
            videoSpec: {
              prompt: normalizeText(options.prompt),
              negativePrompt: normalizeText(options.negativePrompt),
              durationSec: Number(options.durationSec || 0),
              fps: Number(options.fps || 0),
              resolution: normalizeText(options.resolution),
              aspectRatio: normalizeText(options.aspectRatio),
              seed: Number(options.seed || 0),
              firstFrameUri: normalizeText(options.firstFrameUri),
              lastFrameUri: normalizeText(options.lastFrameUri),
              cameraMotion: normalizeText(options.cameraMotion),
              providerOptions: toProtoStruct(options.providerOptions),
            },
          },
        }, timeoutMs, options.signal);
        return {
          artifacts: media.artifacts,
        };
      } catch (error) {
        throw normalizeProviderError(error);
      }
    },
  };
}

export function createSpeechModel(
  runtime: RuntimeForAiProvider,
  defaults: RuntimeDefaults,
  modelId: string,
): NimiRuntimeSpeechModel {
  return {
    synthesize: async (options) => {
      try {
        const resolvedRoute = options.routePolicy || defaults.routePolicy;
        const resolvedFallback = options.fallback || defaults.fallback;
        const timeoutMs = options.timeoutMs || defaults.timeoutMs || 0;
        const media = await executeMediaJob(runtime, defaults, {
          appId: defaults.appId,
          ...(normalizeText(defaults.subjectUserId)
            ? { subjectUserId: normalizeText(defaults.subjectUserId) }
            : {}),
          modelId,
          modal: MODAL_TTS,
          routePolicy: resolveRoutePolicy(resolvedRoute),
          fallback: resolveFallbackPolicy(resolvedFallback),
          timeoutMs,
          requestId: normalizeText(options.requestId),
          idempotencyKey: normalizeText(options.idempotencyKey),
          labels: toLabels(options.labels),
          spec: {
            oneofKind: 'speechSpec',
            speechSpec: {
              text: normalizeText(options.text),
              voice: normalizeText(options.voice),
              language: normalizeText(options.language),
              audioFormat: normalizeText(options.audioFormat),
              sampleRateHz: Number(options.sampleRateHz || 0),
              speed: Number(options.speed || 0),
              pitch: Number(options.pitch || 0),
              volume: Number(options.volume || 0),
              emotion: normalizeText(options.emotion),
              providerOptions: toProtoStruct(options.providerOptions),
            },
          },
        }, timeoutMs, options.signal);
        return {
          artifacts: media.artifacts,
        };
      } catch (error) {
        throw normalizeProviderError(error);
      }
    },
  };
}

export function createTranscriptionModel(
  runtime: RuntimeForAiProvider,
  defaults: RuntimeDefaults,
  modelId: string,
): NimiRuntimeTranscriptionModel {
  return {
    transcribe: async (options) => {
      try {
        const hasAudioChunks = Array.isArray(options.audioChunks)
          && options.audioChunks.some((chunk) => chunk instanceof Uint8Array && chunk.length > 0);
        if (!(options.audioBytes && options.audioBytes.length > 0) && !normalizeText(options.audioUrl) && !hasAudioChunks) {
          throw createNimiError({
            message: 'audioBytes, audioUrl, or audioChunks is required',
            reasonCode: ReasonCode.SDK_AI_PROVIDER_CONFIG_INVALID,
            actionHint: 'set_audio_source',
            source: 'sdk',
          });
        }
        const resolvedRoute = options.routePolicy || defaults.routePolicy;
        const resolvedFallback = options.fallback || defaults.fallback;
        const timeoutMs = options.timeoutMs || defaults.timeoutMs || 0;
        const audioChunks = Array.isArray(options.audioChunks)
          ? options.audioChunks.filter((chunk): chunk is Uint8Array => chunk instanceof Uint8Array && chunk.length > 0)
          : [];
        const audioSource = audioChunks.length > 0
          ? {
            source: {
              oneofKind: 'audioChunks' as const,
              audioChunks: {
                chunks: audioChunks,
              },
            },
          }
          : options.audioBytes && options.audioBytes.length > 0
            ? {
              source: {
                oneofKind: 'audioBytes' as const,
                audioBytes: options.audioBytes,
              },
            }
            : normalizeText(options.audioUrl)
              ? {
                source: {
                  oneofKind: 'audioUri' as const,
                  audioUri: normalizeText(options.audioUrl),
                },
              }
              : undefined;
        const media = await executeMediaJob(runtime, defaults, {
          appId: defaults.appId,
          ...(normalizeText(defaults.subjectUserId)
            ? { subjectUserId: normalizeText(defaults.subjectUserId) }
            : {}),
          modelId,
          modal: MODAL_STT,
          routePolicy: resolveRoutePolicy(resolvedRoute),
          fallback: resolveFallbackPolicy(resolvedFallback),
          timeoutMs,
          requestId: normalizeText(options.requestId),
          idempotencyKey: normalizeText(options.idempotencyKey),
          labels: toLabels(options.labels),
          spec: {
            oneofKind: 'transcriptionSpec',
            transcriptionSpec: {
              audioBytes: options.audioBytes || new Uint8Array(0),
              audioUri: normalizeText(options.audioUrl),
              mimeType: normalizeText(options.mimeType || 'audio/wav'),
              language: normalizeText(options.language),
              timestamps: Boolean(options.timestamps),
              diarization: Boolean(options.diarization),
              speakerCount: Number(options.speakerCount || 0),
              prompt: normalizeText(options.prompt),
              audioSource,
              responseFormat: normalizeText(options.responseFormat),
              providerOptions: toProtoStruct(options.providerOptions),
            },
          },
        }, timeoutMs, undefined);
        const firstArtifact = media.artifacts[0];
        const text = firstArtifact ? normalizeText(toUtf8(firstArtifact.bytes)) : '';
        return {
          text,
          traceId: normalizeText(media.traceId),
          routeDecision: media.routeDecision,
          modelResolved: normalizeText(media.modelResolved),
        };
      } catch (error) {
        throw normalizeProviderError(error);
      }
    },
  };
}
