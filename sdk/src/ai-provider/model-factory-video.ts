import type {
  NimiRuntimeVideoModel,
  RuntimeDefaults,
  RuntimeForAiProvider,
} from './types.js';
import {
  executeScenarioJob,
  normalizeProviderError,
  normalizeText,
  resolveRoutePolicy,
  toLabels,
} from './helpers.js';
import {
  toVideoModeValue,
  toVideoRoleValue,
  withOptionalHeadSubjectUserId,
} from './model-factory-shared.js';
import { ExecutionMode, ScenarioType } from '../runtime/generated/runtime/v1/ai.js';

export function createVideoModelImpl(
  runtime: RuntimeForAiProvider,
  defaults: RuntimeDefaults,
  modelId: string,
): NimiRuntimeVideoModel {
  return {
    generate: async (options) => {
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
          scenarioType: ScenarioType.VIDEO_GENERATE,
          executionMode: ExecutionMode.ASYNC_JOB,
          requestId: normalizeText(options.requestId),
          idempotencyKey: normalizeText(options.idempotencyKey),
          labels: toLabels(options.labels) || {},
          spec: {
            spec: {
              oneofKind: 'videoGenerate' as const,
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
        }, defaults.subjectUserId);
        const media = await executeScenarioJob(runtime, defaults, request, timeoutMs, options.signal);
        return {
          artifacts: media.artifacts,
        };
      } catch (error) {
        throw normalizeProviderError(error);
      }
    },
  };
}
