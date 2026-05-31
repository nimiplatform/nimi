import {
  RuntimeReasonCode,
  createEmptyMemoryEmbeddingConfig,
  createHostMemoryEmbeddingRuntimeSurface,
} from '@nimiplatform/sdk/runtime';

export type TesterMemoryEmbeddingRuntimeProjection = {
  agentId: string;
  sourceKind: string;
  resolutionState: string;
  bindOutcome: string;
};

const TESTER_MEMORY_EMBEDDING_SCOPE_REF = {
  kind: 'feature' as const,
  ownerId: 'tester',
  surfaceId: 'settings-memory-runtime',
};

const TESTER_MEMORY_EMBEDDING_TARGET_REF = {
  kind: 'agent-core' as const,
  agentId: 'tester-agent',
};

const testerMemoryEmbeddingConfig = {
  ...createEmptyMemoryEmbeddingConfig(TESTER_MEMORY_EMBEDDING_SCOPE_REF),
  sourceKind: 'cloud' as const,
  bindingRef: {
    kind: 'cloud' as const,
    connectorId: 'tester-cloud',
    modelId: 'tester-embedding',
  },
};

export function createTesterMemoryEmbeddingRuntimeSurface() {
  return createHostMemoryEmbeddingRuntimeSurface({
    runtime: () => ({
      appId: 'dev.nimi.tester',
      memory: {
        async inspectMemoryEmbeddingRuntime() {
          return {
            bindingIntentPresent: true,
            bindingSourceKind: 'cloud',
            resolutionState: 'resolved',
            canonicalBankStatus: 'bound_equivalent',
            blockedReasonCode: RuntimeReasonCode.REASON_CODE_UNSPECIFIED,
            operationReadiness: { bindAllowed: false, cutoverAllowed: false },
          };
        },
        async requestMemoryEmbeddingRuntimeBind() {
          return {
            outcome: 'already_bound',
            blockedReasonCode: RuntimeReasonCode.REASON_CODE_UNSPECIFIED,
            canonicalBankStatusAfter: 'bound_equivalent',
            pendingCutover: false,
          };
        },
        async requestMemoryEmbeddingRuntimeCutover() {
          return {
            outcome: 'already_current',
            blockedReasonCode: RuntimeReasonCode.REASON_CODE_UNSPECIFIED,
            canonicalBankStatusAfter: 'bound_equivalent',
          };
        },
      },
    }),
    getConfig: () => testerMemoryEmbeddingConfig,
    getSubjectUserId: () => 'tester-user',
  });
}

export async function inspectTesterMemoryEmbeddingRuntimeProjection(): Promise<TesterMemoryEmbeddingRuntimeProjection> {
  const surface = createTesterMemoryEmbeddingRuntimeSurface();
  const input = {
    scopeRef: TESTER_MEMORY_EMBEDDING_SCOPE_REF,
    targetRef: TESTER_MEMORY_EMBEDDING_TARGET_REF,
  };
  const state = await surface.inspect(input);
  const bind = await surface.requestBind(input);
  return {
    agentId: TESTER_MEMORY_EMBEDDING_TARGET_REF.agentId,
    sourceKind: state.bindingSourceKind ?? 'none',
    resolutionState: state.resolutionState,
    bindOutcome: bind.outcome,
  };
}

export function createTesterMemoryEmbeddingRuntimeProjection(): TesterMemoryEmbeddingRuntimeProjection {
  return {
    agentId: TESTER_MEMORY_EMBEDDING_TARGET_REF.agentId,
    sourceKind: 'cloud',
    resolutionState: 'resolved',
    bindOutcome: 'already_bound',
  };
}
