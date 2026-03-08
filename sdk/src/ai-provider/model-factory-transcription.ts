import { createNimiError } from '../runtime/index.js';
import { ReasonCode } from '../types/index.js';
import type {
  NimiRuntimeTranscriptionModel,
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
  toUtf8,
} from './helpers.js';
import { withOptionalHeadSubjectUserId } from './model-factory-shared.js';
import { ExecutionMode, ScenarioType } from '../runtime/generated/runtime/v1/ai.js';

export function createTranscriptionModelImpl(
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
