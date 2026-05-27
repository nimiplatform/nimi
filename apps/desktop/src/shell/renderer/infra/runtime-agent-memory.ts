import { getPlatformClient } from '@nimiplatform/sdk';
import {
  createDefaultAIScopeRef,
  type AIScopeRef,
  type MemoryEmbeddingConfig,
  type MemoryEmbeddingConfigSurface,
  type MemoryEmbeddingRuntimeState,
  type MemoryEmbeddingRuntimeSurface,
} from '@nimiplatform/sdk/ai';
import {
  asNimiError,
  createRuntimeProtectedScopeHelper,
  MemoryBankScope,
} from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { getDesktopMemoryEmbeddingConfigService } from '@renderer/app-shell/providers/desktop-memory-embedding-config-service';

export type CanonicalMemoryMode = 'baseline' | 'standard' | 'unavailable';

export type CanonicalMemoryBankStatus = {
  mode: CanonicalMemoryMode;
  bankId?: string;
  embeddingProfileModelId?: string;
  bindingSourceKind?: 'cloud' | 'local';
  blockedReasonCode?: string;
  pendingCutover?: boolean;
};

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

function parseLocalAgentIdentity(localAgentRef: string): {
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
} {
  const normalized = normalizeText(localAgentRef);
  const parts = normalized.split(':');
  if (parts.length !== 3 || parts[0] !== 'local-agent' || !parts[1] || !parts[2]) {
    throw new Error('runtime agent memory requires localAgentRef formatted as local-agent:${ownerUserId}:${realmAgentId}');
  }
  return {
    ownerUserId: parts[1],
    realmAgentId: parts[2],
    localAgentRef: normalized,
  };
}

function buildAgentRequestContext(runtime: RuntimeClient, subjectUserId: string, localAgentRef: string) {
  return {
    appId: runtime.appId,
    subjectUserId,
    ...parseLocalAgentIdentity(localAgentRef),
  };
}

function isRuntimeMemoryUnavailable(error: unknown): boolean {
  const normalized = asNimiError(error, {
    reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
    source: 'runtime',
  });
  const reasonCode = normalizeText(normalized.reasonCode);
  if (
    reasonCode === 'AI_LOCAL_SERVICE_UNAVAILABLE'
    || reasonCode === 'RUNTIME_GRPC_UNAVAILABLE'
    || reasonCode === ReasonCode.RUNTIME_UNAVAILABLE
  ) {
    return true;
  }
  const message = normalizeText(normalized.message).toLowerCase();
  return message.includes('local memory substrate is not configured')
    || message.includes('memory embedding profile is unavailable');
}

function isRuntimeNotFound(error: unknown): boolean {
  const normalized = asNimiError(error, {
    reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
    source: 'runtime',
  });
  return normalizeText(normalized.reasonCode) === 'RUNTIME_GRPC_NOT_FOUND'
    || normalizeText(normalized.message).toLowerCase().includes('not found');
}

function hasMemoryEmbeddingBindingIntent(config: MemoryEmbeddingConfig): boolean {
  return Boolean(config.sourceKind && config.bindingRef);
}

function isStandardCanonicalBankStatus(value: string | undefined): boolean {
  const normalized = normalizeText(value);
  return normalized === 'bound_equivalent'
    || normalized === 'bound_profile_mismatch'
    || normalized === 'rebuild_pending'
    || normalized === 'cutover_ready';
}

export function createRuntimeAgentMemoryAdapter(deps: RuntimeAgentMemoryDeps = {}) {
  const getRuntime = deps.getRuntime ?? (() => getPlatformClient().runtime);
  const getMemoryEmbeddingConfigService = deps.getMemoryEmbeddingConfigService
    ?? (() => getDesktopMemoryEmbeddingConfigService());
  const getMemoryEmbeddingScopeRef = deps.getMemoryEmbeddingScopeRef
    ?? (() => createDefaultAIScopeRef());
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

  const readCanonicalBankMetadata = async (agentId: string): Promise<{
    bankId?: string;
    embeddingProfileModelId?: string;
  }> => {
    const runtime = getRuntime();
    const subjectUserId = await resolveSubjectUserId();
    const context = buildAgentRequestContext(runtime, subjectUserId, agentId);
    const locator = {
      scope: MemoryBankScope.AGENT_CORE,
      owner: {
        oneofKind: 'agentCore' as const,
        agentCore: {
          agentId,
        },
      },
    };
    const response = await getProtectedAccess().withScopes(['runtime.memory.read'], (options) => runtime.memory.getBank({
      context,
      locator,
    }, options));
    const bank = response.bank;
    return {
      bankId: normalizeText(bank?.bankId) || undefined,
      embeddingProfileModelId: normalizeText(bank?.embeddingProfile?.modelId) || undefined,
    };
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
    let metadata: { bankId?: string; embeddingProfileModelId?: string } = {};
    try {
      metadata = await readCanonicalBankMetadata(agentId);
    } catch (error) {
      if (!isRuntimeNotFound(error) && !isRuntimeMemoryUnavailable(error)) {
        throw error;
      }
    }

    if (isStandardCanonicalBankStatus(state.canonicalBankStatus)) {
      return {
        mode: 'standard',
        bankId: metadata.bankId,
        embeddingProfileModelId: metadata.embeddingProfileModelId || state.resolvedProfileIdentity || undefined,
        bindingSourceKind: state.bindingSourceKind || undefined,
        blockedReasonCode: normalizeText(state.blockedReasonCode || '') || undefined,
        pendingCutover: state.canonicalBankStatus === 'rebuild_pending'
          || state.canonicalBankStatus === 'cutover_ready',
      };
    }

    if (state.resolutionState === 'resolved' && hasMemoryEmbeddingBindingIntent(config)) {
      return {
        mode: 'baseline',
        bankId: metadata.bankId,
        bindingSourceKind: state.bindingSourceKind || undefined,
      };
    }

    return {
      mode: 'unavailable',
      bankId: metadata.bankId,
      bindingSourceKind: state.bindingSourceKind || undefined,
      blockedReasonCode: normalizeText(state.blockedReasonCode || '') || undefined,
    };
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
        if (isRuntimeMemoryUnavailable(error)) {
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
      if (!hasMemoryEmbeddingBindingIntent(config)) {
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
