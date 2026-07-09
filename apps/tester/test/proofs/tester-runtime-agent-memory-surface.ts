import {
  createNimiHostRuntimeAgentMemorySurface,
  type NimiHostRuntimeAgentMemoryClient,
  type NimiRuntimeAgentScopeRunner,
} from '@nimiplatform/sdk/runtime';
import { AgentCanonicalMemoryBankMode, ReasonCode } from '@nimiplatform/sdk/runtime/wire-types';

const TESTER_RUNTIME_IDENTITY = {
  ownerUserId: 'tester-user',
  runtimeSourceRef: 'runtime-source:tester-agent',
  localAgentRef: 'local-agent:tester-user:tester-agent',
};

function unsupportedRuntimeAgentAuth(): never {
  throw new Error('Tester local agent memory proof must use its scoped harness and must not issue runtime agent auth grants.');
}

export function createTesterRuntimeAgentMemorySurface() {
  const status = {
    mode: AgentCanonicalMemoryBankMode.STANDARD,
    bankId: 'tester-agent-bank',
    embeddingProfile: {
      provider: 'tester',
      modelId: 'tester-embedding',
      version: 'v1',
      dimension: 768,
      distanceMetric: 1,
      migrationPolicy: 1,
    },
    bindingSourceKind: 'cloud',
    blockedReasonCode: ReasonCode.REASON_CODE_UNSPECIFIED,
    pendingCutover: true,
    canonicalBankStatus: 'rebuild_pending',
    bindAllowed: false,
    cutoverAllowed: true,
  };
  const withScopes: NimiRuntimeAgentScopeRunner = async (scopes, operation) => operation({
    metadata: {
      callerKind: 'third-party-app',
      callerId: 'nimi.tester',
      surfaceId: 'tester.runtime-agent-memory',
      requestedScopes: [...scopes].join(','),
    },
  });
  return createNimiHostRuntimeAgentMemorySurface({
    getRuntime: (): NimiHostRuntimeAgentMemoryClient => ({
      appId: 'nimi.tester',
      auth: {
        registerApp: unsupportedRuntimeAgentAuth,
      },
      appAuth: {
        authorizeExternalPrincipal: unsupportedRuntimeAgentAuth,
      },
      agent: {
        getAgentCanonicalMemoryBankStatus: async () => ({ status }),
        requestAgentCanonicalMemoryBankBind: async () => ({
          status,
          outcome: 'staged_rebuild',
          blockedReasonCode: ReasonCode.REASON_CODE_UNSPECIFIED,
        }),
      },
    }),
    getSubjectUserId: () => 'tester-user',
    withScopes,
  });
}

export async function inspectTesterRuntimeAgentMemorySurfaceProjection(): Promise<{
  mode: string;
  bankId: string | null;
  pendingCutover: boolean;
}> {
  const surface = createTesterRuntimeAgentMemorySurface();
  const status = await surface.getCanonicalBankStatus(TESTER_RUNTIME_IDENTITY);
  return {
    mode: status.mode,
    bankId: status.bankId ?? null,
    pendingCutover: status.pendingCutover ?? false,
  };
}
