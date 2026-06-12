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
  toVercelGenerateContent,
  toVercelReadableStream,
  toVercelUsage,
  toVercelWarnings,
} from './mappers';
import {
  toVercelRequestMetadata,
  toVercelResponseMetadata,
  toVercelTopLevelProviderMetadata,
} from './raw-metadata';

export const NIMI_VERCEL_AI_UNSUPPORTED_FEATURE_CODE = 'SDK_ADAPTER_FEATURE_UNSUPPORTED' as const;

export type NimiVercelLanguageModel = LanguageModelV3;

export interface NimiVercelLanguageModelOptions {
  readonly model: NimiAiModel;
}

export type NimiVercelRuntimeModelOptions =
  Omit<NimiClientRuntimeModelOptions, 'model' | 'routePolicy'> & {
    readonly routePolicy: NimiRuntimeAIRoutePolicy;
    readonly providerId?: string;
    readonly subjectMode?: 'external-principal';
  };

export type NimiVercelProviderOptions =
  | (NimiVercelRuntimeModelOptions & {
    readonly client: NimiClient;
    readonly model?: never;
  })
  | {
    readonly model: NimiAiModel;
    readonly client?: never;
  };

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

// Declare http(s) URL passthrough for the media types Nimi routes onto Runtime
// content channels. Without this the Vercel framework downloads file URLs in the
// app/SDK process before calling the model, which would bypass the Runtime's
// endpoint security and inline-media limits. Keeping fetch + decode Runtime-owned
// is required by S-AIP-001; the Runtime validates and fetches the URL itself.
const NIMI_VERCEL_SUPPORTED_URLS: Record<string, RegExp[]> = {
  'image/*': [/^https?:\/\//i],
  'audio/*': [/^https?:\/\//i],
  'video/*': [/^https?:\/\//i],
};

export function createNimiVercelLanguageModel(options: NimiVercelLanguageModelOptions): NimiVercelLanguageModel {
  return {
    specificationVersion: 'v3',
    provider: 'nimi',
    modelId: options.model.model.modelId,
    supportedUrls: NIMI_VERCEL_SUPPORTED_URLS,
    async doGenerate(callOptions) {
      const result = await options.model.generateText(
        toNimiGenerateTextRequest(options.model, callOptions, throwUnsupportedVercelAiFeature),
      );
      const providerMetadata = toVercelTopLevelProviderMetadata(result.raw);
      const request = toVercelRequestMetadata(result.raw);
      const response = toVercelResponseMetadata(result.raw);
      return {
        content: toVercelGenerateContent(result),
        finishReason: toVercelFinishReason(result.finishReason),
        usage: toVercelUsage(result.usage),
        warnings: toVercelWarnings(result.warnings),
        ...(providerMetadata ? { providerMetadata } : {}),
        ...(request ? { request } : {}),
        ...(response ? { response } : {}),
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
  assertRuntimeBackedProviderOptions(options);
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

function assertRuntimeBackedProviderOptions(options: NimiVercelProviderOptions): void {
  if (!options.routePolicy) {
    throwUnsupportedVercelAiFeature('provider.routePolicy', 'runtime-backed providers require explicit routePolicy');
  }
  if (options.subjectUserId && options.subjectMode !== 'external-principal') {
    throwUnsupportedVercelAiFeature('provider.subjectUserId', 'subjectUserId requires subjectMode external-principal');
  }
}
