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
  extractGenerateText,
  normalizeProviderError,
  normalizeText,
  resolveRoutePolicy,
  toCallOptions,
  toFinishReason,
  toProviderMetadata,
  toRuntimePrompt,
  toStreamOptions,
  toUsage,
} from './helpers.js';
import { resolveStreamUsage } from '../internal/utils.js';
import { withOptionalHeadSubjectUserId } from './model-factory-shared.js';
import {
  ExecutionMode,
  RoutePolicy,
  ScenarioType,
} from '../runtime/generated/runtime/v1/ai.js';
import type { UsageStats } from '../runtime/generated/runtime/v1/common.js';

function createPromptRequiredError() {
  return createNimiError({
    message: 'language model prompt must include at least one non-system text or media message',
    reasonCode: ReasonCode.AI_INPUT_INVALID,
    actionHint: 'add_user_or_assistant_content_message',
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
        if (!prompt.hasNonSystemInput) {
          throw createPromptRequiredError();
        }

        const response = await runtime.ai.executeScenario(withOptionalHeadSubjectUserId({
          head: {
            appId: defaults.appId,
            subjectUserId: '',
            modelId,
            routePolicy: resolveRoutePolicy(defaults.routePolicy),
            timeoutMs: defaults.timeoutMs || 0,
            connectorId: '',
          },
          scenarioType: ScenarioType.TEXT_GENERATE,
          executionMode: ExecutionMode.SYNC,
          spec: {
            spec: {
              oneofKind: 'textGenerate' as const,
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
        if (!prompt.hasNonSystemInput) {
          throw createPromptRequiredError();
        }

        const runtimeStream = await runtime.ai.streamScenario(withOptionalHeadSubjectUserId({
          head: {
            appId: defaults.appId,
            subjectUserId: '',
            modelId,
            routePolicy: resolveRoutePolicy(defaults.routePolicy),
            timeoutMs: defaults.timeoutMs || 0,
            connectorId: '',
          },
          scenarioType: ScenarioType.TEXT_GENERATE,
          executionMode: ExecutionMode.STREAM,
          spec: {
            spec: {
              oneofKind: 'textGenerate' as const,
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
          async cancel() {
            const iterator = runtimeStream[Symbol.asyncIterator]();
            if (typeof iterator.return === 'function') {
              await iterator.return(undefined);
            }
          },
          start(controller) {
            void (async () => {
              const textId = 'nimi-text-1';
              const reasoningId = 'nimi-reasoning-1';
              let textOpen = false;
              let reasoningOpen = false;
              controller.enqueue({
                type: 'stream-start',
                warnings: [],
              });
              let streamRouteDecision = resolveRoutePolicy(defaults.routePolicy);
              let streamModelResolved = modelId;
              let streamUsage: UsageStats | undefined = undefined;

              for await (const event of runtimeStream) {
                switch (event.payload.oneofKind) {
                case 'started': {
                  const started = event.payload.started;
                  streamRouteDecision = Number(started.routeDecision) || streamRouteDecision;
                  streamModelResolved = normalizeText(started.modelResolved) || streamModelResolved;
                  continue;
                }
                case 'delta': {
                  const deltaPayload = event.payload.delta.delta;
                  if (deltaPayload?.oneofKind === 'reasoning') {
                    const reasoning = normalizeText(deltaPayload.reasoning.text);
                    if (!reasoning) {
                      continue;
                    }
                    if (!reasoningOpen) {
                      reasoningOpen = true;
                      controller.enqueue({
                        type: 'reasoning-start',
                        id: reasoningId,
                      });
                    }
                    controller.enqueue({
                      type: 'reasoning-delta',
                      id: reasoningId,
                      delta: reasoning,
                    });
                    continue;
                  }
                  const delta = deltaPayload?.oneofKind === 'text'
                    ? normalizeText(deltaPayload.text.text)
                    : '';
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
                case 'failed': {
                  const failed = event.payload.failed;
                  controller.enqueue({
                    type: 'error',
                    error: createNimiError({
                      message: normalizeText(failed.actionHint) || 'runtime stream failed',
                      reasonCode: normalizeText(failed.reasonCode) || 'AI_STREAM_BROKEN',
                      actionHint: 'retry_or_switch_route',
                      source: 'runtime',
                    }),
                  });
                  continue;
                }
                case 'usage':
                  streamUsage = event.payload.usage;
                  continue;
                case 'completed':
                  if (reasoningOpen) {
                    controller.enqueue({
                      type: 'reasoning-end',
                      id: reasoningId,
                    });
                    reasoningOpen = false;
                  }
                  if (textOpen) {
                    controller.enqueue({
                      type: 'text-end',
                      id: textId,
                    });
                    textOpen = false;
                  }
                  controller.enqueue({
                    type: 'finish',
                    finishReason: toFinishReason(event.payload.completed.finishReason),
                    usage: toUsage(resolveStreamUsage(streamUsage, event.payload.completed.usage)),
                    providerMetadata: toProviderMetadata({
                      traceId: normalizeText(event.traceId) || undefined,
                      routeDecision: streamRouteDecision === RoutePolicy.CLOUD
                        ? RoutePolicy.CLOUD
                        : RoutePolicy.LOCAL,
                      modelResolved: streamModelResolved,
                    }),
                  });
                  continue;
                case undefined:
                  continue;
                }
              }

              if (reasoningOpen) {
                controller.enqueue({
                  type: 'reasoning-end',
                  id: reasoningId,
                });
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
