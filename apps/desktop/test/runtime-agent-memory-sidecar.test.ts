import assert from 'node:assert/strict';
import test from 'node:test';
import { ReasonCode } from '@nimiplatform/sdk/types';
import {
  MemoryBankScope,
  type MemoryEmbeddingConfig,
  type MemoryEmbeddingConfigSurface,
  type MemoryEmbeddingRuntimeSurface,
} from '@nimiplatform/sdk/runtime';
import {
  createRuntimeAgentMemoryAdapter,
} from '../src/shell/renderer/infra/runtime-agent-memory';
import { createDesktopMemoryEmbeddingScopeRef } from '../src/shell/renderer/app-shell/providers/desktop-memory-embedding-scope';

const LOCAL_AGENT_REF = 'local-agent:user-1:agent-1';

function createRuntimeMock() {
  const calls = {
    registerApp: [] as Array<Record<string, unknown>>,
    authorizeExternalPrincipal: [] as Array<Record<string, unknown>>,
    getBank: [] as Array<Record<string, unknown>>,
  };

  const runtime = {
    appId: 'desktop-test',
    auth: {
      registerApp: async (input: Record<string, unknown>) => {
        calls.registerApp.push(input);
        return { accepted: true };
      },
    },
    appAuth: {
      authorizeExternalPrincipal: async (input: Record<string, unknown>) => {
        calls.authorizeExternalPrincipal.push(input);
        return {
          tokenId: 'protected-token-id',
          secret: 'protected-token-secret',
        };
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
                agent: {
                  agentId: LOCAL_AGENT_REF,
                },
              },
            },
            embeddingProfile: {
              provider: 'local',
              modelId: 'local/embed-alpha',
            },
          },
        };
      },
    },
  };

  return { runtime, calls };
}

function createMemoryEmbeddingServiceMock(input?: {
  config?: Partial<MemoryEmbeddingConfig>;
  inspect?: MemoryEmbeddingRuntimeSurface['inspect'];
  requestBind?: MemoryEmbeddingRuntimeSurface['requestBind'];
  requestCutover?: MemoryEmbeddingRuntimeSurface['requestCutover'];
}) {
  const scopeRef = createDesktopMemoryEmbeddingScopeRef();
  let config: MemoryEmbeddingConfig = {
    scopeRef,
    sourceKind: null,
    bindingRef: null,
    revisionToken: 'rev-1',
    updatedAt: '2026-04-12T00:00:00.000Z',
    ...input?.config,
  };
  const memoryEmbeddingConfig: MemoryEmbeddingConfigSurface = {
    get: () => config,
    update: (_scopeRef: typeof scopeRef, next: MemoryEmbeddingConfig) => {
      config = { ...next, scopeRef: next.scopeRef || scopeRef };
    },
    subscribe: () => () => {},
  };
  const memoryEmbeddingRuntime: MemoryEmbeddingRuntimeSurface = {
    inspect: input?.inspect ?? (async () => ({
      bindingIntentPresent: false,
      bindingSourceKind: null,
      resolutionState: 'missing',
      resolvedProfileIdentity: null,
      canonicalBankStatus: 'unbound',
      blockedReasonCode: null,
      operationReadiness: {
        bindAllowed: false,
        cutoverAllowed: false,
      },
    })),
    requestBind: input?.requestBind ?? (async () => ({
      outcome: 'rejected',
      blockedReasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
      canonicalBankStatusAfter: 'unbound',
      pendingCutover: false,
    })),
    requestCutover: input?.requestCutover ?? (async () => ({
      outcome: 'not_ready',
      blockedReasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
      canonicalBankStatusAfter: 'unbound',
    })),
  };
  return {
    service: {
      memoryEmbeddingConfig,
      memoryEmbeddingRuntime,
    },
    getConfig: () => config,
  };
}

test('runtime agent memory adapter maps canonical bank status to standard, baseline, and unavailable', async () => {
  const { runtime, calls } = createRuntimeMock();
  const standardService = createMemoryEmbeddingServiceMock({
    config: {
      sourceKind: 'cloud',
      bindingRef: {
        kind: 'cloud',
        connectorId: 'conn-1',
        modelId: 'gemini-embedding-001',
      },
    },
    inspect: async () => ({
      bindingIntentPresent: true,
      bindingSourceKind: 'cloud',
      resolutionState: 'resolved',
      resolvedProfileIdentity: 'google:gemini-embedding-001:conn-1',
      canonicalBankStatus: 'rebuild_pending',
      blockedReasonCode: null,
      operationReadiness: {
        bindAllowed: false,
        cutoverAllowed: false,
      },
    }),
  });
  const adapter = createRuntimeAgentMemoryAdapter({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'user-1',
    getMemoryEmbeddingConfigService: () => standardService.service,
  });

  const standard = await adapter.getCanonicalBankStatus(LOCAL_AGENT_REF);
  assert.deepEqual(standard, {
    mode: 'standard',
    bankId: 'bank-agent-1',
    embeddingProfileModelId: 'local/embed-alpha',
    bindingSourceKind: 'cloud',
    blockedReasonCode: undefined,
    pendingCutover: true,
  });
  assert.equal(calls.getBank.length, 1);

  runtime.memory.getBank = async () => ({
    bank: {
      bankId: 'bank-agent-1',
      locator: {
        scope: MemoryBankScope.AGENT_CORE,
        owner: {
          oneofKind: 'agentCore',
          agent: {
            agentId: LOCAL_AGENT_REF,
          },
        },
      },
      embeddingProfile: {
        provider: '',
        modelId: '',
      },
    },
  });
  const baselineService = createMemoryEmbeddingServiceMock({
    config: {
      sourceKind: 'cloud',
      bindingRef: {
        kind: 'cloud',
        connectorId: 'conn-1',
        modelId: 'gemini-embedding-001',
      },
    },
    inspect: async () => ({
      bindingIntentPresent: true,
      bindingSourceKind: 'cloud',
      resolutionState: 'resolved',
      resolvedProfileIdentity: 'google:gemini-embedding-001:conn-1',
      canonicalBankStatus: 'unbound',
      blockedReasonCode: null,
      operationReadiness: {
        bindAllowed: true,
        cutoverAllowed: false,
      },
    }),
  });
  const baselineAdapter = createRuntimeAgentMemoryAdapter({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'user-1',
    getMemoryEmbeddingConfigService: () => baselineService.service,
  });
  const baseline = await baselineAdapter.getCanonicalBankStatus(LOCAL_AGENT_REF);
  assert.deepEqual(baseline, {
    mode: 'baseline',
    bankId: 'bank-agent-1',
    bindingSourceKind: 'cloud',
  });

  const unavailableService = createMemoryEmbeddingServiceMock({
    inspect: async () => ({
      bindingIntentPresent: false,
      bindingSourceKind: null,
      resolutionState: 'missing',
      resolvedProfileIdentity: null,
      canonicalBankStatus: 'unbound',
      blockedReasonCode: null,
      operationReadiness: {
        bindAllowed: false,
        cutoverAllowed: false,
      },
    }),
  });
  const unavailableAdapter = createRuntimeAgentMemoryAdapter({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'user-1',
    getMemoryEmbeddingConfigService: () => unavailableService.service,
  });
  const unavailable = await unavailableAdapter.getCanonicalBankStatus(LOCAL_AGENT_REF);
  assert.deepEqual(unavailable, {
    mode: 'unavailable',
    bankId: 'bank-agent-1',
    bindingSourceKind: undefined,
    blockedReasonCode: undefined,
  });
});

test('runtime agent memory adapter binds canonical bank standard through the memory embedding runtime surface', async () => {
  const { runtime } = createRuntimeMock();
  const bindCalls: Array<Record<string, unknown>> = [];
  const cutoverCalls: Array<Record<string, unknown>> = [];
  const service = createMemoryEmbeddingServiceMock({
    config: {
      sourceKind: 'local',
      bindingRef: {
        kind: 'local',
        targetId: 'local/embed-alpha',
      },
    },
    inspect: async () => ({
      bindingIntentPresent: true,
      bindingSourceKind: 'local',
      resolutionState: 'resolved',
      resolvedProfileIdentity: 'local:local/embed-alpha:local-embed-1',
      canonicalBankStatus: 'bound_equivalent',
      blockedReasonCode: null,
      operationReadiness: {
        bindAllowed: false,
        cutoverAllowed: false,
      },
    }),
    requestBind: async (payload: Parameters<MemoryEmbeddingRuntimeSurface['requestBind']>[0]) => {
      bindCalls.push(payload as unknown as Record<string, unknown>);
      return {
        outcome: 'staged_rebuild',
        blockedReasonCode: null,
        canonicalBankStatusAfter: 'cutover_ready',
        pendingCutover: true,
      };
    },
    requestCutover: async (payload: Parameters<MemoryEmbeddingRuntimeSurface['requestCutover']>[0]) => {
      cutoverCalls.push(payload as unknown as Record<string, unknown>);
      return {
        outcome: 'cutover_committed',
        blockedReasonCode: null,
        canonicalBankStatusAfter: 'bound_equivalent',
      };
    },
  });
  const adapter = createRuntimeAgentMemoryAdapter({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'user-1',
    getMemoryEmbeddingConfigService: () => service.service,
  });

  const result = await adapter.bindCanonicalBankStandard(LOCAL_AGENT_REF);
  assert.deepEqual(result, {
    mode: 'standard',
    bankId: 'bank-agent-1',
    embeddingProfileModelId: 'local/embed-alpha',
    bindingSourceKind: 'local',
    blockedReasonCode: undefined,
    pendingCutover: false,
  });
  assert.equal(bindCalls.length, 1);
  assert.equal(cutoverCalls.length, 1);
  assert.deepEqual(service.getConfig().bindingRef, {
    kind: 'local',
    targetId: 'local/embed-alpha',
  });
});

test('runtime agent memory adapter requires explicit binding intent before standard bind', async () => {
  const { runtime } = createRuntimeMock();
  const service = createMemoryEmbeddingServiceMock();
  const adapter = createRuntimeAgentMemoryAdapter({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'user-1',
    getMemoryEmbeddingConfigService: () => service.service,
  });

  await assert.rejects(
    () => adapter.bindCanonicalBankStandard(LOCAL_AGENT_REF),
    /MEMORY_EMBEDDING_BINDING_INTENT_REQUIRED/,
  );
  assert.equal(service.getConfig().bindingRef, null);
});
