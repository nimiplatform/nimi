import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadWorldDetailWithCharacters,
  loadWorldAssets,
  loadWorldList,
} from '../src/shell/renderer/features/world/data/realm-world-data.js';
import { worldPublicHighlightImages } from '../src/shell/renderer/features/world/world-detail-queries.js';
import { toWorldListItem } from '../src/shell/renderer/features/world/world-list-model.js';

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

type PublicWorld = Record<string, unknown>;
type PublicSource = Record<string, unknown>;

function publicTime() {
  return {
    mode: 'wallClockAnchored',
    flowRatio: 1,
    isPaused: false,
    calendar: null,
    displayFormat: null,
    anchorRealStartedAt: '2026-06-18T00:00:00.000Z',
    anchorWorldStartedAt: '2026-06-18T00:00:00.000Z',
    anchorWorldStartedAtDisplay: 'June 18, 2026',
    currentWorldTime: '2026-06-19T00:00:00.000Z',
    currentWorldTimeDisplay: 'June 19, 2026',
    computedAt: '2026-06-19T00:00:00.000Z',
  };
}

function publicWorld(overrides: PublicWorld = {}) {
  return {
    id: 'world-1',
    name: 'Eldoria',
    summary: 'A kingdom-scale fantasy setting for source discovery.',
    tagline: 'High Magic Frontier',
    type: 'CREATOR',
    visibility: 'public',
    tags: ['Fantasy', 'Adventure'],
    media: {
      iconUrl: 'https://cdn.example.com/world-icon.png',
      bannerUrl: 'https://cdn.example.com/world-banner.png',
      heroUrl: 'https://cdn.example.com/world-hero.png',
      highlightUrls: ['https://cdn.example.com/world-highlight.png'],
    },
    time: publicTime(),
    stats: {
      entityCount: 8,
      relationshipCount: 12,
      characterCount: 1,
      personaCount: 1,
      sceneCount: 2,
      systemCount: 1,
      timelineEventCount: 2,
    },
    entityKinds: ['person', 'place', 'office', 'text'],
    relationshipTypes: ['serves', 'authored', 'locatedIn'],
    rules: ['Magic has an observable cost.'],
    systems: ['High Magic'],
    scenes: ['Sky Citadel', 'Lower Market'],
    timeline: ['Citadel founded', 'Market treaty signed'],
    createdAt: '2026-06-18T00:00:00.000Z',
    updatedAt: '2026-06-19T00:00:00.000Z',
    ...overrides,
  };
}

function publicSource(overrides: PublicSource = {}) {
  return {
    id: 'source-1',
    sourceKind: 'worldCharacter',
    ownership: 'worldOwned',
    sourceRef: {
      kind: 'worldCharacter',
      worldId: 'world-1',
      sourceId: 'source-1',
      sourceContentHash: 'source-hash-1',
    },
    displayName: 'Archivist Liora',
    handle: 'liora',
    summary: 'Keeps a field record of Eldoria.',
    role: 'Archivist',
    worldId: 'world-1',
    worldName: 'Eldoria',
    tags: ['Lore'],
    media: {
      avatarUrl: 'https://cdn.example.com/liora.png',
      profileCoverUrl: null,
    },
    relation: {
      state: 'connectable',
      connectionId: null,
    },
    updatedAt: '2026-06-19T00:00:00.000Z',
    ...overrides,
  };
}

function forbiddenApi(name: string) {
  return new Proxy({}, {
    get() {
      throw new Error(`${name} must not be used by World Atlas product reads`);
    },
  });
}

function createWorldPublicCallApi(payload: {
  worlds?: PublicWorld[];
  detail?: PublicWorld;
  characters?: PublicSource[];
  personas?: PublicSource[];
}) {
  const calls: string[] = [];
  const callApi = async <T>(task: (realm: unknown) => Promise<T>) => task({
    worldPublic: {
      worldPublicControllerListWorlds: async () => {
        calls.push('worldPublicControllerListWorlds');
        return payload.worlds ?? [publicWorld()];
      },
      worldPublicControllerGetWorld: async () => {
        calls.push('worldPublicControllerGetWorld');
        return payload.detail ?? publicWorld();
      },
      worldPublicControllerListWorldCharacters: async () => {
        calls.push('worldPublicControllerListWorldCharacters');
        return payload.characters ?? [publicSource()];
      },
      worldPublicControllerGetWorldDetailWithCharacters: async () => {
        calls.push('worldPublicControllerGetWorldDetailWithCharacters');
        return {
          world: payload.detail ?? publicWorld(),
          sources: {
            characters: payload.characters ?? [publicSource()],
            personas: payload.personas ?? [],
          },
        };
      },
    },
    worldCore: forbiddenApi('worldCore'),
    transit: forbiddenApi('transit'),
  });
  return { callApi, calls };
}

test('World Atlas list consumes public product DTOs without raw WorldCore requirements', async () => {
  const errors: RealmWorldDataError[] = [];
  const { callApi, calls } = createWorldPublicCallApi({
    worlds: [publicWorld()],
  });

  const result = await loadWorldList(callApi as never, createEmitter(errors));
  const firstWorld = result[0] as {
    computed?: {
      time?: {
        currentWorldTime?: unknown;
      };
    };
  } | undefined;

  assert.equal(calls.includes('worldPublicControllerListWorlds'), true);
  assert.equal(result[0]?.id, 'world-1');
  assert.equal(result[0]?.name, 'Eldoria');
  assert.equal(result[0]?.description, 'A kingdom-scale fantasy setting for source discovery.');
  assert.equal(result[0]?.tagline, 'High Magic Frontier');
  assert.equal(result[0]?.bannerUrl, 'https://cdn.example.com/world-banner.png');
  assert.equal(result[0]?.entityCount, 8);
  assert.equal(result[0]?.relationshipCount, 12);
  assert.equal(result[0]?.characterCount, 1);
  assert.equal(result[0]?.personaCount, 1);
  assert.deepEqual(result[0]?.entityKinds, ['person', 'place', 'office', 'text']);
  assert.deepEqual(result[0]?.relationshipTypes, ['serves', 'authored', 'locatedIn']);
  assert.equal(firstWorld?.computed?.time?.currentWorldTime, '2026-06-19T00:00:00.000Z');
  assert.equal(errors.length, 0);
});

test('World list model accepts allowlisted public DTOs and rejects reliance on raw core fields', () => {
  const item = toWorldListItem(publicWorld({
    media: {
      iconUrl: 'file:///tmp/nimi-forge/world/icon.png',
      bannerUrl: 'file:///tmp/nimi-forge/world/banner.png',
      heroUrl: 'file:///tmp/nimi-forge/world/hero.png',
      highlightUrls: [
        'file:///tmp/nimi-forge/world/highlight-1.png',
        'file:///tmp/nimi-forge/world/highlight-2.png',
        'file:///tmp/nimi-forge/world/highlight-3.png',
      ],
    },
  }));

  assert.equal(item.id, 'world-1');
  assert.equal(item.iconUrl, 'file:///tmp/nimi-forge/world/icon.png');
  assert.equal(item.bannerUrl, 'file:///tmp/nimi-forge/world/banner.png');
  assert.deepEqual(
    (item as { highlightUrls?: string[] }).highlightUrls,
    [
      'file:///tmp/nimi-forge/world/highlight-1.png',
      'file:///tmp/nimi-forge/world/highlight-2.png',
      'file:///tmp/nimi-forge/world/highlight-3.png',
    ],
  );
  assert.equal(item.type, 'CREATOR');
  assert.equal(item.status, 'DISCOVERABLE');
  assert.equal(item.entityCount, 8);
  assert.equal(item.relationshipCount, 12);
  assert.equal(item.characterCount, 1);
  assert.equal(item.personaCount, 1);
  assert.equal(item.sceneCount, 2);
  assert.equal(item.timelineEventCount, 2);
  assert.deepEqual(item.entityKinds, ['person', 'place', 'office', 'text']);
  assert.deepEqual(item.relationshipTypes, ['serves', 'authored', 'locatedIn']);
});

test('World detail consumes public source sections for characters and personas', async () => {
  const errors: RealmWorldDataError[] = [];
  const persona = publicSource({
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
    role: 'Traveler',
    media: {
      avatarUrl: 'https://cdn.example.com/mira-avatar.png',
      profileCoverUrl: 'https://cdn.example.com/mira-cover.png',
    },
  });
  const { callApi, calls } = createWorldPublicCallApi({
    detail: publicWorld(),
    characters: [publicSource()],
    personas: [persona],
  });

  const result = await loadWorldDetailWithCharacters(
    callApi as never,
    createEmitter(errors),
    'world-1',
  );

  assert.equal(calls.includes('worldPublicControllerGetWorldDetailWithCharacters'), true);
  assert.equal(result?.id, 'world-1');
  assert.equal(result?.characterCount, 1);
  assert.equal(result?.personaCount, 1);
  assert.equal(result?.characters.length, 2);
  assert.equal(result?.characters[0]?.sourceKind, 'worldCharacter');
  assert.equal(result?.characters[1]?.sourceKind, 'realmPersona');
  assert.equal(result?.characters[1]?.avatarUrl, 'https://cdn.example.com/mira-avatar.png');
  assert.equal(result?.characters[1]?.profileCoverUrl, 'https://cdn.example.com/mira-cover.png');
  assert.deepEqual(result?.characters[1]?.sourceRef, {
    kind: 'realmPersona',
    worldId: 'world-1',
    sourceId: 'persona-1',
    sourceContentHash: 'persona-hash-1',
  });
  assert.equal(errors.length, 0);
});

test('World detail preserves local media paths for forged world and character products', async () => {
  const errors: RealmWorldDataError[] = [];
  const localWorld = publicWorld({
    media: {
      iconUrl: 'file:///tmp/nimi-forge/world/icon.png',
      bannerUrl: 'file:///tmp/nimi-forge/world/banner.png',
      heroUrl: 'file:///tmp/nimi-forge/world/hero.png',
      highlightUrls: [
        'file:///tmp/nimi-forge/world/highlight-1.png',
        'file:///tmp/nimi-forge/world/highlight-2.png',
        'file:///tmp/nimi-forge/world/highlight-3.png',
      ],
    },
  });
  const localCharacter = publicSource({
    media: {
      avatarUrl: '/tmp/nimi-forge/character/avatar.png',
      profileCoverUrl: '/tmp/nimi-forge/character/profile-cover.png',
    },
  });
  const { callApi } = createWorldPublicCallApi({
    detail: localWorld,
    characters: [localCharacter],
    personas: [],
  });

  const result = await loadWorldDetailWithCharacters(
    callApi as never,
    createEmitter(errors),
    'world-1',
  );

  assert.equal(result?.heroUrl, 'file:///tmp/nimi-forge/world/hero.png');
  assert.deepEqual(result?.highlightUrls, [
    'file:///tmp/nimi-forge/world/highlight-1.png',
    'file:///tmp/nimi-forge/world/highlight-2.png',
    'file:///tmp/nimi-forge/world/highlight-3.png',
  ]);
  assert.equal(result?.characters[0]?.avatarUrl, '/tmp/nimi-forge/character/avatar.png');
  assert.equal(
    (result?.characters[0] as { profileCoverUrl?: string | null } | undefined)?.profileCoverUrl,
    '/tmp/nimi-forge/character/profile-cover.png',
  );
  assert.equal(errors.length, 0);
});

test('World assets projection exposes hero banner icon and three local highlights', async () => {
  const errors: RealmWorldDataError[] = [];
  const { callApi } = createWorldPublicCallApi({
    detail: publicWorld({
      media: {
        iconUrl: 'file:///tmp/nimi-forge/world/icon.png',
        bannerUrl: 'file:///tmp/nimi-forge/world/banner.png',
        heroUrl: 'file:///tmp/nimi-forge/world/hero.png',
        highlightUrls: [
          'file:///tmp/nimi-forge/world/highlight-1.png',
          'file:///tmp/nimi-forge/world/highlight-2.png',
          'file:///tmp/nimi-forge/world/highlight-3.png',
        ],
      },
    }),
  });

  const assets = await loadWorldAssets(
    callApi as never,
    createEmitter(errors),
    'world-1',
  );

  assert.deepEqual(assets.externalRefs.map((ref) => [ref.kind, ref.uri]), [
    ['icon', 'file:///tmp/nimi-forge/world/icon.png'],
    ['banner', 'file:///tmp/nimi-forge/world/banner.png'],
    ['hero', 'file:///tmp/nimi-forge/world/hero.png'],
    ['highlight-1', 'file:///tmp/nimi-forge/world/highlight-1.png'],
    ['highlight-2', 'file:///tmp/nimi-forge/world/highlight-2.png'],
    ['highlight-3', 'file:///tmp/nimi-forge/world/highlight-3.png'],
  ]);
  assert.equal(errors.length, 0);
});

test('World detail highlight model prefers public local highlight assets over bundled samples', () => {
  const highlights = worldPublicHighlightImages({
    resourceRefs: [],
    externalRefs: [
      { refId: 'world-media-icon', kind: 'icon', uri: 'file:///tmp/nimi-forge/world/icon.png' },
      { refId: 'world-media-highlight-1', kind: 'highlight-1', uri: 'file:///tmp/nimi-forge/world/highlight-1.png' },
      { refId: 'world-media-highlight-2', kind: 'highlight-2', uri: 'file:///tmp/nimi-forge/world/highlight-2.png' },
      { refId: 'world-media-highlight-3', kind: 'highlight-3', uri: 'file:///tmp/nimi-forge/world/highlight-3.png' },
    ],
    intents: [],
    scenes: [],
  });

  assert.deepEqual(highlights, [
    'file:///tmp/nimi-forge/world/highlight-1.png',
    'file:///tmp/nimi-forge/world/highlight-2.png',
    'file:///tmp/nimi-forge/world/highlight-3.png',
  ]);
});
