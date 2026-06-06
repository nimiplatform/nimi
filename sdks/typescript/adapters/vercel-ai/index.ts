import type { LanguageModelV3 } from '@ai-sdk/provider';
import type {
  NimiClient,
  NimiClientRuntimeModelOptions,
} from '@nimiplatform/sdk';
import type {
  NimiAiModel,
  NimiRuntimeAIRoutePolicy,
} from '@nimiplatform/sdk/ai';
import {
  type NimiCapabilityManifest,
} from '@nimiplatform/sdk/contracts';
import { NIMI_VERCEL_AI_ADAPTER_MANIFEST } from './manifest';
import {
  toNimiGenerateTextRequest,
  toVercelFinishReason,
  toVercelReadableStream,
  toVercelToolCallOutput,
  toVercelUsage,
  toVercelWarnings,
} from './mappers';

export const NIMI_VERCEL_AI_UNSUPPORTED_FEATURE_CODE = 'unsupported_vercel_ai_adapter_feature' as const;

export type NimiVercelLanguageModel = LanguageModelV3;

export interface NimiVercelLanguageModelOptions {
  readonly model: NimiAiModel;
}

export type NimiVercelRuntimeModelOptions =
  Omit<NimiClientRuntimeModelOptions, 'model' | 'routePolicy'> & {
    readonly routePolicy?: NimiRuntimeAIRoutePolicy;
    readonly providerId?: string;
  };

export interface NimiVercelProviderOptions extends NimiVercelRuntimeModelOptions {
  readonly client?: NimiClient;
  readonly model?: NimiAiModel;
}

export interface NimiVercelLanguageModelProvider {
  readonly manifest: NimiCapabilityManifest;
  languageModel(modelId: string): NimiVercelLanguageModel;
}

export class NimiVercelAiUnsupportedFeatureError extends Error {
  readonly code = NIMI_VERCEL_AI_UNSUPPORTED_FEATURE_CODE;
  readonly feature: string;

  constructor(feature: string, detail?: string) {
    super(detail ? `${feature}: ${detail}` : feature);
    this.name = 'NimiVercelAiUnsupportedFeatureError';
    this.feature = feature;
  }
}

export function throwUnsupportedVercelAiFeature(feature: string, detail?: string): never {
  throw new NimiVercelAiUnsupportedFeatureError(feature, detail);
}

export function createNimiVercelLanguageModel(options: NimiVercelLanguageModelOptions): NimiVercelLanguageModel {
  return {
    specificationVersion: 'v3',
    provider: 'nimi',
    modelId: options.model.model.modelId,
    supportedUrls: {},
    async doGenerate(callOptions) {
      const result = await options.model.generateText(
        toNimiGenerateTextRequest(options.model, callOptions, throwUnsupportedVercelAiFeature),
      );
      return {
        content: [
          ...(result.text ? [{ type: 'text' as const, text: result.text }] : []),
          ...(result.toolCalls?.map(toVercelToolCallOutput) ?? []),
        ],
        finishReason: toVercelFinishReason(result.finishReason),
        usage: toVercelUsage(result.usage),
        warnings: toVercelWarnings(result.warnings),
      };
    },
    async doStream(callOptions) {
      if (!options.model.streamText) {
        throwUnsupportedVercelAiFeature('languageModel.doStream', 'model does not expose Nimi streaming');
      }
      const streamEvents = await options.model.streamText(
        toNimiGenerateTextRequest(options.model, callOptions, throwUnsupportedVercelAiFeature),
      );
      return {
        stream: toVercelReadableStream(streamEvents),
      };
    },
  };
}

export function createNimiVercelProvider(options: NimiVercelProviderOptions): NimiVercelLanguageModelProvider {
  if (options.model && options.client) {
    throwUnsupportedVercelAiFeature('provider.configuration', 'pass either model or client, not both');
  }
  if (!options.model && !options.client) {
    throwUnsupportedVercelAiFeature('provider.configuration', 'pass a NimiAiModel or NimiClient');
  }
  return {
    manifest: NIMI_VERCEL_AI_ADAPTER_MANIFEST,
    languageModel(modelId) {
      const model = resolveProviderModel(options, modelId);
      if (modelId !== model.model.modelId) {
        throwUnsupportedVercelAiFeature('provider.languageModel', `unknown model ${modelId}`);
      }
      return createNimiVercelLanguageModel({ model });
    },
  };
}

function resolveProviderModel(options: NimiVercelProviderOptions, modelId: string): NimiAiModel {
  if (options.model) {
    return options.model;
  }
  const client = options.client;
  if (!client) {
    throwUnsupportedVercelAiFeature('provider.configuration', 'missing NimiClient');
  }
  return client.ai.createRuntimeModel({
    appId: options.appId,
    runtime: options.runtime,
    model: {
      modelId,
      ...(options.providerId ? { providerId: options.providerId } : {}),
    },
    routePolicy: options.routePolicy,
    connectorId: options.connectorId,
    subjectUserId: options.subjectUserId,
    timeoutMs: options.timeoutMs,
    metadata: options.metadata,
    reasoning: options.reasoning,
  });
}
