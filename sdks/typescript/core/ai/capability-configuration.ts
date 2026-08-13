import type {
  AIConfig,
  AIConfigCapabilityIntent,
  AIConfigCloudIntent,
  AIConfigLocalIntent,
  AIConfigOwner,
  GetAppAIConfigRequest,
  GetAppAIConfigResponse,
  OverwriteAppAIConfigRequest,
  OverwriteAppAIConfigResponse,
} from '../../core-generated/runtime-protobuf/runtime/v1/capability_configuration';
import type { RuntimeTypedCallOptions } from '../../core-generated/runtime-typed-client';
import { withNimiRuntimeIdempotencyMetadata } from '../../runtime/scenario-jobs';
import { createNimiClientId, createNimiError, ReasonCode } from '../../types';

export type NimiCapabilityAIConfig = AIConfig;
export type NimiCapabilityAIConfigIntent = AIConfigCapabilityIntent;

export type NimiPortableAppAIConfigIntent = Omit<AIConfigCapabilityIntent, 'requiredFeatures' | 'route'> & {
  readonly requiredFeatures: readonly string[];
  readonly route:
    | { readonly oneofKind: 'local'; readonly local: AIConfigLocalIntent }
    | {
        readonly oneofKind: 'cloud';
        readonly cloud: AIConfigCloudIntent;
      };
};

export type NimiPortableAppAIConfig = Omit<AIConfig, 'capabilities'> & {
  readonly capabilities: readonly NimiPortableAppAIConfigIntent[];
};

export interface NimiAppAIConfigRpcClient {
  getAppAIConfig(
    request: GetAppAIConfigRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<GetAppAIConfigResponse>;
  overwriteAppAIConfig(
    request: OverwriteAppAIConfigRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<OverwriteAppAIConfigResponse>;
}

export interface NimiAppAIConfigClient {
  readonly appId: string;
  readonly owner: AIConfigOwner;
  get(options?: RuntimeTypedCallOptions): Promise<AIConfig>;
  overwrite(
    capabilities: readonly AIConfigCapabilityIntent[],
    options?: RuntimeTypedCallOptions,
  ): Promise<AIConfig>;
}

export function createNimiAppAIConfigOwner(appId: string): AIConfigOwner {
  return {
    owner: {
      oneofKind: 'app',
      app: { appId: requireText(appId, 'App AIConfig owner requires appId') },
    },
  };
}

// @nimi-authority: rule.nimi.sdks.feature-clients.r009
/**
 * Creates the typed whole-object App AIConfig client. The explicit owner is a
 * consistency assertion only; Runtime still derives account and App identity
 * from its authenticated transport context.
 */
export function createNimiAppAIConfigClient(options: {
  readonly appId: string;
  readonly runtime: { readonly ai: NimiAppAIConfigRpcClient } | NimiAppAIConfigRpcClient;
}): NimiAppAIConfigClient {
  const appId = requireText(options.appId, 'App AIConfig client requires appId');
  const owner = createNimiAppAIConfigOwner(appId);
  const client = 'ai' in options.runtime ? options.runtime.ai : options.runtime;
  return Object.freeze({
    appId,
    owner,
    async get(callOptions?: RuntimeTypedCallOptions) {
      const response = await client.getAppAIConfig({ owner }, callOptions);
      return requireAppConfig(response.config, appId, 'GetAppAIConfig');
    },
    async overwrite(
      capabilities: readonly AIConfigCapabilityIntent[],
      callOptions?: RuntimeTypedCallOptions,
    ) {
      if (!Array.isArray(capabilities)) {
        return invalidConfiguration('App AIConfig capabilities must be an array');
      }
      const response = await client.overwriteAppAIConfig(
        {
          config: {
            owner,
            capabilities: [...capabilities],
          },
        },
        withNimiRuntimeIdempotencyMetadata(
          callOptions ?? {},
          createNimiClientId('app-ai-config'),
        ),
      );
      return requireAppConfig(response.config, appId, 'OverwriteAppAIConfig');
    },
  });
}

function requireAppConfig(
  config: AIConfig | undefined,
  expectedAppId: string,
  operation: string,
): AIConfig {
  if (!config) {
    return invalidConfiguration(`${operation} did not return App AIConfig`);
  }
  const owner = config.owner?.owner;
  if (owner?.oneofKind !== 'app' || owner.app.appId !== expectedAppId) {
    return invalidConfiguration(`${operation} returned a mismatched App AIConfig owner`);
  }
  return config;
}

function requireText(value: unknown, message: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized !== value) {
    return invalidConfiguration(message);
  }
  return normalized;
}

function invalidConfiguration(message: string): never {
  throw createNimiError({
    message,
    code: ReasonCode.SDK_AI_INPUT_INVALID,
    reasonCode: ReasonCode.SDK_AI_INPUT_INVALID,
    actionHint: 'provide_canonical_app_ai_config',
    source: 'sdk',
  });
}
