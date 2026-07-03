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
  loadWorldAssets,
  loadWorldHistory,
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
    name: 'Song Continuum',
    summary: 'A slow-time alternate Song dynasty world.',
    tagline: 'Late Song divergence',
    type: 'CREATOR',
    visibility: 'public',
    tags: ['Historical', 'Alternate'],
    entityKinds: ['person', 'place', 'office', 'text'],
    relationshipTypes: ['serves', 'locatedIn'],
    media: {
      iconUrl: 'https://cdn.example.com/song-icon.png',
      bannerUrl: 'https://cdn.example.com/song-banner.png',
      heroUrl: 'https://cdn.example.com/song-hero.png',
      highlightUrls: ['https://cdn.example.com/song-highlight.png'],
    },
    time: {
      mode: 'wallClockAnchored',
      flowRatio: 0.125,
      isPaused: false,
      calendar: null,
      displayFormat: null,
      anchorRealStartedAt: '2026-06-18T00:00:00.000Z',
      anchorWorldStartedAt: '2026-06-18T00:00:00.000Z',
      anchorWorldStartedAtDisplay: 'Late Song',
      currentWorldTime: '2026-06-18T03:00:00.000Z',
      currentWorldTimeDisplay: 'Late Song · Day 1',
      computedAt: '2026-06-19T00:00:00.000Z',
    },
    stats: {
      entityCount: 2,
      relationshipCount: 1,
      characterCount: 1,
      personaCount: 0,
      sceneCount: 1,
      systemCount: 1,
      timelineEventCount: 1,
    },
    rules: ['WorldCore admitted as public setting background.'],
    systems: ['Archive stewardship'],
    scenes: [{
      sceneId: 'arrival-point',
      name: 'Arrival Point',
      summary: 'Arrival Point',
      media: [],
      activeEntities: [],
      relatedCharacters: [],
      relatedEvents: [],
      relatedResources: [],
      counts: {
        activeEntityCount: 0,
        relatedCharacterCount: 0,
        relatedEventCount: 0,
        relatedResourceCount: 0,
      },
    }],
    timeline: ['Foundation'],
    createdAt: '2026-06-18T00:00:00.000Z',
    updatedAt: '2026-06-18T00:00:00.000Z',
    ...overrides,
  };
}

function worldCharacterPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'character-1',
    sourceKind: 'worldCharacter',
    ownership: 'worldOwned',
    worldId: 'world-1',
    worldName: 'Song Continuum',
    sourceRef: {
      kind: 'worldCharacter',
      worldId: 'world-1',
      sourceId: 'character-1',
      sourceContentHash: 'character-hash-1',
    },
    displayName: 'Song Steward',
    handle: null,
    summary: 'Keeps the archive coherent.',
    role: 'Steward',
    tags: ['Archive'],
    media: {
      avatarUrl: 'https://cdn.example.com/song-steward.png',
      profileCoverUrl: null,
    },
    relation: {
      state: 'connectable',
      connectionId: null,
    },
    updatedAt: '2026-06-18T00:00:00.000Z',
    ...overrides,
  };
}

function worldPersonaPayload(overrides: Record<string, unknown> = {}) {
  return worldCharacterPayload({
    id: 'persona-1',
    sourceKind: 'realmPersona',
    ownership: 'userOwned',
    sourceRef: {
      kind: 'realmPersona',
      worldId: 'world-1',
      sourceId: 'persona-1',
      sourceContentHash: 'persona-hash-1',
    },
    displayName: 'Mira Vale',
    handle: 'mira',
    summary: 'A public realm persona visiting the world.',
    role: 'Traveler',
    ...overrides,
  });
}

function createWorldCallApi(
  worldCore: Record<string, unknown>,
  characters: unknown[] = [],
  personas: unknown[] = [],
): RealmWorldCallApi {
  return async (task) => task({
    worldPublic: {
      worldPublicControllerGetWorld: async ({ path }: { path: { worldId: string } }) => ({
        ...worldCore,
        id: path.worldId,
        type: path.worldId === 'OASIS' ? 'OASIS' : worldCore.type,
        visibility: path.worldId === 'OASIS' ? 'system' : worldCore.visibility,
      }),
      worldPublicControllerListWorldCharacters: async () => characters,
      worldPublicControllerListWorlds: async () => [worldCore],
      worldPublicControllerGetWorldDetailWithCharacters: async ({ path }: { path: { worldId: string } }) => ({
        world: {
          ...worldCore,
          id: path.worldId,
        },
        sources: {
          characters,
          personas,
        },
      }),
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

test('loadMainWorld projects public OASIS identity and discoverable display state', async () => {
  const errors: RealmWorldDataError[] = [];

  const result = await loadMainWorld(
    createWorldCallApi(worldCorePayload()),
    createEmitter(errors),
  );

  assert.equal(result.id, 'OASIS');
  assert.equal(result.name, 'Song Continuum');
  assert.equal(result.description, 'A slow-time alternate Song dynasty world.');
  assert.equal(result.type, 'OASIS');
  assert.equal(result.status, 'DISCOVERABLE');
  assert.equal(result.characterCount, 1);
  assert.equal(errors.length, 0);
});

test('loadMainWorld fails close on non-object public world payloads', async () => {
  const errors: RealmWorldDataError[] = [];

  await assertRejectsWithReasonCode(
    () => loadMainWorld(
      async (task) => task({
        worldPublic: {
          worldPublicControllerGetWorld: async () => 'not-an-object',
        },
      } as never),
      createEmitter(errors),
    ),
    'SDK_REALM_WORLD_PUBLIC_CONTRACT_INVALID',
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

test('loadWorldCharacters projects public source cards', async () => {
  const errors: RealmWorldDataError[] = [];

  const result = await loadWorldCharacters(
    createWorldCallApi(worldCorePayload(), [worldCharacterPayload()]),
    createEmitter(errors),
    'world-1',
  );

  assert.equal(result[0]?.id, 'character-1');
  assert.equal(result[0]?.name, 'Song Steward');
  assert.equal(result[0]?.bio, 'Keeps the archive coherent.');
  assert.equal(result[0]?.sourceKind, 'worldCharacter');
  assert.deepEqual(result[0]?.sourceRef, {
    kind: 'worldCharacter',
    worldId: 'world-1',
    sourceId: 'character-1',
    sourceContentHash: 'character-hash-1',
  });
  assert.equal(errors.length, 0);
});

test('loadWorldCharacters fails close when public sourceRef is missing sourceContentHash', async () => {
  const errors: RealmWorldDataError[] = [];

  await assertRejectsWithReasonCode(
    () => loadWorldCharacters(
      createWorldCallApi(worldCorePayload(), [
        worldCharacterPayload({
          sourceRef: {
            kind: 'worldCharacter',
            worldId: 'world-1',
            sourceId: 'character-1',
          },
        }),
      ]),
      createEmitter(errors),
      'world-1',
    ),
    'SDK_REALM_WORLD_PUBLIC_SOURCE_CONTRACT_INVALID',
  );

  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.action, 'load-world-characters');
});

test('loadWorldCharacters fails close when public sourceRef points at a different source', async () => {
  const errors: RealmWorldDataError[] = [];

  await assertRejectsWithReasonCode(
    () => loadWorldCharacters(
      createWorldCallApi(worldCorePayload(), [
        worldCharacterPayload({
          sourceRef: {
            kind: 'worldCharacter',
            worldId: 'world-1',
            sourceId: 'character-2',
            sourceContentHash: 'character-hash-1',
          },
        }),
      ]),
      createEmitter(errors),
      'world-1',
    ),
    'SDK_REALM_WORLD_PUBLIC_SOURCE_REF_MISMATCH',
  );

  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.action, 'load-world-characters');
});

test('loadWorldCharacters fails close on invalid public source rows', async () => {
  const errors: RealmWorldDataError[] = [];

  await assertRejectsWithReasonCode(
    () => loadWorldCharacters(
      createWorldCallApi(worldCorePayload(), [worldCharacterPayload(), 'bad-entry']),
      createEmitter(errors),
      'world-1',
    ),
    'SDK_REALM_WORLD_PUBLIC_SOURCE_CONTRACT_INVALID',
  );

  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.action, 'load-world-characters');
});

test('loadWorldDetailWithCharacters keeps character count, persona count, and source card count separate', async () => {
  const errors: RealmWorldDataError[] = [];

  const result = await loadWorldDetailWithCharacters(
    createWorldCallApi(worldCorePayload({
      stats: {
        entityCount: 2,
        relationshipCount: 1,
        characterCount: 1,
        personaCount: 1,
        sceneCount: 1,
        systemCount: 1,
        timelineEventCount: 1,
      },
    }), [
      worldCharacterPayload({ id: 'character-1' }),
    ], [
      worldPersonaPayload(),
    ]),
    createEmitter(errors),
    'world-1',
    1,
  );

  assert.equal(result?.id, 'world-1');
  assert.equal(result?.characterCount, 1);
  assert.equal(result?.personaCount, 1);
  assert.equal(result?.characters.length, 2);
  assert.equal(errors.length, 0);
});

test('loadWorldDetailById fails close when the public world id does not match the request', async () => {
  const errors: RealmWorldDataError[] = [];

  await assertRejectsWithReasonCode(
    () => loadWorldDetailById(
      async (task) => task({
        worldPublic: {
          worldPublicControllerGetWorld: async () => worldCorePayload({ id: 'world-2' }),
        },
      } as never),
      createEmitter(errors),
      'world-1',
    ),
    'SDK_REALM_WORLD_PUBLIC_ID_MISMATCH',
  );

  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.action, 'load-world-detail');
});

test('loadWorldHistory reads public world timeline summaries', async () => {
  const errors: RealmWorldDataError[] = [];

  const result = await loadWorldHistory(
    createWorldCallApi(worldCorePayload()),
    createEmitter(errors),
    'world-1',
  );

  assert.equal(result.items[0]?.title, 'Foundation');
  assert.equal(errors.length, 0);
});

test('loadWorldAssets projects URL-ready public world media without synthetic fallback', async () => {
  const errors: RealmWorldDataError[] = [];

  const result = await loadWorldAssets(
    createWorldCallApi(worldCorePayload()),
    createEmitter(errors),
    'world-1',
  );

  assert.equal(result.resourceRefs.length, 0);
  assert.equal(result.externalRefs[0]?.uri, 'https://cdn.example.com/song-icon.png');
  assert.equal(result.intents.length, 0);
  assert.equal(errors.length, 0);
});

test('loadWorldSemanticBundle projects public world setting as the semantic source', async () => {
  const errors: RealmWorldDataError[] = [];

  const result = await loadWorldSemanticBundle(
    createWorldCallApi(worldCorePayload()),
    createEmitter(errors),
    'world-1',
  );

  const record = result as { operation?: { title?: unknown }; timeModel?: { flowRatio?: unknown } };
  assert.equal(record.operation?.title, 'Song Continuum');
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
