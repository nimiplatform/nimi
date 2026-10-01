import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createOfflineNimiError as createOfflineError,
  ReasonCode,
} from '@nimiplatform/sdk/types';
import {
  loadWorldDetailById,
  loadMainWorld,
  loadWorldCharacterPage,
  loadWorldDetailWithCharacters,
  loadWorldAssets,
  loadWorldHistory,
  loadWorldSemanticBundle,
} from '../src/shell/renderer/features/world/data/realm-world-data.js';

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
    genre: 'Historical',
    themes: ['Alternate'],
    era: null,
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
      personaCharacterCount: 0,
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
      id: 'character-1',
      worldId: 'world-1',
      worldEntityRef: { kind: 'worldEntity', worldId: 'world-1', entityId: 'entity-character-1' },
      sourceHash: 'a'.repeat(64),
    },
    displayName: 'Song Steward',
    handle: null,
    summary: 'Keeps the archive coherent.',
    role: 'Steward',
    traits: ['Meticulous'],
    topics: ['Archive'],
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
    sourceKind: 'personaCharacter',
    ownership: 'userOwned',
    sourceRef: {
      kind: 'personaCharacter',
      id: 'persona-1',
      worldId: 'world-1',
      ownerAccountId: 'account-1',
      sourceHash: 'b'.repeat(64),
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
      worldPublicControllerListWorldCharacterCatalog: async () => ({
        items: characters,
        nextCursor: null,
        hasMore: false,
        totalCount: characters.length,
      }),
      worldPublicControllerListWorldCatalog: async () => ({
        items: [worldCore],
        nextCursor: null,
        hasMore: false,
        totalCount: 1,
      }),
      worldPublicControllerGetWorldDetailWithCharacters: async ({ path }: { path: { worldId: string } }) => ({
        world: {
          ...worldCore,
          id: path.worldId,
        },
        sources: {
          characters,
          charactersNextCursor: null,
          personaCharacters: personas,
          personaCharactersNextCursor: null,
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

test('loadMainWorld surfaces an offline read without substituting a persisted world', async () => {
  const errors: RealmWorldDataError[] = [];
  await assertRejectsWithReasonCode(
    () => loadMainWorld(
      async () => {
        throw createOfflineError({
          source: 'realm',
          reasonCode: ReasonCode.REALM_UNAVAILABLE,
          message: 'offline',
          actionHint: 'retry',
        });
      },
      createEmitter(errors),
    ),
    ReasonCode.REALM_UNAVAILABLE,
  );
  // Offline is a transport state, not a data-contract error.
  assert.equal(errors.length, 0);
});

test('loadWorldCharacterPage projects public source cards', async () => {
  const errors: RealmWorldDataError[] = [];

  const page = await loadWorldCharacterPage(
    createWorldCallApi(worldCorePayload(), [worldCharacterPayload()]),
    createEmitter(errors),
    'world-1',
    {},
  );
  const result = page.items;

  assert.equal(result[0]?.id, 'character-1');
  assert.equal(result[0]?.name, 'Song Steward');
  assert.equal(result[0]?.bio, 'Keeps the archive coherent.');
  assert.equal(result[0]?.sourceKind, 'worldCharacter');
  assert.deepEqual(result[0]?.sourceRef, {
    kind: 'worldCharacter',
    id: 'character-1',
    worldId: 'world-1',
    worldEntityRef: { kind: 'worldEntity', worldId: 'world-1', entityId: 'entity-character-1' },
    sourceHash: 'a'.repeat(64),
  });
  assert.equal(errors.length, 0);
});

test('loadWorldCharacterPage forwards the bounded page request through Realm SDK', async () => {
  const errors: RealmWorldDataError[] = [];
  let receivedQuery: Record<string, unknown> | undefined;

  const page = await loadWorldCharacterPage(
    async (task) => task({
      worldPublic: {
        worldPublicControllerListWorldCharacterCatalog: async (
          request: { query?: Record<string, unknown> },
        ) => {
          receivedQuery = request.query;
          return { items: [worldCharacterPayload()], nextCursor: 'cursor-2', hasMore: true, totalCount: 104 };
        },
      },
    } as never),
    createEmitter(errors),
    'world-1',
    { limit: 3, cursor: 'cursor-1', q: ' Juniper ' },
  );

  assert.equal(page.items.length, 1);
  assert.deepEqual(receivedQuery, { q: 'Juniper', cursor: 'cursor-1', limit: 3 });
  assert.deepEqual({ nextCursor: page.nextCursor, hasMore: page.hasMore, totalCount: page.totalCount }, {
    nextCursor: 'cursor-2',
    hasMore: true,
    totalCount: 104,
  });
  assert.equal(errors.length, 0);
});

test('loadWorldCharacterPage fails close on an inconsistent page', async () => {
  const errors: RealmWorldDataError[] = [];
  await assertRejectsWithReasonCode(
    () => loadWorldCharacterPage(
      async (task) => task({
        worldPublic: {
          worldPublicControllerListWorldCharacterCatalog: async () => ({
            items: [worldCharacterPayload()],
            nextCursor: null,
            hasMore: true,
            totalCount: 2,
          }),
        },
      } as never),
      createEmitter(errors),
      'world-1',
      {},
    ),
    'SDK_REALM_WORLD_CATALOG_CONTRACT_INVALID',
  );
  assert.equal(errors[0]?.action, 'load-world-characters');
});

test('loadWorldCharacterPage fails close when public sourceRef is missing sourceHash', async () => {
  const errors: RealmWorldDataError[] = [];

  await assertRejectsWithReasonCode(
    () => loadWorldCharacterPage(
      createWorldCallApi(worldCorePayload(), [
        worldCharacterPayload({
          sourceRef: {
            kind: 'worldCharacter',
            id: 'character-1',
            worldId: 'world-1',
            worldEntityRef: { kind: 'worldEntity', worldId: 'world-1', entityId: 'entity-character-1' },
          },
        }),
      ]),
      createEmitter(errors),
      'world-1',
      {},
    ),
    'SDK_REALM_WORLD_PUBLIC_SOURCE_CONTRACT_INVALID',
  );

  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.action, 'load-world-characters');
});

test('loadWorldCharacterPage fails close when public sourceRef points at a different source', async () => {
  const errors: RealmWorldDataError[] = [];

  await assertRejectsWithReasonCode(
    () => loadWorldCharacterPage(
      createWorldCallApi(worldCorePayload(), [
        worldCharacterPayload({
          sourceRef: {
            kind: 'worldCharacter',
            id: 'character-2',
            worldId: 'world-1',
            worldEntityRef: { kind: 'worldEntity', worldId: 'world-1', entityId: 'entity-character-2' },
            sourceHash: 'a'.repeat(64),
          },
        }),
      ]),
      createEmitter(errors),
      'world-1',
      {},
    ),
    'SDK_REALM_WORLD_PUBLIC_SOURCE_REF_MISMATCH',
  );

  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.action, 'load-world-characters');
});

test('loadWorldCharacterPage fails close on invalid public source rows', async () => {
  const errors: RealmWorldDataError[] = [];

  await assertRejectsWithReasonCode(
    () => loadWorldCharacterPage(
      createWorldCallApi(worldCorePayload(), [worldCharacterPayload(), 'bad-entry']),
      createEmitter(errors),
      'world-1',
      {},
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
        personaCharacterCount: 1,
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
  assert.equal(result?.personaCharacterCount, 1);
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
