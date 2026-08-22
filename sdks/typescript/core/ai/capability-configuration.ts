import type {
  AIConfig,
  AIConfigCapabilityIntent,
  AIConfigCloudIntent,
  AIConfigLocalResourceProjection,
  AIConfigLocalIntent,
  AIConfigOwner,
  GetAppAIConfigRequest,
  GetAppAIConfigResponse,
  ListAppAIConfigOptionsRequest,
  ListAppAIConfigOptionsResponse,
  OverwriteAppAIConfigRequest,
  OverwriteAppAIConfigResponse,
} from '../../core-generated/runtime-protobuf/runtime/v1/capability_configuration';
import { AIConfigEffectiveState } from '../../core-generated/runtime-protobuf/runtime/v1/capability_configuration';
import { ReasonCode as RuntimeReasonCode } from '../../core-generated/runtime-protobuf/runtime/v1/common';
import type { RuntimeTypedCallOptions } from '../../core-generated/runtime-typed-client';
import { withNimiRuntimeIdempotencyMetadata } from '../../runtime/scenario-jobs';
import { createNimiClientId, createNimiError, ReasonCode } from '../../types';

export type NimiCapabilityAIConfig = AIConfig;
export type NimiCapabilityAIConfigIntent = AIConfigCapabilityIntent;

export type NimiPortableAppAIConfigIntent = AIConfigCapabilityIntent;

export type NimiPortableAppAIConfig = AIConfig;

export type NimiAIConfigSnapshot = {
  readonly config: NimiPortableAppAIConfig | null;
  readonly revision: string;
  readonly effectiveSelections: readonly NimiAIConfigEffectiveSelection[];
};

export type NimiAIConfigEffectiveState = 'ready' | 'missing' | 'blocked' | 'unavailable';

export type NimiAIConfigEffectiveSelection = {
  readonly capabilityContract: string;
  readonly state: NimiAIConfigEffectiveState;
  readonly resource:
    | { readonly oneofKind: 'local'; readonly local: NimiAIConfigLocalLoadoutOption }
    | null;
  readonly reasons: readonly string[];
};

export type NimiAIConfigOverwriteInput = {
  readonly expectedRevision: string;
  readonly capabilities: readonly NimiPortableAppAIConfigIntent[];
};

export type NimiAIConfigOverwriteResult =
  | { readonly outcome: 'committed'; readonly config: NimiPortableAppAIConfig; readonly revision: string }
  | {
      readonly outcome: 'conflict';
      readonly config: NimiPortableAppAIConfig | null;
      readonly revision: string;
      readonly reasonCode: 'AI_CONFIG_REVISION_CONFLICT' | 'AGENT_AI_CONFIG_REVISION_CONFLICT';
    };

export type NimiAIConfigOptionsQuery = {
  readonly kind: 'local-loadouts';
  readonly capabilityContract: string;
  readonly search?: string;
};

export type NimiAIConfigLocalLoadoutOption = {
  readonly loadoutRef: string;
  readonly label: string;
  readonly capabilityContract: string;
  readonly implementation: {
    readonly implementationId: string;
    readonly driverId: string;
    readonly driverDialect: string;
  };
  readonly supportedFeatures: readonly string[];
  readonly state: 'ready' | 'blocked';
  readonly reasons: readonly string[];
};

export type NimiAIConfigOptionsResult = {
  readonly kind: 'local-loadouts';
  readonly options: readonly NimiAIConfigLocalLoadoutOption[];
  readonly truncated: boolean;
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
  listAppAIConfigOptions(
    request: ListAppAIConfigOptionsRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<ListAppAIConfigOptionsResponse>;
}

export interface NimiAppAIConfigClient {
  readonly appId: string;
  readonly owner: AIConfigOwner;
  get(options?: RuntimeTypedCallOptions): Promise<NimiAIConfigSnapshot>;
  overwrite(
    input: NimiAIConfigOverwriteInput,
    options?: RuntimeTypedCallOptions,
  ): Promise<NimiAIConfigOverwriteResult>;
  listOptions(
    query: NimiAIConfigOptionsQuery,
    options?: RuntimeTypedCallOptions,
  ): Promise<NimiAIConfigOptionsResult>;
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
      return Object.freeze({
        config: response.config ? requireAppConfig(response.config, appId, 'GetAppAIConfig') : null,
        revision: requireRevision(response.revision),
        effectiveSelections: Object.freeze(response.effectiveSelections.map(projectEffectiveSelection)),
      });
    },
    async overwrite(
      input: NimiAIConfigOverwriteInput,
      callOptions?: RuntimeTypedCallOptions,
    ) {
      if (!Array.isArray(input?.capabilities)) {
        return invalidConfiguration('App AIConfig capabilities must be an array');
      }
      const response = await client.overwriteAppAIConfig(
        {
          config: {
            owner,
            capabilities: [...input.capabilities],
          },
          expectedRevision: requireRevision(input.expectedRevision),
        },
        withNimiRuntimeIdempotencyMetadata(
          callOptions ?? {},
          createNimiClientId('app-ai-config'),
        ),
      );
      const revision = requireRevision(response.revision);
      const config = response.config
        ? requireAppConfig(response.config, appId, 'OverwriteAppAIConfig')
        : null;
      if (response.committed) {
        if (!config || response.reasonCode !== RuntimeReasonCode.REASON_CODE_UNSPECIFIED) {
          return invalidConfiguration('OverwriteAppAIConfig returned an invalid commit result');
        }
        return Object.freeze({ outcome: 'committed' as const, config, revision });
      }
      if (response.reasonCode !== RuntimeReasonCode.AI_CONFIG_REVISION_CONFLICT) {
        return invalidConfiguration('OverwriteAppAIConfig returned an invalid conflict result');
      }
      return Object.freeze({
        outcome: 'conflict' as const,
        config,
        revision,
        reasonCode: 'AI_CONFIG_REVISION_CONFLICT' as const,
      });
    },
    async listOptions(query: NimiAIConfigOptionsQuery, callOptions?: RuntimeTypedCallOptions) {
      if (query?.kind !== 'local-loadouts') {
        return invalidConfiguration('App AIConfig options query is invalid');
      }
      const capabilityContract = requireText(query.capabilityContract, 'App AIConfig options require capabilityContract');
      const search = query.search === undefined ? '' : String(query.search);
      if (search.trim() !== search) return invalidConfiguration('App AIConfig options search is invalid');
      const response = await client.listAppAIConfigOptions({
        query: {
          oneofKind: 'localLoadouts',
          localLoadouts: { capabilityContract, search },
        },
        owner,
      }, callOptions);
      if (response.result.oneofKind !== 'localLoadouts') {
        return invalidConfiguration('ListAppAIConfigOptions returned a mismatched result');
      }
      return Object.freeze({
        kind: 'local-loadouts' as const,
        options: Object.freeze(response.result.localLoadouts.options.map(projectLocalResource)),
        truncated: response.truncated,
      });
    },
  });
}

function projectEffectiveSelection(value: GetAppAIConfigResponse['effectiveSelections'][number]): NimiAIConfigEffectiveSelection {
  const state = projectEffectiveState(value.state);
  const resource = value.resource.oneofKind === 'local'
    ? { oneofKind: 'local' as const, local: projectLocalResource(value.resource.local) }
    : null;
  return Object.freeze({
    capabilityContract: requireText(value.capabilityContract, 'AIConfig effective capability is invalid'),
    state,
    resource,
    reasons: Object.freeze([...value.reasons]),
  });
}

function projectLocalResource(value: AIConfigLocalResourceProjection): NimiAIConfigLocalLoadoutOption {
  if (!value.implementation) return invalidConfiguration('AIConfig Local option implementation is missing');
  return Object.freeze({
    loadoutRef: requireText(value.loadoutRef, 'AIConfig Local option loadoutRef is invalid'),
    label: requireText(value.label, 'AIConfig Local option label is invalid'),
    capabilityContract: requireText(value.capabilityContract, 'AIConfig Local option capability is invalid'),
    implementation: Object.freeze({
      implementationId: requireText(value.implementation.implementationId, 'AIConfig Local option implementation is invalid'),
      driverId: requireText(value.implementation.driverId, 'AIConfig Local option driver is invalid'),
      driverDialect: requireText(value.implementation.driverDialect, 'AIConfig Local option dialect is invalid'),
    }),
    supportedFeatures: Object.freeze([...value.supportedFeatures]),
    state: value.state === AIConfigEffectiveState.AI_CONFIG_EFFECTIVE_STATE_READY ? 'ready' : 'blocked',
    reasons: Object.freeze([...value.reasons]),
  });
}

function projectEffectiveState(value: AIConfigEffectiveState): NimiAIConfigEffectiveState {
  switch (value) {
    case AIConfigEffectiveState.AI_CONFIG_EFFECTIVE_STATE_READY: return 'ready';
    case AIConfigEffectiveState.AI_CONFIG_EFFECTIVE_STATE_MISSING: return 'missing';
    case AIConfigEffectiveState.AI_CONFIG_EFFECTIVE_STATE_BLOCKED: return 'blocked';
    case AIConfigEffectiveState.AI_CONFIG_EFFECTIVE_STATE_UNAVAILABLE: return 'unavailable';
    default: return invalidConfiguration('AIConfig effective state is invalid');
  }
}

function requireRevision(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/u.test(value)) {
    return invalidConfiguration('App AIConfig revision is invalid');
  }
  return value;
}

function requireAppConfig(
  config: AIConfig | undefined,
  expectedAppId: string,
  operation: string,
): NimiPortableAppAIConfig {
  if (!config) {
    return invalidConfiguration(`${operation} did not return App AIConfig`);
  }
  const owner = config.owner?.owner;
  if (owner?.oneofKind !== 'app' || owner.app.appId !== expectedAppId) {
    return invalidConfiguration(`${operation} returned a mismatched App AIConfig owner`);
  }
  return config as NimiPortableAppAIConfig;
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
