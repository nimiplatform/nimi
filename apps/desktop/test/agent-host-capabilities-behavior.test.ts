import assert from 'node:assert/strict';
import type { AgentMemoryRecord } from '@nimiplatform/sdk/realm';
import test from 'node:test';
import {
  createAgentCoreDataCapabilityHandlers,
  resetAgentCoreDataStateForTesting,
  seedAgentMemoryIndexForTesting,
} from '../src/shell/renderer/infra/bootstrap/core-capabilities';

function makeMemoryRecord(id: string, overrides: Partial<AgentMemoryRecord> = {}): AgentMemoryRecord {
  return {
    actorRefs: [],
    appId: 'desktop-test',
    commitId: `${id}-commit`,
    id,
    content: `${id} content`,
    createdAt: '2026-03-01T00:00:00Z',
    createdBy: 'user-1',
    effectClass: 'MEMORY_ONLY',
    importance: 1,
    reason: 'desktop test',
    schemaId: 'agent.memory.commit',
    schemaVersion: '1',
    sessionId: 'desktop-test-session',
    type: 'PUBLIC_SHARED',
    userId: null,
    worldId: null,
    metadata: undefined,
    ...overrides,
  };
}

test('agent memory core list uses cache-only semantics and rejects missing agentId', async () => {
  resetAgentCoreDataStateForTesting();

  const missingHandlers = createAgentCoreDataCapabilityHandlers();
  await assert.rejects(
    () => missingHandlers.agentMemoryCoreList({}),
    /AGENT_ID_REQUIRED/,
  );

  seedAgentMemoryIndexForTesting({
    agentId: 'agent-cache',
    core: [makeMemoryRecord('core-1')],
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
    items: [makeMemoryRecord('core-1')],
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

test('agent memory dyadic list requires user context and only serves cached slices locally', async () => {
  resetAgentCoreDataStateForTesting();

  const missingUserHandlers = createAgentCoreDataCapabilityHandlers({
    resolveCurrentUserId: async () => undefined,
  });
  await assert.rejects(
    () => missingUserHandlers.agentMemoryDyadicList({ agentId: 'agent-dyadic' }),
    /AGENT_MEMORY_USER_ID_REQUIRED/,
  );

  seedAgentMemoryIndexForTesting({
    agentId: 'agent-dyadic',
    userId: 'user-1',
    dyadic: [makeMemoryRecord('dyadic-1', { userId: 'user-1', type: 'DYADIC' })],
  });
  let requestCount = 0;
  const cachedHandlers = createAgentCoreDataCapabilityHandlers({
    client: {
      listAgentDyadicMemories: async () => {
        requestCount += 1;
        throw new Error('UNEXPECTED_REMOTE_CALL');
      },
    },
  });
  const cached = await cachedHandlers.agentMemoryDyadicList({
    agentId: 'agent-dyadic',
    userId: 'user-1',
  });
  assert.deepEqual(cached, {
    items: [makeMemoryRecord('dyadic-1', { userId: 'user-1', type: 'DYADIC' })],
    source: 'local-index-only',
    userId: 'user-1',
  });
  assert.equal(requestCount, 0);

  resetAgentCoreDataStateForTesting();
  const failingHandlers = createAgentCoreDataCapabilityHandlers({
    resolveCurrentUserId: async () => 'user-1',
    client: {
      listAgentDyadicMemories: async () => {
        throw new Error('REMOTE_MEMORY_DOWN');
      },
    },
  });
  await assert.rejects(
    () => failingHandlers.agentMemoryDyadicList({ agentId: 'agent-dyadic' }),
    /REMOTE_MEMORY_DOWN/,
  );
});

test('agent memory profiles list validates the remote contract', async () => {
  resetAgentCoreDataStateForTesting();

  const invalidHandlers = createAgentCoreDataCapabilityHandlers({
    client: {
      listAgentMemoryProfiles: async () => ({ invalid: true }),
    },
  });
  await assert.rejects(
    () => invalidHandlers.agentMemoryProfilesList({ agentId: 'agent-profiles' }),
    /AGENT_MEMORY_PROFILES_CONTRACT_INVALID/,
  );

  const handlers = createAgentCoreDataCapabilityHandlers({
    client: {
      listAgentMemoryProfiles: async () => ({
        items: [{ userId: 'user-1' }, { userId: 'user-2' }],
      }),
    },
  });
  const result = await handlers.agentMemoryProfilesList({ agentId: 'agent-profiles' });
  assert.deepEqual(result, {
    items: [{ userId: 'user-1' }, { userId: 'user-2' }],
  });
});
