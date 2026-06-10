import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { MastraModelConfig } from '@mastra/core/llm';
import type {
  NimiClient,
  NimiClientEmbeddingOptions,
  NimiClientRuntimeModelOptions,
} from '@nimiplatform/sdk';
import type {
  NimiAiModel,
  NimiRuntimeAIRoutePolicy,
} from '@nimiplatform/sdk/ai';
import type { NimiCapabilityManifest } from '@nimiplatform/sdk/contracts';

import {
  createNimiMastraEmbeddingModel,
  type NimiMastraEmbeddingModel,
  type NimiMastraEmbeddingModelOptions,
} from './embedding';
import { throwUnsupportedMastraFeature } from './errors';
import { NIMI_MASTRA_ADAPTER_MANIFEST } from './manifest';
import {
  toNimiGenerateTextRequest,
  toV3FinishReason,
  toV3GenerateContent,
  toV3ReadableStream,
  toV3Usage,
  toV3Warnings,
} from './mappers';
import {
  toV3RequestMetadata,
  toV3ResponseMetadata,
  toV3TopLevelProviderMetadata,
} from './raw-metadata';

export {
  createNimiMastraEmbeddingModel,
  type NimiMastraEmbeddingModel,
  type NimiMastraEmbeddingModelOptions,
} from './embedding';
export {
  createNimiMastraVoice,
  NIMI_MASTRA_VOICE_UNSUPPORTED_FEATURE_CODE,
  NimiMastraVoice,
  NimiMastraVoiceUnsupportedFeatureError,
  type NimiMastraVoiceCatalogOptions,
  type NimiMastraVoiceListenOptions,
  type NimiMastraVoiceOptions,
  type NimiMastraVoiceRuntime,
  type NimiMastraVoiceScenarioClient,
  type NimiMastraVoiceSpeakOptions,
  type NimiMastraVoiceSpeakerKind,
  type NimiMastraVoiceSpeakerMetadata,
} from './voice';
export {
  NIMI_MASTRA_UNSUPPORTED_FEATURE_CODE,
  NimiMastraUnsupportedFeatureError,
  throwUnsupportedMastraFeature,
} from './errors';
export { NIMI_MASTRA_ADAPTER_ID, NIMI_MASTRA_ADAPTER_MANIFEST } from './manifest';
export {
  createNimiMastraContextBridge,
  generateWithNimiMastraContext,
  streamWithNimiMastraContext,
  type NimiMastraContextBridge,
  type NimiMastraContextBridgeInput,
  type NimiMastraContextBridgeOptions,
  type NimiMastraExecutionOptions,
  type NimiMastraGenerateTarget,
  type NimiMastraStreamTarget,
} from './context';
export {
  createNimiMastraRuntimeDelegatedToolBinding,
  createNimiMastraRuntimeDelegatedTool,
  resumeNimiMastraRuntimeDelegatedTool,
  NIMI_MASTRA_RUNTIME_DELEGATED_TOOL_APPROVAL_REQUIRED_CODE,
  NIMI_MASTRA_RUNTIME_DELEGATED_TOOL_ERROR_CODE,
  NimiMastraRuntimeDelegatedToolApprovalRequiredError,
  NimiMastraRuntimeDelegatedToolError,
  type NimiMastraRuntimeDelegatedToolBinding,
  type NimiMastraRuntimeDelegatedToolBindingOptions,
  type NimiMastraRuntimeDelegatedToolOptions,
  type NimiMastraRuntimeDelegatedToolResumeOptions,
  type NimiMastraRuntimeDelegatedToolValue,
  type NimiMastraRuntimeTurnBinding,
} from './runtime-delegated-tools';

/**
 * The Nimi-backed Mastra model.
 *
 * Mastra's model boundary is the AI SDK provider `LanguageModelV3` admitted by
 * `MastraModelConfig` (Mastra's `@ai-sdk/provider-v6` alias). This adapter owns
 * its own Nimi -> LanguageModelV3 mapping (see mappers.ts) and returns a model
 * Mastra accepts wherever a model config is required, e.g.
 * `new Agent({ model: createNimiMastraModel({ model }) })`.
 */
export type NimiMastraLanguageModel = LanguageModelV3;

// Build-time guarantee that the adapter model is accepted as a Mastra model
// config. `LanguageModelV3` is a `MastraModelConfig` arm; instantiating this
// generic re-checks the assignability whenever either side moves, and the build
// fails closed if Mastra ever stops admitting the produced model shape.
type AssertAssignable<T extends U, U> = T;
export type NimiMastraModelIsMastraModelConfig = AssertAssignable<NimiMastraLanguageModel, MastraModelConfig>;

// Declare http(s) URL passthrough for the media types Nimi routes onto Runtime
// content channels. Without this Mastra/AI-SDK downloads file URLs in the app/SDK
// process before calling the model, which would bypass the Runtime's endpoint
// security and inline-media limits. Keeping fetch + decode Runtime-owned is
// required by S-AIP-001; the Runtime validates and fetches the URL itself.
const NIMI_MASTRA_SUPPORTED_URLS: Record<string, RegExp[]> = {
  'image/*': [/^https?:\/\//i],
  'audio/*': [/^https?:\/\//i],
  'video/*': [/^https?:\/\//i],
};

export interface NimiMastraModelOptions {
  readonly model: NimiAiModel;
}

/**
 * Wrap a `NimiAiModel` as a Mastra-compatible model. Pass the result straight to a
 * Mastra Agent: `new Agent({ name, instructions, model: createNimiMastraModel({ model }) })`.
 *
 * Streaming, tool definitions/choice, structured-output request mapping, sources,
 * reasoning, usage, finish reasons, raw chunks, abort signals, and file inputs are
 * projected by this adapter's own LanguageModelV3 mapping. Mastra owns the agent
 * loop (tool execution, multi-step, structured-output parsing); the adapter
 * faithfully maps the model interface it drives. Unsupported model shapes fail
 * closed with a typed `NimiMastraUnsupportedFeatureError`.
 */
export function createNimiMastraModel(options: NimiMastraModelOptions): NimiMastraLanguageModel {
  if (!options || !options.model) {
    throwUnsupportedMastraFeature('model.config', 'a NimiAiModel is required');
  }
  const model = options.model;
  return {
    specificationVersion: 'v3',
    provider: 'nimi',
    modelId: model.model.modelId,
    supportedUrls: NIMI_MASTRA_SUPPORTED_URLS,
    async doGenerate(callOptions) {
      const result = await model.generateText(
        toNimiGenerateTextRequest(model, callOptions, throwUnsupportedMastraFeature),
      );
      const providerMetadata = toV3TopLevelProviderMetadata(result.raw);
      const request = toV3RequestMetadata(result.raw);
      const response = toV3ResponseMetadata(result.raw);
      return {
        content: toV3GenerateContent(result),
        finishReason: toV3FinishReason(result.finishReason),
        usage: toV3Usage(result.usage),
        warnings: toV3Warnings(result.warnings),
        ...(providerMetadata ? { providerMetadata } : {}),
        ...(request ? { request } : {}),
        ...(response ? { response } : {}),
      };
    },
    async doStream(callOptions) {
      if (!model.streamText) {
        throwUnsupportedMastraFeature('languageModel.doStream', 'model does not expose Nimi streaming');
      }
      const streamEvents = await model.streamText(
        toNimiGenerateTextRequest(model, callOptions, throwUnsupportedMastraFeature),
      );
      return {
        stream: toV3ReadableStream(streamEvents),
      };
    },
  };
}

export type NimiMastraRuntimeModelOptions =
  Omit<NimiClientRuntimeModelOptions, 'model' | 'routePolicy'> & {
    readonly routePolicy?: NimiRuntimeAIRoutePolicy;
    readonly providerId?: string;
  };

export type NimiMastraRuntimeEmbeddingOptions =
  Omit<NimiClientEmbeddingOptions, 'model'> & {
    readonly providerId?: string;
    readonly embedding?: NimiMastraEmbeddingModelOptions['embedding'];
    readonly maxEmbeddingsPerCall?: number;
    readonly supportsParallelCalls?: boolean;
  };

export interface NimiMastraProviderOptions extends NimiMastraRuntimeModelOptions {
  readonly client?: NimiClient;
  readonly model?: NimiAiModel;
  readonly embedding?: NimiMastraRuntimeEmbeddingOptions;
}

export interface NimiMastraLanguageModelProvider {
  readonly manifest: NimiCapabilityManifest;
  languageModel(modelId: string): NimiMastraLanguageModel;
  embeddingModel(modelId: string): NimiMastraEmbeddingModel;
  textEmbeddingModel(modelId: string): NimiMastraEmbeddingModel;
}

/**
 * Construct a Mastra model factory from a direct `NimiAiModel` or a `NimiClient`
 * (Runtime-routed model resolution). The returned `languageModel(modelId)` values
 * are accepted by Mastra Agents. Routing/default-model selection stays Runtime- or
 * caller-owned per S-AIP-001; the provider never introduces its own routing table.
 * Configuration and unknown-model errors fail closed with a typed
 * `NimiMastraUnsupportedFeatureError`.
 */
export function createNimiMastraProvider(options: NimiMastraProviderOptions): NimiMastraLanguageModelProvider {
  if (options.model && options.client) {
    throwUnsupportedMastraFeature('provider.configuration', 'pass either model or client, not both');
  }
  if (!options.model && !options.client) {
    throwUnsupportedMastraFeature('provider.configuration', 'pass a NimiAiModel or NimiClient');
  }
  return {
    manifest: NIMI_MASTRA_ADAPTER_MANIFEST,
    languageModel(modelId) {
      const model = resolveProviderModel(options, modelId);
      if (modelId !== model.model.modelId) {
        throwUnsupportedMastraFeature('provider.languageModel', `unknown model ${modelId}`);
      }
      return createNimiMastraModel({ model });
    },
    embeddingModel(modelId) {
      return resolveProviderEmbeddingModel(options, modelId);
    },
    textEmbeddingModel(modelId) {
      return resolveProviderEmbeddingModel(options, modelId);
    },
  };
}

function resolveProviderModel(options: NimiMastraProviderOptions, modelId: string): NimiAiModel {
  if (options.model) {
    return options.model;
  }
  const client = options.client;
  if (!client) {
    throwUnsupportedMastraFeature('provider.configuration', 'missing NimiClient');
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

function resolveProviderEmbeddingModel(options: NimiMastraProviderOptions, modelId: string): NimiMastraEmbeddingModel {
  const embedding = options.embedding;
  if (!embedding) {
    throwUnsupportedMastraFeature('provider.embeddingModel', 'embedding configuration is required');
  }
  const model = {
    modelId,
    ...(embedding.providerId ? { providerId: embedding.providerId } : {}),
  };
  if (embedding.embedding) {
    return createNimiMastraEmbeddingModel({
      model,
      embedding: embedding.embedding,
      maxEmbeddingsPerCall: embedding.maxEmbeddingsPerCall,
      supportsParallelCalls: embedding.supportsParallelCalls,
      metadata: embedding.metadata,
    });
  }
  if (options.client) {
    return createNimiMastraEmbeddingModel({
      model,
      embedding: options.client.ai.createRuntimeEmbeddingClient({
        appId: embedding.appId,
        runtime: embedding.runtime,
        model,
        routePolicy: embedding.routePolicy,
        connectorId: embedding.connectorId,
        subjectUserId: embedding.subjectUserId,
        timeoutMs: embedding.timeoutMs,
        metadata: embedding.metadata,
      }),
      maxEmbeddingsPerCall: embedding.maxEmbeddingsPerCall,
      supportsParallelCalls: embedding.supportsParallelCalls,
      metadata: embedding.metadata,
    });
  }
  return createNimiMastraEmbeddingModel({
    model,
    runtime: embedding.runtime ?? options.runtime,
    appId: embedding.appId ?? options.appId,
    routePolicy: embedding.routePolicy,
    connectorId: embedding.connectorId,
    subjectUserId: embedding.subjectUserId,
    timeoutMs: embedding.timeoutMs,
    metadata: embedding.metadata,
    maxEmbeddingsPerCall: embedding.maxEmbeddingsPerCall,
    supportsParallelCalls: embedding.supportsParallelCalls,
  });
}
