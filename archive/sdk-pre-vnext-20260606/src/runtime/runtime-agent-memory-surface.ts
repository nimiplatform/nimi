import {
  type GetAgentCanonicalMemoryBankStatusRequest,
  type RequestAgentCanonicalMemoryBankBindRequest,
} from './generated/runtime/v1/agent_service.js';
import type { RuntimeAgentClient } from './types-client-interfaces.js';
import {
  projectRuntimeAgentCanonicalMemoryBankStatus,
  type RuntimeAgentCanonicalMemoryBankStatus,
} from './runtime-agent-memory.js';
import {
  parseRuntimeLocalAgentIdentity,
} from './local-agent-identity.js';
import type { RuntimeTransportConfig } from './types.js';

type Awaitable<T> = T | Promise<T>;

export type RuntimeAgentMemorySurface = {
  getCanonicalBankStatus(agentId: string): Promise<RuntimeAgentCanonicalMemoryBankStatus>;
  bindCanonicalBankStandard(agentId: string): Promise<RuntimeAgentCanonicalMemoryBankStatus>;
};

export type HostRuntimeAgentMemoryClient = {
  readonly appId: string;
  readonly transport?: RuntimeTransportConfig;
  readonly agent: Pick<
    RuntimeAgentClient,
    | 'getAgentCanonicalMemoryBankStatus'
    | 'requestAgentCanonicalMemoryBankBind'
  >;
};

export type HostRuntimeAgentMemorySurfaceOptions = {
  getRuntime: () => HostRuntimeAgentMemoryClient;
  getSubjectUserId: () => Awaitable<string | undefined>;
};

function normalizeRuntimeAgentMemoryText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildAgentCanonicalMemoryRequest(
  runtime: HostRuntimeAgentMemoryClient,
  subjectUserId: string,
  agentId: string,
): GetAgentCanonicalMemoryBankStatusRequest & RequestAgentCanonicalMemoryBankBindRequest {
  const identity = parseRuntimeLocalAgentIdentity(agentId);
  return {
    agentId: identity.localAgentRef,
    context: {
      appId: normalizeRuntimeAgentMemoryText(runtime.appId),
      subjectUserId,
      ownerUserId: identity.ownerUserId,
      realmAgentId: identity.realmAgentId,
      localAgentRef: identity.localAgentRef,
    },
  };
}

export function createHostRuntimeAgentMemorySurface(
  options: HostRuntimeAgentMemorySurfaceOptions,
): RuntimeAgentMemorySurface {
  const resolveSubjectUserId = async (): Promise<string> => {
    const subjectUserId = normalizeRuntimeAgentMemoryText(await options.getSubjectUserId());
    if (!subjectUserId) {
      throw new Error('runtime agent memory requires authenticated subject user id');
    }
    return subjectUserId;
  };

  const buildRequest = async (runtime: HostRuntimeAgentMemoryClient, agentId: string) => {
    const normalizedAgentId = normalizeRuntimeAgentMemoryText(agentId);
    if (!normalizedAgentId) {
      throw new Error('AGENT_ID_REQUIRED');
    }
    return buildAgentCanonicalMemoryRequest(
      runtime,
      await resolveSubjectUserId(),
      normalizedAgentId,
    );
  };

  return {
    async getCanonicalBankStatus(agentId: string): Promise<RuntimeAgentCanonicalMemoryBankStatus> {
      const runtime = options.getRuntime();
      const request = await buildRequest(runtime, agentId);
      const response = await runtime.agent.getAgentCanonicalMemoryBankStatus(request);
      return projectRuntimeAgentCanonicalMemoryBankStatus(response.status);
    },

    async bindCanonicalBankStandard(agentId: string): Promise<RuntimeAgentCanonicalMemoryBankStatus> {
      const runtime = options.getRuntime();
      const request = await buildRequest(runtime, agentId);
      const response = await runtime.agent.requestAgentCanonicalMemoryBankBind(request);
      return projectRuntimeAgentCanonicalMemoryBankStatus(response.status);
    },
  };
}
