import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createNimiError,
  MemoryBankScope,
  MemoryCanonicalClass,
  MemoryRecordKind,
} from '@nimiplatform/sdk/runtime';
import {
  canonicalMemoryViewToDesktopRecord,
  createRuntimeAgentMemoryAdapter,
} from '../src/shell/renderer/infra/runtime-agent-memory';

function createRuntimeMock() {
  const calls = {
    registerApp: [] as Array<Record<string, unknown>>,
    authorizeExternalPrincipal: [] as Array<Record<string, unknown>>,
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
                agentCore: {
                  agentId: 'agent-1',
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
    agentCore: {
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
                    agentId: 'agent-1',
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
                  agentCore: {
                    agentId: 'agent-1',
                  },
                },
              },
              record: {
                memoryId: 'core-1',
                canonicalClass: MemoryCanonicalClass.PUBLIC_SHARED,
                provenance: {
                  sourceSystem: 'desktop.agent-chat',
                  sourceEventId: 'turn-2',
                  authorId: 'agent-1',
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

test('runtime agent memory adapter does not touch platform runtime before first operation', () => {
  let getRuntimeCalls = 0;
  createRuntimeAgentMemoryAdapter({
    getRuntime: () => {
      getRuntimeCalls += 1;
      throw new Error('getRuntime should not run during adapter creation');
    },
  });
  assert.equal(getRuntimeCalls, 0);
});

test('runtime agent memory adapter writes user turns through admitted dyadic observational memory', async () => {
  const { runtime, calls } = createRuntimeMock();
  runtime.agentCore.getAgent = async () => {
    throw createNimiError({
      message: 'agent missing',
      reasonCode: 'RUNTIME_GRPC_NOT_FOUND',
      actionHint: 'check_runtime_agent_core',
      traceId: '',
      retryable: false,
      source: 'runtime',
    });
  };

  const adapter = createRuntimeAgentMemoryAdapter({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'user-1',
    now: () => new Date('2026-04-12T00:00:00.000Z'),
  });

  await adapter.writeDyadicObservation({
    agentId: 'agent-1',
    displayName: 'Agent One',
    worldId: 'world-1',
    observation: 'hello',
    sourceEventId: 'turn-1',
    traceId: 'thread-1',
    policyReason: 'desktop_agent_chat_dyadic_turn',
    createIfMissing: true,
    syncDyadicContext: true,
    syncWorldContext: true,
  });

  assert.equal(calls.initializeAgent.length, 1);
  assert.equal(calls.updateAgentState.length, 1);
  assert.equal(calls.writeMemory.length, 1);
  assert.equal(calls.registerApp.length, 1);
  assert.equal(calls.authorizeExternalPrincipal.length, 3);
  const write = calls.writeMemory[0];
  assert.ok(write);
  assert.deepEqual((write.__options as Record<string, unknown>).protectedAccessToken, {
    tokenId: 'protected-token-id',
    secret: 'protected-token-secret',
  });
  const candidate = (write.candidates as Array<Record<string, unknown>>)[0];
  assert.ok(candidate);
  assert.equal(candidate.canonicalClass, MemoryCanonicalClass.DYADIC);
  assert.equal((candidate.record as Record<string, unknown>).kind, MemoryRecordKind.OBSERVATIONAL);
  assert.equal((((candidate.record as Record<string, unknown>).provenance as Record<string, unknown>).authorId), 'user-1');
});

test('runtime agent memory adapter writes assistant turns with agent author id and fail-closes query misses', async () => {
  const { runtime, calls } = createRuntimeMock();
  const adapter = createRuntimeAgentMemoryAdapter({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'user-1',
    now: () => new Date('2026-04-12T00:00:00.000Z'),
  });

  await adapter.writeDyadicObservation({
    agentId: 'agent-1',
    displayName: 'Agent One',
    worldId: null,
    observation: 'assistant reply',
    sourceEventId: 'turn-2',
    traceId: 'thread-1',
    authorId: 'agent-1',
    policyReason: 'desktop_agent_chat_dyadic_assistant_turn',
    createIfMissing: true,
    syncDyadicContext: true,
    syncWorldContext: true,
  });

  const write = calls.writeMemory[0];
  assert.ok(write);
  assert.deepEqual((write.__options as Record<string, unknown>).protectedAccessToken, {
    tokenId: 'protected-token-id',
    secret: 'protected-token-secret',
  });
  const candidate = (write.candidates as Array<Record<string, unknown>>)[0];
  assert.ok(candidate);
  assert.equal((((candidate.record as Record<string, unknown>).provenance as Record<string, unknown>).authorId), 'agent-1');

  runtime.agentCore.getAgent = async () => {
    throw createNimiError({
      message: 'agent missing',
      reasonCode: 'RUNTIME_GRPC_NOT_FOUND',
      actionHint: 'check_runtime_agent_core',
      traceId: '',
      retryable: false,
      source: 'runtime',
    });
  };
  await assert.rejects(
    () => adapter.queryCompatibilityRecords({
      agentId: 'agent-missing',
      displayName: 'Missing',
      createIfMissing: false,
      syncDyadicContext: false,
      syncWorldContext: false,
      canonicalClasses: [MemoryCanonicalClass.PUBLIC_SHARED],
      limit: 5,
    }),
    /agent missing/,
  );
  const getAgent = calls.getAgent[0];
  assert.ok(getAgent);
  assert.deepEqual((getAgent.__options as Record<string, unknown>).protectedAccessToken, {
    tokenId: 'protected-token-id',
    secret: 'protected-token-secret',
  });
});

test('runtime agent memory adapter soft-disables on memory substrate unavailable', async () => {
  const { runtime } = createRuntimeMock();
  runtime.agentCore.initializeAgent = async () => {
    throw createNimiError({
      message: 'local memory substrate is not configured',
      reasonCode: 'AI_LOCAL_SERVICE_UNAVAILABLE',
      actionHint: 'install_or_attach_memory_provider',
      traceId: '',
      retryable: false,
      source: 'runtime',
    });
  };
  runtime.agentCore.getAgent = async () => {
    throw createNimiError({
      message: 'agent missing',
      reasonCode: 'RUNTIME_GRPC_NOT_FOUND',
      actionHint: 'check_runtime_agent_core',
      traceId: '',
      retryable: false,
      source: 'runtime',
    });
  };

  const adapter = createRuntimeAgentMemoryAdapter({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'user-1',
    now: () => new Date('2026-04-12T00:00:00.000Z'),
  });

  await assert.doesNotReject(async () => {
    const accepted = await adapter.writeDyadicObservation({
      agentId: 'agent-1',
      displayName: 'Agent One',
      worldId: null,
      observation: 'hello',
      sourceEventId: 'turn-1',
      traceId: 'thread-1',
      policyReason: 'desktop_agent_chat_dyadic_turn',
      createIfMissing: true,
      syncDyadicContext: true,
      syncWorldContext: true,
    });
    assert.deepEqual(accepted, []);
  });

  runtime.agentCore.getAgent = async () => ({});
  runtime.agentCore.queryMemory = async () => {
    throw createNimiError({
      message: 'local memory substrate is not configured',
      reasonCode: 'AI_LOCAL_SERVICE_UNAVAILABLE',
      actionHint: 'install_or_attach_memory_provider',
      traceId: '',
      retryable: false,
      source: 'runtime',
    });
  };

  await assert.doesNotReject(async () => {
    const records = await adapter.queryCompatibilityRecords({
      agentId: 'agent-1',
      displayName: 'Agent One',
      createIfMissing: false,
      syncDyadicContext: false,
      syncWorldContext: false,
      canonicalClasses: [MemoryCanonicalClass.PUBLIC_SHARED],
      limit: 5,
    });
    assert.deepEqual(records, []);
  });
});

test('runtime agent memory adapter ignores additive narratives in compatibility queries', async () => {
  const { runtime } = createRuntimeMock();
  runtime.agentCore.queryMemory = async () => ({
    memories: [
      {
        canonicalClass: MemoryCanonicalClass.PUBLIC_SHARED,
        sourceBank: {
          owner: {
            oneofKind: 'agentCore',
            agentCore: {
              agentId: 'agent-1',
            },
          },
        },
        record: {
          memoryId: 'core-1',
          canonicalClass: MemoryCanonicalClass.PUBLIC_SHARED,
          provenance: {
            sourceSystem: 'desktop.agent-chat',
            sourceEventId: 'turn-2',
            authorId: 'agent-1',
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
    narratives: [
      {
        narrativeId: 'narrative-1',
        summary: 'This should remain additive.',
      },
    ],
  });

  const adapter = createRuntimeAgentMemoryAdapter({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'user-1',
    now: () => new Date('2026-04-12T00:00:00.000Z'),
  });

  const records = await adapter.queryCompatibilityRecords({
    agentId: 'agent-1',
    displayName: 'Agent One',
    createIfMissing: false,
    syncDyadicContext: false,
    syncWorldContext: false,
    canonicalClasses: [MemoryCanonicalClass.PUBLIC_SHARED],
    limit: 5,
  });

  assert.equal(records.length, 1);
  assert.equal(records[0]?.content, 'remember this');
});

test('runtime agent memory adapter maps canonical bank status to standard, baseline, and unavailable', async () => {
  const { runtime, calls } = createRuntimeMock();
  const adapter = createRuntimeAgentMemoryAdapter({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'user-1',
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

  const standard = await adapter.getCanonicalBankStatus('agent-1');
  assert.deepEqual(standard, {
    mode: 'standard',
    bankId: 'bank-agent-1',
    embeddingProfileModelId: 'local/embed-alpha',
  });
  assert.equal(calls.getBank.length, 1);

  runtime.memory.getBank = async () => ({
    bank: {
      bankId: 'bank-agent-1',
      locator: {
        scope: MemoryBankScope.AGENT_CORE,
        owner: {
          oneofKind: 'agentCore',
          agentCore: {
            agentId: 'agent-1',
          },
        },
      },
      embeddingProfile: {
        provider: '',
        modelId: '',
      },
    },
  });
  const baseline = await adapter.getCanonicalBankStatus('agent-1');
  assert.deepEqual(baseline, {
    mode: 'baseline',
    bankId: 'bank-agent-1',
  });

  runtime.memory.getBank = async () => {
    throw createNimiError({
      message: 'memory bank not found',
      reasonCode: 'RUNTIME_GRPC_NOT_FOUND',
      actionHint: 'check_runtime_memory',
      traceId: '',
      retryable: false,
      source: 'runtime',
    });
  };
  const unavailableAdapter = createRuntimeAgentMemoryAdapter({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'user-1',
    listLocalRuntimeAssets: async () => [],
  });
  const unavailable = await unavailableAdapter.getCanonicalBankStatus('agent-1');
  assert.deepEqual(unavailable, {
    mode: 'unavailable',
  });
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
          agentCore: {
            agentId: 'agent-1',
          },
        },
      },
      embeddingProfile: null,
    },
  })) as never;

  const adapter = createRuntimeAgentMemoryAdapter({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'user-1',
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

  const status = await adapter.getCanonicalBankStatus('agent-1');
  assert.deepEqual(status, {
    mode: 'baseline',
    bankId: 'bank-agent-1',
  });

  const records = await adapter.queryCompatibilityRecords({
    agentId: 'agent-1',
    displayName: 'Agent One',
    createIfMissing: false,
    syncDyadicContext: false,
    syncWorldContext: false,
    canonicalClasses: [MemoryCanonicalClass.PUBLIC_SHARED],
    limit: 5,
  });
  assert.equal(records.length, 1);
});

test('runtime agent memory adapter binds canonical bank standard through the desktop bridge', async () => {
  const { runtime } = createRuntimeMock();
  const bindCalls: Array<Record<string, unknown>> = [];
  const adapter = createRuntimeAgentMemoryAdapter({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'user-1',
    bindStandard: async (payload) => {
      bindCalls.push(payload as unknown as Record<string, unknown>);
      return {
        alreadyBound: false,
        bank: {
          bankId: 'bank-agent-1',
          embeddingProfile: {
            modelId: 'local/embed-alpha',
          },
        },
      };
    },
  });

  const result = await adapter.bindCanonicalBankStandard('agent-1');
  assert.deepEqual(result, {
    mode: 'standard',
    bankId: 'bank-agent-1',
    embeddingProfileModelId: 'local/embed-alpha',
  });
  assert.deepEqual(bindCalls, [{ agentId: 'agent-1' }]);
});

test('canonical memory view compatibility projection stays runtime-owned', async () => {
  const record = canonicalMemoryViewToDesktopRecord({
    canonicalClass: MemoryCanonicalClass.DYADIC,
    sourceBank: {
      scope: MemoryBankScope.AGENT_DYADIC,
      owner: {
        oneofKind: 'agentDyadic',
        agentDyadic: {
          agentId: 'agent-1',
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
        authorId: 'agent-1',
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
    policyReason: 'runtime_agent_core_projection',
  });

  assert.deepEqual(record, {
    actorRefs: [],
    appId: 'desktop.agent-chat',
    commitId: 'mem-7',
    id: 'mem-7',
    content: 'remember this',
    createdAt: '2024-05-01T00:00:00.000Z',
    createdBy: 'agent-1',
    effectClass: 'MEMORY_ONLY',
    importance: 1,
    reason: 'runtime_agent_core_projection',
    schemaId: 'runtime.agent_core.canonical_memory',
    schemaVersion: '1',
    sessionId: 'thread-7',
    type: 'DYADIC',
    userId: 'user-7',
    worldId: null,
    metadata: undefined,
  });
});
