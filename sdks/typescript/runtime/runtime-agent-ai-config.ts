import {
  RuntimeAgentAIConfigReadinessState,
  RoutePolicy,
  type RuntimeAgentAIConfigReadinessSnapshot,
  type GetRuntimeAgentAIConfigRequest,
  type GetRuntimeAgentAIConfigResponse,
  type GetRuntimeAgentAIConfigReadinessRequest,
  type GetRuntimeAgentAIConfigReadinessResponse,
  type RuntimeAgentAIConfigIntent,
  type RuntimeAgentAIConfigCapabilityReadiness,
  type RuntimeAgentAIConfig,
  type RuntimeDurableTargetRef,
  type RuntimeTypedCallOptions,
  type SubscribeRuntimeAgentAIConfigReadinessRequest,
  type UpsertRuntimeAgentAIConfigRequest,
  type UpsertRuntimeAgentAIConfigResponse,
} from '../core-generated/runtime-typed-client';
import type { AgentRequestContext } from '../core-generated/runtime-protobuf/runtime/v1/agent_common';
import { toRuntimeDurableTargetRef } from '../core/ai';
import { createNimiError } from '../types';
import {
  projectRuntimeLocalAgentIdentity,
  type RuntimeLocalAgentIdentityInput,
} from './agent-local-identity';
import type { NimiRuntimeRouteTargetRef } from './route-options';
import {
  resolveNimiRuntimeAgentSubjectUserId,
  withNimiRuntimeAgentScopes,
  type NimiRuntimeAgentAuthClient,
  type NimiRuntimeAgentScopeRunner,
} from './runtime-agent-protected';
import { normalizeNimiRuntimeAgentText, toNimiRuntimeIsoFromTimestamp } from './runtime-agent-values';

// K-AGCORE-144~150 app-facing projection of the runtime-owned committed
// Runtime Agent AI Config. The SDK never caches config or readiness as its own
// truth; every method is a typed pass-through over the admitted
// RuntimeAgentService RPC surface (S-RUNTIME-011 runtime.agent.ai_config.*).
const AGENT_AI_CONFIG_READ_SCOPE = 'runtime.agent.ai_config.read';
const AGENT_AI_CONFIG_WRITE_SCOPE = 'runtime.agent.ai_config.write';
const REQUIRED_AGENT_AI_CONFIG_CAPABILITIES = ['text.generate', 'text.embed'] as const;
const GRPC_CODE_ABORTED = 10;
const READINESS_REASON_CODES = new Set([
  '',
  'route_unhealthy',
  'connector_missing',
  'model_missing',
  'target_missing',
  'probe_failed',
  'embedding_profile_unavailable',
  'voice_reference_missing',
  'voice_workflow_unavailable',
  'image_route_unavailable',
]);

export type NimiRuntimeAgentAIConfigBinding = {
  readonly route: 'local' | 'cloud';
  readonly modelId: string;
  readonly connectorId?: string;
  readonly targetRef?: NimiRuntimeRouteTargetRef;
  readonly voiceReferenceRef?: string;
  readonly imagePolicyRef?: string;
};

export type NimiRuntimeAgentAIConfigIntents =
  Readonly<Record<string, NimiRuntimeAgentAIConfigBinding>>;

export interface NimiRuntimeAgentAIConfigSnapshot {
  readonly revision: number;
  readonly intents: NimiRuntimeAgentAIConfigIntents;
  readonly updatedAt: string | null;
  readonly updatedByAppId: string;
}

export type NimiRuntimeAgentAIConfigReadinessCapabilityState =
  | 'ready'
  | 'not_configured'
  | 'unavailable';

export type NimiRuntimeAgentAIConfigReadinessReasonCode =
  | ''
  | 'route_unhealthy'
  | 'connector_missing'
  | 'model_missing'
  | 'target_missing'
  | 'probe_failed'
  | 'embedding_profile_unavailable'
  | 'voice_reference_missing'
  | 'voice_workflow_unavailable'
  | 'image_route_unavailable';

export interface NimiRuntimeAgentAIConfigCapabilityReadinessProjection {
  readonly capability: string;
  readonly state: NimiRuntimeAgentAIConfigReadinessCapabilityState;
  readonly reasonCode: NimiRuntimeAgentAIConfigReadinessReasonCode;
  readonly probedAt: string | null;
}

export interface NimiRuntimeAgentAIConfigReadinessSnapshotProjection {
  readonly configRevision: number;
  readonly capabilities: readonly NimiRuntimeAgentAIConfigCapabilityReadinessProjection[];
}

export interface NimiRuntimeAgentAIConfigCallInput extends RuntimeLocalAgentIdentityInput {
  readonly subjectUserId?: string;
}

export interface NimiRuntimeAgentAIConfigUpsertInput extends NimiRuntimeAgentAIConfigCallInput {
  readonly expectedRevision: number;
  readonly intents: NimiRuntimeAgentAIConfigIntents;
}

export interface NimiRuntimeAgentAIConfigModule {
  get(input: NimiRuntimeAgentAIConfigCallInput): Promise<NimiRuntimeAgentAIConfigSnapshot>;
  upsert(input: NimiRuntimeAgentAIConfigUpsertInput): Promise<NimiRuntimeAgentAIConfigSnapshot>;
  readiness(input: NimiRuntimeAgentAIConfigCallInput): Promise<NimiRuntimeAgentAIConfigReadinessSnapshotProjection>;
  subscribeReadiness(
    input: NimiRuntimeAgentAIConfigCallInput,
  ): AsyncIterable<NimiRuntimeAgentAIConfigReadinessSnapshotProjection>;
}

export interface NimiRuntimeAgentAIConfigAgentSurface {
  getRuntimeAgentAIConfig?(
    request: GetRuntimeAgentAIConfigRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<GetRuntimeAgentAIConfigResponse>;
  upsertRuntimeAgentAIConfig?(
    request: UpsertRuntimeAgentAIConfigRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<UpsertRuntimeAgentAIConfigResponse>;
  getRuntimeAgentAIConfigReadiness?(
    request: GetRuntimeAgentAIConfigReadinessRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<GetRuntimeAgentAIConfigReadinessResponse>;
  subscribeRuntimeAgentAIConfigReadiness?(
    request: SubscribeRuntimeAgentAIConfigReadinessRequest,
    options?: RuntimeTypedCallOptions,
  ): AsyncIterable<RuntimeAgentAIConfigReadinessSnapshot>;
}

export interface NimiRuntimeAgentAIConfigRuntime {
  readonly appId: string;
  readonly auth: NimiRuntimeAgentAuthClient;
  readonly agent: NimiRuntimeAgentAIConfigAgentSurface;
}

export interface NimiRuntimeAgentAIConfigModuleOptions {
  readonly runtime: NimiRuntimeAgentAIConfigRuntime;
  readonly getSubjectUserId: () => string | Promise<string | undefined> | undefined;
  readonly withScopes?: NimiRuntimeAgentScopeRunner;
}

function agentAIConfigInputError(message: string, actionHint: string): never {
  throw createNimiError({
    message,
    reasonCode: 'SDK_RUNTIME_AGENT_AI_CONFIG_INPUT_INVALID',
    actionHint,
    source: 'sdk',
  });
}

function agentAIConfigResponseError(message: string): never {
  throw createNimiError({
    message,
    reasonCode: 'SDK_RUNTIME_AGENT_AI_CONFIG_RESPONSE_INVALID',
    actionHint: 'check_runtime_agent_ai_config_surface',
    source: 'runtime',
  });
}

function requireAIConfigMethod<T>(method: T | undefined, methodName: string): T {
  if (typeof method !== 'function') {
    throw createNimiError({
      message: `Runtime Agent AI Config surface is missing ${methodName}.`,
      reasonCode: 'SDK_RUNTIME_AGENT_AI_CONFIG_SURFACE_REQUIRED',
      actionHint: 'provide_runtime_agents_module',
      source: 'sdk',
    });
  }
  return method;
}

function parseAIConfigRevision(value: unknown, field: string): number {
  const revision = Number(normalizeNimiRuntimeAgentText(value));
  if (!Number.isSafeInteger(revision) || revision < 0) {
    agentAIConfigResponseError(`Runtime Agent AI Config ${field} is not a valid revision.`);
  }
  return revision;
}

function projectAIConfigRoute(routePolicy: RoutePolicy, capability: string): 'local' | 'cloud' {
  if (routePolicy === RoutePolicy.LOCAL) {
    return 'local';
  }
  if (routePolicy === RoutePolicy.CLOUD) {
    return 'cloud';
  }
  agentAIConfigResponseError(
    `Runtime Agent AI Config intent for ${capability} carries an unknown route policy (${String(routePolicy)}).`,
  );
}

function projectAIConfigTargetRef(
  targetRef: RuntimeDurableTargetRef | undefined,
  capability: string,
): NimiRuntimeRouteTargetRef | undefined {
  if (!targetRef) {
    return undefined;
  }
  const target = targetRef.target;
  if (target.oneofKind === 'localRuntime') {
    const local = target.localRuntime;
    if (normalizeNimiRuntimeAgentText(local.version) !== 'v2') {
      agentAIConfigResponseError(
        `Runtime Agent AI Config intent for ${capability} carries a non-v2 local target ref.`,
      );
    }
    if (local.ref.oneofKind === 'profileBindingId' && normalizeNimiRuntimeAgentText(local.ref.profileBindingId)) {
      return {
        kind: 'local-runtime',
        version: 'v2',
        profileBindingId: normalizeNimiRuntimeAgentText(local.ref.profileBindingId),
      };
    }
    if (local.ref.oneofKind === 'readinessRef' && normalizeNimiRuntimeAgentText(local.ref.readinessRef)) {
      return {
        kind: 'local-runtime',
        version: 'v2',
        readinessRef: normalizeNimiRuntimeAgentText(local.ref.readinessRef),
      };
    }
    agentAIConfigResponseError(
      `Runtime Agent AI Config intent for ${capability} local target ref has no local ref.`,
    );
  }
  if (target.oneofKind === 'cloud') {
    const cloud = target.cloud;
    const connectorId = normalizeNimiRuntimeAgentText(cloud.connectorId);
    const remoteModelCatalogId = normalizeNimiRuntimeAgentText(cloud.remoteModelCatalogId);
    const providerModelId = normalizeNimiRuntimeAgentText(cloud.providerModelId);
    if (normalizeNimiRuntimeAgentText(cloud.version) !== 'v2' || !connectorId || !remoteModelCatalogId || !providerModelId) {
      agentAIConfigResponseError(
        `Runtime Agent AI Config intent for ${capability} cloud target ref is incomplete.`,
      );
    }
    const provider = normalizeNimiRuntimeAgentText(cloud.provider);
    return {
      kind: 'cloud-connector',
      version: 'v2',
      connectorId,
      remoteModelCatalogId,
      providerModelId,
      ...(provider ? { provider } : {}),
    };
  }
  agentAIConfigResponseError(
    `Runtime Agent AI Config intent for ${capability} target ref has no admitted target kind.`,
  );
}

function projectAIConfigSnapshot(
  config: RuntimeAgentAIConfig | undefined,
): NimiRuntimeAgentAIConfigSnapshot {
  if (!config) {
    agentAIConfigResponseError('Runtime Agent AI Config response carries no committed config.');
  }
  const intents: Record<string, NimiRuntimeAgentAIConfigBinding> = {};
  for (const intent of config.intents || []) {
    const capability = normalizeNimiRuntimeAgentText(intent.capability);
    if (!capability) {
      agentAIConfigResponseError('Runtime Agent AI Config intent is missing its capability.');
    }
    if (intents[capability]) {
      agentAIConfigResponseError(
        `Runtime Agent AI Config binds ${capability} more than once.`,
      );
    }
    const modelId = normalizeNimiRuntimeAgentText(intent.modelId);
    if (!modelId) {
      agentAIConfigResponseError(
        `Runtime Agent AI Config intent for ${capability} is missing model_id.`,
      );
    }
    const connectorId = normalizeNimiRuntimeAgentText(intent.connectorId);
    const targetRef = projectAIConfigTargetRef(intent.targetRef, capability);
    const voiceReferenceRef = normalizeNimiRuntimeAgentText(intent.voiceReferenceRef);
    const imagePolicyRef = normalizeNimiRuntimeAgentText(intent.imagePolicyRef);
    intents[capability] = {
      route: projectAIConfigRoute(intent.routePolicy, capability),
      modelId,
      ...(connectorId ? { connectorId } : {}),
      ...(voiceReferenceRef ? { voiceReferenceRef } : {}),
      ...(imagePolicyRef ? { imagePolicyRef } : {}),
      ...(targetRef ? { targetRef } : {}),
    };
  }
  return {
    revision: parseAIConfigRevision(config.revision, 'revision'),
    intents,
    updatedAt: toNimiRuntimeIsoFromTimestamp(config.updatedAt),
    updatedByAppId: normalizeNimiRuntimeAgentText(config.updatedByAppId),
  };
}

function projectAIConfigReadinessState(
  state: RuntimeAgentAIConfigReadinessState,
  capability: string,
): NimiRuntimeAgentAIConfigReadinessCapabilityState {
  switch (state) {
    case RuntimeAgentAIConfigReadinessState.RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_READY:
      return 'ready';
    case RuntimeAgentAIConfigReadinessState.RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_NOT_CONFIGURED:
      return 'not_configured';
    case RuntimeAgentAIConfigReadinessState.RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_UNAVAILABLE:
      return 'unavailable';
    default:
      agentAIConfigResponseError(
        `Runtime Agent AI Config readiness for ${capability} carries an unknown state (${String(state)}).`,
      );
  }
}

function projectAIConfigReadinessReasonCode(
  reasonCode: unknown,
  capability: string,
): NimiRuntimeAgentAIConfigReadinessReasonCode {
  const normalized = normalizeNimiRuntimeAgentText(reasonCode);
  if (!READINESS_REASON_CODES.has(normalized)) {
    agentAIConfigResponseError(
      `Runtime Agent AI Config readiness for ${capability} carries an unknown reason code (${normalized}).`,
    );
  }
  return normalized as NimiRuntimeAgentAIConfigReadinessReasonCode;
}

function projectAIConfigCapabilityReadiness(
  readiness: RuntimeAgentAIConfigCapabilityReadiness,
): NimiRuntimeAgentAIConfigCapabilityReadinessProjection {
  const capability = normalizeNimiRuntimeAgentText(readiness.capability);
  if (!capability) {
    agentAIConfigResponseError('Runtime Agent AI Config readiness entry is missing its capability.');
  }
  return {
    capability,
    state: projectAIConfigReadinessState(readiness.state, capability),
    reasonCode: projectAIConfigReadinessReasonCode(readiness.reasonCode, capability),
    probedAt: toNimiRuntimeIsoFromTimestamp(readiness.probedAt),
  };
}

export function projectNimiRuntimeAgentAIConfigReadinessSnapshot(
  snapshot: RuntimeAgentAIConfigReadinessSnapshot | undefined,
): NimiRuntimeAgentAIConfigReadinessSnapshotProjection {
  if (!snapshot) {
    agentAIConfigResponseError('Runtime Agent AI Config readiness response carries no snapshot.');
  }
  return {
    configRevision: parseAIConfigRevision(snapshot.configRevision, 'config_revision'),
    capabilities: (snapshot.capabilities || []).map(projectAIConfigCapabilityReadiness),
  };
}

function toAIConfigIntentMessage(
  capability: string,
  binding: NimiRuntimeAgentAIConfigBinding,
): RuntimeAgentAIConfigIntent {
  const route = normalizeNimiRuntimeAgentText(binding?.route).toLowerCase();
  if (route !== 'local' && route !== 'cloud') {
    agentAIConfigInputError(
      `Runtime Agent AI Config intent for ${capability} route must be local or cloud.`,
      'select_runtime_agent_route',
    );
  }
  const modelId = normalizeNimiRuntimeAgentText(binding?.modelId);
  if (!modelId) {
    agentAIConfigInputError(
      `Runtime Agent AI Config intent for ${capability} requires modelId.`,
      'select_runtime_agent_model',
    );
  }
  if (binding.targetRef) {
    const kindMatchesRoute = (route === 'local' && binding.targetRef.kind === 'local-runtime')
      || (route === 'cloud' && binding.targetRef.kind === 'cloud-connector');
    if (!kindMatchesRoute) {
      agentAIConfigInputError(
        `Runtime Agent AI Config intent for ${capability} targetRef kind does not match route ${route}.`,
        'provide_runtime_route_target_ref',
      );
    }
  }
  const connectorId = normalizeNimiRuntimeAgentText(binding.connectorId);
  const voiceReferenceRef = normalizeNimiRuntimeAgentText(binding.voiceReferenceRef);
  const imagePolicyRef = normalizeNimiRuntimeAgentText(binding.imagePolicyRef);
  return {
    capability,
    modelId,
    routePolicy: route === 'local' ? RoutePolicy.LOCAL : RoutePolicy.CLOUD,
    connectorId,
    voiceReferenceRef,
    imagePolicyRef,
    ...(binding.targetRef ? { targetRef: toRuntimeDurableTargetRef(binding.targetRef) } : {}),
  };
}

export function buildNimiRuntimeAgentAIConfigUpsertIntents(
  intents: NimiRuntimeAgentAIConfigIntents,
): RuntimeAgentAIConfigIntent[] {
  const entries = Object.entries(intents || {})
    .map(([capability, binding]) => [normalizeNimiRuntimeAgentText(capability), binding] as const)
    .filter(([capability]) => Boolean(capability));
  if (entries.length === 0) {
    agentAIConfigInputError(
      'Runtime Agent AI Config upsert requires at least one capability intent.',
      'provide_runtime_agent_ai_config_intents',
    );
  }
  for (const requiredCapability of REQUIRED_AGENT_AI_CONFIG_CAPABILITIES) {
    if (!entries.some(([capability]) => capability === requiredCapability)) {
      agentAIConfigInputError(
        `Runtime Agent AI Config upsert must retain the required ${requiredCapability} intent.`,
        `retain_${requiredCapability.replace('.', '_')}_intent`,
      );
    }
  }
  return entries.map(([capability, binding]) => toAIConfigIntentMessage(capability, binding));
}

function normalizeExpectedRevision(value: unknown): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    agentAIConfigInputError(
      'Runtime Agent AI Config upsert requires a positive integer expectedRevision.',
      'read_committed_agent_ai_config_first',
    );
  }
  return String(value);
}

function isAIConfigRevisionConflictError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const record = error as {
    readonly details?: { readonly grpcCode?: unknown };
    readonly reasonCode?: unknown;
    readonly message?: unknown;
  };
  if (Number(record.details?.grpcCode) === GRPC_CODE_ABORTED) {
    return true;
  }
  if (normalizeNimiRuntimeAgentText(record.reasonCode) === 'RUNTIME_GRPC_ABORTED') {
    return true;
  }
  return /concurrent modification/iu.test(String(record.message || ''));
}

function projectAIConfigUpsertError(error: unknown, expectedRevision: string): never {
  if (isAIConfigRevisionConflictError(error)) {
    throw createNimiError({
      message: 'Runtime Agent AI Config was modified concurrently; re-read the committed config and retry with its revision.',
      reasonCode: 'RUNTIME_AGENT_AI_CONFIG_CONCURRENT_MODIFICATION',
      actionHint: 'reload_committed_agent_ai_config_and_retry',
      source: 'runtime',
      details: {
        expectedRevision,
        cause: String((error as { readonly message?: unknown }).message || ''),
      },
    });
  }
  throw error;
}

export function createNimiRuntimeAgentAIConfigModule(
  options: NimiRuntimeAgentAIConfigModuleOptions,
): NimiRuntimeAgentAIConfigModule {
  const runtime = options.runtime;

  const resolveSubject = async (explicit?: unknown): Promise<string> => {
    const explicitSubject = normalizeNimiRuntimeAgentText(explicit);
    if (explicitSubject) {
      return explicitSubject;
    }
    return resolveNimiRuntimeAgentSubjectUserId(
      options.getSubjectUserId,
      'Runtime Agent AI Config module requires authenticated subject user id.',
    );
  };

  const buildContext = (subjectUserId: string, input: RuntimeLocalAgentIdentityInput): AgentRequestContext => ({
    appId: runtime.appId,
    subjectUserId,
    ...projectRuntimeLocalAgentIdentity(input),
    ...(input.scopedBinding ? { scopedBinding: input.scopedBinding } : {}),
  });

  const withScopes = async <T>(
    subjectUserId: string,
    scopes: readonly string[],
    operation: (callOptions: RuntimeTypedCallOptions) => Promise<T>,
  ): Promise<T> => withNimiRuntimeAgentScopes({
    runtime,
    subjectUserId,
    withScopes: options.withScopes,
  }, scopes, operation);

  return {
    async get(input) {
      const getRuntimeAgentAIConfig = requireAIConfigMethod(
        runtime.agent.getRuntimeAgentAIConfig,
        'getRuntimeAgentAIConfig',
      );
      const subjectUserId = await resolveSubject(input.subjectUserId);
      const response = await withScopes(subjectUserId, [AGENT_AI_CONFIG_READ_SCOPE], (callOptions) =>
        getRuntimeAgentAIConfig({ context: buildContext(subjectUserId, input) }, callOptions));
      return projectAIConfigSnapshot(response.config);
    },
    async upsert(input) {
      const upsertRuntimeAgentAIConfig = requireAIConfigMethod(
        runtime.agent.upsertRuntimeAgentAIConfig,
        'upsertRuntimeAgentAIConfig',
      );
      const expectedRevision = normalizeExpectedRevision(input.expectedRevision);
      const intents = buildNimiRuntimeAgentAIConfigUpsertIntents(input.intents);
      const subjectUserId = await resolveSubject(input.subjectUserId);
      let response: UpsertRuntimeAgentAIConfigResponse;
      try {
        response = await withScopes(subjectUserId, [AGENT_AI_CONFIG_WRITE_SCOPE], (callOptions) =>
          upsertRuntimeAgentAIConfig({
            context: buildContext(subjectUserId, input),
            expectedRevision,
            intents,
          }, callOptions));
      } catch (error) {
        projectAIConfigUpsertError(error, expectedRevision);
      }
      return projectAIConfigSnapshot(response.config);
    },
    async readiness(input) {
      const getRuntimeAgentAIConfigReadiness = requireAIConfigMethod(
        runtime.agent.getRuntimeAgentAIConfigReadiness,
        'getRuntimeAgentAIConfigReadiness',
      );
      const subjectUserId = await resolveSubject(input.subjectUserId);
      const response = await withScopes(subjectUserId, [AGENT_AI_CONFIG_READ_SCOPE], (callOptions) =>
        getRuntimeAgentAIConfigReadiness({ context: buildContext(subjectUserId, input) }, callOptions));
      return projectNimiRuntimeAgentAIConfigReadinessSnapshot(response.snapshot);
    },
    subscribeReadiness(input) {
      const subscribeRuntimeAgentAIConfigReadiness = requireAIConfigMethod(
        runtime.agent.subscribeRuntimeAgentAIConfigReadiness,
        'subscribeRuntimeAgentAIConfigReadiness',
      );
      // The server stream delivers the initial snapshot followed by change
      // snapshots (K-AGCORE-149). Scope acquisition is deferred to the first
      // pull so the surface stays synchronous like other typed stream methods.
      return {
        [Symbol.asyncIterator](): AsyncIterator<NimiRuntimeAgentAIConfigReadinessSnapshotProjection> {
          let iterator: AsyncIterator<RuntimeAgentAIConfigReadinessSnapshot> | null = null;
          let closed = false;
          const ensureIterator = async (): Promise<AsyncIterator<RuntimeAgentAIConfigReadinessSnapshot>> => {
            if (iterator) {
              return iterator;
            }
            const subjectUserId = await resolveSubject(input.subjectUserId);
            const stream = await withScopes(subjectUserId, [AGENT_AI_CONFIG_READ_SCOPE], async (callOptions) =>
              subscribeRuntimeAgentAIConfigReadiness({ context: buildContext(subjectUserId, input) }, callOptions));
            iterator = stream[Symbol.asyncIterator]();
            return iterator;
          };
          return {
            next: async () => {
              if (closed) {
                return { done: true, value: undefined };
              }
              const next = await (await ensureIterator()).next();
              if (next.done) {
                return { done: true, value: undefined };
              }
              return {
                done: false,
                value: projectNimiRuntimeAgentAIConfigReadinessSnapshot(next.value),
              };
            },
            return: async () => {
              closed = true;
              if (iterator) {
                await Promise.resolve(iterator.return?.()).catch(() => undefined);
              }
              return { done: true, value: undefined };
            },
          };
        },
      };
    },
  };
}
