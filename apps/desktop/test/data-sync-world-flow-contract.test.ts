import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createOfflineNimiError as createOfflineError,
  ReasonCode,
} from '@nimiplatform/sdk/types';
import {
  loadWorldDetailById,
  loadMainWorld,
  loadWorldCharacters,
  loadWorldDetailWithCharacters,
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

function worldCorePayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'world-1',
    visibility: 'public',
    origin: { kind: 'manual', sourceId: 'seed:world-1' },
    creatorId: 'creator-1',
    core: {
      identity: {
        name: 'Song Continuum',
        summary: 'A slow-time alternate Song dynasty world.',
        worldType: 'historical-alternate',
      },
      presentation: {
        title: 'Song Continuum',
        tagline: 'Late Song divergence',
      },
      timeModel: {
        flowRatio: 0.125,
        isPaused: false,
        eraLabel: 'Late Song',
      },
      timeline: {
        events: [{
          eventId: 'song-foundation',
          sequence: 1,
          timestamp: '2026-06-18T00:00:00.000Z',
          title: 'Foundation',
          summary: 'WorldCore admitted.',
        }],
      },
      entities: [
        { entityId: 'song-steward', kind: 'worldCharacter', name: 'Song Steward' },
      ],
      scenes: [
        { sceneId: 'song-arrival', name: 'Arrival Point', summary: 'Initial exploration scene.' },
      ],
      systems: [],
      relationships: [],
      assets: {},
      authoring: { source: 'test' },
    },
    createdAt: '2026-06-18T00:00:00.000Z',
    updatedAt: '2026-06-18T00:00:00.000Z',
    ...overrides,
  };
}

function worldCharacterPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'character-1',
    worldId: 'world-1',
    entityId: 'song-steward',
    core: {
      identity: {
        name: 'Song Steward',
        summary: 'A WorldCharacterCore seed.',
      },
      presentation: {
        displayName: 'Song Steward',
        shortBio: 'Keeps the archive coherent.',
      },
      placement: {
        worldId: 'world-1',
        entityId: 'song-steward',
      },
    },
    createdAt: '2026-06-18T00:00:00.000Z',
    updatedAt: '2026-06-18T00:00:00.000Z',
    ...overrides,
  };
}

function createWorldCallApi(worldCore: Record<string, unknown>, characters: unknown[] = []): RealmWorldCallApi {
  return async (task) => task({
    worldCore: {
      worldCoreControllerGetOasisWorld: async () => ({ ...worldCore, id: 'OASIS', visibility: 'system', creatorId: null }),
      worldCoreControllerGetWorldCore: async ({ path }: { path: { worldId: string } }) => ({
        ...worldCore,
        id: path.worldId,
      }),
      worldCoreControllerListWorldCharacters: async () => characters,
      worldCoreControllerListWorldCores: async () => [worldCore],
    },
  } as never);
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

test('loadMainWorld projects nested WorldCore identity and active display state', async () => {
  const errors: RealmWorldDataError[] = [];

  const result = await loadMainWorld(
    createWorldCallApi(worldCorePayload()),
    createEmitter(errors),
  );

  assert.equal(result.id, 'OASIS');
  assert.equal(result.name, 'Song Continuum');
  assert.equal(result.description, 'A slow-time alternate Song dynasty world.');
  assert.equal(result.type, 'OASIS');
  assert.equal(result.status, 'ACTIVE');
  assert.equal(result.characterCount, 1);
  assert.equal(errors.length, 0);
});

test('loadMainWorld fails close on non-object WorldCore payloads', async () => {
  const errors: RealmWorldDataError[] = [];

  await assertRejectsWithReasonCode(
    () => loadMainWorld(
      async (task) => task({
        worldCore: {
          worldCoreControllerGetOasisWorld: async () => 'not-an-object',
        },
      } as never),
      createEmitter(errors),
    ),
    'SDK_REALM_WORLD_CORE_CONTRACT_INVALID',
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

test('loadWorldCharacters projects nested WorldCharacterCore rows', async () => {
  const errors: RealmWorldDataError[] = [];

  const result = await loadWorldCharacters(
    createWorldCallApi(worldCorePayload(), [worldCharacterPayload()]),
    createEmitter(errors),
    'world-1',
  );

  assert.equal(result[0]?.id, 'character-1');
  assert.equal(result[0]?.name, 'Song Steward');
  assert.equal(result[0]?.bio, 'A WorldCharacterCore seed.');
  assert.equal(errors.length, 0);
});

test('loadWorldCharacters fails close on invalid WorldCharacterCore rows', async () => {
  const errors: RealmWorldDataError[] = [];

  await assertRejectsWithReasonCode(
    () => loadWorldCharacters(
      createWorldCallApi(worldCorePayload(), [worldCharacterPayload(), 'bad-entry']),
      createEmitter(errors),
      'world-1',
    ),
    'SDK_REALM_WORLD_CHARACTER_CORE_CONTRACT_INVALID',
  );

  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.action, 'load-world-characters');
});

test('loadWorldDetailWithCharacters projects detail and preserves full character count before display slicing', async () => {
  const errors: RealmWorldDataError[] = [];

  const result = await loadWorldDetailWithCharacters(
    createWorldCallApi(worldCorePayload(), [
      worldCharacterPayload({ id: 'character-1' }),
      worldCharacterPayload({ id: 'character-2' }),
    ]),
    createEmitter(errors),
    'world-1',
    1,
  );

  assert.equal(result?.id, 'world-1');
  assert.equal(result?.characterCount, 2);
  assert.equal(result?.characters.length, 1);
  assert.equal(errors.length, 0);
});

test('loadWorldDetailById fails close when the WorldCore id does not match the request', async () => {
  const errors: RealmWorldDataError[] = [];

  await assertRejectsWithReasonCode(
    () => loadWorldDetailById(
      async (task) => task({
        worldCore: {
          worldCoreControllerGetWorldCore: async () => worldCorePayload({ id: 'world-2' }),
        },
      } as never),
      createEmitter(errors),
      'world-1',
    ),
    'SDK_REALM_WORLD_CORE_ID_MISMATCH',
  );

  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.action, 'load-world-detail');
});

test('loadWorldHistory reads WorldCore.timeline.events', async () => {
  const errors: RealmWorldDataError[] = [];

  const result = await loadWorldHistory(
    createWorldCallApi(worldCorePayload()),
    createEmitter(errors),
    'world-1',
  );

  assert.equal(result.items[0]?.eventId, 'song-foundation');
  assert.equal(errors.length, 0);
});

test('loadWorldLorebooks reads WorldCore.core.lorebooks without synthetic fallback', async () => {
  const errors: RealmWorldDataError[] = [];

  const result = await loadWorldLorebooks(
    createWorldCallApi(worldCorePayload({
      core: {
        ...(worldCorePayload().core as Record<string, unknown>),
        lorebooks: [{ id: 'lore-1', key: 'chronicle', content: 'Primary entry' }],
      },
    })),
    createEmitter(errors),
    'world-1',
  );

  assert.equal(result.items[0]?.id, 'lore-1');
  assert.equal(errors.length, 0);
});

test('loadWorldSemanticBundle projects WorldCore.core as the semantic source', async () => {
  const errors: RealmWorldDataError[] = [];

  const result = await loadWorldSemanticBundle(
    createWorldCallApi(worldCorePayload()),
    createEmitter(errors),
    'world-1',
  );

  const record = result as { identity?: { name?: unknown }; timeModel?: { flowRatio?: unknown } };
  assert.equal(record.identity?.name, 'Song Continuum');
  assert.equal(record.timeModel?.flowRatio, 0.125);
  assert.equal(errors.length, 0);
});

test('loadWorldSemanticBundle fails close when WorldCore loading fails', async () => {
  const errors: RealmWorldDataError[] = [];

  await assert.rejects(
    () => loadWorldSemanticBundle(
      async () => {
        throw new Error('realm world core unavailable');
      },
      createEmitter(errors),
      'world-1',
    ),
    /realm world core unavailable/,
  );

  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.action, 'load-world-semantic-bundle');
  assert.deepEqual(errors[0]!.details, { worldId: 'world-1' });
});
