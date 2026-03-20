import assert from 'node:assert/strict';
import test from 'node:test';

import type { Realm } from '../../src/realm/client.js';
import {
  listAgentCoreMemories,
  listAgentE2EMemories,
  recallAgentMemoriesForEntity,
} from '../../src/realm/extensions/agent-memory.js';
import { ReasonCode } from '../../src/types/index.js';

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

test('listAgentCoreMemories throws when agentId is empty', async () => {
  await assert.rejects(
    () => listAgentCoreMemories(createRealmMock(), { agentId: '' }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.ACTION_INPUT_INVALID);
      assert.equal((error as { actionHint?: string }).actionHint, 'provide_agent_id');
      return true;
    },
  );
});

test('listAgentE2EMemories throws when entityId is empty', async () => {
  await assert.rejects(
    () => listAgentE2EMemories(createRealmMock(), { agentId: 'agent-1', entityId: '' }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.ACTION_INPUT_INVALID);
      assert.equal((error as { actionHint?: string }).actionHint, 'provide_entity_id');
      return true;
    },
  );
});

test('recallAgentMemoriesForEntity passes params to service', async () => {
  let capturedArgs: { agentId: string; entityId: string; limit?: number; query?: string } | null = null;

  const realm = createRealmMock({
    recall: async (agentId, entityId, limit, query) => {
      capturedArgs = { agentId, entityId, limit, query };
      return { hits: [] };
    },
  });

  const result = await recallAgentMemoriesForEntity(realm, {
    agentId: 'agent-1',
    entityId: 'entity-2',
    limit: 10,
    query: 'search term',
  });

  assert.ok(result);
  assert.deepEqual((result as { hits: unknown[] }).hits, []);
  assert.deepEqual(capturedArgs, {
    agentId: 'agent-1',
    entityId: 'entity-2',
    limit: 10,
    query: 'search term',
  });
});
