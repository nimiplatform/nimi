import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryCanonicalClass } from '@nimiplatform/sdk/runtime';
import type { DesktopAgentMemoryRecord } from '../src/shell/renderer/infra/runtime-agent-memory';
import {
  createAgentCoreDataCapabilityHandlers,
  resetAgentCoreDataStateForTesting,
} from '../src/shell/renderer/infra/bootstrap/core-capabilities';

function makeMemoryRecord(id: string, overrides: Partial<DesktopAgentMemoryRecord> = {}): DesktopAgentMemoryRecord {
  return {
    actorRefs: [],
    appId: 'runtime.agentCore',
    commitId: `${id}-commit`,
    id,
    content: `${id} content`,
    createdAt: '2026-03-01T00:00:00.000Z',
    createdBy: 'user-1',
    effectClass: 'MEMORY_ONLY',
    importance: 1,
    reason: 'runtime projection',
    schemaId: 'runtime.agent_core.canonical_memory',
    schemaVersion: '1',
    sessionId: 'desktop-test-session',
    type: 'PUBLIC_SHARED',
    userId: null,
    worldId: null,
    metadata: undefined,
    ...overrides,
  };
}

test('agent memory core list is runtime-only and rejects missing agentId or offset', async () => {
  resetAgentCoreDataStateForTesting();

  const calls: Array<Record<string, unknown>> = [];
  const handlers = createAgentCoreDataCapabilityHandlers({
    runtimeMemory: {
      queryCompatibilityRecords: async (input) => {
        calls.push(input as unknown as Record<string, unknown>);
        return [makeMemoryRecord('core-1')];
      },
    },
  });

  await assert.rejects(
    () => handlers.agentMemoryCoreList({}),
    /AGENT_ID_REQUIRED/,
  );

  await assert.rejects(
    () => handlers.agentMemoryCoreList({ agentId: 'agent-1', offset: 1 }),
    /RUNTIME_AGENT_MEMORY_OFFSET_UNSUPPORTED/,
  );

  const result = await handlers.agentMemoryCoreList({ agentId: 'agent-1', limit: 2, query: 'memory' });
  assert.deepEqual(result, {
    items: [makeMemoryRecord('core-1')],
    source: 'runtime-only',
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    agentId: 'agent-1',
    displayName: 'agent-1',
    createIfMissing: false,
    syncDyadicContext: false,
    syncWorldContext: false,
    query: 'memory',
    limit: 2,
    canonicalClasses: [MemoryCanonicalClass.PUBLIC_SHARED],
    includeInvalidated: false,
  });

  const failingHandlers = createAgentCoreDataCapabilityHandlers({
    runtimeMemory: {
      queryCompatibilityRecords: async () => {
        throw new Error('RUNTIME_GRPC_NOT_FOUND');
      },
    },
  });
  await assert.rejects(
    () => failingHandlers.agentMemoryCoreList({ agentId: 'agent-404' }),
    /RUNTIME_GRPC_NOT_FOUND/,
  );
});

test('agent memory dyadic and e2e list require user context and map to runtime dyadic reads', async () => {
  resetAgentCoreDataStateForTesting();

  const calls: Array<Record<string, unknown>> = [];
  const handlers = createAgentCoreDataCapabilityHandlers({
    resolveCurrentUserId: async () => 'user-1',
    runtimeMemory: {
      queryCompatibilityRecords: async (input) => {
        calls.push(input as unknown as Record<string, unknown>);
        return [makeMemoryRecord('dyadic-1', { type: 'DYADIC', userId: 'user-1' })];
      },
    },
  });

  const missingUserHandlers = createAgentCoreDataCapabilityHandlers({
    resolveCurrentUserId: async () => undefined,
    runtimeMemory: {
      queryCompatibilityRecords: async () => [],
    },
  });
  await assert.rejects(
    () => missingUserHandlers.agentMemoryDyadicList({ agentId: 'agent-dyadic' }),
    /AGENT_MEMORY_USER_ID_REQUIRED/,
  );

  const dyadic = await handlers.agentMemoryDyadicList({
    agentId: 'agent-dyadic',
    limit: 3,
  });
  assert.deepEqual(dyadic, {
    items: [makeMemoryRecord('dyadic-1', { type: 'DYADIC', userId: 'user-1' })],
    source: 'runtime-only',
    userId: 'user-1',
  });

  const e2e = await handlers.agentMemoryE2EList({
    agentId: 'agent-dyadic',
    userId: 'user-1',
  });
  assert.deepEqual(e2e, {
    items: [makeMemoryRecord('dyadic-1', { type: 'DYADIC', userId: 'user-1' })],
    source: 'runtime-only',
    userId: 'user-1',
  });

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.deepEqual(call, {
      agentId: 'agent-dyadic',
      displayName: 'agent-dyadic',
      dyadicUserId: 'user-1',
      createIfMissing: false,
      syncDyadicContext: true,
      syncWorldContext: false,
      query: undefined,
      limit: call.limit,
      canonicalClasses: [MemoryCanonicalClass.DYADIC],
      includeInvalidated: false,
    });
  }
});

test('agent memory recall for entity fans out to public_shared and dyadic runtime reads', async () => {
  resetAgentCoreDataStateForTesting();

  const calls: Array<Record<string, unknown>> = [];
  const handlers = createAgentCoreDataCapabilityHandlers({
    runtimeMemory: {
      queryCompatibilityRecords: async (input) => {
        calls.push(input as unknown as Record<string, unknown>);
        const classes = (input as { canonicalClasses: MemoryCanonicalClass[] }).canonicalClasses;
        if (classes[0] === MemoryCanonicalClass.PUBLIC_SHARED) {
          return [makeMemoryRecord('core-1')];
        }
        return [makeMemoryRecord('dyadic-1', { type: 'DYADIC', userId: 'user-9' })];
      },
    },
    resolveCurrentUserId: async () => 'user-9',
  });

  const result = await handlers.agentMemoryRecallForEntity({
    agentId: 'agent-recall',
    query: 'relationship memory',
  });
  assert.deepEqual(result, {
    core: [makeMemoryRecord('core-1')],
    e2e: [makeMemoryRecord('dyadic-1', { type: 'DYADIC', userId: 'user-9' })],
    entityId: 'user-9',
    recallSource: 'runtime-only',
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.canonicalClasses), [
    [MemoryCanonicalClass.PUBLIC_SHARED],
    [MemoryCanonicalClass.DYADIC],
  ]);
});

test('agent memory profiles fail closed while stats soft-disable to zero counts', async () => {
  resetAgentCoreDataStateForTesting();

  const handlers = createAgentCoreDataCapabilityHandlers();
  await assert.rejects(
    () => handlers.agentMemoryProfilesList({ agentId: 'agent-profiles' }),
    /AGENT_MEMORY_PROFILES_UNSUPPORTED_BY_RUNTIME_AUTHORITY/,
  );
  await assert.doesNotReject(async () => {
    const stats = await handlers.agentMemoryStatsGet({ agentId: 'agent-profiles' });
    assert.deepEqual(stats, {
      coreCount: 0,
      dyadicCount: 0,
    });
  });
});
