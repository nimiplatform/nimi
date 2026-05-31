import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MemoryBankScope,
  createEmptyMemoryEmbeddingConfig,
  createHostRuntimeAgentMemorySurface,
  type MemoryEmbeddingConfigSurface,
  type MemoryEmbeddingRuntimeSurface,
} from '../src/runtime/index.js';

const SCOPE_REF = {
  kind: 'feature' as const,
  ownerId: 'sdk-test',
  surfaceId: 'runtime-agent-memory',
};
const LOCAL_AGENT_REF = 'local-agent:user-1:agent-1';

function createMemoryEmbeddingSurface(input?: {
  canonicalBankStatus?: 'bound_equivalent' | 'rebuild_pending';
}) {
  const config = {
    ...createEmptyMemoryEmbeddingConfig(SCOPE_REF),
    sourceKind: 'cloud' as const,
    bindingRef: {
      kind: 'cloud' as const,
      connectorId: 'conn-1',
      modelId: 'embed-1',
    },
  };
  const calls = {
    bind: 0,
    cutover: 0,
  };
  const memoryEmbeddingConfig: MemoryEmbeddingConfigSurface = {
    get: () => config,
    update: () => {},
    subscribe: () => () => {},
  };
  const memoryEmbeddingRuntime: MemoryEmbeddingRuntimeSurface = {
    inspect: async () => ({
      bindingIntentPresent: true,
      bindingSourceKind: 'cloud',
      resolutionState: 'resolved',
      resolvedProfileIdentity: 'runtime:embed-1:v1',
      canonicalBankStatus: input?.canonicalBankStatus ?? 'rebuild_pending',
      blockedReasonCode: null,
      operationReadiness: { bindAllowed: false, cutoverAllowed: true },
    }),
    requestBind: async () => {
      calls.bind += 1;
      return {
        outcome: 'staged_rebuild',
        blockedReasonCode: null,
        canonicalBankStatusAfter: 'cutover_ready',
        pendingCutover: true,
      };
    },
    requestCutover: async () => {
      calls.cutover += 1;
      return {
        outcome: 'cutover_committed',
        blockedReasonCode: null,
        canonicalBankStatusAfter: 'bound_equivalent',
      };
    },
  };
  return {
    calls,
    surface: {
      memoryEmbeddingConfig,
      memoryEmbeddingRuntime,
    },
  };
}

function createRuntime() {
  const calls = {
    registerApp: 0,
    authorizeExternalPrincipal: [] as Array<Record<string, unknown>>,
    getBank: [] as Array<Record<string, unknown>>,
  };
  const runtime = {
    appId: 'sdk-test',
    auth: {
      registerApp: async () => {
        calls.registerApp += 1;
        return { accepted: true };
      },
    },
    appAuth: {
      authorizeExternalPrincipal: async (input: Record<string, unknown>) => {
        calls.authorizeExternalPrincipal.push(input);
        return { tokenId: 'token-id', secret: 'token-secret' };
      },
    },
    memory: {
      getBank: async (input: Record<string, unknown>, options?: Record<string, unknown>) => {
        calls.getBank.push({ ...input, __options: options });
        return {
          bank: {
            bankId: 'bank-agent-1',
            locator: {
              scope: MemoryBankScope.AGENT_CORE,
              owner: {
                oneofKind: 'agentCore',
                agentCore: { agentId: LOCAL_AGENT_REF },
              },
            },
            displayName: 'Agent Memory',
            canonicalAgentScope: true,
            publicApiWritable: false,
            embeddingProfile: {
              provider: 'runtime',
              modelId: 'embed-1',
              version: 'v1',
              dimension: 768,
              distanceMetric: 1,
              migrationPolicy: 1,
            },
          },
        };
      },
    },
  };
  return { calls, runtime };
}

test('host Runtime agent memory surface composes protected memory reads and binding flow', async () => {
  const runtime = createRuntime();
  const memoryEmbedding = createMemoryEmbeddingSurface();
  const surface = createHostRuntimeAgentMemorySurface({
    getRuntime: () => runtime.runtime,
    getSubjectUserId: () => 'user-1',
    getMemoryEmbeddingSurface: () => memoryEmbedding.surface,
    getMemoryEmbeddingScopeRef: () => SCOPE_REF,
  });

  assert.deepEqual(await surface.getCanonicalBankStatus(LOCAL_AGENT_REF), {
    mode: 'standard',
    bankId: 'bank-agent-1',
    embeddingProfileModelId: 'embed-1',
    bindingSourceKind: 'cloud',
    blockedReasonCode: undefined,
    pendingCutover: true,
  });
  assert.equal(runtime.calls.registerApp, 1);
  assert.equal(runtime.calls.authorizeExternalPrincipal.length, 1);
  assert.equal(runtime.calls.getBank.length, 1);
  assert.deepEqual(runtime.calls.getBank[0]?.context, {
    appId: 'sdk-test',
    subjectUserId: 'user-1',
    ownerUserId: 'user-1',
    realmAgentId: 'agent-1',
    localAgentRef: LOCAL_AGENT_REF,
  });
  assert.ok(runtime.calls.getBank[0]?.__options);

  assert.deepEqual(await surface.bindCanonicalBankStandard(LOCAL_AGENT_REF), {
    mode: 'standard',
    bankId: 'bank-agent-1',
    embeddingProfileModelId: 'embed-1',
    bindingSourceKind: 'cloud',
    blockedReasonCode: undefined,
    pendingCutover: true,
  });
  assert.equal(memoryEmbedding.calls.bind, 1);
  assert.equal(memoryEmbedding.calls.cutover, 1);
});
