import {
  AgentCanonicalMemoryBankMode,
  RuntimeReasonCode,
  createHostRuntimeAgentMemorySurface,
} from '@nimiplatform/sdk/runtime';

const TESTER_LOCAL_AGENT_REF = 'local-agent:tester-user:tester-agent';

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
    blockedReasonCode: RuntimeReasonCode.REASON_CODE_UNSPECIFIED,
    pendingCutover: true,
    canonicalBankStatus: 'rebuild_pending',
    bindAllowed: false,
    cutoverAllowed: true,
  };
  return createHostRuntimeAgentMemorySurface({
    getRuntime: () => ({
      appId: 'nimi.tester',
      agent: {
        getAgentCanonicalMemoryBankStatus: async () => ({ status }),
        requestAgentCanonicalMemoryBankBind: async () => ({
          status,
          outcome: 'staged_rebuild',
          blockedReasonCode: RuntimeReasonCode.REASON_CODE_UNSPECIFIED,
        }),
      },
    }),
    getSubjectUserId: () => 'tester-user',
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
