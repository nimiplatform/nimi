import {
  AgentCanonicalMemoryBankMode,
  type AgentCanonicalMemoryBankStatus,
  type GetAgentCanonicalMemoryBankStatusRequest,
  type GetAgentCanonicalMemoryBankStatusResponse,
  type RequestAgentCanonicalMemoryBankBindRequest,
  type RequestAgentCanonicalMemoryBankBindResponse,
  type RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';
import { createNimiError } from '../types';
import { parseRuntimeLocalAgentIdentity } from './agent-local-identity';
import { normalizeNimiRuntimeReasonCode } from './reason-messages';
import {
  type NimiRuntimeAgentAppAuthClient,
  type NimiRuntimeAgentAuthClient,
  type NimiRuntimeAgentScopeRunner,
  resolveNimiRuntimeAgentSubjectUserId,
  withNimiRuntimeAgentScopes,
} from './runtime-agent-protected';
import { normalizeNimiRuntimeAgentText } from './runtime-agent-values';

export type NimiRuntimeAgentCanonicalMemoryMode = 'baseline' | 'standard' | 'unavailable';

export interface NimiRuntimeAgentCanonicalMemoryBankStatus {
  readonly mode: NimiRuntimeAgentCanonicalMemoryMode;
  readonly bankId?: string;
  readonly embeddingProfileModelId?: string;
  readonly bindingSourceKind?: string;
  readonly blockedReasonCode?: string;
  readonly pendingCutover?: boolean;
  readonly canonicalBankStatus?: string;
  readonly bindAllowed?: boolean;
  readonly cutoverAllowed?: boolean;
}

export interface NimiRuntimeAgentMemorySurface {
  getCanonicalBankStatus(agentId: string): Promise<NimiRuntimeAgentCanonicalMemoryBankStatus>;
  bindCanonicalBankStandard(agentId: string): Promise<NimiRuntimeAgentCanonicalMemoryBankStatus>;
}

export interface NimiHostRuntimeAgentMemoryClient {
  readonly appId: string;
  readonly auth: NimiRuntimeAgentAuthClient;
  readonly appAuth: NimiRuntimeAgentAppAuthClient;
  readonly agent: {
    getAgentCanonicalMemoryBankStatus(
      request: GetAgentCanonicalMemoryBankStatusRequest,
      options?: RuntimeTypedCallOptions,
    ): Promise<GetAgentCanonicalMemoryBankStatusResponse>;
    requestAgentCanonicalMemoryBankBind(
      request: RequestAgentCanonicalMemoryBankBindRequest,
      options?: RuntimeTypedCallOptions,
    ): Promise<RequestAgentCanonicalMemoryBankBindResponse>;
  };
}

export interface NimiHostRuntimeAgentMemorySurfaceOptions {
  readonly getRuntime: () => NimiHostRuntimeAgentMemoryClient;
  readonly getSubjectUserId: () => string | Promise<string | undefined> | undefined;
  readonly withScopes?: NimiRuntimeAgentScopeRunner;
}

function projectAgentCanonicalMemoryMode(value: AgentCanonicalMemoryBankMode): NimiRuntimeAgentCanonicalMemoryMode {
  switch (value) {
    case AgentCanonicalMemoryBankMode.BASELINE:
      return 'baseline';
    case AgentCanonicalMemoryBankMode.STANDARD:
      return 'standard';
    case AgentCanonicalMemoryBankMode.UNAVAILABLE:
      return 'unavailable';
    default:
      throw createNimiError({
        message: 'Runtime Agent canonical memory mode is required.',
        reasonCode: 'SDK_RUNTIME_AGENT_CANONICAL_MEMORY_MODE_REQUIRED',
        actionHint: 'check_runtime_agent_memory_status',
        source: 'runtime',
      });
  }
}

export function projectNimiRuntimeAgentCanonicalMemoryBankStatus(
  status: AgentCanonicalMemoryBankStatus | undefined,
): NimiRuntimeAgentCanonicalMemoryBankStatus {
  if (!status) {
    throw createNimiError({
      message: 'Runtime Agent canonical memory status is required.',
      reasonCode: 'SDK_RUNTIME_AGENT_CANONICAL_MEMORY_STATUS_REQUIRED',
      actionHint: 'check_runtime_agent_memory_status',
      source: 'runtime',
    });
  }
  const blockedReasonCode = normalizeNimiRuntimeReasonCode(status.blockedReasonCode) || undefined;
  return {
    mode: projectAgentCanonicalMemoryMode(status.mode),
    bankId: normalizeNimiRuntimeAgentText(status.bankId) || undefined,
    embeddingProfileModelId: normalizeNimiRuntimeAgentText(status.embeddingProfile?.modelId) || undefined,
    bindingSourceKind: normalizeNimiRuntimeAgentText(status.bindingSourceKind) || undefined,
    blockedReasonCode,
    pendingCutover: status.pendingCutover,
    canonicalBankStatus: normalizeNimiRuntimeAgentText(status.canonicalBankStatus) || undefined,
    bindAllowed: status.bindAllowed,
    cutoverAllowed: status.cutoverAllowed,
  };
}

async function resolveSubjectUserId(
  getSubjectUserId: () => string | Promise<string | undefined> | undefined,
): Promise<string> {
  return resolveNimiRuntimeAgentSubjectUserId(
    getSubjectUserId,
    'Runtime Agent memory requires authenticated subject user id.',
  );
}

function buildAgentCanonicalMemoryRequest(
  runtime: NimiHostRuntimeAgentMemoryClient,
  subjectUserId: string,
  agentId: string,
): GetAgentCanonicalMemoryBankStatusRequest & RequestAgentCanonicalMemoryBankBindRequest {
  const identity = parseRuntimeLocalAgentIdentity(agentId);
  return {
    agentId: identity.localAgentRef,
    context: {
      appId: normalizeNimiRuntimeAgentText(runtime.appId),
      subjectUserId,
      ownerUserId: identity.ownerUserId,
      runtimeSourceRef: identity.runtimeSourceRef,
      localAgentRef: identity.localAgentRef,
    },
  };
}

export function createNimiHostRuntimeAgentMemorySurface(
  options: NimiHostRuntimeAgentMemorySurfaceOptions,
): NimiRuntimeAgentMemorySurface {
  async function buildRequest(runtime: NimiHostRuntimeAgentMemoryClient, agentId: string) {
    const normalizedAgentId = normalizeNimiRuntimeAgentText(agentId);
    if (!normalizedAgentId) {
      throw createNimiError({
        message: 'Runtime Agent memory requires agent id.',
        reasonCode: 'SDK_RUNTIME_AGENT_ID_REQUIRED',
        actionHint: 'provide_runtime_agent_id',
        source: 'sdk',
      });
    }
    const subjectUserId = await resolveSubjectUserId(options.getSubjectUserId);
    return {
      subjectUserId,
      request: buildAgentCanonicalMemoryRequest(runtime, subjectUserId, normalizedAgentId),
    };
  }

  return {
    async getCanonicalBankStatus(agentId) {
      const runtime = options.getRuntime();
      const { request, subjectUserId } = await buildRequest(runtime, agentId);
      const response = await withNimiRuntimeAgentScopes({
        runtime,
        subjectUserId,
        withScopes: options.withScopes,
      }, ['runtime.agent.read'], (callOptions) => (
        runtime.agent.getAgentCanonicalMemoryBankStatus(request, callOptions)
      ));
      return projectNimiRuntimeAgentCanonicalMemoryBankStatus(response.status);
    },
    async bindCanonicalBankStandard(agentId) {
      const runtime = options.getRuntime();
      const { request, subjectUserId } = await buildRequest(runtime, agentId);
      const response = await withNimiRuntimeAgentScopes({
        runtime,
        subjectUserId,
        withScopes: options.withScopes,
      }, ['runtime.agent.write'], (callOptions) => (
        runtime.agent.requestAgentCanonicalMemoryBankBind(request, callOptions)
      ));
      return projectNimiRuntimeAgentCanonicalMemoryBankStatus(response.status);
    },
  };
}
