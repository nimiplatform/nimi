import type {
  EmbeddingModelV3,
  EmbeddingModelV3CallOptions,
  EmbeddingModelV3Result,
} from '@ai-sdk/provider';
import type {
  RuntimeDefaults,
  RuntimeForAiProvider,
} from './types.js';
import {
  normalizeProviderError,
  parseCount,
  resolveRoutePolicy,
  toCallOptions,
  toEmbeddingVectorsFromScenarioOutput,
  toProviderMetadata,
} from './helpers.js';
import { withOptionalHeadSubjectUserId } from './model-factory-shared.js';
import { ExecutionMode, ScenarioType } from '../runtime/generated/runtime/v1/ai.js';

export function createEmbeddingModelImpl(
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
            subjectUserId: '',
            modelId,
            routePolicy: resolveRoutePolicy(defaults.routePolicy),
            timeoutMs: defaults.timeoutMs || 0,
            connectorId: '',
          },
          scenarioType: ScenarioType.TEXT_EMBED,
          executionMode: ExecutionMode.SYNC,
          spec: {
            spec: {
              oneofKind: 'textEmbed' as const,
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
            tokens: parseCount(response.usage?.inputTokens) || 0,
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
