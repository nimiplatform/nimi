import {
  MemoryBankScope,
  createEmptyMemoryEmbeddingConfig,
  createHostRuntimeAgentMemorySurface,
  type MemoryEmbeddingConfigSurface,
  type MemoryEmbeddingRuntimeSurface,
} from '@nimiplatform/sdk/runtime';

const TESTER_MEMORY_SCOPE_REF = {
  kind: 'feature' as const,
  ownerId: 'tester',
  surfaceId: 'runtime-agent-memory',
};

const TESTER_LOCAL_AGENT_REF = 'local-agent:tester-user:tester-agent';

const testerMemoryConfig = {
  ...createEmptyMemoryEmbeddingConfig(TESTER_MEMORY_SCOPE_REF),
  sourceKind: 'cloud' as const,
  bindingRef: {
    kind: 'cloud' as const,
    connectorId: 'tester-cloud',
    modelId: 'tester-embedding',
  },
};

function createTesterMemoryEmbeddingSurface() {
  const memoryEmbeddingConfig: MemoryEmbeddingConfigSurface = {
    get: () => testerMemoryConfig,
    update: () => {},
    subscribe: () => () => {},
  };
  const memoryEmbeddingRuntime: MemoryEmbeddingRuntimeSurface = {
    inspect: async () => ({
      bindingIntentPresent: true,
      bindingSourceKind: 'cloud',
      resolutionState: 'resolved',
      resolvedProfileIdentity: 'tester:tester-embedding:v1',
      canonicalBankStatus: 'rebuild_pending',
      blockedReasonCode: null,
      operationReadiness: {
        bindAllowed: false,
        cutoverAllowed: true,
      },
    }),
    requestBind: async () => ({
      outcome: 'staged_rebuild',
      blockedReasonCode: null,
      canonicalBankStatusAfter: 'cutover_ready',
      pendingCutover: true,
    }),
    requestCutover: async () => ({
      outcome: 'cutover_committed',
      blockedReasonCode: null,
      canonicalBankStatusAfter: 'bound_equivalent',
    }),
  };
  return { memoryEmbeddingConfig, memoryEmbeddingRuntime };
}

export function createTesterRuntimeAgentMemorySurface() {
  return createHostRuntimeAgentMemorySurface({
    getRuntime: () => ({
      appId: 'dev.nimi.tester',
      auth: {
        registerApp: async () => ({ accepted: true }),
      },
      appAuth: {
        authorizeExternalPrincipal: async () => ({
          tokenId: 'tester-token',
          secret: 'tester-secret',
        }),
      },
      memory: {
        getBank: async () => ({
          bank: {
            bankId: 'tester-agent-bank',
            locator: {
              scope: MemoryBankScope.AGENT_CORE,
              owner: {
                oneofKind: 'agentCore',
                agentCore: {
                  agentId: TESTER_LOCAL_AGENT_REF,
                },
              },
            },
            displayName: 'Tester Agent Memory',
            canonicalAgentScope: true,
            publicApiWritable: false,
            embeddingProfile: {
              provider: 'tester',
              modelId: 'tester-embedding',
              version: 'v1',
              dimension: 768,
              distanceMetric: 1,
              migrationPolicy: 1,
            },
          },
        }),
      },
    }) as never,
    getSubjectUserId: () => 'tester-user',
    getMemoryEmbeddingSurface: () => createTesterMemoryEmbeddingSurface(),
    getMemoryEmbeddingScopeRef: () => TESTER_MEMORY_SCOPE_REF,
  });
}

export async function inspectTesterRuntimeAgentMemorySurfaceProjection(): Promise<{
  mode: string;
  bankId: string | null;
  pendingCutover: boolean;
}> {
  const surface = createTesterRuntimeAgentMemorySurface();
  const status = await surface.getCanonicalBankStatus(TESTER_LOCAL_AGENT_REF);
  return {
    mode: status.mode,
    bankId: status.bankId ?? null,
    pendingCutover: status.pendingCutover ?? false,
  };
}
