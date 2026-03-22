import assert from 'node:assert/strict';
import test from 'node:test';

import { ReasonCode } from '@nimiplatform/sdk/types';
import {
  loadMainWorld,
  loadWorldAgents,
  loadWorldDetailWithAgents,
  loadWorldSemanticBundle,
} from '../src/runtime/data-sync/flows/world-flow.js';
import { createOfflineError, getOfflineCacheManager } from '../src/runtime/offline/index.js';

type DataSyncError = {
  action: string;
  error: unknown;
  details?: Record<string, unknown>;
};

function createEmitter(errors: DataSyncError[]) {
  return (action: string, error: unknown, details?: Record<string, unknown>) => {
    errors.push({ action, error, details });
  };
}

test('loadMainWorld fails close on non-object payloads', async () => {
  const errors: DataSyncError[] = [];

  await assert.rejects(
    () => loadMainWorld(
      async () => 'not-an-object' as never,
      createEmitter(errors),
    ),
    /MAIN_WORLD_CONTRACT_INVALID/,
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
  const errors: DataSyncError[] = [];

  await assert.rejects(
    () => loadWorldAgents(
      async () => [{ id: 'ok' }, 'bad-entry'] as never,
      createEmitter(errors),
      'world-1',
    ),
    /WORLD_AGENT_LIST_CONTRACT_INVALID/,
  );

  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.action, 'load-world-agents');
});

test('loadWorldDetailWithAgents fails close on invalid object payloads', async () => {
  const errors: DataSyncError[] = [];

  await assert.rejects(
    () => loadWorldDetailWithAgents(
      async () => 'bad-payload' as never,
      createEmitter(errors),
      'world-1',
    ),
    /WORLD_DETAIL_WITH_AGENTS_CONTRACT_INVALID/,
  );

  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.action, 'load-world-detail-with-agents');
});

test('loadWorldSemanticBundle only requests worldview and skips redundant world detail fetch', async () => {
  const errors: DataSyncError[] = [];
  let worldDetailCalls = 0;
  let worldviewCalls = 0;

  const result = await loadWorldSemanticBundle(
    async (task) => task({
      services: {
        WorldsService: {
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
        },
      },
    } as never),
    createEmitter(errors),
    'world-1',
  );

  assert.equal(worldDetailCalls, 0);
  assert.equal(worldviewCalls, 1);
  assert.equal(result.world, null);
  assert.equal(result.worldview?.id, 'view-1');
  assert.equal(errors.length, 0);
});
