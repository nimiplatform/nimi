import assert from 'node:assert/strict';
import test from 'node:test';

import type { Realm } from '../src/realm/client.js';
import {
  listAgentCoreMemories,
  listAgentE2EMemories,
  recallAgentMemoriesForEntity,
} from '../src/realm/extensions/agent-memory.js';
import { ReasonCode } from '../src/types/index.js';

function createRealmMock(overrides?: {
  listCore?: (agentId: string, limit?: number) => Promise<unknown[]>;
  listE2E?: (agentId: string, entityId: string, limit?: number) => Promise<unknown[]>;
  recall?: (agentId: string, entityId: string, limit?: number, query?: string) => Promise<unknown>;
}): Realm {
  return {
    services: {
      AgentsService: {
        agentControllerListCoreMemories: overrides?.listCore ?? (async () => []),
        agentControllerListE2EMemories: overrides?.listE2E ?? (async () => []),
        agentControllerRecallForEntity: overrides?.recall ?? (async () => ({ hits: [] })),
      },
    },
  } as unknown as Realm;
}

test('agent memory helpers reject missing ids with NimiError', async () => {
  await assert.rejects(
    () => listAgentCoreMemories(createRealmMock(), { agentId: ' ' }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.ACTION_INPUT_INVALID);
      assert.equal((error as { actionHint?: string }).actionHint, 'provide_agent_id');
      return true;
    },
  );

  await assert.rejects(
    () => listAgentE2EMemories(createRealmMock(), { agentId: 'agent-1', entityId: '' }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.ACTION_INPUT_INVALID);
      assert.equal((error as { actionHint?: string }).actionHint, 'provide_entity_id');
      return true;
    },
  );

  await assert.rejects(
    () => recallAgentMemoriesForEntity(createRealmMock(), { agentId: '', entityId: 'entity-1' }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.ACTION_INPUT_INVALID);
      assert.equal((error as { actionHint?: string }).actionHint, 'provide_agent_id');
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
    () => recallAgentMemoriesForEntity(createRealmMock({
      recall: async () => { throw failure; },
    }), { agentId: 'agent-1', entityId: 'entity-1' }),
    failure,
  );
});

test('agent memory helpers forward ids, limits, and trimmed query', async () => {
  let coreArgs: { agentId: string; limit?: number } | null = null;
  let e2eArgs: { agentId: string; entityId: string; limit?: number } | null = null;
  let recallArgs: { agentId: string; entityId: string; limit?: number; query?: string } | null = null;
  const realm = createRealmMock({
    listCore: async (agentId, limit) => {
      coreArgs = { agentId, limit };
      return [{ id: 'core-1' }];
    },
    listE2E: async (agentId, entityId, limit) => {
      e2eArgs = { agentId, entityId, limit };
      return [{ id: 'e2e-1' }];
    },
    recall: async (agentId, entityId, limit, query) => {
      recallArgs = { agentId, entityId, limit, query };
      return { hits: [{ id: 'recall-1' }] };
    },
  });

  const core = await listAgentCoreMemories(realm, { agentId: ' agent-1 ', limit: 5 });
  const e2e = await listAgentE2EMemories(realm, {
    agentId: ' agent-1 ',
    entityId: ' entity-1 ',
    limit: 7,
  });
  const recall = await recallAgentMemoriesForEntity(realm, {
    agentId: ' agent-1 ',
    entityId: ' entity-1 ',
    limit: 9,
    query: '  favorite memory  ',
  });

  assert.deepEqual(core, [{ id: 'core-1' }]);
  assert.deepEqual(e2e, [{ id: 'e2e-1' }]);
  assert.deepEqual(recall, { hits: [{ id: 'recall-1' }] });
  assert.deepEqual(coreArgs, { agentId: 'agent-1', limit: 5 });
  assert.deepEqual(e2eArgs, { agentId: 'agent-1', entityId: 'entity-1', limit: 7 });
  assert.deepEqual(recallArgs, {
    agentId: 'agent-1',
    entityId: 'entity-1',
    limit: 9,
    query: 'favorite memory',
  });
});
