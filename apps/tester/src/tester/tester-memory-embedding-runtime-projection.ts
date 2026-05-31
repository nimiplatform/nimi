import {
  RuntimeReasonCode,
  buildMemoryEmbeddingAgentCoreLocator,
  buildMemoryEmbeddingBindingIntentSnapshot,
  createEmptyMemoryEmbeddingConfig,
  projectMemoryEmbeddingBindResult,
  projectMemoryEmbeddingRuntimeState,
} from '@nimiplatform/sdk/runtime';

export type TesterMemoryEmbeddingRuntimeProjection = {
  agentId: string;
  sourceKind: string;
  resolutionState: string;
  bindOutcome: string;
};

export function createTesterMemoryEmbeddingRuntimeProjection(): TesterMemoryEmbeddingRuntimeProjection {
  const config = {
    ...createEmptyMemoryEmbeddingConfig({
      kind: 'feature',
      ownerId: 'tester',
      surfaceId: 'settings-memory-runtime',
    }),
    sourceKind: 'cloud' as const,
    bindingRef: {
      kind: 'cloud' as const,
      connectorId: 'tester-cloud',
      modelId: 'tester-embedding',
    },
  };
  const locator = buildMemoryEmbeddingAgentCoreLocator({ kind: 'agent-core', agentId: 'tester-agent' });
  const state = projectMemoryEmbeddingRuntimeState({
    bindingIntentPresent: Boolean(buildMemoryEmbeddingBindingIntentSnapshot(config)),
    bindingSourceKind: 'cloud',
    resolutionState: 'resolved',
    canonicalBankStatus: 'bound_equivalent',
    blockedReasonCode: RuntimeReasonCode.REASON_CODE_UNSPECIFIED,
    operationReadiness: { bindAllowed: false, cutoverAllowed: false },
  });
  const bind = projectMemoryEmbeddingBindResult({
    outcome: 'already_bound',
    blockedReasonCode: RuntimeReasonCode.REASON_CODE_UNSPECIFIED,
    canonicalBankStatusAfter: 'bound_equivalent',
    pendingCutover: false,
  });
  return {
    agentId: locator.owner.oneofKind === 'agentCore' ? locator.owner.agentCore.agentId : 'unknown',
    sourceKind: state.bindingSourceKind ?? 'none',
    resolutionState: state.resolutionState,
    bindOutcome: bind.outcome,
  };
}
