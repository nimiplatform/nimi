import {
  RoutePolicy,
  RuntimeAgentAIConfigReadinessState,
  type GetRuntimeAgentAIConfigRequest,
  type GetRuntimeAgentAIConfigResponse,
  type GetRuntimeAgentAIConfigReadinessRequest,
  type GetRuntimeAgentAIConfigReadinessResponse,
  type RuntimeAgentAIConfig,
  type RuntimeAgentAIConfigIntent,
  type RuntimeAgentAIConfigReadinessSnapshot,
  type RuntimeTypedCallOptions,
  type UpsertRuntimeAgentAIConfigRequest,
  type UpsertRuntimeAgentAIConfigResponse,
} from '../core-generated/runtime-typed-client';
import { createNimiAIScopeRef, type NimiAIScopeRef } from '../core/ai/index.js';
import { createNimiError } from '../types/index.js';
import {
  projectRuntimeLocalAgentIdentity,
  type RuntimeLocalAgentIdentityInput,
} from './agent-local-identity.js';
import {
  resolveNimiRuntimeAgentSubjectUserId,
  withNimiRuntimeAgentScopes,
  type NimiRuntimeAgentAuthClient,
  type NimiRuntimeAgentScopeRunner,
} from './runtime-agent-protected.js';
import { normalizeNimiRuntimeAgentText, toNimiRuntimeIsoFromTimestamp } from './runtime-agent-values.js';

const MODEL_SETTINGS_SCOPE_OWNER = 'runtime.agent.model-settings';
const UINT64_DECIMAL = /^(?:0|[1-9]\d*)$/u;

export type NimiRuntimeAgentModelSettingsRoutePolicy = 'local' | 'cloud';
export type NimiRuntimeAgentModelSettingsReadinessState = 'ready' | 'blocked' | 'unavailable';

export interface NimiRuntimeAgentModelSettingsRouteIntent {
  readonly capability: string;
  readonly provider: string;
  readonly model: string;
  readonly routePolicy: NimiRuntimeAgentModelSettingsRoutePolicy;
}

export interface NimiRuntimeAgentModelSettingsCapabilityReadiness {
  readonly capability: string;
  readonly state: NimiRuntimeAgentModelSettingsReadinessState;
  readonly reason: string;
  readonly observedAt: string | null;
}

export interface NimiRuntimeAgentModelSettingsProjection {
  readonly scopeRef: NimiAIScopeRef;
  readonly capabilities: readonly string[];
  readonly routeIntents: readonly NimiRuntimeAgentModelSettingsRouteIntent[];
  readonly readiness: readonly NimiRuntimeAgentModelSettingsCapabilityReadiness[];
  readonly configurationRevision: string;
}

export interface NimiRuntimeAgentModelSettingsInput extends RuntimeLocalAgentIdentityInput {
  readonly subjectUserId?: string;
}

export interface NimiRuntimeAgentModelSettingsUpdateInput extends NimiRuntimeAgentModelSettingsInput {
  readonly expectedConfigurationRevision: string;
  readonly routeIntents: readonly NimiRuntimeAgentModelSettingsRouteIntent[];
}

export interface NimiRuntimeAgentModelSettingsModule {
  snapshot(input: NimiRuntimeAgentModelSettingsInput): Promise<NimiRuntimeAgentModelSettingsProjection>;
  update(input: NimiRuntimeAgentModelSettingsUpdateInput): Promise<NimiRuntimeAgentModelSettingsProjection>;
}

export interface NimiRuntimeAgentModelSettingsRuntime {
  readonly appId: string;
  readonly auth: NimiRuntimeAgentAuthClient;
  readonly agent: {
    getRuntimeAgentAIConfig(request: GetRuntimeAgentAIConfigRequest, options?: RuntimeTypedCallOptions): Promise<GetRuntimeAgentAIConfigResponse>;
    upsertRuntimeAgentAIConfig(request: UpsertRuntimeAgentAIConfigRequest, options?: RuntimeTypedCallOptions): Promise<UpsertRuntimeAgentAIConfigResponse>;
    getRuntimeAgentAIConfigReadiness(request: GetRuntimeAgentAIConfigReadinessRequest, options?: RuntimeTypedCallOptions): Promise<GetRuntimeAgentAIConfigReadinessResponse>;
  };
}

export interface NimiRuntimeAgentModelSettingsModuleOptions {
  readonly runtime: NimiRuntimeAgentModelSettingsRuntime;
  readonly getSubjectUserId: () => string | Promise<string | undefined> | undefined;
  readonly withScopes?: NimiRuntimeAgentScopeRunner;
}

export function createNimiRuntimeAgentModelSettingsScopeRef(localAgentRef: string): NimiAIScopeRef {
  const normalized = normalizeNimiRuntimeAgentText(localAgentRef);
  if (!normalized) {
    return modelSettingsError('Local Agent ref is required for model settings scope.', 'SDK_RUNTIME_AGENT_MODEL_SETTINGS_INPUT_INVALID', 'provide_runtime_agent_identity');
  }
  return createNimiAIScopeRef({ kind: 'feature', ownerId: MODEL_SETTINGS_SCOPE_OWNER, surfaceId: normalized });
}

export function createNimiRuntimeAgentModelSettingsModule(
  options: NimiRuntimeAgentModelSettingsModuleOptions,
): NimiRuntimeAgentModelSettingsModule {
  const resolveSubject = async (explicit: unknown): Promise<string> => {
    const normalized = normalizeNimiRuntimeAgentText(explicit);
    return normalized || resolveNimiRuntimeAgentSubjectUserId(
      options.getSubjectUserId,
      'Runtime Agent model settings require an authenticated subject user id.',
    );
  };
  const contextFor = (input: NimiRuntimeAgentModelSettingsInput, subjectUserId: string) => ({
    appId: options.runtime.appId,
    subjectUserId,
    ...projectRuntimeLocalAgentIdentity(input),
  });
  const scoped = <T>(subjectUserId: string, scopes: readonly string[], operation: (callOptions: RuntimeTypedCallOptions) => Promise<T>) =>
    withNimiRuntimeAgentScopes({ runtime: options.runtime, subjectUserId, withScopes: options.withScopes }, scopes, operation);

  const readProjection = async (input: NimiRuntimeAgentModelSettingsInput, subjectUserId: string): Promise<NimiRuntimeAgentModelSettingsProjection> => {
    const context = contextFor(input, subjectUserId);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const configResponse = await scoped(subjectUserId, ['runtime.agent.ai_config.read'], (callOptions) =>
        options.runtime.agent.getRuntimeAgentAIConfig({ context }, callOptions));
      const readinessResponse = await scoped(subjectUserId, ['runtime.agent.ai_config.read'], (callOptions) =>
        options.runtime.agent.getRuntimeAgentAIConfigReadiness({ context }, callOptions));
      const configRevision = uint64(configResponse.config?.revision, 'configuration revision', false);
      const readinessRevision = uint64(readinessResponse.snapshot?.configRevision, 'readiness revision', false);
      if (configRevision === readinessRevision) {
        return projectModelSettings(projectRuntimeLocalAgentIdentity(input).localAgentRef, configResponse.config, readinessResponse.snapshot);
      }
    }
    return modelSettingsError('Runtime Agent model settings changed while a coherent snapshot was being read.', 'SDK_RUNTIME_AGENT_MODEL_SETTINGS_SNAPSHOT_STALE', 'retry_model_settings_snapshot');
  };

  const module: NimiRuntimeAgentModelSettingsModule = {
    async snapshot(input: NimiRuntimeAgentModelSettingsInput) {
      const subjectUserId = await resolveSubject(input.subjectUserId);
      return readProjection(input, subjectUserId);
    },
    async update(input: NimiRuntimeAgentModelSettingsUpdateInput) {
      const expectedRevision = uint64(input.expectedConfigurationRevision, 'expected configuration revision', true);
      const subjectUserId = await resolveSubject(input.subjectUserId);
      const context = contextFor(input, subjectUserId);
      const intents = toRuntimeModelSettingsIntents(input.routeIntents);
      // The RPC promise resolves only after Runtime's repository CAS, audit
      // handoff, and readiness refresh have completed. We additionally await
      // the matching readiness projection before resolving this SDK call.
      const response = await scoped(subjectUserId, ['runtime.agent.ai_config.write'], (callOptions) =>
        options.runtime.agent.upsertRuntimeAgentAIConfig({ context, expectedRevision, intents }, callOptions));
      const committedRevision = uint64(response.config?.revision, 'committed configuration revision', true);
      const readinessResponse = await scoped(subjectUserId, ['runtime.agent.ai_config.read'], (callOptions) =>
        options.runtime.agent.getRuntimeAgentAIConfigReadiness({ context }, callOptions));
      const readinessRevision = uint64(readinessResponse.snapshot?.configRevision, 'readiness revision', true);
      if (readinessRevision !== committedRevision) {
        return modelSettingsError('Runtime returned readiness for a different committed model settings revision.', 'SDK_RUNTIME_AGENT_MODEL_SETTINGS_RESPONSE_INVALID', 'retry_model_settings_snapshot');
      }
      return projectModelSettings(projectRuntimeLocalAgentIdentity(input).localAgentRef, response.config, readinessResponse.snapshot);
    },
  };
  return Object.freeze(module);
}

function projectModelSettings(
  localAgentRef: string,
  config: RuntimeAgentAIConfig | undefined,
  readiness: RuntimeAgentAIConfigReadinessSnapshot | undefined,
): NimiRuntimeAgentModelSettingsProjection {
  if (!config || !readiness) {
    return modelSettingsError('Runtime Agent model settings response is incomplete.', 'SDK_RUNTIME_AGENT_MODEL_SETTINGS_RESPONSE_INVALID', 'inspect_runtime_model_settings');
  }
  const configurationRevision = uint64(config.revision, 'configuration revision', false);
  if (configurationRevision !== uint64(readiness.configRevision, 'readiness revision', false)) {
    return modelSettingsError('Runtime Agent model settings projection revisions do not match.', 'SDK_RUNTIME_AGENT_MODEL_SETTINGS_RESPONSE_INVALID', 'retry_model_settings_snapshot');
  }
  const capabilities: string[] = [];
  const seen = new Set<string>();
  const projectedReadiness = readiness.capabilities.map((item) => {
    const capability = requireModelSettingsText(item.capability, 'readiness capability');
    if (seen.has(capability)) {
      return modelSettingsError('Runtime Agent model settings repeats a capability.', 'SDK_RUNTIME_AGENT_MODEL_SETTINGS_RESPONSE_INVALID', 'inspect_runtime_model_settings');
    }
    seen.add(capability);
    capabilities.push(capability);
    let state: NimiRuntimeAgentModelSettingsReadinessState;
    switch (item.state) {
      case RuntimeAgentAIConfigReadinessState.RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_READY:
        state = 'ready';
        break;
      case RuntimeAgentAIConfigReadinessState.RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_NOT_CONFIGURED:
        state = 'blocked';
        break;
      case RuntimeAgentAIConfigReadinessState.RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_UNAVAILABLE:
        state = 'unavailable';
        break;
      default:
        return modelSettingsError('Runtime Agent model settings readiness state is invalid.', 'SDK_RUNTIME_AGENT_MODEL_SETTINGS_RESPONSE_INVALID', 'inspect_runtime_model_settings');
    }
    return Object.freeze({
      capability,
      state,
      reason: normalizeNimiRuntimeAgentText(item.reasonCode),
      observedAt: toNimiRuntimeIsoFromTimestamp(item.probedAt),
    });
  });
  const routeIntents = config.intents.map((intent) => projectRouteIntent(intent));
  for (const intent of routeIntents) {
    if (!seen.has(intent.capability)) {
      return modelSettingsError('Runtime Agent model settings intent is outside the canonical capability projection.', 'SDK_RUNTIME_AGENT_MODEL_SETTINGS_RESPONSE_INVALID', 'inspect_runtime_model_settings');
    }
  }
  return Object.freeze({
    scopeRef: createNimiRuntimeAgentModelSettingsScopeRef(localAgentRef),
    capabilities: Object.freeze(capabilities),
    routeIntents: Object.freeze(routeIntents),
    readiness: Object.freeze(projectedReadiness),
    configurationRevision,
  });
}

function projectRouteIntent(intent: RuntimeAgentAIConfigIntent): NimiRuntimeAgentModelSettingsRouteIntent {
  const capability = requireModelSettingsText(intent.capability, 'route capability');
  const targetCloud = intent.targetRef?.target.oneofKind === 'cloud' ? intent.targetRef.target.cloud : null;
  const model = requireModelSettingsText(targetCloud?.providerModelId || intent.modelId, 'route model');
  if (intent.routePolicy === RoutePolicy.LOCAL) {
    return Object.freeze({ capability, provider: '', model, routePolicy: 'local' });
  }
  if (intent.routePolicy === RoutePolicy.CLOUD) {
    const provider = requireModelSettingsText(intent.provider || targetCloud?.provider, 'route provider');
    return Object.freeze({ capability, provider, model, routePolicy: 'cloud' });
  }
  return modelSettingsError('Runtime Agent model settings route policy is invalid.', 'SDK_RUNTIME_AGENT_MODEL_SETTINGS_RESPONSE_INVALID', 'inspect_runtime_model_settings');
}

function toRuntimeModelSettingsIntents(input: readonly NimiRuntimeAgentModelSettingsRouteIntent[]): RuntimeAgentAIConfigIntent[] {
  if (!Array.isArray(input) || input.length === 0) {
    return modelSettingsError('Model settings update requires route intents.', 'SDK_RUNTIME_AGENT_MODEL_SETTINGS_INPUT_INVALID', 'provide_model_route_intents');
  }
  const seen = new Set<string>();
  return input.map((intent) => {
    const capability = requireModelSettingsText(intent?.capability, 'route capability');
    const modelId = requireModelSettingsText(intent?.model, 'route model');
    const provider = normalizeNimiRuntimeAgentText(intent?.provider);
    if (seen.has(capability) || (intent.routePolicy !== 'local' && intent.routePolicy !== 'cloud')
      || (intent.routePolicy === 'local' && provider) || (intent.routePolicy === 'cloud' && !provider)) {
      return modelSettingsError('Model settings route intent is not canonical.', 'SDK_RUNTIME_AGENT_MODEL_SETTINGS_INPUT_INVALID', 'repair_model_route_intent');
    }
    seen.add(capability);
    return {
      capability,
      modelId,
      provider,
      routePolicy: intent.routePolicy === 'local' ? RoutePolicy.LOCAL : RoutePolicy.CLOUD,
      connectorId: '',
      voiceReferenceRef: '',
      imagePolicyRef: '',
    };
  });
}

function uint64(value: unknown, field: string, positive: boolean): string {
  const normalized = normalizeNimiRuntimeAgentText(value);
  if (!UINT64_DECIMAL.test(normalized) || (positive && normalized === '0')) {
    return modelSettingsError(`Runtime Agent model settings ${field} is invalid.`, 'SDK_RUNTIME_AGENT_MODEL_SETTINGS_INPUT_INVALID', 'refresh_model_settings_snapshot');
  }
  return normalized;
}

function requireModelSettingsText(value: unknown, field: string): string {
  const normalized = normalizeNimiRuntimeAgentText(value);
  if (!normalized) {
    return modelSettingsError(`Runtime Agent model settings ${field} is required.`, 'SDK_RUNTIME_AGENT_MODEL_SETTINGS_RESPONSE_INVALID', 'inspect_runtime_model_settings');
  }
  return normalized;
}

function modelSettingsError(message: string, reasonCode: string, actionHint: string): never {
  throw createNimiError({ message, reasonCode, actionHint, source: 'sdk' });
}
