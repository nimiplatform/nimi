import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNimiRuntimeAgentMemoryExport,
  toNimiRuntimeTimestamp,
  type NimiHostRuntimeAgentMemoryExportClient,
} from './index';
import {
  AgentExecutionState,
  MemoryBankScope,
  MemoryCanonicalClass,
  MemoryRecordKind,
  type AgentStateProjection,
  type CanonicalMemoryView,
  type QueryAgentMemoryRequest,
  type RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';

const OWNER_USER_ID = 'user-1';
const RUNTIME_SOURCE_REF = 'agent-1';
const AGENT_REF = 'local-agent:test-user-1-agent-1';
const AGENT_IDENTITY = {
  ownerUserId: OWNER_USER_ID,
  runtimeSourceRef: RUNTIME_SOURCE_REF,
  localAgentRef: AGENT_REF,
} as const;

function buildAgentState(overrides: Partial<AgentStateProjection> = {}): AgentStateProjection {
  return {
    executionState: AgentExecutionState.IDLE,
    statusText: 'resting',
    activeWorldId: '',
    activeUserId: '',
    attributes: {},
    currentEmotion: 'calm',
    ...overrides,
  };
}

function buildView(input: {
  readonly memoryId: string;
  readonly canonicalClass: MemoryCanonicalClass;
}): CanonicalMemoryView {
  const bank = input.canonicalClass === MemoryCanonicalClass.DYADIC
    ? {
      scope: MemoryBankScope.AGENT_DYADIC,
      owner: {
        oneofKind: 'agentDyadic' as const,
          agentDyadic: { agentId: AGENT_REF, userId: OWNER_USER_ID },
      },
    }
    : input.canonicalClass === MemoryCanonicalClass.WORLD_SHARED
      ? {
        scope: MemoryBankScope.WORLD_SHARED,
        owner: {
          oneofKind: 'worldShared' as const,
          worldShared: { worldId: 'world-1' },
        },
      }
      : {
        scope: MemoryBankScope.AGENT_CORE,
        owner: {
          oneofKind: 'agentCore' as const,
          agentCore: { agentId: AGENT_REF },
        },
      };
  return {
    canonicalClass: input.canonicalClass,
    sourceBank: bank,
    recallScore: 0,
    policyReason: 'query_agent_memory_history',
    record: {
      memoryId: input.memoryId,
      bank,
      kind: MemoryRecordKind.OBSERVATIONAL,
      canonicalClass: input.canonicalClass,
      provenance: {
        sourceSystem: 'runtime.agent',
        sourceEventId: `event-${input.memoryId}`,
        authorId: AGENT_REF,
        traceId: `trace-${input.memoryId}`,
        committedAt: toNimiRuntimeTimestamp('2026-06-10T00:00:00.000Z'),
      },
      payload: {
        oneofKind: 'observational',
        observational: {
          observation: `observation ${input.memoryId}`,
          observedAt: toNimiRuntimeTimestamp('2026-06-10T00:00:00.000Z'),
          sourceRef: '',
        },
      },
      createdAt: toNimiRuntimeTimestamp('2026-06-10T00:00:00.000Z'),
      updatedAt: toNimiRuntimeTimestamp('2026-06-10T01:00:00.000Z'),
    },
  };
}

function buildClient(input: {
  readonly state?: AgentStateProjection;
  readonly pages: ReadonlyMap<MemoryCanonicalClass, readonly CanonicalMemoryView[] | Error>;
  readonly queryCalls?: QueryAgentMemoryRequest[];
}): NimiHostRuntimeAgentMemoryExportClient {
  return {
    appId: 'sdk.test',
    auth: {
      async registerApp() {
        throw new Error('auth path must not be used when withScopes is provided');
      },
    },
    appAuth: {
      async authorizeExternalPrincipal() {
        throw new Error('app-auth path must not be used when withScopes is provided');
      },
    },
    agent: {
      async getAgentState() {
        return { state: input.state ?? buildAgentState() };
      },
      async queryAgentMemory(request: QueryAgentMemoryRequest) {
        input.queryCalls?.push(request);
        const canonicalClass = request.canonicalClasses[0];
        const page = input.pages.get(canonicalClass);
        if (page instanceof Error) {
          throw page;
        }
        return {
          memories: [...(page ?? [])],
          narratives: [],
        };
      },
    },
  };
}

const passthroughScopes = async <T>(
  _scopes: readonly string[],
  operation: (options: RuntimeTypedCallOptions) => Promise<T>,
): Promise<T> => operation({});

test('Runtime Agent memory export collects every canonical class page into a complete envelope', async () => {
  const queryCalls: QueryAgentMemoryRequest[] = [];
  const client = buildClient({
    state: buildAgentState({ activeWorldId: 'world-1', activeUserId: 'user-1' }),
    pages: new Map<MemoryCanonicalClass, readonly CanonicalMemoryView[]>([
      [MemoryCanonicalClass.PUBLIC_SHARED, [
        buildView({ memoryId: 'memory-public-1', canonicalClass: MemoryCanonicalClass.PUBLIC_SHARED }),
        buildView({ memoryId: 'memory-public-2', canonicalClass: MemoryCanonicalClass.PUBLIC_SHARED }),
      ]],
      [MemoryCanonicalClass.WORLD_SHARED, [
        buildView({ memoryId: 'memory-world-1', canonicalClass: MemoryCanonicalClass.WORLD_SHARED }),
      ]],
      [MemoryCanonicalClass.DYADIC, [
        buildView({ memoryId: 'memory-dyadic-1', canonicalClass: MemoryCanonicalClass.DYADIC }),
      ]],
    ]),
    queryCalls,
  });

  const envelope = await createNimiRuntimeAgentMemoryExport(client, {
    ...AGENT_IDENTITY,
    exportedAt: '2026-06-11T08:00:00.000Z',
    maxRecords: 10,
    getSubjectUserId: () => 'user-1',
    withScopes: passthroughScopes,
  });

  assert.equal(envelope.schemaVersion, 1);
  assert.equal(envelope.exportedAt, '2026-06-11T08:00:00.000Z');
  assert.equal(envelope.agentId, AGENT_REF);
  assert.deepEqual(envelope.records.map((record) => record.memoryId), [
    'memory-public-1',
    'memory-public-2',
    'memory-world-1',
    'memory-dyadic-1',
  ]);
  assert.deepEqual(envelope.banks.map((bank) => [bank.bankKey, bank.recordCount]), [
    [`agent-core:${AGENT_REF}`, 2],
    [`agent-dyadic:${AGENT_REF}:${OWNER_USER_ID}`, 1],
    ['world-shared:world-1', 1],
  ]);
  assert.equal(envelope.records[0]?.canonicalClass, 'public-shared');
  assert.equal(envelope.records[0]?.kind, 'observational');
  assert.equal(envelope.records[0]?.summary, 'observation memory-public-1');
  assert.equal(envelope.records[0]?.payload.kind, 'observational');
  assert.equal(envelope.records[0]?.provenance?.sourceEventId, 'event-memory-public-1');
  assert.equal(envelope.records[0]?.updatedAt, '2026-06-10T01:00:00.000Z');
  assert.deepEqual(queryCalls.map((call) => call.canonicalClasses), [
    [MemoryCanonicalClass.PUBLIC_SHARED],
    [MemoryCanonicalClass.WORLD_SHARED],
    [MemoryCanonicalClass.DYADIC],
  ]);
  // Sentinel arithmetic: each class read asks for remaining + 1.
  assert.deepEqual(queryCalls.map((call) => call.limit), [11, 9, 8]);
  assert.ok(queryCalls.every((call) => call.query === '' && call.agentId === AGENT_REF));
});

test('Runtime Agent memory export aborts on mid-collection failure without partial envelope', async () => {
  const queryCalls: QueryAgentMemoryRequest[] = [];
  const client = buildClient({
    state: buildAgentState({ activeWorldId: 'world-1' }),
    pages: new Map<MemoryCanonicalClass, readonly CanonicalMemoryView[] | Error>([
      [MemoryCanonicalClass.PUBLIC_SHARED, [
        buildView({ memoryId: 'memory-public-1', canonicalClass: MemoryCanonicalClass.PUBLIC_SHARED }),
      ]],
      [MemoryCanonicalClass.WORLD_SHARED, new Error('runtime unavailable')],
    ]),
    queryCalls,
  });

  await assert.rejects(
    createNimiRuntimeAgentMemoryExport(client, {
      ...AGENT_IDENTITY,
      exportedAt: '2026-06-11T08:00:00.000Z',
      maxRecords: 10,
      getSubjectUserId: () => 'user-1',
      withScopes: passthroughScopes,
    }),
    (error: { name?: string; reasonCode?: string }) => {
      assert.equal(error.name, 'NimiError');
      assert.equal(error.reasonCode, 'SDK_RUNTIME_AGENT_MEMORY_EXPORT_READ_FAILED');
      return true;
    },
  );
  assert.equal(queryCalls.length, 2);
});

test('Runtime Agent memory export fails closed when records exceed maxRecords', async () => {
  const client = buildClient({
    pages: new Map<MemoryCanonicalClass, readonly CanonicalMemoryView[]>([
      [MemoryCanonicalClass.PUBLIC_SHARED, [
        buildView({ memoryId: 'memory-1', canonicalClass: MemoryCanonicalClass.PUBLIC_SHARED }),
        buildView({ memoryId: 'memory-2', canonicalClass: MemoryCanonicalClass.PUBLIC_SHARED }),
        buildView({ memoryId: 'memory-3', canonicalClass: MemoryCanonicalClass.PUBLIC_SHARED }),
      ]],
    ]),
  });

  await assert.rejects(
    createNimiRuntimeAgentMemoryExport(client, {
      ...AGENT_IDENTITY,
      exportedAt: '2026-06-11T08:00:00.000Z',
      maxRecords: 2,
      getSubjectUserId: () => 'user-1',
      withScopes: passthroughScopes,
    }),
    (error: { reasonCode?: string; details?: { maxRecords?: number } }) => {
      assert.equal(error.reasonCode, 'SDK_RUNTIME_AGENT_MEMORY_EXPORT_MAX_RECORDS_EXCEEDED');
      assert.equal(error.details?.maxRecords, 2);
      return true;
    },
  );
});

test('Runtime Agent memory export projects empty memory as a valid empty envelope', async () => {
  const queryCalls: QueryAgentMemoryRequest[] = [];
  const client = buildClient({
    pages: new Map<MemoryCanonicalClass, readonly CanonicalMemoryView[]>([
      [MemoryCanonicalClass.PUBLIC_SHARED, []],
    ]),
    queryCalls,
  });

  const envelope = await createNimiRuntimeAgentMemoryExport(client, {
    ...AGENT_IDENTITY,
    exportedAt: '2026-06-11T08:00:00+08:00',
    maxRecords: 5,
    getSubjectUserId: () => 'user-1',
    withScopes: passthroughScopes,
  });

  assert.equal(envelope.schemaVersion, 1);
  assert.equal(envelope.exportedAt, '2026-06-11T00:00:00.000Z');
  assert.deepEqual(envelope.records, []);
  assert.deepEqual(envelope.banks, []);
  // No active world/user context: only the public-shared class is admitted.
  assert.deepEqual(queryCalls.map((call) => call.canonicalClasses), [
    [MemoryCanonicalClass.PUBLIC_SHARED],
  ]);
});

test('Runtime Agent memory export validates caller clock and maxRecords input', async () => {
  const client = buildClient({
    pages: new Map<MemoryCanonicalClass, readonly CanonicalMemoryView[]>([
      [MemoryCanonicalClass.PUBLIC_SHARED, []],
    ]),
  });

  await assert.rejects(
    createNimiRuntimeAgentMemoryExport(client, {
      ...AGENT_IDENTITY,
      exportedAt: 'not-a-clock',
      maxRecords: 5,
      getSubjectUserId: () => 'user-1',
      withScopes: passthroughScopes,
    }),
    (error: { reasonCode?: string }) => {
      assert.equal(error.reasonCode, 'SDK_RUNTIME_AGENT_MEMORY_EXPORT_EXPORTED_AT_INVALID');
      return true;
    },
  );

  for (const maxRecords of [0, -1, 2.5, Number.NaN, 2_147_483_647]) {
    await assert.rejects(
      createNimiRuntimeAgentMemoryExport(client, {
        ...AGENT_IDENTITY,
        exportedAt: '2026-06-11T08:00:00.000Z',
        maxRecords,
        getSubjectUserId: () => 'user-1',
        withScopes: passthroughScopes,
      }),
      (error: { reasonCode?: string }) => {
        assert.equal(error.reasonCode, 'SDK_RUNTIME_AGENT_MEMORY_EXPORT_MAX_RECORDS_INVALID');
        return true;
      },
    );
  }
});

test('Runtime Agent memory export fails closed on canonical view without payload discriminator', async () => {
  const broken = buildView({ memoryId: 'memory-broken', canonicalClass: MemoryCanonicalClass.PUBLIC_SHARED });
  const client = buildClient({
    pages: new Map<MemoryCanonicalClass, readonly CanonicalMemoryView[]>([
      [MemoryCanonicalClass.PUBLIC_SHARED, [{
        ...broken,
        record: broken.record
          ? { ...broken.record, payload: { oneofKind: undefined } }
          : undefined,
      }]],
    ]),
  });

  await assert.rejects(
    createNimiRuntimeAgentMemoryExport(client, {
      ...AGENT_IDENTITY,
      exportedAt: '2026-06-11T08:00:00.000Z',
      maxRecords: 5,
      getSubjectUserId: () => 'user-1',
      withScopes: passthroughScopes,
    }),
    (error: { reasonCode?: string; details?: { memoryId?: string } }) => {
      assert.equal(error.reasonCode, 'SDK_RUNTIME_AGENT_MEMORY_EXPORT_RECORD_INVALID');
      assert.equal(error.details?.memoryId, 'memory-broken');
      return true;
    },
  );
});
