import type {
  ImageModelV3,
  ImageModelV3CallOptions,
  ImageModelV3ProviderMetadata,
} from '@ai-sdk/provider';
import type {
  RuntimeDefaults,
  RuntimeForAiProvider,
} from './types.js';
import {
  asRecord,
  executeScenarioJob,
  normalizeProviderError,
  normalizeText,
  resolveFallbackPolicy,
  resolveRoutePolicy,
  toBase64,
  toImageFileSource,
  toImageFileSources,
  toLabels,
} from './helpers.js';
import {
  flattenImageProviderOptions,
  withOptionalHeadSubjectUserId,
} from './model-factory-shared.js';
import { ExecutionMode, ScenarioType } from '../runtime/generated/runtime/v1/ai.js';

export function createImageModelImpl(
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
