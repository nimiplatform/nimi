import { createNimiProtectedHostMemoryEmbeddingRuntimeSurface } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/runtime/generated';

export type TesterMemoryEmbeddingRuntimeProjection = {
  agentId: string;
  sourceKind: string;
  resolutionState: string;
  bindOutcome: string;
};

const TESTER_MEMORY_EMBEDDING_TARGET_REF = {
  kind: 'agent-core' as const,
  localAgentRef: 'local-agent:tester-user:tester-agent',
};

export function createTesterMemoryEmbeddingRuntimeSurface() {
  const runtime = {
    appId: 'nimi.tester',
    auth: {
      async registerApp() {
        return {
          appInstanceId: 'nimi.tester.memory-embedding',
          accepted: true,
          reasonCode: ReasonCode.REASON_CODE_UNSPECIFIED,
        };
      },
    },
    appAuth: {
      async authorizeExternalPrincipal(request: {
        scopes: string[];
        appId: string;
        subjectUserId: string;
        externalPrincipalId: string;
        policyVersion: string;
        scopeCatalogVersion: string;
      }) {
        return {
          tokenId: 'tester-token',
          secret: 'tester-secret',
          appId: request.appId,
          subjectUserId: request.subjectUserId,
          externalPrincipalId: request.externalPrincipalId,
          effectiveScopes: request.scopes,
          policyVersion: request.policyVersion,
          issuedScopeCatalogVersion: request.scopeCatalogVersion,
          canDelegate: false,
        };
      },
    },
    memory: {
      async inspectMemoryEmbeddingRuntime() {
        return {
          textEmbedIntentPresent: true,
          textEmbedSourceKind: 'cloud',
          configRevision: 1,
          resolutionState: 'resolved',
          canonicalBankStatus: 'bound_equivalent',
          blockedReasonCode: ReasonCode.REASON_CODE_UNSPECIFIED,
          operationReadiness: { bindAllowed: false, cutoverAllowed: false },
        };
      },
      async requestMemoryEmbeddingRuntimeBind() {
        return {
          outcome: 'already_bound',
          blockedReasonCode: ReasonCode.REASON_CODE_UNSPECIFIED,
          canonicalBankStatusAfter: 'bound_equivalent',
          pendingCutover: false,
        };
      },
      async requestMemoryEmbeddingRuntimeCutover() {
        return {
          outcome: 'already_current',
          blockedReasonCode: ReasonCode.REASON_CODE_UNSPECIFIED,
          canonicalBankStatusAfter: 'bound_equivalent',
        };
      },
    },
  };
  return createNimiProtectedHostMemoryEmbeddingRuntimeSurface({
    runtime: () => runtime,
    getSubjectUserId: () => 'tester-user',
  });
}

export function createTesterMemoryEmbeddingRuntimeOnlySurface() {
  return createTesterMemoryEmbeddingRuntimeSurface();
}

export async function inspectTesterMemoryEmbeddingRuntimeProjection(): Promise<TesterMemoryEmbeddingRuntimeProjection> {
  const surface = createTesterMemoryEmbeddingRuntimeSurface();
  const input = {
    targetRef: TESTER_MEMORY_EMBEDDING_TARGET_REF,
  };
  const state = await surface.inspect(input);
  const bind = await surface.requestBind(input);
  return {
    agentId: TESTER_MEMORY_EMBEDDING_TARGET_REF.localAgentRef,
    sourceKind: state.textEmbedSourceKind ?? 'none',
    resolutionState: state.resolutionState,
    bindOutcome: bind.outcome,
  };
}

export function createTesterMemoryEmbeddingRuntimeProjection(): TesterMemoryEmbeddingRuntimeProjection {
  return {
    agentId: TESTER_MEMORY_EMBEDDING_TARGET_REF.localAgentRef,
    sourceKind: 'cloud',
    resolutionState: 'resolved',
    bindOutcome: 'already_bound',
  };
}
