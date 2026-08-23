import type {
  AIConfig,
  AIConfigCapabilityIntent,
  AIConfigCloudIntent,
  AIConfigCloudConnectorProjection,
  AIConfigCloudTargetProjection,
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
import { Struct as RuntimeStruct } from '../../core-generated/runtime-protobuf/google/protobuf/struct';
import { AIConfigEffectiveState } from '../../core-generated/runtime-protobuf/runtime/v1/capability_configuration';
import { ReasonCode as RuntimeReasonCode } from '../../core-generated/runtime-protobuf/runtime/v1/common';
import type { RuntimeTypedCallOptions } from '../../core-generated/runtime-typed-client';
import { withNimiRuntimeIdempotencyMetadata } from '../../runtime/scenario-jobs';
import { createNimiClientId, createNimiError, ReasonCode } from '../../types';
import type { NimiJsonObject } from '../contracts/index.js';
import { assertRouteOnlyLocalAIConfigIntents } from './capability-configuration-local-intent.js';

export type NimiCapabilityAIConfig = AIConfig;
export type NimiCapabilityAIConfigIntent = AIConfigCapabilityIntent;

export type NimiPortableAppAIConfigIntent = AIConfigCapabilityIntent;

export type NimiPortableAppAIConfig = AIConfig;

export type NimiSharedLocalAgentCapabilityParticipation = {
  readonly role:
    | 'conversation.primary'
    | 'memory.embedding'
    | 'conversation.input.voice'
    | 'conversation.output.voice'
    | 'conversation.action.image';
  readonly capabilityContract:
    | 'text.generate'
    | 'text.embed'
    | 'audio.transcribe'
    | 'audio.synthesize'
    | 'image.generate';
};

export type NimiAIConfigSnapshot = {
  readonly config: NimiPortableAppAIConfig | null;
  readonly revision: string;
  readonly effectiveSelections: readonly NimiAIConfigEffectiveSelection[];
};

export type NimiSharedLocalAgentAIConfigSnapshot = NimiAIConfigSnapshot & {
  readonly participation: readonly NimiSharedLocalAgentCapabilityParticipation[];
};

export type NimiAIConfigEffectiveState = 'ready' | 'missing' | 'blocked' | 'unavailable';

export type NimiAIConfigEffectiveSelection = {
  readonly capabilityContract: string;
  readonly state: NimiAIConfigEffectiveState;
  readonly resource:
    | { readonly oneofKind: 'local'; readonly local: NimiAIConfigLocalLoadoutOption }
    | { readonly oneofKind: 'cloud'; readonly cloud: NimiAIConfigCloudResource }
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

export type NimiSharedLocalAgentAIConfigOverwriteResult =
  | (Extract<NimiAIConfigOverwriteResult, { outcome: 'committed' }> & {
      readonly participation: readonly NimiSharedLocalAgentCapabilityParticipation[];
    })
  | (Extract<NimiAIConfigOverwriteResult, { outcome: 'conflict' }> & {
      readonly participation: readonly NimiSharedLocalAgentCapabilityParticipation[];
    });

export type NimiAIConfigOptionsQuery =
  | { readonly kind: 'local-loadouts'; readonly capabilityContract: string; readonly search?: string }
  | { readonly kind: 'cloud-connectors'; readonly capabilityContract: string; readonly search?: string }
  | { readonly kind: 'cloud-targets'; readonly capabilityContract: string; readonly connectorRef: string; readonly search?: string };

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

export type NimiAIConfigCloudConnectorOption = {
  readonly connectorRef: string;
  readonly label: string;
  readonly provider: string;
  readonly state: 'ready' | 'blocked';
  readonly reasons: readonly string[];
};

export type NimiAIConfigCloudTargetOption = {
  readonly connectorRef: string;
  readonly label: string;
  readonly capabilityContract: string;
  readonly implementation: {
    readonly implementationId: string;
    readonly driverId: string;
    readonly driverDialect: string;
  };
  readonly providerModelTarget: NimiJsonObject;
  readonly supportedFeatures: readonly string[];
  readonly state: 'ready' | 'blocked';
  readonly reasons: readonly string[];
};

export type NimiAIConfigCloudResource = {
  readonly connector: NimiAIConfigCloudConnectorOption;
  readonly target: NimiAIConfigCloudTargetOption;
};

export type NimiAIConfigOptionsResult =
  | { readonly kind: 'local-loadouts'; readonly options: readonly NimiAIConfigLocalLoadoutOption[]; readonly truncated: boolean }
  | { readonly kind: 'cloud-connectors'; readonly options: readonly NimiAIConfigCloudConnectorOption[]; readonly truncated: boolean }
  | { readonly kind: 'cloud-targets'; readonly options: readonly NimiAIConfigCloudTargetOption[]; readonly truncated: boolean };

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
      assertRouteOnlyLocalAIConfigIntents(input.capabilities, invalidConfiguration);
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
      if (!query || !['local-loadouts', 'cloud-connectors', 'cloud-targets'].includes(query.kind)) {
        return invalidConfiguration('App AIConfig options query is invalid');
      }
      const capabilityContract = requireText(query.capabilityContract, 'App AIConfig options require capabilityContract');
      const search = query.search === undefined ? '' : String(query.search);
      if (search.trim() !== search) return invalidConfiguration('App AIConfig options search is invalid');
      const wireQuery: ListAppAIConfigOptionsRequest['query'] = query.kind === 'local-loadouts'
        ? { oneofKind: 'localLoadouts', localLoadouts: { capabilityContract, search } }
        : query.kind === 'cloud-connectors'
          ? { oneofKind: 'cloudConnectors', cloudConnectors: { capabilityContract, search } }
          : {
              oneofKind: 'cloudTargets',
              cloudTargets: {
                capabilityContract,
                connectorRef: requireText(query.connectorRef, 'App AIConfig Cloud targets require connectorRef'),
                search,
              },
            };
      const response = await client.listAppAIConfigOptions({
        query: wireQuery,
        owner,
      }, callOptions);
	  if (query.kind === 'local-loadouts' && response.result.oneofKind === 'localLoadouts') {
	    return Object.freeze({
	      kind: 'local-loadouts' as const,
	      options: Object.freeze(response.result.localLoadouts.options.map(projectLocalResource)),
	      truncated: response.truncated,
	    });
	  }
	  if (query.kind === 'cloud-connectors' && response.result.oneofKind === 'cloudConnectors') {
	    return Object.freeze({
	      kind: 'cloud-connectors' as const,
	      options: Object.freeze(response.result.cloudConnectors.options.map(projectCloudConnectorResource)),
	      truncated: response.truncated,
	    });
	  }
	  if (query.kind === 'cloud-targets' && response.result.oneofKind === 'cloudTargets') {
	    return Object.freeze({
	      kind: 'cloud-targets' as const,
	      options: Object.freeze(response.result.cloudTargets.options.map(projectCloudTargetResource)),
	      truncated: response.truncated,
	    });
      }
	  return invalidConfiguration('ListAppAIConfigOptions returned a mismatched result');
    },
  });
}

function projectEffectiveSelection(value: GetAppAIConfigResponse['effectiveSelections'][number]): NimiAIConfigEffectiveSelection {
  const state = projectEffectiveState(value.state);
  const resource = value.resource.oneofKind === 'local'
    ? { oneofKind: 'local' as const, local: projectLocalResource(value.resource.local) }
    : value.resource.oneofKind === 'cloud'
      ? {
          oneofKind: 'cloud' as const,
          cloud: Object.freeze({
            connector: projectCloudConnectorResource(value.resource.cloud.connector!),
            target: projectCloudTargetResource(value.resource.cloud.target!),
          }),
        }
    : null;
  return Object.freeze({
    capabilityContract: requireText(value.capabilityContract, 'AIConfig effective capability is invalid'),
    state,
    resource,
    reasons: Object.freeze([...value.reasons]),
  });
}

function projectCloudConnectorResource(value: AIConfigCloudConnectorProjection): NimiAIConfigCloudConnectorOption {
  return Object.freeze({
    connectorRef: requireText(value.connectorRef, 'AIConfig Cloud connectorRef is invalid'),
    label: requireText(value.label, 'AIConfig Cloud Connector label is invalid'),
    provider: requireText(value.provider, 'AIConfig Cloud Connector provider is invalid'),
    state: value.state === AIConfigEffectiveState.AI_CONFIG_EFFECTIVE_STATE_READY ? 'ready' : 'blocked',
    reasons: Object.freeze([...value.reasons]),
  });
}

function projectCloudTargetResource(value: AIConfigCloudTargetProjection): NimiAIConfigCloudTargetOption {
  if (!value.implementation || !value.providerModelTarget) {
    return invalidConfiguration('AIConfig Cloud target identity is missing');
  }
  return Object.freeze({
    connectorRef: requireText(value.connectorRef, 'AIConfig Cloud target connectorRef is invalid'),
    label: requireText(value.label, 'AIConfig Cloud target label is invalid'),
    capabilityContract: requireText(value.capabilityContract, 'AIConfig Cloud target capability is invalid'),
    implementation: Object.freeze({
      implementationId: requireText(value.implementation.implementationId, 'AIConfig Cloud target implementation is invalid'),
      driverId: requireText(value.implementation.driverId, 'AIConfig Cloud target driver is invalid'),
      driverDialect: requireText(value.implementation.driverDialect, 'AIConfig Cloud target dialect is invalid'),
    }),
    providerModelTarget: RuntimeStruct.toJson(value.providerModelTarget) as NimiJsonObject,
    supportedFeatures: Object.freeze([...value.supportedFeatures]),
    state: value.state === AIConfigEffectiveState.AI_CONFIG_EFFECTIVE_STATE_READY ? 'ready' : 'blocked',
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
