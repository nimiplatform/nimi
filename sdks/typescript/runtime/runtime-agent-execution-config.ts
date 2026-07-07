import {
  AgentExecutionReadinessState,
  RoutePolicy,
  type AgentExecutionReadinessSnapshot,
  type GetAgentExecutionConfigRequest,
  type GetAgentExecutionConfigResponse,
  type GetAgentExecutionReadinessRequest,
  type GetAgentExecutionReadinessResponse,
  type RuntimeAgentExecutionCapabilityBinding,
  type RuntimeAgentExecutionCapabilityReadiness,
  type RuntimeAgentExecutionConfig,
  type RuntimeDurableTargetRef,
  type RuntimeTypedCallOptions,
  type SubscribeAgentExecutionReadinessRequest,
  type UpsertAgentExecutionConfigRequest,
  type UpsertAgentExecutionConfigResponse,
} from '../core-generated/runtime-typed-client';
import type { AgentRequestContext } from '../core-generated/runtime-protobuf/runtime/v1/agent_common';
import { toRuntimeDurableTargetRef } from '../core/ai';
import { createNimiError } from '../types';
import type { NimiRuntimeRouteTargetRef } from './route-options';
import {
  resolveNimiRuntimeAgentSubjectUserId,
  withNimiRuntimeAgentScopes,
  type NimiRuntimeAgentAppAuthClient,
  type NimiRuntimeAgentAuthClient,
  type NimiRuntimeAgentScopeRunner,
} from './runtime-agent-protected';
import type { NimiRuntimeAgentExecutionBinding } from './runtime-agent-turn-runner-types';
import { normalizeNimiRuntimeAgentText, toNimiRuntimeIsoFromTimestamp } from './runtime-agent-values';

// K-AGCORE-144~150 app-facing projection of the runtime-owned committed
// execution config. The SDK never caches config or readiness as its own
// truth; every method is a typed pass-through over the admitted
// RuntimeAgentService RPC surface (S-RUNTIME-011 runtime.agent.executionConfig.*).
const EXECUTION_CONFIG_READ_SCOPE = 'runtime.agent.execution_config.read';
const EXECUTION_CONFIG_WRITE_SCOPE = 'runtime.agent.execution_config.write';
const REQUIRED_TEXT_CAPABILITY = 'text.generate';
const GRPC_CODE_ABORTED = 10;
const READINESS_REASON_CODES = new Set([
  '',
  'route_unhealthy',
  'connector_missing',
  'model_missing',
  'target_missing',
  'probe_failed',
]);

export type NimiRuntimeAgentExecutionConfigBindings =
  Readonly<Record<string, NimiRuntimeAgentExecutionBinding>>;

export interface NimiRuntimeAgentExecutionConfigSnapshot {
  readonly revision: number;
  readonly bindings: NimiRuntimeAgentExecutionConfigBindings;
  readonly updatedAt: string | null;
  readonly updatedByAppId: string;
}

export type NimiRuntimeAgentExecutionReadinessCapabilityState =
  | 'ready'
  | 'not_configured'
  | 'unavailable';

export type NimiRuntimeAgentExecutionReadinessReasonCode =
  | ''
  | 'route_unhealthy'
  | 'connector_missing'
  | 'model_missing'
  | 'target_missing'
  | 'probe_failed';

export interface NimiRuntimeAgentExecutionCapabilityReadinessProjection {
  readonly capability: string;
  readonly state: NimiRuntimeAgentExecutionReadinessCapabilityState;
  readonly reasonCode: NimiRuntimeAgentExecutionReadinessReasonCode;
  readonly probedAt: string | null;
}

export interface NimiRuntimeAgentExecutionReadinessSnapshotProjection {
  readonly configRevision: number;
  readonly capabilities: readonly NimiRuntimeAgentExecutionCapabilityReadinessProjection[];
}

export interface NimiRuntimeAgentExecutionConfigCallInput {
  readonly subjectUserId?: string;
}

export interface NimiRuntimeAgentExecutionConfigUpsertInput extends NimiRuntimeAgentExecutionConfigCallInput {
  readonly expectedRevision: number;
  readonly bindings: NimiRuntimeAgentExecutionConfigBindings;
}

export interface NimiRuntimeAgentExecutionConfigModule {
  get(input?: NimiRuntimeAgentExecutionConfigCallInput): Promise<NimiRuntimeAgentExecutionConfigSnapshot>;
  upsert(input: NimiRuntimeAgentExecutionConfigUpsertInput): Promise<NimiRuntimeAgentExecutionConfigSnapshot>;
  readiness(input?: NimiRuntimeAgentExecutionConfigCallInput): Promise<NimiRuntimeAgentExecutionReadinessSnapshotProjection>;
  subscribeReadiness(
    input?: NimiRuntimeAgentExecutionConfigCallInput,
  ): AsyncIterable<NimiRuntimeAgentExecutionReadinessSnapshotProjection>;
}

export interface NimiRuntimeAgentExecutionConfigAgentSurface {
  getAgentExecutionConfig?(
    request: GetAgentExecutionConfigRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<GetAgentExecutionConfigResponse>;
  upsertAgentExecutionConfig?(
    request: UpsertAgentExecutionConfigRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<UpsertAgentExecutionConfigResponse>;
  getAgentExecutionReadiness?(
    request: GetAgentExecutionReadinessRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<GetAgentExecutionReadinessResponse>;
  subscribeAgentExecutionReadiness?(
    request: SubscribeAgentExecutionReadinessRequest,
    options?: RuntimeTypedCallOptions,
  ): AsyncIterable<AgentExecutionReadinessSnapshot>;
}

export interface NimiRuntimeAgentExecutionConfigRuntime {
  readonly appId: string;
  readonly auth: NimiRuntimeAgentAuthClient;
  readonly appAuth: NimiRuntimeAgentAppAuthClient;
  readonly agent: NimiRuntimeAgentExecutionConfigAgentSurface;
}

export interface NimiRuntimeAgentExecutionConfigModuleOptions {
  readonly runtime: NimiRuntimeAgentExecutionConfigRuntime;
  readonly getSubjectUserId: () => string | Promise<string | undefined> | undefined;
  readonly withScopes?: NimiRuntimeAgentScopeRunner;
}

function executionConfigInputError(message: string, actionHint: string): never {
  throw createNimiError({
    message,
    reasonCode: 'SDK_RUNTIME_AGENT_EXECUTION_CONFIG_INPUT_INVALID',
    actionHint,
    source: 'sdk',
  });
}

function executionConfigResponseError(message: string): never {
  throw createNimiError({
    message,
    reasonCode: 'SDK_RUNTIME_AGENT_EXECUTION_CONFIG_RESPONSE_INVALID',
    actionHint: 'check_runtime_agent_execution_config_surface',
    source: 'runtime',
  });
}

function requireExecutionConfigMethod<T>(method: T | undefined, methodName: string): T {
  if (typeof method !== 'function') {
    throw createNimiError({
      message: `Runtime Agent execution config surface is missing ${methodName}.`,
      reasonCode: 'SDK_RUNTIME_AGENT_EXECUTION_CONFIG_SURFACE_REQUIRED',
      actionHint: 'provide_runtime_agents_module',
      source: 'sdk',
    });
  }
  return method;
}

function parseExecutionConfigRevision(value: unknown, field: string): number {
  const revision = Number(normalizeNimiRuntimeAgentText(value));
  if (!Number.isSafeInteger(revision) || revision < 0) {
    executionConfigResponseError(`Runtime Agent execution config ${field} is not a valid revision.`);
  }
  return revision;
}

function projectExecutionRoute(routePolicy: RoutePolicy, capability: string): 'local' | 'cloud' {
  if (routePolicy === RoutePolicy.LOCAL) {
    return 'local';
  }
  if (routePolicy === RoutePolicy.CLOUD) {
    return 'cloud';
  }
  executionConfigResponseError(
    `Runtime Agent execution config binding for ${capability} carries an unknown route policy (${String(routePolicy)}).`,
  );
}

function projectExecutionTargetRef(
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
      executionConfigResponseError(
        `Runtime Agent execution config binding for ${capability} carries a non-v2 local target ref.`,
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
    executionConfigResponseError(
      `Runtime Agent execution config binding for ${capability} local target ref has no local ref.`,
    );
  }
  if (target.oneofKind === 'cloud') {
    const cloud = target.cloud;
    const connectorId = normalizeNimiRuntimeAgentText(cloud.connectorId);
    const remoteModelCatalogId = normalizeNimiRuntimeAgentText(cloud.remoteModelCatalogId);
    const providerModelId = normalizeNimiRuntimeAgentText(cloud.providerModelId);
    if (normalizeNimiRuntimeAgentText(cloud.version) !== 'v2' || !connectorId || !remoteModelCatalogId || !providerModelId) {
      executionConfigResponseError(
        `Runtime Agent execution config binding for ${capability} cloud target ref is incomplete.`,
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
  executionConfigResponseError(
    `Runtime Agent execution config binding for ${capability} target ref has no admitted target kind.`,
  );
}

function projectExecutionConfigSnapshot(
  config: RuntimeAgentExecutionConfig | undefined,
): NimiRuntimeAgentExecutionConfigSnapshot {
  if (!config) {
    executionConfigResponseError('Runtime Agent execution config response carries no committed config.');
  }
  const bindings: Record<string, NimiRuntimeAgentExecutionBinding> = {};
  for (const binding of config.bindings || []) {
    const capability = normalizeNimiRuntimeAgentText(binding.capability);
    if (!capability) {
      executionConfigResponseError('Runtime Agent execution config binding is missing its capability.');
    }
    if (bindings[capability]) {
      executionConfigResponseError(
        `Runtime Agent execution config binds ${capability} more than once.`,
      );
    }
    const modelId = normalizeNimiRuntimeAgentText(binding.modelId);
    if (!modelId) {
      executionConfigResponseError(
        `Runtime Agent execution config binding for ${capability} is missing model_id.`,
      );
    }
    const connectorId = normalizeNimiRuntimeAgentText(binding.connectorId);
    const targetRef = projectExecutionTargetRef(binding.targetRef, capability);
    bindings[capability] = {
      route: projectExecutionRoute(binding.routePolicy, capability),
      modelId,
      ...(connectorId ? { connectorId } : {}),
      ...(targetRef ? { targetRef } : {}),
    };
  }
  return {
    revision: parseExecutionConfigRevision(config.revision, 'revision'),
    bindings,
    updatedAt: toNimiRuntimeIsoFromTimestamp(config.updatedAt),
    updatedByAppId: normalizeNimiRuntimeAgentText(config.updatedByAppId),
  };
}

function projectExecutionReadinessState(
  state: AgentExecutionReadinessState,
  capability: string,
): NimiRuntimeAgentExecutionReadinessCapabilityState {
  switch (state) {
    case AgentExecutionReadinessState.READY:
      return 'ready';
    case AgentExecutionReadinessState.NOT_CONFIGURED:
      return 'not_configured';
    case AgentExecutionReadinessState.UNAVAILABLE:
      return 'unavailable';
    default:
      executionConfigResponseError(
        `Runtime Agent execution readiness for ${capability} carries an unknown state (${String(state)}).`,
      );
  }
}

function projectExecutionReadinessReasonCode(
  reasonCode: unknown,
  capability: string,
): NimiRuntimeAgentExecutionReadinessReasonCode {
  const normalized = normalizeNimiRuntimeAgentText(reasonCode);
  if (!READINESS_REASON_CODES.has(normalized)) {
    executionConfigResponseError(
      `Runtime Agent execution readiness for ${capability} carries an unknown reason code (${normalized}).`,
    );
  }
  return normalized as NimiRuntimeAgentExecutionReadinessReasonCode;
}

function projectExecutionCapabilityReadiness(
  readiness: RuntimeAgentExecutionCapabilityReadiness,
): NimiRuntimeAgentExecutionCapabilityReadinessProjection {
  const capability = normalizeNimiRuntimeAgentText(readiness.capability);
  if (!capability) {
    executionConfigResponseError('Runtime Agent execution readiness entry is missing its capability.');
  }
  return {
    capability,
    state: projectExecutionReadinessState(readiness.state, capability),
    reasonCode: projectExecutionReadinessReasonCode(readiness.reasonCode, capability),
    probedAt: toNimiRuntimeIsoFromTimestamp(readiness.probedAt),
  };
}

export function projectNimiRuntimeAgentExecutionReadinessSnapshot(
  snapshot: AgentExecutionReadinessSnapshot | undefined,
): NimiRuntimeAgentExecutionReadinessSnapshotProjection {
  if (!snapshot) {
    executionConfigResponseError('Runtime Agent execution readiness response carries no snapshot.');
  }
  return {
    configRevision: parseExecutionConfigRevision(snapshot.configRevision, 'config_revision'),
    capabilities: (snapshot.capabilities || []).map(projectExecutionCapabilityReadiness),
  };
}

function toExecutionBindingMessage(
  capability: string,
  binding: NimiRuntimeAgentExecutionBinding,
): RuntimeAgentExecutionCapabilityBinding {
  const route = normalizeNimiRuntimeAgentText(binding?.route).toLowerCase();
  if (route !== 'local' && route !== 'cloud') {
    executionConfigInputError(
      `Runtime Agent execution config binding for ${capability} route must be local or cloud.`,
      'select_runtime_agent_route',
    );
  }
  const modelId = normalizeNimiRuntimeAgentText(binding?.modelId);
  if (!modelId) {
    executionConfigInputError(
      `Runtime Agent execution config binding for ${capability} requires modelId.`,
      'select_runtime_agent_model',
    );
  }
  if (binding.targetRef) {
    const kindMatchesRoute = (route === 'local' && binding.targetRef.kind === 'local-runtime')
      || (route === 'cloud' && binding.targetRef.kind === 'cloud-connector');
    if (!kindMatchesRoute) {
      executionConfigInputError(
        `Runtime Agent execution config binding for ${capability} targetRef kind does not match route ${route}.`,
        'provide_runtime_route_target_ref',
      );
    }
  }
  const connectorId = normalizeNimiRuntimeAgentText(binding.connectorId);
  return {
    capability,
    modelId,
    routePolicy: route === 'local' ? RoutePolicy.LOCAL : RoutePolicy.CLOUD,
    connectorId,
    ...(binding.targetRef ? { targetRef: toRuntimeDurableTargetRef(binding.targetRef) } : {}),
  };
}

export function buildNimiRuntimeAgentExecutionConfigUpsertBindings(
  bindings: NimiRuntimeAgentExecutionConfigBindings,
): RuntimeAgentExecutionCapabilityBinding[] {
  const entries = Object.entries(bindings || {})
    .map(([capability, binding]) => [normalizeNimiRuntimeAgentText(capability), binding] as const)
    .filter(([capability]) => Boolean(capability));
  if (entries.length === 0) {
    executionConfigInputError(
      'Runtime Agent execution config upsert requires at least one capability binding.',
      'provide_runtime_agent_execution_bindings',
    );
  }
  if (!entries.some(([capability]) => capability === REQUIRED_TEXT_CAPABILITY)) {
    executionConfigInputError(
      `Runtime Agent execution config upsert must retain the required ${REQUIRED_TEXT_CAPABILITY} binding.`,
      'retain_text_generate_binding',
    );
  }
  return entries.map(([capability, binding]) => toExecutionBindingMessage(capability, binding));
}

function normalizeExpectedRevision(value: unknown): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    executionConfigInputError(
      'Runtime Agent execution config upsert requires a positive integer expectedRevision.',
      'read_committed_execution_config_first',
    );
  }
  return String(value);
}

function isExecutionConfigRevisionConflictError(error: unknown): boolean {
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

function projectExecutionConfigUpsertError(error: unknown, expectedRevision: string): never {
  if (isExecutionConfigRevisionConflictError(error)) {
    throw createNimiError({
      message: 'Runtime Agent execution config was modified concurrently; re-read the committed config and retry with its revision.',
      reasonCode: 'RUNTIME_AGENT_EXECUTION_CONFIG_CONCURRENT_MODIFICATION',
      actionHint: 'reload_committed_execution_config_and_retry',
      source: 'runtime',
      details: {
        expectedRevision,
        cause: String((error as { readonly message?: unknown }).message || ''),
      },
    });
  }
  throw error;
}

export function createNimiRuntimeAgentExecutionConfigModule(
  options: NimiRuntimeAgentExecutionConfigModuleOptions,
): NimiRuntimeAgentExecutionConfigModule {
  const runtime = options.runtime;

  const resolveSubject = async (explicit?: unknown): Promise<string> => {
    const explicitSubject = normalizeNimiRuntimeAgentText(explicit);
    if (explicitSubject) {
      return explicitSubject;
    }
    return resolveNimiRuntimeAgentSubjectUserId(
      options.getSubjectUserId,
      'Runtime Agent execution config module requires authenticated subject user id.',
    );
  };

  const buildContext = (subjectUserId: string): AgentRequestContext => ({
    appId: runtime.appId,
    subjectUserId,
    ownerUserId: '',
    runtimeSourceRef: '',
    localAgentRef: '',
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
    async get(input = {}) {
      const getAgentExecutionConfig = requireExecutionConfigMethod(
        runtime.agent.getAgentExecutionConfig,
        'getAgentExecutionConfig',
      );
      const subjectUserId = await resolveSubject(input.subjectUserId);
      const response = await withScopes(subjectUserId, [EXECUTION_CONFIG_READ_SCOPE], (callOptions) =>
        getAgentExecutionConfig({ context: buildContext(subjectUserId) }, callOptions));
      return projectExecutionConfigSnapshot(response.config);
    },
    async upsert(input) {
      const upsertAgentExecutionConfig = requireExecutionConfigMethod(
        runtime.agent.upsertAgentExecutionConfig,
        'upsertAgentExecutionConfig',
      );
      const expectedRevision = normalizeExpectedRevision(input.expectedRevision);
      const bindings = buildNimiRuntimeAgentExecutionConfigUpsertBindings(input.bindings);
      const subjectUserId = await resolveSubject(input.subjectUserId);
      let response: UpsertAgentExecutionConfigResponse;
      try {
        response = await withScopes(subjectUserId, [EXECUTION_CONFIG_WRITE_SCOPE], (callOptions) =>
          upsertAgentExecutionConfig({
            context: buildContext(subjectUserId),
            expectedRevision,
            bindings,
          }, callOptions));
      } catch (error) {
        projectExecutionConfigUpsertError(error, expectedRevision);
      }
      return projectExecutionConfigSnapshot(response.config);
    },
    async readiness(input = {}) {
      const getAgentExecutionReadiness = requireExecutionConfigMethod(
        runtime.agent.getAgentExecutionReadiness,
        'getAgentExecutionReadiness',
      );
      const subjectUserId = await resolveSubject(input.subjectUserId);
      const response = await withScopes(subjectUserId, [EXECUTION_CONFIG_READ_SCOPE], (callOptions) =>
        getAgentExecutionReadiness({ context: buildContext(subjectUserId) }, callOptions));
      return projectNimiRuntimeAgentExecutionReadinessSnapshot(response.snapshot);
    },
    subscribeReadiness(input = {}) {
      const subscribeAgentExecutionReadiness = requireExecutionConfigMethod(
        runtime.agent.subscribeAgentExecutionReadiness,
        'subscribeAgentExecutionReadiness',
      );
      // The server stream delivers the initial snapshot followed by change
      // snapshots (K-AGCORE-149). Scope acquisition is deferred to the first
      // pull so the surface stays synchronous like other typed stream methods.
      return {
        [Symbol.asyncIterator](): AsyncIterator<NimiRuntimeAgentExecutionReadinessSnapshotProjection> {
          let iterator: AsyncIterator<AgentExecutionReadinessSnapshot> | null = null;
          let closed = false;
          const ensureIterator = async (): Promise<AsyncIterator<AgentExecutionReadinessSnapshot>> => {
            if (iterator) {
              return iterator;
            }
            const subjectUserId = await resolveSubject(input.subjectUserId);
            const stream = await withScopes(subjectUserId, [EXECUTION_CONFIG_READ_SCOPE], async (callOptions) =>
              subscribeAgentExecutionReadiness({ context: buildContext(subjectUserId) }, callOptions));
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
                value: projectNimiRuntimeAgentExecutionReadinessSnapshot(next.value),
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
