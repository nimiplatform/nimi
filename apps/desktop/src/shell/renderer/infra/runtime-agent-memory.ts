import { getPlatformClient } from '@nimiplatform/sdk';
import {
  type AIScopeRef,
  type MemoryEmbeddingConfig,
  type MemoryEmbeddingConfigSurface,
} from '@nimiplatform/sdk/ai';
import {
  buildRuntimeAgentCoreMemoryBankLocator,
  buildRuntimeMemoryRequestContext,
  createRuntimeProtectedScopeHelper,
  isRuntimeMemoryNotFoundError,
  isRuntimeMemoryUnavailableError,
  projectRuntimeAgentCanonicalMemoryBankStatus,
  projectRuntimeLocalAgentIdentityFromRef,
  runtimeMemoryEmbeddingConfigHasBindingIntent,
  type MemoryBank,
  type MemoryEmbeddingRuntimeState,
  type RuntimeAgentCanonicalMemoryBankStatus,
  type MemoryEmbeddingRuntimeSurface,
} from '@nimiplatform/sdk/runtime';
import { getDesktopMemoryEmbeddingConfigService } from '@renderer/app-shell/providers/desktop-memory-embedding-config-service';
import { createDesktopMemoryEmbeddingScopeRef } from '@renderer/app-shell/providers/desktop-memory-embedding-scope';

export type CanonicalMemoryBankStatus = RuntimeAgentCanonicalMemoryBankStatus;

type RuntimeClient = ReturnType<typeof getPlatformClient>['runtime'];
type DesktopMemoryEmbeddingConfigService = {
  memoryEmbeddingConfig: MemoryEmbeddingConfigSurface;
  memoryEmbeddingRuntime: MemoryEmbeddingRuntimeSurface;
};

type RuntimeAgentMemoryDeps = {
  getRuntime?: () => RuntimeClient;
  getSubjectUserId?: () => string | undefined | Promise<string | undefined>;
  getMemoryEmbeddingConfigService?: () => DesktopMemoryEmbeddingConfigService;
  getMemoryEmbeddingScopeRef?: () => AIScopeRef;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildAgentRequestContext(runtime: RuntimeClient, subjectUserId: string, localAgentRef: string) {
  return {
    ...buildRuntimeMemoryRequestContext({
      runtimeAppId: runtime.appId,
      subjectUserId,
    }),
    ...projectRuntimeLocalAgentIdentityFromRef(localAgentRef),
  };
}

export function createRuntimeAgentMemoryAdapter(deps: RuntimeAgentMemoryDeps = {}) {
  const getRuntime = deps.getRuntime ?? (() => getPlatformClient().runtime);
  const getMemoryEmbeddingConfigService = deps.getMemoryEmbeddingConfigService
    ?? (() => getDesktopMemoryEmbeddingConfigService());
  const getMemoryEmbeddingScopeRef = deps.getMemoryEmbeddingScopeRef
    ?? (() => createDesktopMemoryEmbeddingScopeRef());
  let protectedAccess: ReturnType<typeof createRuntimeProtectedScopeHelper> | null = null;

  const resolveSubjectUserId = async (): Promise<string> => {
    const subjectUserId = normalizeText(await deps.getSubjectUserId?.());
    if (!subjectUserId) {
      throw new Error('desktop runtime agent memory requires authenticated subject user id');
    }
    return subjectUserId;
  };

  const getProtectedAccess = () => {
    if (protectedAccess) {
      return protectedAccess;
    }
    protectedAccess = createRuntimeProtectedScopeHelper({
      runtime: getRuntime(),
      getSubjectUserId: async () => resolveSubjectUserId(),
    });
    return protectedAccess;
  };

  const getMemoryEmbeddingRuntimeInput = (agentId: string) => ({
    scopeRef: getMemoryEmbeddingScopeRef(),
    targetRef: {
      kind: 'agent-core' as const,
      agentId,
    },
  });

  const deriveCanonicalBankStatus = async (
    agentId: string,
    state: MemoryEmbeddingRuntimeState,
    config: MemoryEmbeddingConfig,
  ): Promise<CanonicalMemoryBankStatus> => {
    let bank: MemoryBank | null = null;
    try {
      const runtime = getRuntime();
      const subjectUserId = await resolveSubjectUserId();
      const context = buildAgentRequestContext(runtime, subjectUserId, agentId);
      const locator = buildRuntimeAgentCoreMemoryBankLocator(agentId);
      const response = await getProtectedAccess().withScopes(['runtime.memory.read'], (options) => runtime.memory.getBank({
        context,
        locator,
      }, options));
      bank = response.bank ?? null;
    } catch (error) {
      if (!isRuntimeMemoryNotFoundError(error) && !isRuntimeMemoryUnavailableError(error)) {
        throw error;
      }
    }

    return projectRuntimeAgentCanonicalMemoryBankStatus({ state, config, bank });
  };

  return {
    async getCanonicalBankStatus(agentId: string): Promise<CanonicalMemoryBankStatus> {
      const normalizedAgentID = normalizeText(agentId);
      if (!normalizedAgentID) {
        throw new Error('AGENT_ID_REQUIRED');
      }
      try {
        const memoryEmbeddingService = getMemoryEmbeddingConfigService();
        const runtimeInput = getMemoryEmbeddingRuntimeInput(normalizedAgentID);
        const config = memoryEmbeddingService.memoryEmbeddingConfig.get(runtimeInput.scopeRef);
        const state = await memoryEmbeddingService.memoryEmbeddingRuntime.inspect(runtimeInput);
        return deriveCanonicalBankStatus(normalizedAgentID, state, config);
      } catch (error) {
        if (isRuntimeMemoryUnavailableError(error)) {
          return { mode: 'unavailable' };
        }
        throw error;
      }
    },

    async bindCanonicalBankStandard(agentId: string): Promise<CanonicalMemoryBankStatus> {
      const normalizedAgentID = normalizeText(agentId);
      if (!normalizedAgentID) {
        throw new Error('AGENT_ID_REQUIRED');
      }
      const memoryEmbeddingService = getMemoryEmbeddingConfigService();
      const runtimeInput = getMemoryEmbeddingRuntimeInput(normalizedAgentID);
      const config = memoryEmbeddingService.memoryEmbeddingConfig.get(runtimeInput.scopeRef);
      if (!runtimeMemoryEmbeddingConfigHasBindingIntent(config)) {
        throw new Error('MEMORY_EMBEDDING_BINDING_INTENT_REQUIRED');
      }
      const bindResult = await memoryEmbeddingService.memoryEmbeddingRuntime.requestBind(runtimeInput);
      if (bindResult.outcome === 'staged_rebuild' || bindResult.pendingCutover) {
        await memoryEmbeddingService.memoryEmbeddingRuntime.requestCutover(runtimeInput);
      }
      return this.getCanonicalBankStatus(normalizedAgentID);
    },
  };
}
