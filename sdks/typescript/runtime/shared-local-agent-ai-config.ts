import type { AgentRequestContext } from '../core-generated/runtime-protobuf/runtime/v1/agent_common';
import type {
  AIConfig,
  AIConfigCapabilityIntent,
  AIConfigCloudConnectorProjection,
  AIConfigCloudTargetProjection,
  AIConfigEffectiveSelection,
  AIConfigLocalResourceProjection,
} from '../core-generated/runtime-protobuf/runtime/v1/capability_configuration';
import { AIConfigEffectiveState } from '../core-generated/runtime-protobuf/runtime/v1/capability_configuration';
import { Struct as RuntimeStruct } from '../core-generated/runtime-protobuf/google/protobuf/struct';
import type {
  NimiAIConfigEffectiveSelection,
  NimiAIConfigCloudConnectorOption,
  NimiAIConfigCloudTargetOption,
  NimiAIConfigLocalLoadoutOption,
  NimiSharedLocalAgentAIConfigOptionsQuery,
  NimiSharedLocalAgentAIConfigOptionsResult,
  NimiSharedLocalAgentCapabilityParticipation,
  NimiSharedLocalAgentAIConfigSnapshot,
  NimiSharedLocalAgentAIConfigOverwriteResult,
} from '../core/ai/capability-configuration';
import type { LocalAgentCapabilityParticipation } from '../core-generated/runtime-protobuf/runtime/v1/agent_configure';
import { LocalAgentCapabilityParticipationRole } from '../core-generated/runtime-protobuf/runtime/v1/agent_configure';
import type {
  ApplySharedLocalAgentAIProfileRequest,
  ApplySharedLocalAgentAIProfileResponse,
  GetSharedLocalAgentAIConfigRequest,
  GetSharedLocalAgentAIConfigResponse,
  PreviewSharedLocalAgentAIProfileRequest,
  PreviewSharedLocalAgentAIProfileResponse,
  OverwriteSharedLocalAgentAIConfigRequest,
  OverwriteSharedLocalAgentAIConfigResponse,
  ListSharedLocalAgentAIConfigOptionsRequest,
  ListSharedLocalAgentAIConfigOptionsResponse,
} from '../core-generated/runtime-protobuf/runtime/v1/agent_service';
import { ReasonCode as RuntimeReasonCode } from '../core-generated/runtime-protobuf/runtime/v1/common';
import type { RuntimeTypedCallOptions } from '../core-generated/runtime-typed-client';
import {
  parseNimiPortableAIProfile,
  serializeNimiPortableAIProfile,
  type NimiPortableAIProfile,
  type NimiPortableAIProfileInput,
} from '../core/ai/config-profile';
import { assertRouteOnlyLocalAIConfigIntents } from '../core/ai/capability-configuration-local-intent.js';
import { createNimiClientId, createNimiError } from '../types';
import { withNimiRuntimeIdempotencyMetadata } from './scenario-jobs';
import {
  resolveNimiRuntimeAgentSubjectUserId,
  withNimiRuntimeAgentScopes,
  type NimiRuntimeAgentAuthClient,
  type NimiRuntimeAgentScopeRunner,
} from './runtime-agent-protected';
import { normalizeNimiRuntimeAgentText } from './runtime-agent-values';

const SHARED_LOCAL_AGENT_AI_CONFIG_READ_SCOPE = 'runtime.agent.ai_config.read';
const SHARED_LOCAL_AGENT_AI_CONFIG_WRITE_SCOPE = 'runtime.agent.ai_config.write';
const SHARED_PRESET_VOICE_OPTIONS_LIMIT = 100;
const SHARED_PRESET_VOICE_ID_MAX_SCALARS = 128;
const SHARED_PRESET_VOICE_NAME_MAX_SCALARS = 256;
const SHARED_PRESET_VOICE_LANGS_LIMIT = 32;
const SHARED_PRESET_VOICE_LANG_MAX_SCALARS = 64;

export interface NimiSharedLocalAgentAIConfigCallInput {
  readonly subjectUserId?: string;
}

export interface NimiSharedLocalAgentAIConfigOverwriteInput
  extends NimiSharedLocalAgentAIConfigCallInput {
  readonly expectedRevision: string;
  readonly capabilities: readonly AIConfigCapabilityIntent[];
}

export type NimiSharedLocalAgentAIConfigOptionsInput =
  NimiSharedLocalAgentAIConfigOptionsQuery & NimiSharedLocalAgentAIConfigCallInput;

export interface NimiSharedLocalAgentAIProfileInput
  extends NimiSharedLocalAgentAIConfigCallInput {
  readonly profile: NimiPortableAIProfileInput;
}

export interface NimiSharedLocalAgentAIProfilePreview {
  readonly source: NimiPortableAIProfile;
  readonly before: AIConfig | null;
  readonly after: AIConfig;
  readonly identical: boolean;
}

/**
 * Typed SDK projection of the singular Runtime-owned LocalAgent subsystem
 * AIConfig. No individual LocalAgent identity or machine binding can be
 * expressed through this surface; revision, effective state, and bounded
 * candidate options belong to the singular owner manager.
 */
export interface NimiSharedLocalAgentAIConfigClient {
  get(input?: NimiSharedLocalAgentAIConfigCallInput): Promise<NimiSharedLocalAgentAIConfigSnapshot>;
  overwrite(input: NimiSharedLocalAgentAIConfigOverwriteInput): Promise<NimiSharedLocalAgentAIConfigOverwriteResult>;
  listOptions(input: NimiSharedLocalAgentAIConfigOptionsInput, options?: RuntimeTypedCallOptions): Promise<NimiSharedLocalAgentAIConfigOptionsResult>;
}

export interface NimiSharedLocalAgentAIProfileClient {
  preview(input: NimiSharedLocalAgentAIProfileInput): Promise<NimiSharedLocalAgentAIProfilePreview>;
  apply(input: NimiSharedLocalAgentAIProfileInput): Promise<AIConfig>;
}

export interface NimiSharedLocalAgentAISurface {
  readonly sharedAIConfig: NimiSharedLocalAgentAIConfigClient;
  readonly sharedAIProfile: NimiSharedLocalAgentAIProfileClient;
}

export interface NimiSharedLocalAgentAIConfigAgentSurface {
  getSharedLocalAgentAIConfig?(
    request: GetSharedLocalAgentAIConfigRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<GetSharedLocalAgentAIConfigResponse>;
  overwriteSharedLocalAgentAIConfig?(
    request: OverwriteSharedLocalAgentAIConfigRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<OverwriteSharedLocalAgentAIConfigResponse>;
  listSharedLocalAgentAIConfigOptions?(
    request: ListSharedLocalAgentAIConfigOptionsRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<ListSharedLocalAgentAIConfigOptionsResponse>;
  previewSharedLocalAgentAIProfile?(
    request: PreviewSharedLocalAgentAIProfileRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<PreviewSharedLocalAgentAIProfileResponse>;
  applySharedLocalAgentAIProfile?(
    request: ApplySharedLocalAgentAIProfileRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<ApplySharedLocalAgentAIProfileResponse>;
}

export interface NimiSharedLocalAgentAIConfigRuntime {
  readonly appId: string;
  readonly auth: NimiRuntimeAgentAuthClient;
  readonly agent: NimiSharedLocalAgentAIConfigAgentSurface;
}

export interface NimiSharedLocalAgentAISurfaceOptions {
  readonly runtime: NimiSharedLocalAgentAIConfigRuntime;
  readonly getSubjectUserId: () => string | Promise<string | undefined> | undefined;
  readonly withScopes?: NimiRuntimeAgentScopeRunner;
}

// @nimi-authority: definition.nimi.sdks.feature-clients.ai-config-plane
// @nimi-authority: rule.nimi.sdks.feature-clients.r012
// @nimi-authority: rule.nimi.sdks.feature-clients.r014
export function createNimiSharedLocalAgentAISurface(
  options: NimiSharedLocalAgentAISurfaceOptions,
): NimiSharedLocalAgentAISurface {
  const runtime = options.runtime;

  const resolveSubject = async (explicit?: unknown): Promise<string> => {
    const explicitSubject = normalizeNimiRuntimeAgentText(explicit);
    if (explicitSubject) return explicitSubject;
    return resolveNimiRuntimeAgentSubjectUserId(
      options.getSubjectUserId,
      'Shared LocalAgent AIConfig requires authenticated subject user id.',
    );
  };

  const context = (subjectUserId: string): AgentRequestContext => ({
    appId: runtime.appId,
    subjectUserId,
    ownerUserId: subjectUserId,
    runtimeSourceRef: '',
    localAgentRef: '',
  });

  const scoped = async <T>(
    subjectUserId: string,
    scopes: readonly string[],
    operation: (callOptions: RuntimeTypedCallOptions) => Promise<T>,
  ): Promise<T> => withNimiRuntimeAgentScopes({
    runtime,
    subjectUserId,
    withScopes: options.withScopes,
  }, scopes, operation);

  const sharedAIConfig: NimiSharedLocalAgentAIConfigClient = Object.freeze({
    async get(input: NimiSharedLocalAgentAIConfigCallInput = {}) {
      const method = requireMethod(runtime.agent.getSharedLocalAgentAIConfig, 'getSharedLocalAgentAIConfig');
      const subjectUserId = await resolveSubject(input.subjectUserId);
      const response = await scoped(subjectUserId, [SHARED_LOCAL_AGENT_AI_CONFIG_READ_SCOPE], (callOptions) => (
        method({ context: context(subjectUserId) }, callOptions)
      ));
      const revision = requireRevision(response.revision, 'GetSharedLocalAgentAIConfig');
      return Object.freeze({
        config: response.config ? requireSharedAIConfig(response.config, 'GetSharedLocalAgentAIConfig') : null,
        revision,
        effectiveSelections: projectEffectiveSelections(response.effectiveSelections),
        participation: projectLocalAgentParticipation(response.participation),
      });
    },

    async overwrite(input: NimiSharedLocalAgentAIConfigOverwriteInput) {
      if (!Array.isArray(input.capabilities)) {
        inputError('Shared LocalAgent AIConfig capabilities must be an array');
      }
      assertRouteOnlyLocalAIConfigIntents(input.capabilities, inputError);
      requireRevision(input.expectedRevision, 'OverwriteSharedLocalAgentAIConfig');
      const method = requireMethod(runtime.agent.overwriteSharedLocalAgentAIConfig, 'overwriteSharedLocalAgentAIConfig');
      const subjectUserId = await resolveSubject(input.subjectUserId);
      const response = await scoped(subjectUserId, [SHARED_LOCAL_AGENT_AI_CONFIG_WRITE_SCOPE], (callOptions) => (
        method(
          {
            context: context(subjectUserId),
            expectedRevision: input.expectedRevision,
            capabilities: [...input.capabilities],
          },
          withNimiRuntimeIdempotencyMetadata(
            callOptions,
            createNimiClientId('shared-local-agent-ai-config-overwrite'),
          ),
        )
      ));
      const revision = requireRevision(response.revision, 'OverwriteSharedLocalAgentAIConfig');
      const config = response.config
        ? requireSharedAIConfig(response.config, 'OverwriteSharedLocalAgentAIConfig')
        : null;
      const participation = projectLocalAgentParticipation(response.participation);
      if (response.committed && response.reasonCode === RuntimeReasonCode.REASON_CODE_UNSPECIFIED && config) {
        return Object.freeze({ outcome: 'committed', config, revision, participation });
      }
      if (!response.committed && response.reasonCode === RuntimeReasonCode.AGENT_AI_CONFIG_REVISION_CONFLICT) {
        return Object.freeze({ outcome: 'conflict', config, revision, reasonCode: 'AGENT_AI_CONFIG_REVISION_CONFLICT', participation });
      }
      invalidResponse('OverwriteSharedLocalAgentAIConfig returned an invalid outcome');
    },

    async listOptions(input: NimiSharedLocalAgentAIConfigOptionsInput, options?: RuntimeTypedCallOptions) {
      assertSharedAIConfigOptionsInputKeys(input);
      if (!['local-loadouts', 'cloud-connectors', 'cloud-targets', 'preset-voices'].includes(input.kind)
        || (input.kind !== 'preset-voices' && !normalizeNimiRuntimeAgentText(input.capabilityContract))
        || (input.kind === 'cloud-targets' && !normalizeNimiRuntimeAgentText(input.connectorRef))
        || ('search' in input && input.search !== undefined && input.search.trim() !== input.search)) {
        inputError('Shared LocalAgent AIConfig options query is invalid');
      }
      const method = requireMethod(runtime.agent.listSharedLocalAgentAIConfigOptions, 'listSharedLocalAgentAIConfigOptions');
      const subjectUserId = await resolveSubject(input.subjectUserId);
      const response = await scoped(subjectUserId, [SHARED_LOCAL_AGENT_AI_CONFIG_WRITE_SCOPE], (callOptions) => (
        method({
          context: context(subjectUserId),
          query: input.kind === 'local-loadouts'
            ? { oneofKind: 'localLoadouts', localLoadouts: { capabilityContract: input.capabilityContract, search: input.search ?? '' } }
            : input.kind === 'cloud-connectors'
              ? { oneofKind: 'cloudConnectors', cloudConnectors: { capabilityContract: input.capabilityContract, search: input.search ?? '' } }
              : input.kind === 'cloud-targets'
                ? { oneofKind: 'cloudTargets', cloudTargets: { capabilityContract: input.capabilityContract, connectorRef: input.connectorRef, search: input.search ?? '' } }
                : { oneofKind: 'presetVoices', presetVoices: {} },
        }, mergeSharedAIConfigCallOptions(callOptions, options))
      ));
      if (input.kind === 'local-loadouts' && response.result.oneofKind === 'localLoadouts') {
        return Object.freeze({ kind: input.kind, options: Object.freeze(response.result.localLoadouts.options.map(projectLocalOption)), truncated: response.truncated });
      }
      if (input.kind === 'cloud-connectors' && response.result.oneofKind === 'cloudConnectors') {
        return Object.freeze({ kind: input.kind, options: Object.freeze(response.result.cloudConnectors.options.map(projectCloudConnectorOption)), truncated: response.truncated });
      }
      if (input.kind === 'cloud-targets' && response.result.oneofKind === 'cloudTargets') {
        return Object.freeze({ kind: input.kind, options: Object.freeze(response.result.cloudTargets.options.map(projectCloudTargetOption)), truncated: response.truncated });
      }
      if (input.kind === 'preset-voices' && response.result.oneofKind === 'presetVoices') {
        if (response.result.presetVoices.options.length > SHARED_PRESET_VOICE_OPTIONS_LIMIT) {
          invalidResponse('Shared LocalAgent preset voice options exceed the row bound');
        }
        return Object.freeze({
          kind: input.kind,
          options: Object.freeze(response.result.presetVoices.options.map((voice) => Object.freeze({
            voiceId: requirePresetVoiceText(voice.voiceId, 'voiceId', SHARED_PRESET_VOICE_ID_MAX_SCALARS),
            name: requirePresetVoiceText(voice.name, 'name', SHARED_PRESET_VOICE_NAME_MAX_SCALARS),
            supportedLangs: Object.freeze(voice.supportedLangs.length <= SHARED_PRESET_VOICE_LANGS_LIMIT
              ? voice.supportedLangs.map((lang) => requirePresetVoiceText(lang, 'supportedLangs', SHARED_PRESET_VOICE_LANG_MAX_SCALARS))
              : invalidResponse('Shared LocalAgent preset voice languages exceed the row bound')),
          }))),
          truncated: response.truncated,
        });
      }
      invalidResponse('ListSharedLocalAgentAIConfigOptions returned a mismatched projection');
    },
  });

  const sharedAIProfile: NimiSharedLocalAgentAIProfileClient = Object.freeze({
      async preview(input: NimiSharedLocalAgentAIProfileInput) {
        const profile = encodeProfile(input.profile);
        const method = requireMethod(
          runtime.agent.previewSharedLocalAgentAIProfile,
          'previewSharedLocalAgentAIProfile',
        );
        const subjectUserId = await resolveSubject(input.subjectUserId);
        const response = await scoped(subjectUserId, [SHARED_LOCAL_AGENT_AI_CONFIG_WRITE_SCOPE], (callOptions) => (
          method({
            context: context(subjectUserId),
            profileJson: profile.bytes,
          }, callOptions)
        ));
        const before = response.before
          ? requireSharedAIConfig(response.before, 'PreviewSharedLocalAgentAIProfile.before')
          : null;
        const after = requireSharedAIConfig(response.after, 'PreviewSharedLocalAgentAIProfile.after');
        return Object.freeze({
          source: profile.source,
          before,
          after,
          identical: before !== null && canonicalAIConfig(before) === canonicalAIConfig(after),
        });
      },

      async apply(input: NimiSharedLocalAgentAIProfileInput) {
        const profile = encodeProfile(input.profile);
        const method = requireMethod(
          runtime.agent.applySharedLocalAgentAIProfile,
          'applySharedLocalAgentAIProfile',
        );
        const subjectUserId = await resolveSubject(input.subjectUserId);
        const response = await scoped(subjectUserId, [SHARED_LOCAL_AGENT_AI_CONFIG_WRITE_SCOPE], (callOptions) => (
          method(
            {
              context: context(subjectUserId),
              profileJson: profile.bytes,
            },
            withNimiRuntimeIdempotencyMetadata(
              callOptions,
              createNimiClientId('shared-local-agent-ai-profile-apply'),
            ),
          )
        ));
        return requireSharedAIConfig(response.config, 'ApplySharedLocalAgentAIProfile');
      },
  });

  return Object.freeze({ sharedAIConfig, sharedAIProfile });
}

function projectLocalAgentParticipation(
  rows: readonly LocalAgentCapabilityParticipation[],
): readonly NimiSharedLocalAgentCapabilityParticipation[] {
  const expected = [
    [LocalAgentCapabilityParticipationRole.CONVERSATION_PRIMARY, 'conversation.primary', 'text.generate'],
    [LocalAgentCapabilityParticipationRole.MEMORY_EMBEDDING, 'memory.embedding', 'text.embed'],
    [LocalAgentCapabilityParticipationRole.CONVERSATION_INPUT_VOICE, 'conversation.input.voice', 'audio.transcribe'],
    [LocalAgentCapabilityParticipationRole.CONVERSATION_OUTPUT_VOICE, 'conversation.output.voice', 'audio.synthesize'],
    [LocalAgentCapabilityParticipationRole.CONVERSATION_REALTIME, 'conversation.realtime', 'realtime.interact'],
    [LocalAgentCapabilityParticipationRole.CONVERSATION_ACTION_IMAGE, 'conversation.action.image', 'image.generate'],
  ] as const;
  if (!Array.isArray(rows) || rows.length !== expected.length) {
    invalidResponse('Shared LocalAgent participation is invalid');
  }
  return Object.freeze(rows.map((row, index) => {
    const expectedRow = expected[index];
    if (!expectedRow || row.role !== expectedRow[0] || row.capabilityContract !== expectedRow[2]) {
      return invalidResponse('Shared LocalAgent participation row is invalid');
    }
    return Object.freeze({ role: expectedRow[1], capabilityContract: expectedRow[2] });
  }));
}

function requireSharedAIConfig(config: AIConfig | undefined, operation: string): AIConfig {
  if (config?.owner?.owner.oneofKind !== 'runtimeLocalAgentSubsystem') {
    invalidResponse(`${operation} did not return the shared LocalAgent subsystem AIConfig`);
  }
  return config;
}

function requireRevision(value: unknown, operation: string): string {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    invalidResponse(`${operation} did not return a valid owner revision`);
  }
  return value;
}

function projectEffectiveSelections(
  values: readonly AIConfigEffectiveSelection[],
): readonly NimiAIConfigEffectiveSelection[] {
  return Object.freeze(values.map((selection) => Object.freeze({
    capabilityContract: selection.capabilityContract,
    state: projectEffectiveState(selection.state),
    resource: selection.resource.oneofKind === 'local'
      ? Object.freeze({ oneofKind: 'local' as const, local: projectLocalOption(selection.resource.local) })
      : selection.resource.oneofKind === 'cloud'
        ? Object.freeze({
            oneofKind: 'cloud' as const,
            cloud: Object.freeze({
              connector: projectCloudConnectorOption(selection.resource.cloud.connector!),
              target: projectCloudTargetOption(selection.resource.cloud.target!),
            }),
          })
      : null,
    reasons: Object.freeze([...selection.reasons]),
  })));
}

function projectCloudConnectorOption(value: AIConfigCloudConnectorProjection): NimiAIConfigCloudConnectorOption {
  const state = projectEffectiveState(value.state);
  if (state !== 'ready' && state !== 'blocked') invalidResponse('Shared AIConfig Cloud Connector state is invalid');
  return Object.freeze({
    connectorRef: value.connectorRef,
    label: value.label,
    provider: value.provider,
    state,
    reasons: Object.freeze([...value.reasons]),
  });
}

function projectCloudTargetOption(value: AIConfigCloudTargetProjection): NimiAIConfigCloudTargetOption {
  if (!value.implementation || !value.providerModelTarget) invalidResponse('Shared AIConfig Cloud target identity is missing');
  const state = projectEffectiveState(value.state);
  if (state !== 'ready' && state !== 'blocked') invalidResponse('Shared AIConfig Cloud target state is invalid');
  return Object.freeze({
    connectorRef: value.connectorRef,
    label: value.label,
    capabilityContract: value.capabilityContract,
    implementation: Object.freeze({ ...value.implementation }),
    providerModelTarget: RuntimeStruct.toJson(value.providerModelTarget) as NimiAIConfigCloudTargetOption['providerModelTarget'],
    supportedFeatures: Object.freeze([...value.supportedFeatures]),
    state,
    reasons: Object.freeze([...value.reasons]),
  });
}

function projectLocalOption(value: AIConfigLocalResourceProjection): NimiAIConfigLocalLoadoutOption {
  if (!value.implementation) invalidResponse('Shared LocalAgent AIConfig Local option omitted implementation');
  const state = projectEffectiveState(value.state);
  if (state !== 'ready' && state !== 'blocked') {
    invalidResponse('Shared LocalAgent AIConfig Local option state is invalid');
  }
  return Object.freeze({
    loadoutRef: value.loadoutRef,
    label: value.label,
    capabilityContract: value.capabilityContract,
    implementation: Object.freeze({ ...value.implementation }),
    supportedFeatures: Object.freeze([...value.supportedFeatures]),
    state,
    reasons: Object.freeze([...value.reasons]),
  });
}

function projectEffectiveState(value: AIConfigEffectiveState): NimiAIConfigEffectiveSelection['state'] {
  switch (value) {
    case AIConfigEffectiveState.AI_CONFIG_EFFECTIVE_STATE_READY: return 'ready';
    case AIConfigEffectiveState.AI_CONFIG_EFFECTIVE_STATE_MISSING: return 'missing';
    case AIConfigEffectiveState.AI_CONFIG_EFFECTIVE_STATE_BLOCKED: return 'blocked';
    case AIConfigEffectiveState.AI_CONFIG_EFFECTIVE_STATE_UNAVAILABLE: return 'unavailable';
    default: invalidResponse('Shared LocalAgent AIConfig effective state is invalid');
  }
}

function encodeProfile(input: NimiPortableAIProfileInput): {
  readonly source: NimiPortableAIProfile;
  readonly bytes: Uint8Array;
} {
  const source = parseNimiPortableAIProfile(input);
  return {
    source,
    bytes: new TextEncoder().encode(serializeNimiPortableAIProfile(source)),
  };
}

function canonicalAIConfig(config: AIConfig | undefined): string {
  return JSON.stringify(config ?? null);
}

function requirePresetVoiceText(value: unknown, field: string, maxScalars: number): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0 || Array.from(value).length > maxScalars) {
    invalidResponse(`Shared LocalAgent preset voice ${field} is invalid`);
  }
  return value;
}

function assertSharedAIConfigOptionsInputKeys(input: NimiSharedLocalAgentAIConfigOptionsInput): void {
  if (!input || typeof input !== 'object') {
    inputError('Shared LocalAgent AIConfig options query is invalid');
  }
  const expected = input.kind === 'preset-voices'
    ? ['kind', 'subjectUserId']
    : input.kind === 'cloud-targets'
      ? ['kind', 'capabilityContract', 'connectorRef', 'search', 'subjectUserId']
      : ['kind', 'capabilityContract', 'search', 'subjectUserId'];
  const allowed = new Set(expected);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    inputError('Shared LocalAgent AIConfig options query contains unknown fields');
  }
}

function mergeSharedAIConfigCallOptions(
  scoped: RuntimeTypedCallOptions,
  requested: RuntimeTypedCallOptions | undefined,
): RuntimeTypedCallOptions {
  return {
    ...scoped,
    ...(requested?.signal ? { signal: requested.signal } : {}),
    ...(requested?.responseMetadataObserver ? { responseMetadataObserver: requested.responseMetadataObserver } : {}),
    ...(requested?.timeoutMs !== undefined && (scoped.timeoutMs === undefined || requested.timeoutMs < scoped.timeoutMs)
      ? { timeoutMs: requested.timeoutMs }
      : {}),
  };
}

function requireMethod<T>(method: T | undefined, name: string): T {
  if (typeof method !== 'function') {
    throw createNimiError({
      message: `Shared LocalAgent AIConfig method ${name} is unavailable.`,
      reasonCode: 'RUNTIME_SHARED_LOCAL_AGENT_AI_CONFIG_METHOD_UNAVAILABLE',
      actionHint: 'provide_shared_local_shared_local_agent_ai_config_transport',
      source: 'sdk',
    });
  }
  return method;
}

function inputError(message: string): never {
  throw createNimiError({
    message,
    reasonCode: 'RUNTIME_SHARED_LOCAL_AGENT_AI_CONFIG_INPUT_INVALID',
    actionHint: 'provide_canonical_shared_local_shared_local_agent_ai_config_input',
    source: 'sdk',
  });
}

function invalidResponse(message: string): never {
  throw createNimiError({
    message,
    reasonCode: 'RUNTIME_SHARED_LOCAL_AGENT_AI_CONFIG_RESPONSE_INVALID',
    actionHint: 'inspect_shared_local_shared_local_agent_ai_config_contract',
    source: 'runtime',
  });
}
