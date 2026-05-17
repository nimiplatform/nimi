import assert from 'node:assert/strict';
import test from 'node:test';
import { ReasonCode } from '@nimiplatform/sdk/types';
import {
  createDefaultAIScopeRef,
  type MemoryEmbeddingConfig,
  type MemoryEmbeddingConfigSurface,
  type MemoryEmbeddingRuntimeSurface,
} from '@nimiplatform/sdk/mod';
import {
  MemoryBankScope,
  MemoryCanonicalClass,
  MemoryRecordKind,
} from '@nimiplatform/sdk/runtime';
import {
  canonicalMemoryViewToDesktopRecord,
  createRuntimeAgentMemoryAdapter,
} from '../src/shell/renderer/infra/runtime-agent-memory';

const LOCAL_AGENT_REF = 'local-agent:user-1:agent-1';

function createRuntimeMock() {
  const calls = {
    registerApp: [] as Array<Record<string, unknown>>,
    authorizeExternalPrincipal: [] as Array<Record<string, unknown>>,
    sendAppMessage: [] as Array<Record<string, unknown>>,
    getBank: [] as Array<Record<string, unknown>>,
    getAgent: [] as Array<Record<string, unknown>>,
    initializeAgent: [] as Array<Record<string, unknown>>,
    updateAgentState: [] as Array<Record<string, unknown>>,
    writeMemory: [] as Array<Record<string, unknown>>,
    queryMemory: [] as Array<Record<string, unknown>>,
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
    app: {
      sendMessage: async (input: Record<string, unknown>, options?: Record<string, unknown>) => {
        calls.sendAppMessage.push({ ...input, __options: options });
        return {
          messageId: 'app-msg-1',
          accepted: true,
          reasonCode: ReasonCode.ACTION_EXECUTED,
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
    agent: {
      getAgent: async (input: Record<string, unknown>, options?: Record<string, unknown>) => {
        calls.getAgent.push({ ...input, __options: options });
        return {};
      },
      initializeAgent: async (input: Record<string, unknown>, options?: Record<string, unknown>) => {
        calls.initializeAgent.push({ ...input, __options: options });
        return {};
      },
      updateAgentState: async (input: Record<string, unknown>, options?: Record<string, unknown>) => {
        calls.updateAgentState.push({ ...input, __options: options });
        return {};
      },
      writeMemory: async (input: Record<string, unknown>, options?: Record<string, unknown>) => {
        calls.writeMemory.push({ ...input, __options: options });
        return {
          accepted: [
            {
              canonicalClass: MemoryCanonicalClass.DYADIC,
              sourceBank: {
                owner: {
                  oneofKind: 'agentDyadic',
                  agentDyadic: {
                    agentId: LOCAL_AGENT_REF,
                    userId: 'user-1',
                  },
                },
              },
              record: {
                memoryId: 'mem-1',
                canonicalClass: MemoryCanonicalClass.DYADIC,
                provenance: {
                  sourceSystem: 'desktop.agent-chat',
                  sourceEventId: 'turn-1',
                  authorId: 'user-1',
                  traceId: 'thread-1',
                },
                payload: {
                  oneofKind: 'observational',
                  observational: {
                    observation: 'hello',
                  },
                },
              },
              recallScore: 1,
              policyReason: 'desktop_agent_chat_dyadic_turn',
            },
          ],
          rejected: [],
        };
      },
      queryMemory: async (input: Record<string, unknown>, options?: Record<string, unknown>) => {
        calls.queryMemory.push({ ...input, __options: options });
        return {
          memories: [
            {
              canonicalClass: MemoryCanonicalClass.PUBLIC_SHARED,
              sourceBank: {
                owner: {
                  oneofKind: 'agentCore',
                  agent: {
                    agentId: LOCAL_AGENT_REF,
                  },
                },
              },
              record: {
                memoryId: 'core-1',
                canonicalClass: MemoryCanonicalClass.PUBLIC_SHARED,
                provenance: {
                  sourceSystem: 'desktop.agent-chat',
                  sourceEventId: 'turn-2',
                  authorId: LOCAL_AGENT_REF,
                  traceId: 'thread-1',
                },
                payload: {
                  oneofKind: 'observational',
                  observational: {
                    observation: 'remember this',
                  },
                },
                createdAt: { seconds: '1714521600', nanos: 0 },
                updatedAt: { seconds: '1714521600', nanos: 0 },
              },
              recallScore: 0,
              policyReason: 'query_agent_memory_history',
            },
          ],
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
  const scopeRef = createDefaultAIScopeRef();
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
    listLocalRuntimeAssets: async () => [{
      localAssetId: 'local-embed-1',
      assetId: 'local/embed-alpha',
      kind: 'embedding',
      engine: 'llama',
      entry: 'embed.gguf',
      files: ['embed.gguf'],
      license: 'apache-2.0',
      source: { repo: 'repo', revision: 'main' },
      integrityMode: 'verified',
      hashes: {},
      status: 'active',
      installedAt: '2026-04-01T00:00:00Z',
      updatedAt: '2026-04-12T00:00:00Z',
    }],
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
    listLocalRuntimeAssets: async () => [],
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
    listLocalRuntimeAssets: async () => [],
  });
  const unavailable = await unavailableAdapter.getCanonicalBankStatus(LOCAL_AGENT_REF);
  assert.deepEqual(unavailable, {
    mode: 'unavailable',
    bankId: 'bank-agent-1',
    bindingSourceKind: undefined,
    blockedReasonCode: undefined,
  });
});

test('runtime agent memory adapter lets explicit desktop E2E fixture status take precedence', async () => {
  const { runtime, calls } = createRuntimeMock();
  runtime.memory.getBank = async () => {
    throw new Error('PROTOCOL_ENVELOPE_INVALID');
  };
  const fixtureStatusCalls: Array<Record<string, unknown>> = [];
  const service = createMemoryEmbeddingServiceMock({
    inspect: async () => {
      throw new Error('PROTOCOL_ENVELOPE_INVALID');
    },
  });
  const adapter = createRuntimeAgentMemoryAdapter({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'user-1',
    getMemoryEmbeddingConfigService: () => service.service,
    getAgentMemoryStandardFixtureStatus: async (payload) => {
      fixtureStatusCalls.push(payload);
      return {
        available: true,
        alreadyBound: false,
        bank: {
          bankId: 'bank-agent-1',
          embeddingProfile: {
            modelId: 'local/embed-alpha',
          },
        },
      };
    },
    listLocalRuntimeAssets: async () => [],
  });

  const status = await adapter.getCanonicalBankStatus(LOCAL_AGENT_REF);

  assert.deepEqual(status, {
    mode: 'baseline',
    bankId: 'bank-agent-1',
  });
  assert.deepEqual(fixtureStatusCalls, [{ agentId: LOCAL_AGENT_REF }]);
  assert.equal(calls.getBank.length, 0);
});

test('runtime agent memory adapter uses desktop E2E fixture status after runtime reports missing binding', async () => {
  const { runtime } = createRuntimeMock();
  runtime.memory.getBank = (async () => ({
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
      embeddingProfile: null,
    },
  })) as never;
  const fixtureStatusCalls: Array<Record<string, unknown>> = [];
  const adapter = createRuntimeAgentMemoryAdapter({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'user-1',
    getMemoryEmbeddingConfigService: () => createMemoryEmbeddingServiceMock({
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
    }).service,
    getAgentMemoryStandardFixtureStatus: async (payload) => {
      fixtureStatusCalls.push(payload);
      return {
        available: true,
        alreadyBound: false,
        bank: {
          bankId: 'bank-agent-1',
          embeddingProfile: {
            modelId: 'local/embed-alpha',
          },
        },
      };
    },
    listLocalRuntimeAssets: async () => [],
  });

  const status = await adapter.getCanonicalBankStatus(LOCAL_AGENT_REF);

  assert.deepEqual(status, {
    mode: 'baseline',
    bankId: 'bank-agent-1',
  });
  assert.deepEqual(fixtureStatusCalls, [{ agentId: LOCAL_AGENT_REF }]);
});

test('runtime agent memory adapter uses desktop E2E fixture status after legacy bank metadata is unbound', async () => {
  const { runtime } = createRuntimeMock();
  runtime.memory.getBank = (async () => ({
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
      embeddingProfile: null,
    },
  })) as never;
  const fixtureStatusCalls: Array<Record<string, unknown>> = [];
  const adapter = createRuntimeAgentMemoryAdapter({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'user-1',
    getMemoryEmbeddingConfigService: () => createMemoryEmbeddingServiceMock({
      inspect: async () => {
        throw new Error('memory embedding runtime inspect unavailable');
      },
    }).service,
    getAgentMemoryStandardFixtureStatus: async (payload) => {
      fixtureStatusCalls.push(payload);
      return {
        available: true,
        alreadyBound: false,
        bank: {
          bankId: 'bank-agent-1',
          embeddingProfile: {
            modelId: 'local/embed-alpha',
          },
        },
      };
    },
    listLocalRuntimeAssets: async () => [],
  });

  const status = await adapter.getCanonicalBankStatus(LOCAL_AGENT_REF);

  assert.deepEqual(status, {
    mode: 'baseline',
    bankId: 'bank-agent-1',
  });
  assert.deepEqual(fixtureStatusCalls, [{ agentId: LOCAL_AGENT_REF }]);
});

test('runtime agent memory adapter keeps compatibility queries working when canonical bank is baseline', async () => {
  const { runtime } = createRuntimeMock();
  runtime.memory.getBank = (async () => ({
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
      embeddingProfile: null,
    },
  })) as never;
  const service = createMemoryEmbeddingServiceMock({
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

  const adapter = createRuntimeAgentMemoryAdapter({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'user-1',
    getMemoryEmbeddingConfigService: () => service.service,
    listLocalRuntimeAssets: async () => [{
      localAssetId: 'local-embed-1',
      assetId: 'local/embed-alpha',
      kind: 'embedding',
      engine: 'llama',
      entry: 'embed.gguf',
      files: ['embed.gguf'],
      license: 'apache-2.0',
      source: { repo: 'repo', revision: 'main' },
      integrityMode: 'verified',
      hashes: {},
      status: 'active',
      installedAt: '2026-04-01T00:00:00Z',
      updatedAt: '2026-04-12T00:00:00Z',
    }],
  });

  const status = await adapter.getCanonicalBankStatus(LOCAL_AGENT_REF);
  assert.deepEqual(status, {
    mode: 'baseline',
    bankId: 'bank-agent-1',
    bindingSourceKind: 'local',
  });

  const records = await adapter.queryCompatibilityRecords({
    agentId: LOCAL_AGENT_REF,
    displayName: 'Agent One',
    createIfMissing: false,
    syncDyadicContext: false,
    syncWorldContext: false,
    canonicalClasses: [MemoryCanonicalClass.PUBLIC_SHARED],
    limit: 5,
  });
  assert.equal(records.length, 1);
});

test('runtime agent memory adapter binds canonical bank standard through the memory embedding runtime surface', async () => {
  const { runtime } = createRuntimeMock();
  const bindCalls: Array<Record<string, unknown>> = [];
  const cutoverCalls: Array<Record<string, unknown>> = [];
  const service = createMemoryEmbeddingServiceMock({
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
    listLocalRuntimeAssets: async () => [{
      localAssetId: 'local-embed-1',
      assetId: 'local/embed-alpha',
      kind: 'embedding',
      engine: 'llama',
      entry: 'embed.gguf',
      files: ['embed.gguf'],
      license: 'apache-2.0',
      source: { repo: 'repo', revision: 'main' },
      integrityMode: 'verified',
      hashes: {},
      status: 'active',
      installedAt: '2026-04-01T00:00:00Z',
      updatedAt: '2026-04-12T00:00:00Z',
    }],
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

test('runtime agent memory adapter forwards chat sidecar input through app messaging only', async () => {
  const { runtime, calls } = createRuntimeMock();
  const adapter = createRuntimeAgentMemoryAdapter({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'user-1',
  });

  await adapter.sendChatTrackSidecarInput({
    agentId: LOCAL_AGENT_REF,
    sourceEventId: 'turn-1',
    threadId: 'thread-1',
    messages: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ],
  });

  assert.equal(calls.sendAppMessage.length, 1);
  assert.equal(calls.writeMemory.length, 0);
  assert.equal(calls.updateAgentState.length, 0);
  const request = calls.sendAppMessage[0];
  assert.ok(request);
  assert.equal(request.fromAppId, 'desktop-test');
  assert.equal(request.toAppId, 'runtime.agent.internal.chat_track_sidecar');
  assert.equal(request.subjectUserId, 'user-1');
  assert.equal(request.messageType, 'agent.chat_track.sidecar_input.v1');
  assert.equal(request.requireAck, false);
  assert.deepEqual((request.__options as Record<string, unknown>).protectedAccessToken, {
    tokenId: 'protected-token-id',
    secret: 'protected-token-secret',
  });
  const payload = request.payload as {
    fields: Record<string, {
      kind?: {
        stringValue?: string;
        listValue?: {
          values: Array<{
            kind?: {
              structValue?: {
                fields: Record<string, { kind?: { stringValue?: string } }>;
              };
            };
          }>;
        };
      };
    }>;
  };
  assert.equal(payload.fields.agent_id?.kind?.stringValue, LOCAL_AGENT_REF);
  assert.equal(payload.fields.source_event_id?.kind?.stringValue, 'turn-1');
  assert.equal(payload.fields.thread_id?.kind?.stringValue, 'thread-1');
  const messageValues = payload.fields.messages?.kind?.listValue?.values || [];
  assert.equal(messageValues.length, 2);
  assert.equal(messageValues[0]?.kind?.structValue?.fields.role?.kind?.stringValue, 'user');
  assert.equal(messageValues[1]?.kind?.structValue?.fields.content?.kind?.stringValue, 'hi there');
});

test('canonical memory view compatibility projection stays runtime-owned', async () => {
  const record = canonicalMemoryViewToDesktopRecord({
    canonicalClass: MemoryCanonicalClass.DYADIC,
    sourceBank: {
      scope: MemoryBankScope.AGENT_DYADIC,
      owner: {
        oneofKind: 'agentDyadic',
        agentDyadic: {
          agentId: LOCAL_AGENT_REF,
          userId: 'user-7',
        },
      },
    },
    record: {
      memoryId: 'mem-7',
      kind: MemoryRecordKind.OBSERVATIONAL,
      canonicalClass: MemoryCanonicalClass.DYADIC,
      provenance: {
        sourceSystem: 'desktop.agent-chat',
        sourceEventId: 'turn-7',
        authorId: LOCAL_AGENT_REF,
        traceId: 'thread-7',
      },
        payload: {
          oneofKind: 'observational',
          observational: {
            observation: 'remember this',
            sourceRef: 'thread-7',
          },
        },
      createdAt: { seconds: '1714521600', nanos: 0 },
      updatedAt: { seconds: '1714521600', nanos: 0 },
      metadata: undefined,
    },
    recallScore: 0.5,
    policyReason: 'runtime_agent_projection',
  });

  assert.deepEqual(record, {
    actorRefs: [],
    appId: 'desktop.agent-chat',
    commitId: 'mem-7',
    id: 'mem-7',
    content: 'remember this',
    createdAt: '2024-05-01T00:00:00.000Z',
    createdBy: LOCAL_AGENT_REF,
    effectClass: 'MEMORY_ONLY',
    importance: 1,
    reason: 'runtime_agent_projection',
    schemaId: 'runtime.agent.canonical_memory',
    schemaVersion: '1',
    sessionId: 'thread-7',
    type: 'DYADIC',
    userId: 'user-7',
    worldId: null,
    metadata: undefined,
  });
});
