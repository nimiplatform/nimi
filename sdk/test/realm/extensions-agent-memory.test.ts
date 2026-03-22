import assert from 'node:assert/strict';
import test from 'node:test';

import type { Realm } from '../../src/realm/client.js';
import {
  type AgentMemoryCommitEnvelope,
  commitAgentMemories,
  listAgentCoreMemories,
  listAgentDyadicMemories,
} from '../../src/realm/extensions/agent-memory.js';
import { ReasonCode } from '../../src/types/index.js';

const memoryCommit: AgentMemoryCommitEnvelope = {
  worldId: 'world-1',
  appId: 'sdk-test',
  sessionId: 'sdk-test-session',
  effectClass: 'MEMORY_ONLY',
  scope: 'WORLD',
  schemaId: 'agent.memory.commit',
  schemaVersion: '1',
  actorRefs: [
    {
      actorId: 'agent-1',
      actorType: 'AGENT',
      role: 'owner',
    },
  ],
  reason: 'sdk test commit',
};

function createRealmMock(overrides?: {
  listCore?: (agentId: string, limit?: number) => Promise<unknown[]>;
  listDyadic?: (agentId: string, userId: string, limit?: number) => Promise<unknown[]>;
  commit?: (agentId: string, body: Record<string, unknown>) => Promise<unknown>;
}): Realm {
  return {
    services: {
      AgentsService: {
        agentControllerListCoreMemories: overrides?.listCore ?? (async () => []),
        agentControllerListDyadicMemories: overrides?.listDyadic ?? (async () => []),
        agentControllerCommitMemory: overrides?.commit ?? (async () => ({ id: 'memory-1' })),
      },
    },
  } as unknown as Realm;
}

test('agent memory helpers reject missing ids and content with NimiError', async () => {
  await assert.rejects(
    () => listAgentCoreMemories(createRealmMock(), { agentId: ' ' }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.ACTION_INPUT_INVALID);
      assert.equal((error as { actionHint?: string }).actionHint, 'provide_agent_id');
      return true;
    },
  );

  await assert.rejects(
    () => listAgentDyadicMemories(createRealmMock(), { agentId: 'agent-1', userId: '' }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.ACTION_INPUT_INVALID);
      assert.equal((error as { actionHint?: string }).actionHint, 'provide_user_id');
      return true;
    },
  );

  await assert.rejects(
    () => commitAgentMemories(createRealmMock(), {
      agentId: 'agent-1',
      commit: memoryCommit,
      type: 'PUBLIC_SHARED',
      content: '   ',
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.ACTION_INPUT_INVALID);
      assert.equal((error as { actionHint?: string }).actionHint, 'provide_memory_content');
      return true;
    },
  );
});

test('agent memory helpers propagate service failures', async () => {
  const failure = new Error('AGENT_MEMORY_FAILED');
  await assert.rejects(
    () => listAgentCoreMemories(createRealmMock({
      listCore: async () => { throw failure; },
    }), { agentId: 'agent-1' }),
    failure,
  );

  await assert.rejects(
    () => commitAgentMemories(createRealmMock({
      commit: async () => { throw failure; },
    }), {
      agentId: 'agent-1',
      commit: memoryCommit,
      type: 'PUBLIC_SHARED',
      content: 'memory',
    }),
    failure,
  );
});

test('agent memory helpers forward ids and normalized payloads', async () => {
  let coreArgs: { agentId: string; limit?: number } | null = null;
  let dyadicArgs: { agentId: string; userId: string; limit?: number } | null = null;
  let commitArgs: { agentId: string; body: Record<string, unknown> } | null = null;

  const realm = createRealmMock({
    listCore: async (agentId, limit) => {
      coreArgs = { agentId, limit };
      return [{ id: 'core-1' }];
    },
    listDyadic: async (agentId, userId, limit) => {
      dyadicArgs = { agentId, userId, limit };
      return [{ id: 'dyadic-1' }];
    },
    commit: async (agentId, body) => {
      commitArgs = { agentId, body };
      return { id: 'memory-1' };
    },
  });

  const core = await listAgentCoreMemories(realm, { agentId: ' agent-1 ', limit: 5 });
  const dyadic = await listAgentDyadicMemories(realm, {
    agentId: ' agent-1 ',
    userId: ' user-1 ',
    limit: 7,
  });
  const commit = await commitAgentMemories(realm, {
    agentId: ' agent-1 ',
    commit: memoryCommit,
    type: 'DYADIC',
    content: '  remembered detail  ',
    userId: ' user-1 ',
    worldId: ' world-1 ',
    importance: 8,
    metadata: { source: 'test' },
  });

  assert.deepEqual(core, [{ id: 'core-1' }]);
  assert.deepEqual(dyadic, [{ id: 'dyadic-1' }]);
  assert.deepEqual(commit, { id: 'memory-1' });
  assert.deepEqual(coreArgs, { agentId: 'agent-1', limit: 5 });
  assert.deepEqual(dyadicArgs, { agentId: 'agent-1', userId: 'user-1', limit: 7 });
  assert.deepEqual(commitArgs, {
    agentId: 'agent-1',
    body: {
      commit: memoryCommit,
      type: 'DYADIC',
      content: 'remembered detail',
      userId: 'user-1',
      worldId: 'world-1',
      importance: 8,
      metadata: { source: 'test' },
    },
  });
});
