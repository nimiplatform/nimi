import type { AIScopeRef } from '../scope/ai-scope.js';
import {
  type MemoryEmbeddingConfig,
  type MemoryEmbeddingConfigSurface,
} from './memory-embedding-config.js';
import {
  type MemoryEmbeddingRuntimeState,
  type MemoryEmbeddingRuntimeSurface,
} from './memory-embedding-runtime.js';
import { createRuntimeProtectedScopeHelper } from './protected-access.js';
import {
  buildRuntimeAgentCoreMemoryBankLocator,
  buildRuntimeMemoryRequestContext,
  isRuntimeMemoryNotFoundError,
  isRuntimeMemoryUnavailableError,
  projectRuntimeAgentCanonicalMemoryBankStatus,
  projectRuntimeLocalAgentIdentityFromRef,
  runtimeMemoryEmbeddingConfigHasBindingIntent,
  type RuntimeAgentCanonicalMemoryBankStatus,
} from './runtime-agent-memory.js';
import type {
  RuntimeAppAuthClient,
  RuntimeAuthClient,
  RuntimeMemoryClient,
} from './types-client-interfaces.js';
import type { RuntimeTransportConfig } from './types.js';

type Awaitable<T> = T | Promise<T>;

export type RuntimeAgentMemorySurface = {
  getCanonicalBankStatus(agentId: string): Promise<RuntimeAgentCanonicalMemoryBankStatus>;
  bindCanonicalBankStandard(agentId: string): Promise<RuntimeAgentCanonicalMemoryBankStatus>;
};

export type RuntimeAgentMemoryEmbeddingSurface = {
  memoryEmbeddingConfig: MemoryEmbeddingConfigSurface;
  memoryEmbeddingRuntime: MemoryEmbeddingRuntimeSurface;
};

export type HostRuntimeAgentMemoryClient = {
  readonly appId: string;
  readonly transport?: RuntimeTransportConfig;
  readonly auth: Pick<RuntimeAuthClient, 'registerApp'>;
  readonly appAuth: Pick<RuntimeAppAuthClient, 'authorizeExternalPrincipal'>;
  readonly memory: Pick<RuntimeMemoryClient, 'getBank'>;
};

export type HostRuntimeAgentMemorySurfaceOptions = {
  getRuntime: () => HostRuntimeAgentMemoryClient;
  getSubjectUserId: () => Awaitable<string | undefined>;
  getMemoryEmbeddingSurface: () => RuntimeAgentMemoryEmbeddingSurface;
  getMemoryEmbeddingScopeRef: () => AIScopeRef;
};

function normalizeRuntimeAgentMemoryText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildAgentMemoryRequestContext(
  runtime: HostRuntimeAgentMemoryClient,
  subjectUserId: string,
  localAgentRef: string,
) {
  return {
    ...buildRuntimeMemoryRequestContext({
      runtimeAppId: runtime.appId,
      subjectUserId,
    }),
    ...projectRuntimeLocalAgentIdentityFromRef(localAgentRef),
  };
}

function buildMemoryEmbeddingRuntimeInput(scopeRef: AIScopeRef, agentId: string) {
  return {
    scopeRef,
    targetRef: {
      kind: 'agent-core' as const,
      agentId,
    },
  };
}

export function createHostRuntimeAgentMemorySurface(
  options: HostRuntimeAgentMemorySurfaceOptions,
): RuntimeAgentMemorySurface {
  let protectedAccess: ReturnType<typeof createRuntimeProtectedScopeHelper> | null = null;

  const resolveSubjectUserId = async (): Promise<string> => {
    const subjectUserId = normalizeRuntimeAgentMemoryText(await options.getSubjectUserId());
    if (!subjectUserId) {
      throw new Error('runtime agent memory requires authenticated subject user id');
    }
    return subjectUserId;
  };

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

  const deriveCanonicalBankStatus = async (
    agentId: string,
    state: MemoryEmbeddingRuntimeState,
    config: MemoryEmbeddingConfig,
  ): Promise<RuntimeAgentCanonicalMemoryBankStatus> => {
    let bank = null;
    try {
      const runtime = options.getRuntime();
      const subjectUserId = await resolveSubjectUserId();
      const context = buildAgentMemoryRequestContext(runtime, subjectUserId, agentId);
      const locator = buildRuntimeAgentCoreMemoryBankLocator(agentId);
      const response = await getProtectedAccess().withScopes(['runtime.memory.read'], (callOptions) => (
        runtime.memory.getBank({ context, locator }, callOptions)
      ));
      bank = response.bank ?? null;
    } catch (error) {
      if (!isRuntimeMemoryNotFoundError(error) && !isRuntimeMemoryUnavailableError(error)) {
        throw error;
      }
    }

    return projectRuntimeAgentCanonicalMemoryBankStatus({ state, config, bank });
  };

  const getCanonicalBankStatus = async (
    agentId: string,
  ): Promise<RuntimeAgentCanonicalMemoryBankStatus> => {
    const normalizedAgentId = normalizeRuntimeAgentMemoryText(agentId);
    if (!normalizedAgentId) {
      throw new Error('AGENT_ID_REQUIRED');
    }
    try {
      const memoryEmbeddingSurface = options.getMemoryEmbeddingSurface();
      const runtimeInput = buildMemoryEmbeddingRuntimeInput(
        options.getMemoryEmbeddingScopeRef(),
        normalizedAgentId,
      );
      const config = memoryEmbeddingSurface.memoryEmbeddingConfig.get(runtimeInput.scopeRef);
      const state = await memoryEmbeddingSurface.memoryEmbeddingRuntime.inspect(runtimeInput);
      return deriveCanonicalBankStatus(normalizedAgentId, state, config);
    } catch (error) {
      if (isRuntimeMemoryUnavailableError(error)) {
        return { mode: 'unavailable' };
      }
      throw error;
    }
  };

  return {
    getCanonicalBankStatus,

    async bindCanonicalBankStandard(agentId: string): Promise<RuntimeAgentCanonicalMemoryBankStatus> {
      const normalizedAgentId = normalizeRuntimeAgentMemoryText(agentId);
      if (!normalizedAgentId) {
        throw new Error('AGENT_ID_REQUIRED');
      }
      const memoryEmbeddingSurface = options.getMemoryEmbeddingSurface();
      const runtimeInput = buildMemoryEmbeddingRuntimeInput(
        options.getMemoryEmbeddingScopeRef(),
        normalizedAgentId,
      );
      const config = memoryEmbeddingSurface.memoryEmbeddingConfig.get(runtimeInput.scopeRef);
      if (!runtimeMemoryEmbeddingConfigHasBindingIntent(config)) {
        throw new Error('MEMORY_EMBEDDING_BINDING_INTENT_REQUIRED');
      }
      const bindResult = await memoryEmbeddingSurface.memoryEmbeddingRuntime.requestBind(runtimeInput);
      if (bindResult.outcome === 'staged_rebuild' || bindResult.pendingCutover) {
        await memoryEmbeddingSurface.memoryEmbeddingRuntime.requestCutover(runtimeInput);
      }
      return getCanonicalBankStatus(normalizedAgentId);
    },
  };
}
