import { createNimiError } from '../runtime/browser.js';
import { ReasonCode } from '../types/index.js';
import type {
  NimiRuntimeTranscriptionModel,
  RuntimeDefaults,
  RuntimeForAiProvider,
} from './types.js';
import {
  ensureSafeExternalMediaUrl,
  executeScenarioJob,
  normalizeProviderError,
  normalizeText,
  resolveRoutePolicy,
  toSpeechTranscriptionFromScenarioOutput,
  toLabels,
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
        const mimeType = normalizeText(options.mimeType);
        if (!mimeType) {
          throw createNimiError({
            message: 'mimeType is required',
            reasonCode: ReasonCode.SDK_AI_PROVIDER_CONFIG_INVALID,
            actionHint: 'set_mime_type',
            source: 'sdk',
          });
        }
        const resolvedRoute = options.routePolicy || defaults.routePolicy;
        const timeoutMs = options.timeoutMs || defaults.timeoutMs || 0;
        const audioChunks = Array.isArray(options.audioChunks)
          ? options.audioChunks.filter((chunk): chunk is Uint8Array => chunk instanceof Uint8Array && chunk.length > 0)
          : [];
        const audioUrl = normalizeText(options.audioUrl)
          ? ensureSafeExternalMediaUrl(options.audioUrl, 'audioUrl')
          : '';
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
            : audioUrl
              ? {
                source: {
                  oneofKind: 'audioUri' as const,
                  audioUri: audioUrl,
                },
              }
              : undefined;
        const request = withOptionalHeadSubjectUserId({
          head: {
            appId: defaults.appId,
            subjectUserId: '',
            modelId,
            routePolicy: resolveRoutePolicy(resolvedRoute),
            timeoutMs,
            connectorId: '',
          },
          scenarioType: ScenarioType.SPEECH_TRANSCRIBE,
          executionMode: ExecutionMode.ASYNC_JOB,
          requestId: normalizeText(options.requestId),
          idempotencyKey: normalizeText(options.idempotencyKey),
          labels: toLabels(options.labels) || {},
          spec: {
            spec: {
              oneofKind: 'speechTranscribe' as const,
              speechTranscribe: {
                mimeType,
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
        }, defaults.subjectUserId);
        const media = await executeScenarioJob(runtime, defaults, request, timeoutMs);
        if (!media.output?.output || media.output.output.oneofKind !== 'speechTranscribe') {
          throw createNimiError({
            message: 'runtime transcription result missing typed speechTranscribe output',
            reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
            actionHint: 'regenerate_runtime_proto_and_sdk',
            source: 'sdk',
          });
        }
        const typedResult = toSpeechTranscriptionFromScenarioOutput(media.output);
        const text = typedResult.text;
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
