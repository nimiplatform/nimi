import type {
  NimiRuntimeSpeechModel,
  RuntimeDefaults,
  RuntimeForAiProvider,
} from './types.js';
import {
  executeScenarioJob,
  normalizeProviderError,
  normalizeText,
  resolveFallbackPolicy,
  resolveRoutePolicy,
  toLabels,
} from './helpers.js';
import { withOptionalHeadSubjectUserId } from './model-factory-shared.js';
import { ExecutionMode, ScenarioType } from '../runtime/generated/runtime/v1/ai.js';

export function createSpeechModelImpl(
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
