import { asNimiError } from '../core/errors.js';
import { ReasonCode } from '../types/index.js';
import { AgentLifecycleStatus } from './generated/runtime/v1/agent_service.js';
import { buildRuntimeAgentRequestContext } from './local-agent-identity.js';
import { createRuntimeProtectedScopeHelper } from './protected-access.js';
import { normalizeRuntimeAgentText } from './runtime-agent-inspect-projection.js';
import type { RuntimeCallOptions, RuntimeTransportConfig } from './types.js';
import type {
  RuntimeAgentClient,
  RuntimeAppAuthClient,
  RuntimeAuthClient,
} from './types-client-interfaces.js';

type Awaitable<T> = T | Promise<T>;

const RUNTIME_GRPC_ALREADY_EXISTS = 'RUNTIME_GRPC_ALREADY_EXISTS';

export type RuntimeAgentLifecycleSurface = {
  ensureLocalAgentInitialized(input: RuntimeAgentEnsureLocalAgentInitializedInput): Promise<void>;
  initializeLocalAgent(input: RuntimeAgentInitializeLocalAgentInput): Promise<void>;
  terminateLocalAgent(input: RuntimeAgentTerminateLocalAgentInput): Promise<void>;
};

export type RuntimeAgentInitializeLocalAgentInput = {
  localAgentRef: unknown;
  ownerUserId: unknown;
  realmAgentId: unknown;
  displayName?: unknown;
  worldId?: unknown;
};

export type RuntimeAgentEnsureLocalAgentInitializedInput = RuntimeAgentInitializeLocalAgentInput;

export type RuntimeAgentTerminateLocalAgentInput = {
  localAgentRef: unknown;
  ownerUserId: unknown;
  realmAgentId: unknown;
  reason?: unknown;
};

export type HostRuntimeAgentLifecycleClient = {
  readonly appId: string;
  readonly transport?: RuntimeTransportConfig;
  readonly auth: Pick<RuntimeAuthClient, 'registerApp'>;
  readonly appAuth: Pick<RuntimeAppAuthClient, 'authorizeExternalPrincipal'>;
  readonly agent: Pick<RuntimeAgentClient, 'getAgent' | 'initializeAgent' | 'terminateAgent'>;
};

export type HostRuntimeAgentLifecycleSurfaceOptions = {
  getRuntime: () => HostRuntimeAgentLifecycleClient;
  getSubjectUserId: () => Awaitable<string | undefined>;
  withScopes?: <T>(
    scopes: readonly string[],
    operation: (options: RuntimeCallOptions) => Promise<T>,
  ) => Promise<T>;
};

function requireLifecycleText(value: unknown, code: string): string {
  const normalized = normalizeRuntimeAgentText(value);
  if (!normalized) {
    throw new Error(code);
  }
  return normalized;
}

function buildLifecycleRequest(input: RuntimeAgentInitializeLocalAgentInput) {
  const localAgentRef = requireLifecycleText(input.localAgentRef, 'LOCAL_AGENT_REF_REQUIRED');
  const ownerUserId = requireLifecycleText(input.ownerUserId, 'OWNER_USER_ID_REQUIRED');
  const realmAgentId = requireLifecycleText(input.realmAgentId, 'REALM_AGENT_ID_REQUIRED');
  return {
    localAgentRef,
    ownerUserId,
    realmAgentId,
    displayName: normalizeRuntimeAgentText(input.displayName) || realmAgentId,
    worldId: normalizeRuntimeAgentText(input.worldId),
  };
}

export function createHostRuntimeAgentLifecycleSurface(
  options: HostRuntimeAgentLifecycleSurfaceOptions,
): RuntimeAgentLifecycleSurface {
  let protectedAccess: ReturnType<typeof createRuntimeProtectedScopeHelper> | null = null;

  const resolveSubjectUserId = async (): Promise<string> => (
    requireLifecycleText(
      await options.getSubjectUserId(),
      'runtime agent lifecycle requires authenticated subject user id',
    )
  );

  const getProtectedAccess = () => {
    if (protectedAccess) {
      return protectedAccess;
    }
    protectedAccess = createRuntimeProtectedScopeHelper({
      runtime: options.getRuntime(),
      getSubjectUserId: async () => resolveSubjectUserId(),
    });
    return protectedAccess;
  };

  const withRuntimeAgentAdmin = <T>(
    operation: (callOptions: RuntimeCallOptions) => Promise<T>,
  ) => (
    options.withScopes
      ? options.withScopes(['runtime.agent.admin'], operation)
      : getProtectedAccess().withScopes(['runtime.agent.admin'], operation)
  );

  const withRuntimeAgentRead = <T>(
    operation: (callOptions: RuntimeCallOptions) => Promise<T>,
  ) => (
    options.withScopes
      ? options.withScopes(['runtime.agent.read'], operation)
      : getProtectedAccess().withScopes(['runtime.agent.read'], operation)
  );

  const initializeWithRuntime = async (
    input: RuntimeAgentInitializeLocalAgentInput,
  ): Promise<void> => {
    const runtime = options.getRuntime();
    const request = buildLifecycleRequest(input);
    const context = buildRuntimeAgentRequestContext({
      runtimeAppId: runtime.appId,
      subjectUserId: request.ownerUserId,
      localAgentRef: request.localAgentRef,
    });
    try {
      await withRuntimeAgentAdmin((callOptions) => runtime.agent.initializeAgent({
        context,
        agentId: '',
        localAgentRef: request.localAgentRef,
        ownerUserId: request.ownerUserId,
        realmAgentId: request.realmAgentId,
        displayName: request.displayName,
        autonomyConfig: undefined,
        worldId: request.worldId,
        metadata: undefined,
      }, callOptions));
    } catch (error) {
      const normalized = asNimiError(error, {
        reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
        actionHint: 'initialize_local_agent',
        source: 'runtime',
      });
      if (normalized.reasonCode === RUNTIME_GRPC_ALREADY_EXISTS) {
        return;
      }
      throw error;
    }
  };

  return {
    async ensureLocalAgentInitialized(input) {
      const runtime = options.getRuntime();
      const request = buildLifecycleRequest(input);
      const context = buildRuntimeAgentRequestContext({
        runtimeAppId: runtime.appId,
        subjectUserId: request.ownerUserId,
        localAgentRef: request.localAgentRef,
      });

      try {
        const response = await withRuntimeAgentRead((callOptions) => runtime.agent.getAgent({
          context,
          agentId: request.localAgentRef,
        }, callOptions));
        if (Number(response.agent?.lifecycleStatus) === AgentLifecycleStatus.ACTIVE) {
          return;
        }
      } catch (error) {
        const normalized = asNimiError(error, {
          reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
          actionHint: 'check_runtime_agent',
          source: 'runtime',
        });
        if (normalized.reasonCode !== 'RUNTIME_GRPC_NOT_FOUND') {
          throw normalized;
        }
      }

      await initializeWithRuntime(input);
    },

    async initializeLocalAgent(input) {
      await initializeWithRuntime(input);
    },

    async terminateLocalAgent(input) {
      const runtime = options.getRuntime();
      const localAgentRef = requireLifecycleText(input.localAgentRef, 'LOCAL_AGENT_REF_REQUIRED');
      const ownerUserId = requireLifecycleText(input.ownerUserId, 'OWNER_USER_ID_REQUIRED');
      requireLifecycleText(input.realmAgentId, 'REALM_AGENT_ID_REQUIRED');
      const context = buildRuntimeAgentRequestContext({
        runtimeAppId: runtime.appId,
        subjectUserId: ownerUserId,
        localAgentRef,
      });
      await withRuntimeAgentAdmin((callOptions) => runtime.agent.terminateAgent({
        context,
        agentId: localAgentRef,
        reason: normalizeRuntimeAgentText(input.reason) || 'runtime-agent-lifecycle:terminate-local-agent',
      }, callOptions));
    },
  };
}
