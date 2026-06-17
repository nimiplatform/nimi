import {
  AgentLifecycleStatus,
  type GetAgentRequest,
  type GetAgentResponse,
  type InitializeAgentRequest,
  type InitializeAgentResponse,
  type RuntimeTypedCallOptions,
  type TerminateAgentRequest,
  type TerminateAgentResponse,
} from '../core-generated/runtime-typed-client';
import { asNimiError, createNimiError, ReasonCode } from '../types';
import { buildRuntimeAgentRequestContext } from './agent-local-identity';
import {
  resolveNimiRuntimeAgentSubjectUserId,
  withNimiRuntimeAgentScopes,
  type NimiRuntimeAgentAppAuthClient,
  type NimiRuntimeAgentAuthClient,
  type NimiRuntimeAgentScopeRunner,
} from './runtime-agent-protected';
import { normalizeNimiRuntimeAgentText } from './runtime-agent-values';

export interface NimiRuntimeAgentLifecycleSurface {
  ensureLocalAgentInitialized(input: NimiRuntimeAgentEnsureLocalAgentInitializedInput): Promise<void>;
  initializeLocalAgent(input: NimiRuntimeAgentInitializeLocalAgentInput): Promise<void>;
  terminateLocalAgent(input: NimiRuntimeAgentTerminateLocalAgentInput): Promise<void>;
}

export interface NimiRuntimeAgentInitializeLocalAgentInput {
  readonly localAgentRef: unknown;
  readonly ownerUserId: unknown;
  readonly runtimeSourceRef: unknown;
  readonly displayName?: unknown;
  readonly worldId?: unknown;
}

export type NimiRuntimeAgentEnsureLocalAgentInitializedInput = NimiRuntimeAgentInitializeLocalAgentInput;

export interface NimiRuntimeAgentTerminateLocalAgentInput {
  readonly localAgentRef: unknown;
  readonly ownerUserId: unknown;
  readonly runtimeSourceRef: unknown;
  readonly reason?: unknown;
}

export interface NimiHostRuntimeAgentLifecycleClient {
  readonly appId: string;
  readonly auth: NimiRuntimeAgentAuthClient;
  readonly appAuth: NimiRuntimeAgentAppAuthClient;
  readonly agent: {
    getAgent(request: GetAgentRequest, options?: RuntimeTypedCallOptions): Promise<GetAgentResponse>;
    initializeAgent(request: InitializeAgentRequest, options?: RuntimeTypedCallOptions): Promise<InitializeAgentResponse>;
    terminateAgent(request: TerminateAgentRequest, options?: RuntimeTypedCallOptions): Promise<TerminateAgentResponse>;
  };
}

export interface NimiHostRuntimeAgentLifecycleSurfaceOptions {
  readonly getRuntime: () => NimiHostRuntimeAgentLifecycleClient;
  readonly getSubjectUserId: () => string | Promise<string | undefined> | undefined;
  readonly withScopes?: NimiRuntimeAgentScopeRunner;
}

function lifecycleError(message: string, reasonCode: string, actionHint: string): never {
  throw createNimiError({
    message,
    reasonCode,
    actionHint,
    source: 'sdk',
  });
}

function requireLifecycleText(value: unknown, reasonCode: string, actionHint: string): string {
  const normalized = normalizeNimiRuntimeAgentText(value);
  if (!normalized) {
    lifecycleError(`Runtime Agent lifecycle requires ${actionHint}.`, reasonCode, actionHint);
  }
  return normalized;
}

function buildLifecycleRequest(input: NimiRuntimeAgentInitializeLocalAgentInput) {
  const localAgentRef = requireLifecycleText(input.localAgentRef, 'SDK_RUNTIME_AGENT_LOCAL_REF_REQUIRED', 'provide_runtime_agent_local_ref');
  const ownerUserId = requireLifecycleText(input.ownerUserId, 'SDK_RUNTIME_AGENT_OWNER_REQUIRED', 'provide_runtime_agent_owner_user_id');
  const runtimeSourceRef = requireLifecycleText(input.runtimeSourceRef, 'SDK_RUNTIME_AGENT_REALM_ID_REQUIRED', 'provide_runtime_agent_runtime_source_ref');
  return {
    localAgentRef,
    ownerUserId,
    runtimeSourceRef,
    displayName: normalizeNimiRuntimeAgentText(input.displayName) || runtimeSourceRef,
    worldId: normalizeNimiRuntimeAgentText(input.worldId),
  };
}

export function createNimiHostRuntimeAgentLifecycleSurface(
  options: NimiHostRuntimeAgentLifecycleSurfaceOptions,
): NimiRuntimeAgentLifecycleSurface {
  async function initializeWithRuntime(input: NimiRuntimeAgentInitializeLocalAgentInput): Promise<void> {
    const runtime = options.getRuntime();
    await resolveNimiRuntimeAgentSubjectUserId(
      options.getSubjectUserId,
      'Runtime Agent lifecycle requires authenticated subject user id.',
    );
    const request = buildLifecycleRequest(input);
    const context = buildRuntimeAgentRequestContext({
      runtimeAppId: runtime.appId,
      subjectUserId: request.ownerUserId,
      localAgentRef: request.localAgentRef,
    });
    try {
      await withNimiRuntimeAgentScopes({
        runtime,
        subjectUserId: request.ownerUserId,
        withScopes: options.withScopes,
      }, ['runtime.agent.admin'], (callOptions) => runtime.agent.initializeAgent({
        context,
        agentId: '',
        localAgentRef: request.localAgentRef,
        ownerUserId: request.ownerUserId,
        runtimeSourceRef: request.runtimeSourceRef,
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
      if (normalized.reasonCode === 'RUNTIME_GRPC_ALREADY_EXISTS') {
        return;
      }
      throw normalized;
    }
  }

  return {
    async ensureLocalAgentInitialized(input) {
      const runtime = options.getRuntime();
      await resolveNimiRuntimeAgentSubjectUserId(
        options.getSubjectUserId,
        'Runtime Agent lifecycle requires authenticated subject user id.',
      );
      const request = buildLifecycleRequest(input);
      const context = buildRuntimeAgentRequestContext({
        runtimeAppId: runtime.appId,
        subjectUserId: request.ownerUserId,
        localAgentRef: request.localAgentRef,
      });
      try {
        const response = await withNimiRuntimeAgentScopes({
          runtime,
          subjectUserId: request.ownerUserId,
          withScopes: options.withScopes,
        }, ['runtime.agent.read'], (callOptions) => runtime.agent.getAgent({
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
      const localAgentRef = requireLifecycleText(input.localAgentRef, 'SDK_RUNTIME_AGENT_LOCAL_REF_REQUIRED', 'provide_runtime_agent_local_ref');
      const ownerUserId = requireLifecycleText(input.ownerUserId, 'SDK_RUNTIME_AGENT_OWNER_REQUIRED', 'provide_runtime_agent_owner_user_id');
      requireLifecycleText(input.runtimeSourceRef, 'SDK_RUNTIME_AGENT_REALM_ID_REQUIRED', 'provide_runtime_agent_runtime_source_ref');
      const context = buildRuntimeAgentRequestContext({
        runtimeAppId: runtime.appId,
        subjectUserId: ownerUserId,
        localAgentRef,
      });
      await withNimiRuntimeAgentScopes({
        runtime,
        subjectUserId: ownerUserId,
        withScopes: options.withScopes,
      }, ['runtime.agent.admin'], (callOptions) => runtime.agent.terminateAgent({
        context,
        agentId: localAgentRef,
        reason: normalizeNimiRuntimeAgentText(input.reason) || 'runtime-agent-lifecycle:terminate-local-agent',
      }, callOptions));
    },
  };
}
