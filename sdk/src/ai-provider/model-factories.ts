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
  type NimiRuntimeSpeechModel,
  type NimiRuntimeTranscriptionModel,
  type NimiRuntimeVideoModel,
  type RuntimeDefaults,
  type RuntimeForAiProvider,
} from './types.js';
import {
  asRecord,
  executeScenarioJob,
  extractGenerateText,
  normalizeProviderError,
  normalizeText,
  parseCount,
  resolveFallbackPolicy,
  resolveRoutePolicy,
  toBase64,
  toCallOptions,
  toEmbeddingVectorsFromScenarioOutput,
  toFinishReason,
  toImageFileSource,
  toImageFileSources,
  toLabels,
  toProviderMetadata,
  toRuntimePrompt,
  toStreamOptions,
  toUsage,
  toUtf8,
} from './helpers.js';
import { ExecutionMode, ScenarioType } from '../runtime/generated/runtime/v1/ai.js';

function withOptionalHeadSubjectUserId<T extends { head: Record<string, unknown> }>(
  request: T,
  subjectUserId: string | undefined,
): T {
  const normalized = normalizeText(subjectUserId);
  if (!normalized) {
    return request;
  }
  return {
    ...request,
    head: {
      ...request.head,
      subjectUserId: normalized,
    },
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

        const response = await runtime.ai.executeScenario(withOptionalHeadSubjectUserId({
          head: {
            appId: defaults.appId,
            modelId,
            routePolicy: resolveRoutePolicy(defaults.routePolicy),
            fallback: resolveFallbackPolicy(defaults.fallback),
            timeoutMs: defaults.timeoutMs || 0,
            connectorId: '',
          },
          scenarioType: ScenarioType.TEXT_GENERATE,
          executionMode: ExecutionMode.SYNC,
          spec: {
            spec: {
              oneofKind: 'textGenerate',
              textGenerate: {
                input: prompt.input,
                systemPrompt: prompt.systemPrompt,
                tools: [],
                temperature: options.temperature || 0,
                topP: options.topP || 0,
                maxTokens: options.maxOutputTokens || 0,
              },
            },
          },
          extensions: [],
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

        const runtimeStream = await runtime.ai.streamScenario(withOptionalHeadSubjectUserId({
          head: {
            appId: defaults.appId,
            modelId,
            routePolicy: resolveRoutePolicy(defaults.routePolicy),
            fallback: resolveFallbackPolicy(defaults.fallback),
            timeoutMs: defaults.timeoutMs || 0,
            connectorId: '',
          },
          scenarioType: ScenarioType.TEXT_GENERATE,
          executionMode: ExecutionMode.STREAM,
          spec: {
            spec: {
              oneofKind: 'textGenerate',
              textGenerate: {
                input: prompt.input,
                systemPrompt: prompt.systemPrompt,
                tools: [],
                temperature: options.temperature || 0,
                topP: options.topP || 0,
                maxTokens: options.maxOutputTokens || 0,
              },
            },
          },
          extensions: [],
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
              let streamRouteDecision = resolveRoutePolicy(defaults.routePolicy);
              let streamModelResolved = modelId;
              let streamUsage: unknown = undefined;

              for await (const event of runtimeStream) {
                const payload = asRecord(event).payload;
                const oneofKind = normalizeText(asRecord(payload).oneofKind);
                if (oneofKind === 'started') {
                  streamRouteDecision = Number(asRecord(asRecord(payload).started).routeDecision) || streamRouteDecision;
                  streamModelResolved = normalizeText(asRecord(asRecord(payload).started).modelResolved) || streamModelResolved;
                  continue;
                }
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

                if (oneofKind === 'usage') {
                  streamUsage = asRecord(payload).usage;
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
                    usage: toUsage(streamUsage || asRecord(asRecord(payload).completed).usage),
                    providerMetadata: toProviderMetadata({
                      traceId: normalizeText(asRecord(event).traceId) || undefined,
                      routeDecision: streamRouteDecision,
                      modelResolved: streamModelResolved,
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
        const response = await runtime.ai.executeScenario(withOptionalHeadSubjectUserId({
          head: {
            appId: defaults.appId,
            modelId,
            routePolicy: resolveRoutePolicy(defaults.routePolicy),
            fallback: resolveFallbackPolicy(defaults.fallback),
            timeoutMs: defaults.timeoutMs || 0,
            connectorId: '',
          },
          scenarioType: ScenarioType.TEXT_EMBED,
          executionMode: ExecutionMode.SYNC,
          spec: {
            spec: {
              oneofKind: 'textEmbed',
              textEmbed: {
                inputs: options.values,
              },
            },
          },
          extensions: [],
        }, defaults.subjectUserId), toCallOptions(defaults, {
          timeoutMs: defaults.timeoutMs,
          metadata: undefined,
        }));

        return {
          embeddings: toEmbeddingVectorsFromScenarioOutput(response.output),
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
        const media = await executeScenarioJob(runtime, defaults, withOptionalHeadSubjectUserId({
          head: {
            appId: defaults.appId,
            modelId,
            routePolicy: resolveRoutePolicy(defaults.routePolicy),
            fallback: resolveFallbackPolicy(defaults.fallback),
            timeoutMs,
            connectorId: '',
          },
          scenarioType: ScenarioType.IMAGE_GENERATE,
          executionMode: ExecutionMode.ASYNC_JOB,
          requestId: normalizeText(flattenedProviderOptions.requestId),
          idempotencyKey: normalizeText(flattenedProviderOptions.idempotencyKey),
          labels: requestLabels,
          spec: {
            spec: {
              oneofKind: 'imageGenerate',
              imageGenerate: {
                prompt: normalizeText(options.prompt),
                negativePrompt: normalizeText(optionRecord.negativePrompt),
                n: Number(optionRecord.n || 0),
                size: normalizeText(optionRecord.size),
                aspectRatio: normalizeText(optionRecord.aspectRatio),
                quality: normalizeText(flattenedProviderOptions.quality),
                style: normalizeText(flattenedProviderOptions.style),
                seed: String(optionRecord.seed || 0),
                referenceImages,
                mask,
                responseFormat: normalizeText(flattenedProviderOptions.responseFormat),
              },
            },
          },
          extensions: [],
        }, defaults.subjectUserId) as unknown as Record<string, unknown>, timeoutMs, options.abortSignal);
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
        const media = await executeScenarioJob(runtime, defaults, withOptionalHeadSubjectUserId({
          head: {
            appId: defaults.appId,
            modelId,
            routePolicy: resolveRoutePolicy(resolvedRoute),
            fallback: resolveFallbackPolicy(resolvedFallback),
            timeoutMs,
            connectorId: '',
          },
          scenarioType: ScenarioType.VIDEO_GENERATE,
          executionMode: ExecutionMode.ASYNC_JOB,
          requestId: normalizeText(options.requestId),
          idempotencyKey: normalizeText(options.idempotencyKey),
          labels: toLabels(options.labels),
          spec: {
            spec: {
              oneofKind: 'videoGenerate',
              videoGenerate: {
                prompt: normalizeText(options.prompt),
                negativePrompt: normalizeText(options.negativePrompt),
                mode: toVideoModeValue(options.mode),
                content: Array.isArray(options.content)
                  ? options.content.map((entry) => {
                    if (entry.type === 'text') {
                      return {
                        type: 1,
                        role: toVideoRoleValue(entry.role || 'prompt'),
                        text: normalizeText(entry.text),
                        imageUrl: undefined,
                      };
                    }
                    return {
                      type: 2,
                      role: toVideoRoleValue(entry.role),
                      text: '',
                      imageUrl: { url: normalizeText(entry.imageUrl) },
                    };
                  })
                  : [],
                options: {
                  resolution: normalizeText(options.options?.resolution),
                  ratio: normalizeText(options.options?.ratio),
                  durationSec: Number(options.options?.durationSec || 0),
                  frames: Number(options.options?.frames || 0),
                  fps: Number(options.options?.fps || 0),
                  seed: String(options.options?.seed || 0),
                  cameraFixed: Boolean(options.options?.cameraFixed),
                  watermark: Boolean(options.options?.watermark),
                  generateAudio: Boolean(options.options?.generateAudio),
                  draft: Boolean(options.options?.draft),
                  serviceTier: normalizeText(options.options?.serviceTier),
                  executionExpiresAfterSec: Number(options.options?.executionExpiresAfterSec || 0),
                  returnLastFrame: Boolean(options.options?.returnLastFrame),
                },
              },
            },
          },
          extensions: [],
        }, defaults.subjectUserId) as unknown as Record<string, unknown>, timeoutMs, options.signal);
        return {
          artifacts: media.artifacts,
        };
      } catch (error) {
        throw normalizeProviderError(error);
      }
    },
  };
}

function toVideoModeValue(value: 't2v' | 'i2v-first-frame' | 'i2v-first-last' | 'i2v-reference'): number {
  switch (value) {
    case 't2v':
      return 1;
    case 'i2v-first-frame':
      return 2;
    case 'i2v-first-last':
      return 3;
    case 'i2v-reference':
      return 4;
    default:
      return 0;
  }
}

function toVideoRoleValue(value: 'prompt' | 'first_frame' | 'last_frame' | 'reference_image'): number {
  switch (value) {
    case 'prompt':
      return 1;
    case 'first_frame':
      return 2;
    case 'last_frame':
      return 3;
    case 'reference_image':
      return 4;
    default:
      return 0;
  }
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
        const media = await executeScenarioJob(runtime, defaults, withOptionalHeadSubjectUserId({
          head: {
            appId: defaults.appId,
            modelId,
            routePolicy: resolveRoutePolicy(resolvedRoute),
            fallback: resolveFallbackPolicy(resolvedFallback),
            timeoutMs,
            connectorId: '',
          },
          scenarioType: ScenarioType.SPEECH_SYNTHESIZE,
          executionMode: ExecutionMode.ASYNC_JOB,
          requestId: normalizeText(options.requestId),
          idempotencyKey: normalizeText(options.idempotencyKey),
          labels: toLabels(options.labels),
          spec: {
            spec: {
              oneofKind: 'speechSynthesize',
              speechSynthesize: {
                text: normalizeText(options.text),
                language: normalizeText(options.language),
                audioFormat: normalizeText(options.audioFormat),
                sampleRateHz: Number(options.sampleRateHz || 0),
                speed: Number(options.speed || 0),
                pitch: Number(options.pitch || 0),
                volume: Number(options.volume || 0),
                emotion: normalizeText(options.emotion),
                voiceRef: normalizeText(options.voice)
                  ? {
                    kind: 3,
                    reference: {
                      oneofKind: 'providerVoiceRef',
                      providerVoiceRef: normalizeText(options.voice),
                    },
                  }
                  : undefined,
              },
            },
          },
          extensions: [],
        }, defaults.subjectUserId) as unknown as Record<string, unknown>, timeoutMs, options.signal);
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
        const media = await executeScenarioJob(runtime, defaults, withOptionalHeadSubjectUserId({
          head: {
            appId: defaults.appId,
            modelId,
            routePolicy: resolveRoutePolicy(resolvedRoute),
            fallback: resolveFallbackPolicy(resolvedFallback),
            timeoutMs,
            connectorId: '',
          },
          scenarioType: ScenarioType.SPEECH_TRANSCRIBE,
          executionMode: ExecutionMode.ASYNC_JOB,
          requestId: normalizeText(options.requestId),
          idempotencyKey: normalizeText(options.idempotencyKey),
          labels: toLabels(options.labels),
          spec: {
            spec: {
              oneofKind: 'speechTranscribe',
              speechTranscribe: {
                mimeType: normalizeText(options.mimeType || 'audio/wav'),
                language: normalizeText(options.language),
                timestamps: Boolean(options.timestamps),
                diarization: Boolean(options.diarization),
                speakerCount: Number(options.speakerCount || 0),
                prompt: normalizeText(options.prompt),
                audioSource,
                responseFormat: normalizeText(options.responseFormat),
              },
            },
          },
          extensions: [],
        }, defaults.subjectUserId) as unknown as Record<string, unknown>, timeoutMs, undefined);
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
