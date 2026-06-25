import { buildNimiMemoryEmbeddingBindingIntentSnapshot, createEmptyNimiMemoryEmbeddingConfig, createNimiProtectedHostMemoryEmbeddingConfigSurface, createNimiProtectedHostMemoryEmbeddingRuntimeSurface } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/runtime/generated';

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
  localAgentRef: 'local-agent:tester-user:tester-agent',
};

const testerMemoryEmbeddingConfig = {
  ...createEmptyNimiMemoryEmbeddingConfig(TESTER_MEMORY_EMBEDDING_SCOPE_REF),
  sourceKind: 'cloud' as const,
  bindingRef: {
    kind: 'cloud' as const,
    connectorId: 'tester-cloud',
    remoteModelCatalogId: 'remote-catalog:tester-cloud:tester-embedding',
    providerModelId: 'tester-embedding',
    provider: 'tester',
  },
};

export function createTesterMemoryEmbeddingRuntimeSurface() {
  let bindingIntent = buildNimiMemoryEmbeddingBindingIntentSnapshot(testerMemoryEmbeddingConfig);
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
      async getMemoryEmbeddingRuntimeIntent() {
        return {
          bindingIntentPresent: Boolean(bindingIntent),
          bindingIntent,
        };
      },
      async setMemoryEmbeddingRuntimeIntent(request: {
        bindingIntent?: typeof bindingIntent;
      }) {
        bindingIntent = request.bindingIntent;
        return {
          accepted: true,
          bindingIntentPresent: Boolean(bindingIntent),
          bindingIntent,
        };
      },
      async inspectMemoryEmbeddingRuntime() {
        return {
          bindingIntentPresent: Boolean(bindingIntent),
          bindingSourceKind: bindingIntent?.sourceKind || '',
          resolutionState: bindingIntent ? 'resolved' : 'missing',
          canonicalBankStatus: 'bound_equivalent',
          blockedReasonCode: ReasonCode.REASON_CODE_UNSPECIFIED,
          operationReadiness: { bindAllowed: false, cutoverAllowed: false },
        };
      },
      async requestMemoryEmbeddingRuntimeBind() {
        return {
          outcome: bindingIntent ? 'already_bound' : 'rejected',
          blockedReasonCode: ReasonCode.REASON_CODE_UNSPECIFIED,
          canonicalBankStatusAfter: bindingIntent ? 'bound_equivalent' : 'unbound',
          pendingCutover: false,
        };
      },
      async requestMemoryEmbeddingRuntimeCutover() {
        return {
          outcome: bindingIntent ? 'already_current' : 'not_ready',
          blockedReasonCode: ReasonCode.REASON_CODE_UNSPECIFIED,
          canonicalBankStatusAfter: bindingIntent ? 'bound_equivalent' : 'unbound',
        };
      },
    },
  };
  return {
    memoryEmbeddingConfig: createNimiProtectedHostMemoryEmbeddingConfigSurface({
      runtime: () => runtime,
      getSubjectUserId: () => 'tester-user',
    }),
    memoryEmbeddingRuntime: createNimiProtectedHostMemoryEmbeddingRuntimeSurface({
      runtime: () => runtime,
      getSubjectUserId: () => 'tester-user',
    }),
  };
}

export function createTesterMemoryEmbeddingRuntimeOnlySurface() {
  return createTesterMemoryEmbeddingRuntimeSurface().memoryEmbeddingRuntime;
}

export function createTesterMemoryEmbeddingConfigSurface() {
  return createTesterMemoryEmbeddingRuntimeSurface().memoryEmbeddingConfig;
}

export async function inspectTesterMemoryEmbeddingRuntimeProjection(): Promise<TesterMemoryEmbeddingRuntimeProjection> {
  const surface = createTesterMemoryEmbeddingRuntimeSurface();
  const input = {
    scopeRef: TESTER_MEMORY_EMBEDDING_SCOPE_REF,
    targetRef: TESTER_MEMORY_EMBEDDING_TARGET_REF,
  };
  await surface.memoryEmbeddingConfig.update(input, testerMemoryEmbeddingConfig);
  const state = await surface.memoryEmbeddingRuntime.inspect(input);
  const bind = await surface.memoryEmbeddingRuntime.requestBind(input);
  return {
    agentId: TESTER_MEMORY_EMBEDDING_TARGET_REF.localAgentRef,
    sourceKind: state.bindingSourceKind ?? 'none',
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
