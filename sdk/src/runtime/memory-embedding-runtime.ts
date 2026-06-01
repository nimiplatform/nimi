import type { AIScopeRef } from '../scope/ai-scope.js';
import { ReasonCode } from '../types/index.js';
import type {
  MemoryEmbeddingConfig,
  MemoryEmbeddingSourceKind,
} from './memory-embedding-config.js';
import type {
  InspectMemoryEmbeddingRuntimeResponse,
  MemoryBankLocator,
  MemoryEmbeddingBindingIntentSnapshot,
  MemoryEmbeddingProfile,
  RequestMemoryEmbeddingRuntimeBindResponse,
  RequestMemoryEmbeddingRuntimeCutoverResponse,
} from './generated/runtime/v1/memory.js';
import { MemoryBankScope } from './generated/runtime/v1/memory.js';
import { normalizeRuntimeReasonCode } from './reason-code-messages.js';
import { createRuntimeProtectedScopeHelper } from './protected-access.js';
import type {
  RuntimeAppAuthClient,
  RuntimeAuthClient,
  RuntimeCallOptions,
  RuntimeTransportConfig,
} from './types.js';
import type { RuntimeMemoryClient } from './types-client-interfaces.js';

export type MemoryEmbeddingResolutionState =
  | 'missing'
  | 'resolved'
  | 'unresolved'
  | 'unavailable';

export type MemoryEmbeddingCanonicalBankStatus =
  | 'unbound'
  | 'bound_equivalent'
  | 'bound_profile_mismatch'
  | 'rebuild_pending'
  | 'cutover_ready';

export type MemoryEmbeddingRuntimeState = {
  bindingIntentPresent: boolean;
  bindingSourceKind: MemoryEmbeddingSourceKind | null;
  resolutionState: MemoryEmbeddingResolutionState;
  resolvedProfileIdentity: string | null;
  canonicalBankStatus: MemoryEmbeddingCanonicalBankStatus;
  blockedReasonCode: string | null;
  operationReadiness: {
    bindAllowed: boolean;
    cutoverAllowed: boolean;
  };
  traceId?: string;
};

export type MemoryEmbeddingRuntimeTargetRef = {
  kind: 'agent-core';
  agentId: string;
};

export type MemoryEmbeddingRuntimeInput = {
  scopeRef: AIScopeRef;
  targetRef: MemoryEmbeddingRuntimeTargetRef;
};

export type MemoryEmbeddingBindOutcome =
  | 'bound'
  | 'already_bound'
  | 'staged_rebuild'
  | 'rejected';

export type MemoryEmbeddingBindResult = {
  outcome: MemoryEmbeddingBindOutcome;
  blockedReasonCode: string | null;
  canonicalBankStatusAfter: MemoryEmbeddingCanonicalBankStatus;
  pendingCutover: boolean;
  traceId?: string;
};

export type MemoryEmbeddingCutoverOutcome =
  | 'cutover_committed'
  | 'already_current'
  | 'not_ready'
  | 'rejected';

export type MemoryEmbeddingCutoverResult = {
  outcome: MemoryEmbeddingCutoverOutcome;
  blockedReasonCode: string | null;
  canonicalBankStatusAfter: MemoryEmbeddingCanonicalBankStatus;
  traceId?: string;
};

export type MemoryEmbeddingRuntimeSurface = {
  inspect(input: MemoryEmbeddingRuntimeInput): Promise<MemoryEmbeddingRuntimeState>;
  requestBind(input: MemoryEmbeddingRuntimeInput): Promise<MemoryEmbeddingBindResult>;
  requestCutover(input: MemoryEmbeddingRuntimeInput): Promise<MemoryEmbeddingCutoverResult>;
};

type Awaitable<T> = T | Promise<T>;

type HostMemoryEmbeddingRuntimeClient = {
  readonly appId: string;
  readonly memory: Pick<
    RuntimeMemoryClient,
    | 'inspectMemoryEmbeddingRuntime'
    | 'requestMemoryEmbeddingRuntimeBind'
    | 'requestMemoryEmbeddingRuntimeCutover'
  >;
};

type ProtectedHostMemoryEmbeddingRuntimeClient = HostMemoryEmbeddingRuntimeClient & {
  readonly transport?: RuntimeTransportConfig;
  readonly auth: Pick<RuntimeAuthClient, 'registerApp'>;
  readonly appAuth: Pick<RuntimeAppAuthClient, 'authorizeExternalPrincipal'>;
};

export type HostMemoryEmbeddingRuntimeSurfaceOptions = {
  readonly runtime: () => Awaitable<HostMemoryEmbeddingRuntimeClient>;
  readonly getConfig: (scopeRef: AIScopeRef) => Awaitable<MemoryEmbeddingConfig>;
  readonly getSubjectUserId: () => Awaitable<string>;
  readonly withScopes?: <T>(
    scopes: readonly string[],
    operation: (options: RuntimeCallOptions) => Promise<T>,
  ) => Promise<T>;
  readonly unavailableReasonCode?: string;
};

export type ProtectedHostMemoryEmbeddingRuntimeSurfaceOptions = Omit<
  HostMemoryEmbeddingRuntimeSurfaceOptions,
  'runtime' | 'withScopes'
> & {
  readonly runtime: () => Awaitable<ProtectedHostMemoryEmbeddingRuntimeClient>;
};

export function memoryEmbeddingRuntimeReasonCodeName(value: unknown): string | null {
  return normalizeRuntimeReasonCode(value) || null;
}

export function memoryEmbeddingProfileIdentity(profile: MemoryEmbeddingProfile | undefined): string | null {
  if (!profile) {
    return null;
  }
  const parts = [profile.provider, profile.modelId, profile.version]
    .map((part) => String(part || '').trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(':') : null;
}

export function buildMemoryEmbeddingBindingIntentSnapshot(
  config: MemoryEmbeddingConfig,
): MemoryEmbeddingBindingIntentSnapshot | undefined {
  if (!config.sourceKind || !config.bindingRef) {
    return undefined;
  }
  if (config.sourceKind === 'cloud' && config.bindingRef.kind === 'cloud') {
    return {
      sourceKind: 'cloud',
      cloudBinding: {
        connectorId: config.bindingRef.connectorId,
        modelId: config.bindingRef.modelId,
      },
      revisionToken: config.revisionToken,
    };
  }
  if (config.sourceKind === 'local' && config.bindingRef.kind === 'local') {
    return {
      sourceKind: 'local',
      localBinding: {
        targetId: config.bindingRef.targetId,
      },
      revisionToken: config.revisionToken,
    };
  }
  return undefined;
}

export function buildMemoryEmbeddingAgentCoreLocator(
  targetRef: MemoryEmbeddingRuntimeTargetRef,
): MemoryBankLocator {
  return {
    scope: MemoryBankScope.AGENT_CORE,
    owner: {
      oneofKind: 'agentCore',
      agentCore: {
        agentId: String(targetRef.agentId || '').trim(),
      },
    },
  };
}

export function normalizeMemoryEmbeddingResolutionState(value: unknown): MemoryEmbeddingResolutionState {
  switch (String(value || '').trim()) {
    case 'missing':
    case 'resolved':
    case 'unresolved':
    case 'unavailable':
      return String(value).trim() as MemoryEmbeddingResolutionState;
    default:
      return 'unavailable';
  }
}

export function normalizeMemoryEmbeddingSourceKind(value: unknown): MemoryEmbeddingSourceKind | null {
  switch (String(value || '').trim()) {
    case 'cloud':
      return 'cloud';
    case 'local':
      return 'local';
    default:
      return null;
  }
}

export function normalizeMemoryEmbeddingCanonicalBankStatus(value: unknown): MemoryEmbeddingCanonicalBankStatus {
  switch (String(value || '').trim()) {
    case 'unbound':
    case 'bound_equivalent':
    case 'bound_profile_mismatch':
    case 'rebuild_pending':
    case 'cutover_ready':
      return String(value).trim() as MemoryEmbeddingCanonicalBankStatus;
    default:
      return 'unbound';
  }
}

export function normalizeMemoryEmbeddingBindOutcome(value: unknown): MemoryEmbeddingBindOutcome {
  switch (String(value || '').trim()) {
    case 'bound':
    case 'already_bound':
    case 'staged_rebuild':
    case 'rejected':
      return String(value).trim() as MemoryEmbeddingBindOutcome;
    default:
      return 'rejected';
  }
}

export function normalizeMemoryEmbeddingCutoverOutcome(value: unknown): MemoryEmbeddingCutoverOutcome {
  switch (String(value || '').trim()) {
    case 'cutover_committed':
    case 'already_current':
    case 'not_ready':
    case 'rejected':
      return String(value).trim() as MemoryEmbeddingCutoverOutcome;
    default:
      return 'rejected';
  }
}

export function projectMemoryEmbeddingRuntimeState(
  result: InspectMemoryEmbeddingRuntimeResponse,
): MemoryEmbeddingRuntimeState {
  return {
    bindingIntentPresent: result.bindingIntentPresent,
    bindingSourceKind: normalizeMemoryEmbeddingSourceKind(result.bindingSourceKind),
    resolutionState: normalizeMemoryEmbeddingResolutionState(result.resolutionState),
    resolvedProfileIdentity: memoryEmbeddingProfileIdentity(result.resolvedProfile),
    canonicalBankStatus: normalizeMemoryEmbeddingCanonicalBankStatus(result.canonicalBankStatus),
    blockedReasonCode: memoryEmbeddingRuntimeReasonCodeName(result.blockedReasonCode),
    operationReadiness: {
      bindAllowed: Boolean(result.operationReadiness?.bindAllowed),
      cutoverAllowed: Boolean(result.operationReadiness?.cutoverAllowed),
    },
  };
}

export function projectMemoryEmbeddingBindResult(
  result: RequestMemoryEmbeddingRuntimeBindResponse,
): MemoryEmbeddingBindResult {
  return {
    outcome: normalizeMemoryEmbeddingBindOutcome(result.outcome),
    blockedReasonCode: memoryEmbeddingRuntimeReasonCodeName(result.blockedReasonCode),
    canonicalBankStatusAfter: normalizeMemoryEmbeddingCanonicalBankStatus(result.canonicalBankStatusAfter),
    pendingCutover: result.pendingCutover,
  };
}

export function projectMemoryEmbeddingCutoverResult(
  result: RequestMemoryEmbeddingRuntimeCutoverResponse,
): MemoryEmbeddingCutoverResult {
  return {
    outcome: normalizeMemoryEmbeddingCutoverOutcome(result.outcome),
    blockedReasonCode: memoryEmbeddingRuntimeReasonCodeName(result.blockedReasonCode),
    canonicalBankStatusAfter: normalizeMemoryEmbeddingCanonicalBankStatus(result.canonicalBankStatusAfter),
  };
}

export function projectUnavailableMemoryEmbeddingRuntimeState(
  input: {
    config: MemoryEmbeddingConfig;
    blockedReasonCode: string;
  },
): MemoryEmbeddingRuntimeState {
  const bindingIntentPresent = Boolean(input.config.sourceKind && input.config.bindingRef);
  return {
    bindingIntentPresent,
    bindingSourceKind: bindingIntentPresent ? input.config.sourceKind : null,
    resolutionState: bindingIntentPresent ? 'unavailable' : 'missing',
    resolvedProfileIdentity: null,
    canonicalBankStatus: 'unbound',
    blockedReasonCode: bindingIntentPresent ? input.blockedReasonCode : null,
    operationReadiness: {
      bindAllowed: false,
      cutoverAllowed: false,
    },
  };
}

function trimText(value: unknown): string {
  return String(value || '').trim();
}

function memoryEmbeddingRuntimeUnavailableReason(input: HostMemoryEmbeddingRuntimeSurfaceOptions): string {
  return input.unavailableReasonCode || ReasonCode.RUNTIME_UNAVAILABLE;
}

async function callWithMemoryEmbeddingScopes<T>(
  input: HostMemoryEmbeddingRuntimeSurfaceOptions,
  scopes: readonly string[],
  operation: (options: RuntimeCallOptions) => Promise<T>,
): Promise<T> {
  return input.withScopes ? input.withScopes(scopes, operation) : operation({});
}

function projectUnavailableMemoryEmbeddingBindResult(input: {
  config: MemoryEmbeddingConfig;
  blockedReasonCode: string;
}): MemoryEmbeddingBindResult {
  const state = projectUnavailableMemoryEmbeddingRuntimeState(input);
  return {
    outcome: 'rejected',
    blockedReasonCode: state.blockedReasonCode || input.blockedReasonCode,
    canonicalBankStatusAfter: state.canonicalBankStatus,
    pendingCutover: false,
  };
}

function projectUnavailableMemoryEmbeddingCutoverResult(input: {
  config: MemoryEmbeddingConfig;
  blockedReasonCode: string;
}): MemoryEmbeddingCutoverResult {
  const state = projectUnavailableMemoryEmbeddingRuntimeState(input);
  return {
    outcome: 'not_ready',
    blockedReasonCode: state.blockedReasonCode || input.blockedReasonCode,
    canonicalBankStatusAfter: state.canonicalBankStatus,
  };
}

export function createHostMemoryEmbeddingRuntimeSurface(
  options: HostMemoryEmbeddingRuntimeSurfaceOptions,
): MemoryEmbeddingRuntimeSurface {
  async function resolveRuntimeContext(scopeRef: AIScopeRef): Promise<
    | { ok: true; config: MemoryEmbeddingConfig; runtime: HostMemoryEmbeddingRuntimeClient; subjectUserId: string }
    | { ok: false; config: MemoryEmbeddingConfig; blockedReasonCode: string }
  > {
    const config = await options.getConfig(scopeRef);
    const subjectUserId = trimText(await options.getSubjectUserId());
    if (!subjectUserId) {
      return {
        ok: false,
        config,
        blockedReasonCode: memoryEmbeddingRuntimeUnavailableReason(options),
      };
    }
    return {
      ok: true,
      config,
      runtime: await options.runtime(),
      subjectUserId,
    };
  }

  return {
    async inspect(input: MemoryEmbeddingRuntimeInput): Promise<MemoryEmbeddingRuntimeState> {
      const context = await resolveRuntimeContext(input.scopeRef);
      if (!context.ok) {
        return projectUnavailableMemoryEmbeddingRuntimeState({
          config: context.config,
          blockedReasonCode: context.blockedReasonCode,
        });
      }
      const result = await callWithMemoryEmbeddingScopes(
        options,
        ['runtime.memory.read'],
        (callOptions) => context.runtime.memory.inspectMemoryEmbeddingRuntime({
          context: {
            appId: context.runtime.appId,
            subjectUserId: context.subjectUserId,
          },
          locator: buildMemoryEmbeddingAgentCoreLocator(input.targetRef),
          bindingIntentSnapshot: buildMemoryEmbeddingBindingIntentSnapshot(context.config),
        }, callOptions),
      );
      return projectMemoryEmbeddingRuntimeState(result);
    },

    async requestBind(input: MemoryEmbeddingRuntimeInput): Promise<MemoryEmbeddingBindResult> {
      const context = await resolveRuntimeContext(input.scopeRef);
      if (!context.ok) {
        return projectUnavailableMemoryEmbeddingBindResult({
          config: context.config,
          blockedReasonCode: context.blockedReasonCode,
        });
      }
      const result = await callWithMemoryEmbeddingScopes(
        options,
        ['runtime.memory.write'],
        (callOptions) => context.runtime.memory.requestMemoryEmbeddingRuntimeBind({
          context: {
            appId: context.runtime.appId,
            subjectUserId: context.subjectUserId,
          },
          locator: buildMemoryEmbeddingAgentCoreLocator(input.targetRef),
          bindingIntentSnapshot: buildMemoryEmbeddingBindingIntentSnapshot(context.config),
        }, callOptions),
      );
      return projectMemoryEmbeddingBindResult(result);
    },

    async requestCutover(input: MemoryEmbeddingRuntimeInput): Promise<MemoryEmbeddingCutoverResult> {
      const context = await resolveRuntimeContext(input.scopeRef);
      if (!context.ok) {
        return projectUnavailableMemoryEmbeddingCutoverResult({
          config: context.config,
          blockedReasonCode: context.blockedReasonCode,
        });
      }
      const result = await callWithMemoryEmbeddingScopes(
        options,
        ['runtime.memory.write'],
        (callOptions) => context.runtime.memory.requestMemoryEmbeddingRuntimeCutover({
          context: {
            appId: context.runtime.appId,
            subjectUserId: context.subjectUserId,
          },
          locator: buildMemoryEmbeddingAgentCoreLocator(input.targetRef),
          bindingIntentSnapshot: buildMemoryEmbeddingBindingIntentSnapshot(context.config),
        }, callOptions),
      );
      return projectMemoryEmbeddingCutoverResult(result);
    },
  };
}

export function createProtectedHostMemoryEmbeddingRuntimeSurface(
  options: ProtectedHostMemoryEmbeddingRuntimeSurfaceOptions,
): MemoryEmbeddingRuntimeSurface {
  let protectedRuntime: ProtectedHostMemoryEmbeddingRuntimeClient | null = null;
  let protectedAccess: ReturnType<typeof createRuntimeProtectedScopeHelper> | null = null;

  async function getProtectedRuntime() {
    if (protectedRuntime && protectedAccess) {
      return { runtime: protectedRuntime, protectedAccess };
    }
    protectedRuntime = await options.runtime();
    protectedAccess = createRuntimeProtectedScopeHelper({
      runtime: protectedRuntime,
      getSubjectUserId: options.getSubjectUserId,
    });
    return { runtime: protectedRuntime, protectedAccess };
  }

  return createHostMemoryEmbeddingRuntimeSurface({
    ...options,
    runtime: async () => (await getProtectedRuntime()).runtime,
    withScopes: async (scopes, operation) => {
      const access = await getProtectedRuntime();
      return access.protectedAccess.withScopes(scopes, operation);
    },
  });
}
