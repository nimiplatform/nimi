import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AgentCanonicalMemoryBankMode,
  createHostRuntimeAgentMemorySurface,
} from '../src/runtime/index.js';

const LOCAL_AGENT_REF = 'local-agent:user-1:agent-1';

function createRuntime() {
  const calls = {
    getStatus: [] as Array<Record<string, unknown>>,
    bind: [] as Array<Record<string, unknown>>,
  };
  const status = {
    mode: AgentCanonicalMemoryBankMode.STANDARD,
    bankId: 'bank-agent-1',
    embeddingProfile: {
      provider: 'runtime',
      modelId: 'embed-1',
      version: 'v1',
      dimension: 768,
      distanceMetric: 1,
      migrationPolicy: 1,
    },
    bindingSourceKind: 'cloud',
    blockedReasonCode: 0,
    pendingCutover: true,
    canonicalBankStatus: 'rebuild_pending',
    bindAllowed: false,
    cutoverAllowed: true,
  };
  return {
    calls,
    runtime: {
      appId: 'sdk-test',
      agent: {
        getAgentCanonicalMemoryBankStatus: async (input: Record<string, unknown>) => {
          calls.getStatus.push(input);
          return { status };
        },
        requestAgentCanonicalMemoryBankBind: async (input: Record<string, unknown>) => {
          calls.bind.push(input);
          return { status, outcome: 'staged_rebuild', blockedReasonCode: 0 };
        },
      },
    },
  };
}

test('host Runtime agent memory surface delegates status and bind to Runtime Agent', async () => {
  const runtime = createRuntime();
  const surface = createHostRuntimeAgentMemorySurface({
    getRuntime: () => runtime.runtime,
    getSubjectUserId: () => 'user-1',
  });

  assert.deepEqual(await surface.getCanonicalBankStatus(LOCAL_AGENT_REF), {
    mode: 'standard',
    bankId: 'bank-agent-1',
    embeddingProfileModelId: 'embed-1',
    bindingSourceKind: 'cloud',
    blockedReasonCode: undefined,
    pendingCutover: true,
    canonicalBankStatus: 'rebuild_pending',
    bindAllowed: false,
    cutoverAllowed: true,
  });
  assert.equal(runtime.calls.getStatus.length, 1);
  assert.deepEqual(runtime.calls.getStatus[0], {
    agentId: LOCAL_AGENT_REF,
    context: {
      appId: 'sdk-test',
      subjectUserId: 'user-1',
      ownerUserId: 'user-1',
      realmAgentId: 'agent-1',
      localAgentRef: LOCAL_AGENT_REF,
    },
  });

  assert.deepEqual(await surface.bindCanonicalBankStandard(LOCAL_AGENT_REF), {
    mode: 'standard',
    bankId: 'bank-agent-1',
    embeddingProfileModelId: 'embed-1',
    bindingSourceKind: 'cloud',
    blockedReasonCode: undefined,
    pendingCutover: true,
    canonicalBankStatus: 'rebuild_pending',
    bindAllowed: false,
    cutoverAllowed: true,
  });
  assert.equal(runtime.calls.bind.length, 1);
  assert.deepEqual(runtime.calls.bind[0], runtime.calls.getStatus[0]);
});
