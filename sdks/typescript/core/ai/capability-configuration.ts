import { projectSpeechInputCapabilities, type NimiSpeechInputCapabilities } from './speech-input.js';
import { projectReasoningInputCapabilities } from './reasoning.js';
import { SpeechInputCapabilities } from '../../core-generated/runtime-protobuf/runtime/v1/capability_configuration';
import type { NimiMusicInputCapabilities } from './music-input.js';
import { projectRuntimeMusicInput } from './music-input-wire.js';
import { projectVoiceReferenceInput, type NimiVoiceReferenceInputCapabilities } from './voice-reference-input.js';
import type {
  AIConfig,
  AIConfigCapabilityIntent,
  AIConfigCloudIntent,
  AIConfigCloudConnectorProjection,
  AIConfigCloudTargetProjection,
  AIConfigLocalResourceProjection,
  AIConfigLocalIntent,
  AIConfigOwner,
  AppAIConfigPresetVoiceOption,
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
import {
  projectNimiTextBehaviorCapabilities,
  type NimiTextBehaviorCapabilityProjection,
} from '../../runtime/text-behavior-projections';
import { createNimiClientId, createNimiError, ReasonCode } from '../../types';
import type { NimiJsonObject } from '../contracts/index.js';
import { assertRouteOnlyLocalAIConfigIntents } from './capability-configuration-local-intent.js';

const APP_PRESET_VOICE_OPTIONS_LIMIT = 100;
const APP_PRESET_VOICE_ID_MAX_SCALARS = 128;
const APP_PRESET_VOICE_NAME_MAX_SCALARS = 256;
const APP_PRESET_VOICE_LANG_MAX_SCALARS = 64;
const APP_PRESET_VOICE_LANGS_LIMIT = 32;

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
    | 'conversation.realtime'
    | 'conversation.action.image';
  readonly capabilityContract:
    | 'text.generate'
    | 'text.embed'
    | 'audio.transcribe'
    | 'audio.synthesize'
    | 'realtime.interact'
    | 'image.generate';
};

export type NimiAIConfigRecord = Readonly<{ configRef: string; name: string; revision: string; isDefault: boolean }>;
export type NimiAIConfigQuery = Readonly<{ configRef?: string; includeRecords?: boolean }>;
export type NimiAIConfigRecordEdit = Readonly<
  | { configRef: string; action: 'save' }
  | { action: 'create'; name: string }
  | { configRef: string; action: 'rename'; name: string }
  | { configRef: string; action: 'make-default' | 'delete' }
>;

export function validateAIConfigRecord(value: unknown): NimiAIConfigRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidConfiguration('Invalid AIConfig record.');
  const r = value as Record<string, unknown>;
  if (Object.keys(r).sort().join('|') !== 'configRef|isDefault|name|revision' || typeof r.configRef !== 'string'
    || !/^(main|[a-f0-9]{32})$/.test(r.configRef) || typeof r.name !== 'string' || !r.name.trim()
    || typeof r.revision !== 'string' || !/^[1-9][0-9]*$/.test(r.revision) || typeof r.isDefault !== 'boolean') {
    return invalidConfiguration('Invalid AIConfig record.');
  }
  return Object.freeze({ configRef: r.configRef, isDefault: r.isDefault, name: r.name, revision: r.revision });
}

export function validateAIConfigEdit(value: unknown): NimiAIConfigRecordEdit {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidConfiguration('Invalid AIConfig edit.');
  const r = value as Record<string, unknown>;
  if (r.action === 'create' || r.action === 'rename') {
    if (typeof r.name !== 'string' || !r.name.trim() || r.name !== r.name.trim() || [...r.name].length > 128) return invalidConfiguration('Invalid AIConfig name.');
  } else if (r.action !== 'save' && r.action !== 'make-default' && r.action !== 'delete') return invalidConfiguration('Invalid AIConfig action.');
  if (r.action !== 'create' && (typeof r.configRef !== 'string' || !/^(main|[a-f0-9]{32})$/.test(r.configRef))) return invalidConfiguration('Invalid AIConfig reference.');
  const keys = r.action === 'create' ? 'action|name' : r.action === 'rename' ? 'action|configRef|name' : 'action|configRef';
  if (Object.keys(r).sort().join('|') !== keys) return invalidConfiguration('Invalid AIConfig edit fields.');
  return value as NimiAIConfigRecordEdit;
}
function encodeAppRecord(edit: NimiAIConfigRecordEdit): NonNullable<OverwriteAppAIConfigRequest['record']> {
  switch (edit.action) {
    case 'create': return { configRef:'', change:{oneofKind:'createName',createName:edit.name} };
    case 'rename': return { configRef:edit.configRef,change:{oneofKind:'renameTo',renameTo:edit.name} };
    case 'make-default': return {configRef:edit.configRef,change:{oneofKind:'makeDefault',makeDefault:true}};
    case 'delete': return {configRef:edit.configRef,change:{oneofKind:'deleteRecord',deleteRecord:true}};
    default: return {configRef:edit.configRef,change:{oneofKind:undefined}};
  }
}

export type NimiAIConfigSnapshot = {
  readonly record?: NimiAIConfigRecord;
  readonly records?: readonly NimiAIConfigRecord[];
  readonly config: NimiPortableAppAIConfig | null;
  readonly revision: string;
  readonly effectiveSelections: readonly NimiAIConfigEffectiveSelection[];
};

export type NimiSharedLocalAgentAIConfigSnapshot = NimiAIConfigSnapshot & {
  readonly participation: readonly NimiSharedLocalAgentCapabilityParticipation[];
};

export type NimiAIConfigEffectiveState = 'ready' | 'missing' | 'blocked' | 'unavailable';

export type NimiAIConfigEffectiveSelection = {
  readonly localLoadoutRevision?: string;
  readonly contextWindowTokens?: number;
  readonly requestCapacityFloorTokens?: number;
  readonly reasoningInput?: import('./reasoning').NimiReasoningInputCapabilities;
  readonly textReplay?: NimiTextReplayCompatibility;
  readonly capabilityContract: string;
  readonly state: NimiAIConfigEffectiveState;
  readonly resource:
    | { readonly oneofKind: 'local'; readonly local: NimiAIConfigLocalLoadoutOption }
    | { readonly oneofKind: 'cloud'; readonly cloud: NimiAIConfigCloudResource }
    | null;
  readonly reasons: readonly string[];
};

export type NimiTextReplayCompatibility = {
  readonly acceptedCarriers: readonly {
    readonly kind: string;
    readonly version: number;
    readonly executionModes: readonly ('sync' | 'stream')[];
  }[];
};

export type NimiAIConfigOverwriteInput = {
  readonly record?: NimiAIConfigRecordEdit;
  readonly expectedRevision: string;
  readonly capabilities: readonly NimiPortableAppAIConfigIntent[];
};

export type NimiAIConfigOverwriteResult =
  | { readonly outcome: 'committed'; readonly record?: NimiAIConfigRecord; readonly config: NimiPortableAppAIConfig; readonly revision: string }
  | {
      readonly outcome: 'conflict';
      readonly record?: NimiAIConfigRecord;
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
  | { readonly kind: 'cloud-targets'; readonly capabilityContract: string; readonly connectorRef: string; readonly search?: string }
  | { readonly kind: 'preset-voices' };

export type NimiSharedLocalAgentAIConfigOptionsQuery =
  | NimiAIConfigOptionsQuery
  | { readonly kind: 'preset-voices' }
  | { readonly kind: 'voice-assets' };

export type NimiAIConfigLocalLoadoutOption = {
  readonly referenceAudioInput?: NimiVoiceReferenceInputCapabilities;
  readonly musicInput?: NimiMusicInputCapabilities;
  readonly speechInput?: NimiSpeechInputCapabilities;
  readonly loadoutRef: string;
  readonly label: string;
  readonly capabilityContract: string;
  readonly implementation: {
    readonly implementationId: string;
    readonly driverId: string;
    readonly driverDialect: string;
  };
  readonly implementationSupportedFeatures: readonly string[];
  readonly configuredFeatures: readonly string[];
  readonly textBehaviors: readonly NimiTextBehaviorCapabilityProjection[];
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
  readonly referenceAudioInput?: NimiVoiceReferenceInputCapabilities;
  readonly musicInput?: NimiMusicInputCapabilities;
  readonly speechInput?: NimiSpeechInputCapabilities;
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

export type NimiSharedLocalAgentPresetVoiceOption = {
  readonly voiceId: string;
  readonly name: string;
  readonly supportedLangs: readonly string[];
};

export type NimiAppAIConfigPresetVoiceOption = {
  readonly voiceId: string;
  readonly name: string;
  readonly supportedLangs: readonly string[];
};

export type NimiSharedLocalAgentVoiceAssetOption = {
  readonly voiceAssetId: string;
};

export type NimiAIConfigCloudResource = {
  readonly connector: NimiAIConfigCloudConnectorOption;
  readonly target: NimiAIConfigCloudTargetOption;
};

export type NimiAIConfigOptionsResult =
  | { readonly kind: 'local-loadouts'; readonly options: readonly NimiAIConfigLocalLoadoutOption[]; readonly truncated: boolean }
  | { readonly kind: 'cloud-connectors'; readonly options: readonly NimiAIConfigCloudConnectorOption[]; readonly truncated: boolean }
  | { readonly kind: 'cloud-targets'; readonly options: readonly NimiAIConfigCloudTargetOption[]; readonly truncated: boolean }
  | { readonly kind: 'preset-voices'; readonly options: readonly NimiAppAIConfigPresetVoiceOption[]; readonly truncated: boolean };

export type NimiSharedLocalAgentAIConfigOptionsResult =
  | NimiAIConfigOptionsResult
  | {
      readonly kind: 'preset-voices';
      readonly options: readonly NimiSharedLocalAgentPresetVoiceOption[];
      readonly truncated: boolean;
    }
  | {
      readonly kind: 'voice-assets';
      readonly options: readonly NimiSharedLocalAgentVoiceAssetOption[];
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
  get(options?: RuntimeTypedCallOptions & NimiAIConfigQuery): Promise<NimiAIConfigSnapshot>;
  overwrite(
    input: NimiAIConfigOverwriteInput,
    options?: RuntimeTypedCallOptions,
  ): Promise<NimiAIConfigOverwriteResult>;
  listOptions(
    query: NimiAIConfigOptionsQuery,
    options?: RuntimeTypedCallOptions,
  ): Promise<NimiAIConfigOptionsResult>;
}

export type NimiLocalAppAIConfigRuntimeClient = Pick<
  NimiAppAIConfigClient,
  'get' | 'overwrite' | 'listOptions'
>;

export function createNimiAppAIConfigOwner(appId: string): AIConfigOwner {
  return {
    owner: {
      oneofKind: 'app',
      app: { appId: requireText(appId, 'App AIConfig owner requires appId') },
    },
  };
}

// @nimi-authority: rule.nimi.sdks.feature-clients.r009
// @nimi-authority: rule.nimi.sdks.feature-clients.r014
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
	const operations = createAppAIConfigOperations(options.runtime, appId, owner);
	return Object.freeze({ appId, owner, ...operations });
}

/**
 * Runtime adapter for one already-admitted formal App session. appId validates
 * the returned owner projection only; no owner selector is sent to Runtime.
 */
// @nimi-authority: rule.nimi.sdks.feature-clients.r014
export function createNimiLocalAppAIConfigRuntimeClient(options: {
  readonly appId: string;
  readonly runtime: { readonly ai: NimiAppAIConfigRpcClient } | NimiAppAIConfigRpcClient;
}): NimiLocalAppAIConfigRuntimeClient {
	const appId = requireText(options.appId, 'Local App AIConfig projection requires appId');
	return createAppAIConfigOperations(options.runtime, appId);
}

function createAppAIConfigOperations(
	runtime: { readonly ai: NimiAppAIConfigRpcClient } | NimiAppAIConfigRpcClient,
	appId: string,
	owner?: AIConfigOwner,
): NimiLocalAppAIConfigRuntimeClient {
  const client = 'ai' in runtime ? runtime.ai : runtime;
  return Object.freeze({
    async get(options?: RuntimeTypedCallOptions & NimiAIConfigQuery) {
      const { configRef, includeRecords, ...callOptions } = options ?? {};
      const response = await client.getAppAIConfig({ ...(owner ? { owner } : {}), ...(configRef === undefined ? {} : {configRef}), ...(includeRecords===undefined?{}:{includeRecords}) }, options ? callOptions : undefined);
      return Object.freeze({
        config: response.config ? requireAppConfig(response.config, appId, 'GetAppAIConfig') : null,
        revision: requireRevision(response.revision),
        effectiveSelections: Object.freeze(response.effectiveSelections.map(projectEffectiveSelection)),
        ...(response.record ? {record: validateAIConfigRecord(response.record)} : {}),
        ...(response.directory ? {records:Object.freeze(response.directory.records.map(validateAIConfigRecord))} : {}),
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
			...(owner ? { owner } : {}),
            capabilities: [...input.capabilities],
          },
          expectedRevision: requireRevision(input.expectedRevision),
          ...(input.record ? {record:encodeAppRecord(validateAIConfigEdit(input.record))} : {}),
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
        return Object.freeze({ outcome: 'committed' as const, config, revision, ...(response.record ? {record:validateAIConfigRecord(response.record)} : {}) });
      }
      if (response.reasonCode !== RuntimeReasonCode.AI_CONFIG_REVISION_CONFLICT) {
        return invalidConfiguration('OverwriteAppAIConfig returned an invalid conflict result');
      }
      return Object.freeze({
        outcome: 'conflict' as const,
        config,
        revision,
        reasonCode: 'AI_CONFIG_REVISION_CONFLICT' as const,
        ...(response.record ? { record: validateAIConfigRecord(response.record) } : {}),
      });
    },
    async listOptions(query: NimiAIConfigOptionsQuery, callOptions?: RuntimeTypedCallOptions) {
      if (!query || !['local-loadouts', 'cloud-connectors', 'cloud-targets', 'preset-voices'].includes(query.kind)) {
        return invalidConfiguration('App AIConfig options query is invalid');
      }
      let wireQuery: ListAppAIConfigOptionsRequest['query'];
      if (query.kind === 'preset-voices') {
        wireQuery = { oneofKind: 'presetVoices', presetVoices: {} };
      } else {
        const capabilityContract = requireText(query.capabilityContract, 'App AIConfig options require capabilityContract');
        const search = query.search === undefined ? '' : String(query.search);
        if (search.trim() !== search) return invalidConfiguration('App AIConfig options search is invalid');
        wireQuery = query.kind === 'local-loadouts'
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
      }
      const response = await client.listAppAIConfigOptions({
        query: wireQuery,
		...(owner ? { owner } : {}),
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
	  if (query.kind === 'preset-voices' && response.result.oneofKind === 'presetVoices') {
	    if (response.result.presetVoices.options.length > APP_PRESET_VOICE_OPTIONS_LIMIT) {
	      return invalidConfiguration('App AIConfig preset voice options exceed the row bound');
	    }
	    return Object.freeze({
	      kind: 'preset-voices' as const,
	      options: Object.freeze(response.result.presetVoices.options.map(projectAppPresetVoiceResource)),
	      truncated: response.truncated,
	    });
	  }
	  return invalidConfiguration('ListAppAIConfigOptions returned a mismatched result');
    },
  });
}

function projectEffectiveSelection(value: GetAppAIConfigResponse['effectiveSelections'][number]): NimiAIConfigEffectiveSelection {
  const state = projectEffectiveState(value.state);
  const tokenCount = (raw: string | undefined, route: 'local' | 'cloud') => {
    if (raw === undefined) return undefined;
    const count = Number(raw);
    if (!Number.isSafeInteger(count) || count <= 0 || value.resource.oneofKind !== route || value.capabilityContract !== 'text.generate' || state !== 'ready') return invalidConfiguration('Text context capacity is invalid');
    return count;
  };
  const capacity = tokenCount(value.contextWindowTokens, 'local');
  const floor = tokenCount(value.requestCapacityFloorTokens, 'cloud');
  if (value.reasoningInput && (value.capabilityContract !== 'text.generate' || state !== 'ready')) return invalidConfiguration('Reasoning input selection is invalid');
  if (value.textReplay && (value.capabilityContract !== 'text.generate' || state !== 'ready' || value.textReplay.acceptedCarriers.length > 16)) return invalidConfiguration('Text replay selection is invalid');
  const replayIdentities = new Set<string>();
  for (const format of value.textReplay?.acceptedCarriers ?? []) {
    const identity = JSON.stringify([format.kind, format.version]);
    if (!format.kind || format.kind.trim() !== format.kind || new TextEncoder().encode(format.kind).byteLength > 128 || /[\u0000-\u001f\u007f]/u.test(format.kind)
      || !Number.isSafeInteger(format.version) || format.version < 1 || format.version > 0xffff_ffff || replayIdentities.has(identity)
      || !format.executionModes.length || format.executionModes.length > 2 || new Set(format.executionModes).size !== format.executionModes.length
      || !format.executionModes.every((mode) => mode === 1 || mode === 2)) return invalidConfiguration('Text replay carrier format is invalid');
    replayIdentities.add(identity);
  }
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
    ...(value.localLoadoutRevision ? {localLoadoutRevision:value.localLoadoutRevision} : {}),
    ...(capacity === undefined ? {} : { contextWindowTokens: capacity }),
    ...(floor === undefined ? {} : { requestCapacityFloorTokens: floor }),
    ...(value.reasoningInput ? { reasoningInput: projectReasoningInputCapabilities(value.reasoningInput, invalidConfiguration) } : {}),
    ...(value.textReplay ? { textReplay: {
      acceptedCarriers: value.textReplay.acceptedCarriers.map((format) => ({
        kind: requireText(format.kind, 'Text replay carrier kind is invalid'),
        version: format.version,
        executionModes: format.executionModes.map((mode): 'sync' | 'stream' => {
          if (mode === 1) return 'sync';
          if (mode === 2) return 'stream';
          return invalidConfiguration('Text replay execution mode is invalid');
        }),
      })),
    } } : {}),
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
    ...(value.musicInput ? { musicInput: projectRuntimeMusicInput(value.musicInput) } : {}),
    ...(value.speechInput ? { speechInput: projectSpeechInputCapabilities(SpeechInputCapabilities.toJson(value.speechInput,{emitDefaultValues:true})) } : {}),
    ...(value.referenceAudioInput ? { referenceAudioInput: projectVoiceReferenceInput(value.referenceAudioInput) } : {}),
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
    implementationSupportedFeatures: Object.freeze([...value.implementationSupportedFeatures]),
    configuredFeatures: Object.freeze([...value.configuredFeatures]),
    textBehaviors: projectNimiTextBehaviorCapabilities(value.textBehaviors),
    ...(value.musicInput ? { musicInput: projectRuntimeMusicInput(value.musicInput) } : {}),
    ...(value.speechInput ? { speechInput: projectSpeechInputCapabilities(SpeechInputCapabilities.toJson(value.speechInput,{emitDefaultValues:true})) } : {}),
    ...(value.referenceAudioInput ? { referenceAudioInput: projectVoiceReferenceInput(value.referenceAudioInput) } : {}),
    state: value.state === AIConfigEffectiveState.AI_CONFIG_EFFECTIVE_STATE_READY ? 'ready' : 'blocked',
    reasons: Object.freeze([...value.reasons]),
  });
}

function projectAppPresetVoiceResource(value: AppAIConfigPresetVoiceOption): NimiAppAIConfigPresetVoiceOption {
  if (value.supportedLangs.length > APP_PRESET_VOICE_LANGS_LIMIT) {
    return invalidConfiguration('App AIConfig preset voice languages exceed the row bound');
  }
  return Object.freeze({
    voiceId: requireAppPresetVoiceText(value.voiceId, 'voiceId', APP_PRESET_VOICE_ID_MAX_SCALARS),
    name: requireAppPresetVoiceText(value.name, 'name', APP_PRESET_VOICE_NAME_MAX_SCALARS),
    supportedLangs: Object.freeze(value.supportedLangs.map((lang) => (
      requireAppPresetVoiceText(lang, 'supportedLangs', APP_PRESET_VOICE_LANG_MAX_SCALARS)
    ))),
  });
}

function requireAppPresetVoiceText(value: unknown, field: string, maxScalars: number): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0 || Array.from(value).length > maxScalars
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    return invalidConfiguration(`App AIConfig preset voice ${field} is invalid`);
  }
  return value;
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
