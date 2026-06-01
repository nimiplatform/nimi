import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRealmMasterAgent,
  loadRealmAgentDetails,
  loadRealmCreatorAgents,
} from '../src/realm/index.js';

function createCallApi(services: Record<string, unknown>) {
  return async <T>(task: (realm: { services: Record<string, unknown> }) => Promise<T>) =>
    task({ services });
}

test('Realm agent detail rejects legacy handle prefixes before service calls', async () => {
  let calls = 0;
  const callApi = async () => {
    calls += 1;
    throw new Error('UNEXPECTED_API_CALL');
  };

  await assert.rejects(
    () => loadRealmAgentDetails(callApi as never, () => undefined, '@legacy'),
    /HANDLE_PREFIX_UNSUPPORTED/,
  );
  await assert.rejects(
    () => loadRealmAgentDetails(callApi as never, () => undefined, '~legacy'),
    /HANDLE_PREFIX_UNSUPPORTED/,
  );
  assert.equal(calls, 0);
});

test('Realm agent detail loads by id, enriches world banner, and caches no app truth', async () => {
  const calls: string[] = [];
  const detail = await loadRealmAgentDetails(
    createCallApi({
      AgentsService: {
        getAgent: async (id: string) => {
          calls.push(`get-id:${id}`);
          return { id, isAgent: true, worldId: 'world-1', handle: 'agent-one' };
        },
        getAgentByHandle: async (handle: string) => {
          calls.push(`get-handle:${handle}`);
          return null;
        },
      },
      WorldsService: {
        worldControllerGetWorld: async (worldId: string) => {
          calls.push(`get-world:${worldId}`);
          return { id: worldId, name: 'World One', bannerUrl: 'https://media.test/world-one.png' };
        },
      },
    }) as never,
    () => undefined,
    'agent-1',
  );

  assert.deepEqual(calls, ['get-id:agent-1', 'get-world:world-1']);
  assert.equal(detail.worldName, 'World One');
  assert.equal(detail.worldBannerUrl, 'https://media.test/world-one.png');
});

test('Realm agent detail falls back from id lookup to handle lookup', async () => {
  const calls: string[] = [];
  const detail = await loadRealmAgentDetails(
    createCallApi({
      AgentsService: {
        getAgent: async (id: string) => {
          calls.push(`get-id:${id}`);
          throw new Error('not id');
        },
        getAgentByHandle: async (handle: string) => {
          calls.push(`get-handle:${handle}`);
          return { id: 'agent-by-handle', handle, isAgent: true };
        },
      },
      WorldsService: {
        worldControllerGetWorld: async () => null,
      },
    }) as never,
    () => undefined,
    'agent-handle',
  );

  assert.deepEqual(calls, ['get-id:agent-handle', 'get-handle:agent-handle']);
  assert.equal(detail.id, 'agent-by-handle');
});

test('Realm creator agent helpers own list and create service calls', async () => {
  const capturedCalls: string[] = [];
  const callApi = createCallApi({
    CreatorService: {
      creatorControllerListAgents: async () => {
        capturedCalls.push('list-agents');
        return [{ id: 'agent-1', displayName: 'Agent One' }];
      },
      creatorControllerCreateAgent: async (input: Record<string, unknown>) => {
        capturedCalls.push(`create-agent:${String(input.handle || '')}`);
        return { id: 'agent-2', ...input };
      },
    },
  }) as never;

  const agents = await loadRealmCreatorAgents(callApi);
  const created = await createRealmMasterAgent(callApi, {
    worldId: 'world-1',
    handle: ' agent_two ',
    concept: ' concept ',
    displayName: ' Agent Two ',
  });

  assert.deepEqual(capturedCalls, ['list-agents', 'create-agent:agent_two']);
  assert.deepEqual(agents, [{ id: 'agent-1', displayName: 'Agent One' }]);
  assert.equal(created.id, 'agent-2');
  assert.equal(created.handle, 'agent_two');
  assert.equal(created.concept, 'concept');
  assert.equal(created.ownershipType, 'MASTER_OWNED');
});

test('Realm creator agent list fails closed instead of returning pseudo-success', async () => {
  await assert.rejects(
    () => loadRealmCreatorAgents((async () => {
      throw new Error('Forbidden');
    }) as never),
    /Forbidden/,
  );
});
