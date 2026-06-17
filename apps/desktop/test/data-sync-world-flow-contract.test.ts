import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createOfflineNimiError as createOfflineError,
  ReasonCode,
} from '@nimiplatform/sdk/types';
import {
  loadWorldDetailById,
  loadMainWorld,
  loadWorldAgents,
  loadWorldDetailWithAgents,
  loadWorldHistory,
  loadWorldLorebooks,
  loadWorldSemanticBundle,
} from '../src/shell/renderer/features/world/data/realm-world-data.js';
import { getOfflineCacheManager } from '../src/shell/renderer/infra/offline/cache-manager.js';

type RealmWorldDataError = {
  action: string;
  error: unknown;
  details?: Record<string, unknown>;
};

function createEmitter(errors: RealmWorldDataError[]) {
  return (action: string, error: unknown, details?: Record<string, unknown>) => {
    errors.push({ action, error, details });
  };
}

type RealmWorldCallApi = Parameters<typeof loadMainWorld>[0];

function createWorldCallApi(world: Record<string, unknown>): RealmWorldCallApi {
  return async (task) => task({ world } as never);
}

async function assertRejectsWithReasonCode(
  action: () => Promise<unknown>,
  reasonCode: string,
): Promise<void> {
  await assert.rejects(
    action,
    (error: unknown) => {
      assert.equal((error as { readonly reasonCode?: string }).reasonCode, reasonCode);
      return true;
    },
  );
}

test('loadMainWorld fails close on non-object payloads', async () => {
  const errors: RealmWorldDataError[] = [];

  await assertRejectsWithReasonCode(
    () => loadMainWorld(
      createWorldCallApi({
        worldControllerGetMainWorld: async () => 'not-an-object',
      }),
      createEmitter(errors),
    ),
    'SDK_REALM_MAIN_WORLD_CONTRACT_INVALID',
  );

  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.action, 'load-main-world');
});

test('loadMainWorld still falls back to cached world metadata for offline errors', async () => {
  const manager = await getOfflineCacheManager();
  manager.close();
  await manager.open();
  await manager.syncWorldMetadata('main-world', {
    id: 'cached-world',
    name: 'Cached World',
  });

  const result = await loadMainWorld(
    async () => {
      throw createOfflineError({
        source: 'realm',
        reasonCode: ReasonCode.REALM_UNAVAILABLE,
        message: 'offline',
        actionHint: 'retry',
      });
    },
    () => undefined,
  );

  assert.equal(result.id, 'cached-world');
});

test('loadWorldAgents fails close on invalid list payloads', async () => {
  const errors: RealmWorldDataError[] = [];

  await assertRejectsWithReasonCode(
    () => loadWorldAgents(
      createWorldCallApi({
        worldControllerGetWorldAgents: async () => [{ id: 'ok' }, 'bad-entry'],
      }),
      createEmitter(errors),
      'world-1',
    ),
    'SDK_REALM_WORLD_AGENTS_CONTRACT_INVALID',
  );

  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.action, 'load-world-agents');
});

test('loadWorldDetailWithAgents fails close on invalid object payloads', async () => {
  const errors: RealmWorldDataError[] = [];

  await assertRejectsWithReasonCode(
    () => loadWorldDetailWithAgents(
      createWorldCallApi({
        worldControllerGetWorldDetailWithAgents: async () => 'bad-payload',
      }),
      createEmitter(errors),
      'world-1',
    ),
    'SDK_REALM_WORLD_DETAIL_WITH_AGENTS_CONTRACT_INVALID',
  );

  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.action, 'load-world-detail-with-agents');
});

test('loadWorldDetailWithAgents fails close when the response world id does not match the request', async () => {
  const errors: RealmWorldDataError[] = [];

  await assertRejectsWithReasonCode(
    () => loadWorldDetailWithAgents(
      createWorldCallApi({
        worldControllerGetWorldDetailWithAgents: async () => ({ id: 'world-2', agents: [] }),
      }),
      createEmitter(errors),
      'world-1',
    ),
    'SDK_REALM_WORLD_DETAIL_WITH_AGENTS_WORLD_ID_MISMATCH',
  );

  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.action, 'load-world-detail-with-agents');
});

test('loadWorldDetailById fails close when the response world id does not match the request', async () => {
  const errors: RealmWorldDataError[] = [];

  await assertRejectsWithReasonCode(
    () => loadWorldDetailById(
      createWorldCallApi({
        worldControllerGetWorld: async () => ({ id: 'world-2' }),
      }),
      createEmitter(errors),
      'world-1',
    ),
    'SDK_REALM_WORLD_DETAIL_WORLD_ID_MISMATCH',
  );

  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.action, 'load-world-detail');
});

test('loadWorldHistory fails close when the response world id does not match the request', async () => {
  const errors: RealmWorldDataError[] = [];

  await assertRejectsWithReasonCode(
    () => loadWorldHistory(
      createWorldCallApi({
        worldControllerGetWorldHistory: async () => ({ worldId: 'world-2', items: [] }),
      }),
      createEmitter(errors),
      'world-1',
    ),
    'SDK_REALM_WORLD_HISTORY_WORLD_ID_MISMATCH',
  );

  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.action, 'load-world-history');
});

test('loadWorldLorebooks fails close when the response world id does not match the request', async () => {
  const errors: RealmWorldDataError[] = [];

  await assertRejectsWithReasonCode(
    () => loadWorldLorebooks(
      createWorldCallApi({
        worldControllerGetWorldLorebooks: async () => ({ worldId: 'world-2', items: [] }),
      }),
      createEmitter(errors),
      'world-1',
    ),
    'SDK_REALM_WORLD_LOREBOOKS_WORLD_ID_MISMATCH',
  );

  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.action, 'load-world-lorebooks');
});

test('loadWorldSemanticBundle only requests worldview and skips redundant world detail fetch', async () => {
  const errors: RealmWorldDataError[] = [];
  let worldDetailCalls = 0;
  let worldviewCalls = 0;

  const result = await loadWorldSemanticBundle(
    createWorldCallApi({
      worldControllerGetWorld: async () => {
        worldDetailCalls += 1;
        return { id: 'world-1' };
      },
      worldControllerGetWorldview: async () => {
        worldviewCalls += 1;
        return {
          id: 'view-1',
          coreSystem: null,
          spaceTopology: null,
          causality: null,
          languages: null,
        };
      },
    }),
    createEmitter(errors),
    'world-1',
  );

  assert.equal(worldDetailCalls, 0);
  assert.equal(worldviewCalls, 1);
  const resultRecord = result as { world?: unknown; worldview?: { id?: unknown } };
  assert.equal(resultRecord.world, null);
  assert.equal(resultRecord.worldview?.id, 'view-1');
  assert.equal(errors.length, 0);
});

test('loadWorldSemanticBundle fails close when worldview loading fails', async () => {
  const errors: RealmWorldDataError[] = [];

  await assert.rejects(
    () => loadWorldSemanticBundle(
      async () => {
        throw new Error('realm worldview unavailable');
      },
      createEmitter(errors),
      'world-1',
    ),
    /realm worldview unavailable/,
  );

  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.action, 'load-world-semantic-bundle');
  assert.deepEqual(errors[0]!.details, { worldId: 'world-1' });
});
