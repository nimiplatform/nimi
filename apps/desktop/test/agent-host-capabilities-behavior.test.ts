import assert from 'node:assert/strict';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import test from 'node:test';
import {
  createAgentCoreDataCapabilityHandlers,
  resetAgentCoreDataStateForTesting,
  seedAgentMemoryIndexForTesting,
} from '../src/shell/renderer/infra/bootstrap/core-capabilities';

type MemoryStatsResponseDto = RealmModel<'MemoryStatsResponseDto'>;

test('agent chat route capability fails close on missing agentId, invalid payload, and remote errors', async () => {
  resetAgentCoreDataStateForTesting();

  const missingHandlers = createAgentCoreDataCapabilityHandlers();
  await assert.rejects(
    () => missingHandlers.agentChatRouteResolve({}),
    /AGENT_ID_REQUIRED/,
  );

  const invalidHandlers = createAgentCoreDataCapabilityHandlers({
    client: {
      resolveAgentChatRoute: async () => ({}) as never,
    },
  });
  await assert.rejects(
    () => invalidHandlers.agentChatRouteResolve({ agentId: 'agent-1' }),
    /AGENT_CHAT_ROUTE_INVALID/,
  );

  const remoteError = new Error('CONTROL_PLANE_DOWN');
  const failingHandlers = createAgentCoreDataCapabilityHandlers({
    client: {
      resolveAgentChatRoute: async () => {
        throw remoteError;
      },
    },
  });
  await assert.rejects(
    () => failingHandlers.agentChatRouteResolve({ agentId: 'agent-1' }),
    /CONTROL_PLANE_DOWN/,
  );
});

test('agent memory core list uses cache-only semantics and rejects missing agentId', async () => {
  resetAgentCoreDataStateForTesting();

  const missingHandlers = createAgentCoreDataCapabilityHandlers();
  await assert.rejects(
    () => missingHandlers.agentMemoryCoreList({}),
    /AGENT_ID_REQUIRED/,
  );

  seedAgentMemoryIndexForTesting({
    agentId: 'agent-cache',
    core: [{ id: 'core-1' }],
  });
  let requestCount = 0;
  const cachedHandlers = createAgentCoreDataCapabilityHandlers({
    client: {
      listAgentCoreMemories: async () => {
        requestCount += 1;
        throw new Error('UNEXPECTED_REMOTE_CALL');
      },
    },
  });
  const cached = await cachedHandlers.agentMemoryCoreList({ agentId: 'agent-cache', limit: 1 });
  assert.deepEqual(cached, {
    items: [{ id: 'core-1' }],
    source: 'local-index-only',
  });
  assert.equal(requestCount, 0);

  resetAgentCoreDataStateForTesting();
  const failingHandlers = createAgentCoreDataCapabilityHandlers({
    client: {
      listAgentCoreMemories: async () => {
        throw new Error('REMOTE_MEMORY_DOWN');
      },
    },
  });
  await assert.rejects(
    () => failingHandlers.agentMemoryCoreList({ agentId: 'agent-cache' }),
    /REMOTE_MEMORY_DOWN/,
  );
});

test('agent memory e2e list requires entity context and only serves cached slices locally', async () => {
  resetAgentCoreDataStateForTesting();

  const missingEntityHandlers = createAgentCoreDataCapabilityHandlers({
    resolveCurrentUserId: async () => null,
  });
  await assert.rejects(
    () => missingEntityHandlers.agentMemoryE2EList({ agentId: 'agent-e2e' }),
    /AGENT_MEMORY_ENTITY_ID_REQUIRED/,
  );

  seedAgentMemoryIndexForTesting({
    agentId: 'agent-e2e',
    entityId: 'user-1',
    e2e: [{ id: 'e2e-1' }],
  });
  let requestCount = 0;
  const cachedHandlers = createAgentCoreDataCapabilityHandlers({
    client: {
      listAgentE2EMemories: async () => {
        requestCount += 1;
        throw new Error('UNEXPECTED_REMOTE_CALL');
      },
    },
  });
  const cached = await cachedHandlers.agentMemoryE2EList({
    agentId: 'agent-e2e',
    entityId: 'user-1',
  });
  assert.deepEqual(cached, {
    items: [{ id: 'e2e-1' }],
    source: 'local-index-only',
    entityId: 'user-1',
  });
  assert.equal(requestCount, 0);

  resetAgentCoreDataStateForTesting();
  const failingHandlers = createAgentCoreDataCapabilityHandlers({
    resolveCurrentUserId: async () => 'user-1',
    client: {
      listAgentE2EMemories: async () => {
        throw new Error('REMOTE_MEMORY_DOWN');
      },
    },
  });
  await assert.rejects(
    () => failingHandlers.agentMemoryE2EList({ agentId: 'agent-e2e' }),
    /REMOTE_MEMORY_DOWN/,
  );
});

test('agent memory recall only returns local data when cache already satisfies topK', async () => {
  resetAgentCoreDataStateForTesting();

  seedAgentMemoryIndexForTesting({
    agentId: 'agent-recall',
    core: [{ id: 'core-1' }],
    entityId: 'user-1',
    e2e: [{ id: 'e2e-1' }],
  });
  let requestCount = 0;
  const localHandlers = createAgentCoreDataCapabilityHandlers({
    client: {
      recallAgentMemoriesForEntity: async () => {
        requestCount += 1;
        throw new Error('UNEXPECTED_REMOTE_CALL');
      },
    },
  });
  const localOnly = await localHandlers.agentMemoryRecallForEntity({
    agentId: 'agent-recall',
    entityId: 'user-1',
    topK: 2,
  });
  assert.deepEqual(localOnly, {
    items: [{ id: 'e2e-1' }, { id: 'core-1' }],
    core: [{ id: 'core-1' }],
    e2e: [{ id: 'e2e-1' }],
    entityId: 'user-1',
    recallSource: 'local-index-only',
  });
  assert.equal(requestCount, 0);

  resetAgentCoreDataStateForTesting();
  seedAgentMemoryIndexForTesting({
    agentId: 'agent-recall',
    core: [{ id: 'core-1' }],
    entityId: 'user-1',
    e2e: [],
  });
  const failingHandlers = createAgentCoreDataCapabilityHandlers({
    client: {
      recallAgentMemoriesForEntity: async () => {
        throw new Error('REMOTE_RECALL_DOWN');
      },
    },
  });
  await assert.rejects(
    () => failingHandlers.agentMemoryRecallForEntity({
      agentId: 'agent-recall',
      entityId: 'user-1',
      topK: 2,
    }),
    /REMOTE_RECALL_DOWN/,
  );
});

test('agent memory stats require cached stats or remote success and do not synthesize counts from slices', async () => {
  resetAgentCoreDataStateForTesting();

  const cachedStats: MemoryStatsResponseDto = {
    coreCount: 1,
    e2eCount: 2,
    profileCount: 3,
  } as MemoryStatsResponseDto;
  seedAgentMemoryIndexForTesting({
    agentId: 'agent-stats',
    stats: cachedStats,
  });
  let requestCount = 0;
  const cachedHandlers = createAgentCoreDataCapabilityHandlers({
    client: {
      getAgentMemoryStats: async () => {
        requestCount += 1;
        throw new Error('UNEXPECTED_REMOTE_CALL');
      },
    },
  });
  const localOnly = await cachedHandlers.agentMemoryStatsGet({ agentId: 'agent-stats' });
  assert.deepEqual(localOnly, {
    ...cachedStats,
    source: 'local-index-only',
  });
  assert.equal(requestCount, 0);

  resetAgentCoreDataStateForTesting();
  seedAgentMemoryIndexForTesting({
    agentId: 'agent-stats',
    core: [{ id: 'core-1' }],
    entityId: 'user-1',
    e2e: [{ id: 'e2e-1' }],
  });
  const failingHandlers = createAgentCoreDataCapabilityHandlers({
    client: {
      getAgentMemoryStats: async () => {
        throw new Error('REMOTE_STATS_DOWN');
      },
    },
  });
  await assert.rejects(
    () => failingHandlers.agentMemoryStatsGet({ agentId: 'agent-stats' }),
    /REMOTE_STATS_DOWN/,
  );
});
