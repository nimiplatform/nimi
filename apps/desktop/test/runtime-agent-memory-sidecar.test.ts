import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentCanonicalMemoryBankMode, ReasonCode } from '@nimiplatform/sdk/runtime/generated';
import {
  createRuntimeAgentMemoryAdapter,
} from '../src/shell/renderer/infra/runtime-agent-memory';

const LOCAL_AGENT_REF = 'local-agent:user-1:agent-1';

function runtimeStatus(input: {
  mode: AgentCanonicalMemoryBankMode;
  bankId?: string;
  modelId?: string;
  bindingSourceKind?: string;
  pendingCutover?: boolean;
  canonicalBankStatus?: string;
  bindAllowed?: boolean;
}) {
  return {
    mode: input.mode,
    bankId: input.bankId ?? '',
    embeddingProfile: input.modelId
      ? {
        provider: 'local',
        modelId: input.modelId,
        version: 'v1',
        dimension: 768,
        distanceMetric: 1,
        migrationPolicy: 1,
      }
      : undefined,
    bindingSourceKind: input.bindingSourceKind ?? '',
    blockedReasonCode: ReasonCode.REASON_CODE_UNSPECIFIED,
    pendingCutover: input.pendingCutover ?? false,
    canonicalBankStatus: input.canonicalBankStatus ?? 'unbound',
    bindAllowed: input.bindAllowed ?? false,
    cutoverAllowed: false,
  };
}

function createRuntimeMock(statuses: Array<ReturnType<typeof runtimeStatus>>) {
  const calls = {
    getStatus: [] as Array<Record<string, unknown>>,
    bind: [] as Array<Record<string, unknown>>,
  };
  let index = 0;
  const currentStatus = () => statuses[Math.min(index, statuses.length - 1)];
  return {
    calls,
    runtime: {
      appId: 'desktop-test',
      auth: {
        async registerApp() {
          return { accepted: true };
        },
      },
      appAuth: {
        async authorizeExternalPrincipal() {
          return { tokenId: 'token-1', secret: 'secret-1' };
        },
      },
      agent: {
        getAgentCanonicalMemoryBankStatus: async (input: Record<string, unknown>, options?: Record<string, unknown>) => {
          calls.getStatus.push({ ...input, __options: options });
          return { status: currentStatus() };
        },
        requestAgentCanonicalMemoryBankBind: async (input: Record<string, unknown>, options?: Record<string, unknown>) => {
          calls.bind.push({ ...input, __options: options });
          index += 1;
          return {
            status: currentStatus(),
            outcome: 'bound',
            blockedReasonCode: ReasonCode.REASON_CODE_UNSPECIFIED,
          };
        },
      },
    },
  };
}

test('runtime agent memory adapter consumes Runtime Agent canonical bank status', async () => {
  const { runtime, calls } = createRuntimeMock([
    runtimeStatus({
      mode: AgentCanonicalMemoryBankMode.STANDARD,
      bankId: 'bank-agent-1',
      modelId: 'local/embed-alpha',
      bindingSourceKind: 'cloud',
      pendingCutover: true,
      canonicalBankStatus: 'rebuild_pending',
    }),
  ]);
  const adapter = createRuntimeAgentMemoryAdapter({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'user-1',
  });

  const standard = await adapter.getCanonicalBankStatus(LOCAL_AGENT_REF);
  assert.deepEqual(standard, {
    mode: 'standard',
    bankId: 'bank-agent-1',
    embeddingProfileModelId: 'local/embed-alpha',
    bindingSourceKind: 'cloud',
    blockedReasonCode: undefined,
    pendingCutover: true,
    canonicalBankStatus: 'rebuild_pending',
    bindAllowed: false,
    cutoverAllowed: false,
  });
  assert.equal(calls.getStatus.length, 1);
  const { __options: getStatusOptions, ...getStatusRequest } = calls.getStatus[0] || {};
  assert.deepEqual(getStatusRequest, {
    agentId: LOCAL_AGENT_REF,
    context: {
      appId: 'desktop-test',
      subjectUserId: 'user-1',
      ownerUserId: 'user-1',
      realmAgentId: 'agent-1',
      localAgentRef: LOCAL_AGENT_REF,
    },
  });
  assert.equal((getStatusOptions as { metadata?: Record<string, string> } | undefined)?.metadata?.['x-nimi-access-token-id'], 'token-1');
});

test('runtime agent memory adapter binds through Runtime Agent without app-side intent checks', async () => {
  const { runtime, calls } = createRuntimeMock([
    runtimeStatus({
      mode: AgentCanonicalMemoryBankMode.BASELINE,
      bankId: 'bank-agent-1',
      bindingSourceKind: 'local',
      bindAllowed: true,
    }),
    runtimeStatus({
      mode: AgentCanonicalMemoryBankMode.STANDARD,
      bankId: 'bank-agent-1',
      modelId: 'local/embed-alpha',
      bindingSourceKind: 'local',
      canonicalBankStatus: 'bound_equivalent',
    }),
  ]);
  const adapter = createRuntimeAgentMemoryAdapter({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'user-1',
  });

  const result = await adapter.bindCanonicalBankStandard(LOCAL_AGENT_REF);
  assert.deepEqual(result, {
    mode: 'standard',
    bankId: 'bank-agent-1',
    embeddingProfileModelId: 'local/embed-alpha',
    bindingSourceKind: 'local',
    blockedReasonCode: undefined,
    pendingCutover: false,
    canonicalBankStatus: 'bound_equivalent',
    bindAllowed: false,
    cutoverAllowed: false,
  });
  assert.equal(calls.bind.length, 1);
  assert.equal((calls.bind[0]?.__options as { metadata?: Record<string, string> } | undefined)?.metadata?.['x-nimi-access-token-id'], 'token-1');
});
