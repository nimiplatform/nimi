import {
  type AgentRecord,
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
import type { JsonObject } from '../types';
import { buildRuntimeAgentRequestContext, isRuntimeLocalAgentRef } from './agent-local-identity';
import {
  resolveNimiRuntimeAgentSubjectUserId,
  withNimiRuntimeAgentScopes,
  type NimiRuntimeAgentAppAuthClient,
  type NimiRuntimeAgentAuthClient,
  type NimiRuntimeAgentScopeRunner,
} from './runtime-agent-protected';
import { normalizeNimiRuntimeAgentText, toNimiRuntimeProtoStruct } from './runtime-agent-values';

export interface NimiRuntimeAgentLifecycleSurface {
  ensureLocalAgentInitialized(input: NimiRuntimeAgentEnsureLocalAgentInitializedInput): Promise<NimiRuntimeAgentInitializedLocalAgent>;
  initializeLocalAgent(input: NimiRuntimeAgentInitializeLocalAgentInput): Promise<NimiRuntimeAgentInitializedLocalAgent>;
  terminateLocalAgent(input: NimiRuntimeAgentTerminateLocalAgentInput): Promise<void>;
}

export interface NimiRuntimeAgentInitializeLocalAgentInput {
  readonly localAgentRef?: unknown;
  readonly ownerUserId: unknown;
  readonly runtimeSourceRef: unknown;
  readonly displayName?: unknown;
  readonly worldId?: unknown;
  readonly sourceMaterializationPacket?: unknown;
}

export interface NimiRuntimeAgentEnsureLocalAgentInitializedInput extends NimiRuntimeAgentInitializeLocalAgentInput {
  readonly localAgentRef: unknown;
}

export interface NimiRuntimeAgentInitializedLocalAgent {
  readonly localAgentRef: string;
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly agent: AgentRecord;
}

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

function normalizeSourceMaterializationPacket(value: unknown): JsonObject | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    lifecycleError(
      'Runtime Agent lifecycle sourceMaterializationPacket must be an object.',
      'SDK_RUNTIME_AGENT_SOURCE_PACKET_INVALID',
      'provide_source_materialization_packet',
    );
  }
  return value as JsonObject;
}

function buildLifecycleRequest(
  input: NimiRuntimeAgentInitializeLocalAgentInput,
  options: { readonly requireLocalAgentRef: boolean },
) {
  const localAgentRef = normalizeNimiRuntimeAgentText(input.localAgentRef);
  if (options.requireLocalAgentRef && !localAgentRef) {
    lifecycleError(
      'Runtime Agent lifecycle requires provide_runtime_agent_local_ref.',
      'SDK_RUNTIME_AGENT_LOCAL_REF_REQUIRED',
      'provide_runtime_agent_local_ref',
    );
  }
  const ownerUserId = requireLifecycleText(input.ownerUserId, 'SDK_RUNTIME_AGENT_OWNER_REQUIRED', 'provide_runtime_agent_owner_user_id');
  const runtimeSourceRef = requireLifecycleText(input.runtimeSourceRef, 'SDK_RUNTIME_AGENT_REALM_ID_REQUIRED', 'provide_runtime_agent_runtime_source_ref');
  return {
    localAgentRef,
    ownerUserId,
    runtimeSourceRef,
    displayName: normalizeNimiRuntimeAgentText(input.displayName) || runtimeSourceRef,
    worldId: normalizeNimiRuntimeAgentText(input.worldId),
    sourceMaterializationPacket: normalizeSourceMaterializationPacket(input.sourceMaterializationPacket),
  };
}

function buildInitializeAgentRequestContext(input: {
  readonly runtimeAppId: string;
  readonly subjectUserId: string;
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
}) {
  return {
    appId: input.runtimeAppId,
    subjectUserId: input.subjectUserId,
    ownerUserId: input.ownerUserId,
    runtimeSourceRef: input.runtimeSourceRef,
    localAgentRef: input.localAgentRef,
  };
}

function normalizeInitializeAgentResponse(
  response: InitializeAgentResponse,
  request: ReturnType<typeof buildLifecycleRequest>,
): NimiRuntimeAgentInitializedLocalAgent {
  const agent = response.agent;
  const localAgentRef = normalizeNimiRuntimeAgentText(agent?.localAgentRef)
    || normalizeNimiRuntimeAgentText(agent?.agentId);
  if (!agent || !isRuntimeLocalAgentRef(localAgentRef)) {
    lifecycleError(
      'Runtime Agent lifecycle initializeAgent returned no Runtime-owned localAgentRef.',
      'SDK_RUNTIME_AGENT_RESPONSE_INVALID',
      'check_runtime_agent_initialize_response',
    );
  }
  return {
    localAgentRef,
    ownerUserId: normalizeNimiRuntimeAgentText(agent.ownerUserId) || request.ownerUserId,
    runtimeSourceRef: normalizeNimiRuntimeAgentText(agent.runtimeSourceRef) || request.runtimeSourceRef,
    agent,
  };
}

export function createNimiHostRuntimeAgentLifecycleSurface(
  options: NimiHostRuntimeAgentLifecycleSurfaceOptions,
): NimiRuntimeAgentLifecycleSurface {
  async function initializeWithRuntime(input: NimiRuntimeAgentInitializeLocalAgentInput): Promise<NimiRuntimeAgentInitializedLocalAgent> {
    const runtime = options.getRuntime();
    await resolveNimiRuntimeAgentSubjectUserId(
      options.getSubjectUserId,
      'Runtime Agent lifecycle requires authenticated subject user id.',
    );
    const request = buildLifecycleRequest(input, { requireLocalAgentRef: false });
    const context = buildInitializeAgentRequestContext({
      runtimeAppId: runtime.appId,
      subjectUserId: request.ownerUserId,
      ownerUserId: request.ownerUserId,
      runtimeSourceRef: request.runtimeSourceRef,
      localAgentRef: request.localAgentRef,
    });
    try {
      const response = await withNimiRuntimeAgentScopes({
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
        metadata: request.sourceMaterializationPacket
          ? toNimiRuntimeProtoStruct({ sourceMaterializationPacket: request.sourceMaterializationPacket })
          : undefined,
      }, callOptions));
      return normalizeInitializeAgentResponse(response, request);
    } catch (error) {
      const normalized = asNimiError(error, {
        reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
        actionHint: 'initialize_local_agent',
        source: 'runtime',
      });
      if (normalized.reasonCode === 'RUNTIME_GRPC_ALREADY_EXISTS') {
        if (request.localAgentRef) {
          return {
            localAgentRef: request.localAgentRef,
            ownerUserId: request.ownerUserId,
            runtimeSourceRef: request.runtimeSourceRef,
            agent: {
              agentId: request.localAgentRef,
              localAgentRef: request.localAgentRef,
              ownerUserId: request.ownerUserId,
              runtimeSourceRef: request.runtimeSourceRef,
              displayName: request.displayName,
              lifecycleStatus: AgentLifecycleStatus.ACTIVE,
            },
          };
        }
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
      const request = buildLifecycleRequest(input, { requireLocalAgentRef: true });
      const context = buildRuntimeAgentRequestContext({
        runtimeAppId: runtime.appId,
        subjectUserId: request.ownerUserId,
        ownerUserId: request.ownerUserId,
        runtimeSourceRef: request.runtimeSourceRef,
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
        const agent = response.agent;
        if (agent && Number(agent.lifecycleStatus) === AgentLifecycleStatus.ACTIVE) {
          return {
            localAgentRef: request.localAgentRef,
            ownerUserId: request.ownerUserId,
            runtimeSourceRef: request.runtimeSourceRef,
            agent,
          };
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
      return initializeWithRuntime(input);
    },
    async initializeLocalAgent(input) {
      return initializeWithRuntime(input);
    },
    async terminateLocalAgent(input) {
      const runtime = options.getRuntime();
      const localAgentRef = requireLifecycleText(input.localAgentRef, 'SDK_RUNTIME_AGENT_LOCAL_REF_REQUIRED', 'provide_runtime_agent_local_ref');
      const ownerUserId = requireLifecycleText(input.ownerUserId, 'SDK_RUNTIME_AGENT_OWNER_REQUIRED', 'provide_runtime_agent_owner_user_id');
      const runtimeSourceRef = requireLifecycleText(input.runtimeSourceRef, 'SDK_RUNTIME_AGENT_REALM_ID_REQUIRED', 'provide_runtime_agent_runtime_source_ref');
      const context = buildRuntimeAgentRequestContext({
        runtimeAppId: runtime.appId,
        subjectUserId: ownerUserId,
        ownerUserId,
        runtimeSourceRef,
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
