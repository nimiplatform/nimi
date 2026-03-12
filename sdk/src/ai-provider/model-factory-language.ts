import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from '@ai-sdk/provider';
import { createNimiError } from '../runtime/index.js';
import { ReasonCode } from '../types/index.js';
import type {
  RuntimeDefaults,
  RuntimeForAiProvider,
} from './types.js';
import {
  asRecord,
  extractGenerateText,
  normalizeProviderError,
  normalizeText,
  resolveFallbackPolicy,
  resolveRoutePolicy,
  toCallOptions,
  toFinishReason,
  toProviderMetadata,
  toRuntimePrompt,
  toStreamOptions,
  toUsage,
} from './helpers.js';
import { withOptionalHeadSubjectUserId } from './model-factory-shared.js';
import { ExecutionMode, ScenarioType } from '../runtime/generated/runtime/v1/ai.js';

function createPromptRequiredError() {
  return createNimiError({
    message: 'language model prompt must include at least one non-system text message',
    reasonCode: ReasonCode.AI_INPUT_INVALID,
    actionHint: 'add_user_or_assistant_text_message',
    source: 'sdk',
  });
}

export function createLanguageModelImpl(
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
        if (!prompt.hasTextInput) {
          throw createPromptRequiredError();
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
        if (!prompt.hasTextInput) {
          throw createPromptRequiredError();
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
