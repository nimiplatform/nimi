import type {
  NimiRuntimeSpeechModel,
  RuntimeDefaults,
  RuntimeForAiProvider,
} from './types.js';
import { createNimiError } from '../runtime/index.js';
import {
  ensureText,
  executeScenarioJob,
  normalizeProviderError,
  normalizeText,
  resolveRoutePolicy,
  toLabels,
} from './helpers.js';
import { ReasonCode } from '../types/index.js';
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
        const timeoutMs = options.timeoutMs || defaults.timeoutMs || 0;
        const request = withOptionalHeadSubjectUserId({
          head: {
            appId: defaults.appId,
            subjectUserId: '',
            modelId,
            routePolicy: resolveRoutePolicy(resolvedRoute),
            timeoutMs,
            connectorId: '',
          },
          scenarioType: ScenarioType.SPEECH_SYNTHESIZE,
          executionMode: ExecutionMode.ASYNC_JOB,
          requestId: normalizeText(options.requestId),
          idempotencyKey: normalizeText(options.idempotencyKey),
          labels: toLabels(options.labels) || {},
          spec: {
            spec: {
              oneofKind: 'speechSynthesize' as const,
              speechSynthesize: {
                text: ensureText(options.text, 'text'),
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
                      oneofKind: 'providerVoiceRef' as const,
                      providerVoiceRef: normalizeText(options.voice),
                    },
                  }
                  : undefined,
                timingMode: 0,
              },
            },
          },
          extensions: [],
        }, defaults.subjectUserId);
        const media = await executeScenarioJob(runtime, defaults, request, timeoutMs, options.signal);
        if (!media.output?.output || media.output.output.oneofKind !== 'speechSynthesize') {
          throw createNimiError({
            message: 'runtime speech synthesis output missing typed speechSynthesize result',
            reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
            actionHint: 'regenerate_runtime_proto_and_sdk',
            source: 'runtime',
          });
        }
        return {
          artifacts: media.artifacts,
        };
      } catch (error) {
        throw normalizeProviderError(error);
      }
    },
  };
}
