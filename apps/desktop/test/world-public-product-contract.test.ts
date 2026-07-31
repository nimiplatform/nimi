import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadWorldDetailWithCharacters,
  loadWorldAssets,
  loadWorldList,
} from '../src/shell/renderer/features/world/data/realm-world-data.js';
import {
  displayTags,
  isWorldVisibleInAtlas,
} from '../src/shell/renderer/features/world/world-list-catalog-model.js';
import {
  toWorldDisplayFallback,
  worldPublicHighlightImages,
} from '../src/shell/renderer/features/world/world-detail-queries.js';
import { projectWorldPublicSourceCard } from '../src/shell/renderer/features/world/data/world-public-projection.js';
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

function publicScene(sceneId: string, name: string, summary: string) {
  return {
    sceneId,
    name,
    summary,
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
    scenes: [
      publicScene('sky-citadel', 'Sky Citadel', 'Sky Citadel'),
      publicScene('lower-market', 'Lower Market', 'Lower Market'),
    ],
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
      id: 'source-1',
      worldId: 'world-1',
      worldEntityRef: { kind: 'worldEntity', worldId: 'world-1', entityId: 'entity-source-1' },
      sourceHash: 'a'.repeat(64),
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
    worlds: [publicWorld({ era: '元代' })],
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
  assert.equal(result[0]?.era, '元代');
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

test('World detail list-item fallback consumes the already projected world list item', () => {
  const item = toWorldListItem(publicWorld());

  const fallback = toWorldDisplayFallback(item);

  assert.equal(fallback.id, 'world-1');
  assert.equal(fallback.name, 'Eldoria');
  assert.equal(fallback.description, 'A kingdom-scale fantasy setting for source discovery.');
  assert.equal(fallback.characterCount, 1);
  assert.equal(fallback.currentWorldTime, '2026-06-19T00:00:00.000Z');
});

test('World Atlas preview tags expose only the dynasty label', () => {
  const item = toWorldListItem(publicWorld({
    era: '元代',
    tags: ['historical', 'cbdb-yuan-literati-academy-world'],
  }));

  assert.deepEqual(displayTags(item, 2, 'zh-CN'), ['元代']);
  assert.deepEqual(displayTags(item, 2, 'en-US'), ['元代']);
});

test('World Atlas excludes Beijing and Northern Song scholar-official worlds from the visible catalog', () => {
  assert.equal(isWorldVisibleInAtlas(toWorldListItem(publicWorld({ name: '北京士大夫世界' }))), false);
  assert.equal(isWorldVisibleInAtlas(toWorldListItem(publicWorld({ name: '北宋士大夫世界' }))), false);
  assert.equal(isWorldVisibleInAtlas(toWorldListItem(publicWorld({ name: '唐代文人世界' }))), true);
});

test('World Character projections fail closed on incomplete source refs', () => {
  const incompleteSource = publicSource({
    sourceRef: {
      kind: 'worldCharacter',
      id: 'source-1',
      worldId: 'world-1',
      sourceHash: 'a'.repeat(64),
    },
  });

  assert.throws(
    () => projectWorldPublicSourceCard(incompleteSource as never),
    /matching CharacterSourceRefV3/i,
  );

  const item = toWorldListItem(publicWorld({
    characters: [{
      ...incompleteSource,
      name: 'Archivist Liora',
    }],
  }));
  assert.equal(item.characters?.[0]?.sourceRef, null);
});

test('World detail consumes public source sections for characters and personas', async () => {
  const errors: RealmWorldDataError[] = [];
  const persona = publicSource({
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
  assert.equal(result?.characters[1]?.sourceKind, 'personaCharacter');
  assert.equal(result?.characters[1]?.avatarUrl, 'https://cdn.example.com/mira-avatar.png');
  assert.equal(result?.characters[1]?.profileCoverUrl, 'https://cdn.example.com/mira-cover.png');
  assert.deepEqual(result?.characters[1]?.sourceRef, {
    kind: 'personaCharacter',
    id: 'persona-1',
    worldId: 'world-1',
    ownerAccountId: 'account-1',
    sourceHash: 'b'.repeat(64),
  });
  assert.equal(errors.length, 0);
});

test('World detail projects public source sections into atlas recommended people', async () => {
  const errors: RealmWorldDataError[] = [];
  const persona = publicSource({
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
    summary: 'A visiting scholar with a public source profile.',
  });
  const { callApi } = createWorldPublicCallApi({
    detail: publicWorld({
      stats: {
        entityCount: 8,
        relationshipCount: 12,
        characterCount: 1,
        personaCount: 1,
        sceneCount: 2,
        systemCount: 1,
        timelineEventCount: 2,
      },
    }),
    characters: [publicSource()],
    personas: [persona],
  });

  const result = await loadWorldDetailWithCharacters(
    callApi as never,
    createEmitter(errors),
    'world-1',
  );
  const item = toWorldListItem(result as NonNullable<typeof result>);

  assert.deepEqual(
    item.computed.entry.recommendedCharacters.map((character) => character.name),
    ['Archivist Liora', 'Mira Vale'],
  );
  assert.equal(item.characters?.[0]?.bio, 'Keeps a field record of Eldoria.');
  assert.equal(item.characters?.[1]?.bio, 'A visiting scholar with a public source profile.');
  assert.equal(errors.length, 0);
});

test('World detail consumes public resource media for forged world and character products', async () => {
  const errors: RealmWorldDataError[] = [];
  const resourceWorld = publicWorld({
    media: {
      iconUrl: 'file:///tmp/nimi-forge/world/icon.png',
      bannerUrl: 'file:///tmp/nimi-forge/world/banner.png',
      heroUrl: 'file:///tmp/nimi-forge/world/hero.png',
      highlightUrls: [
        'file:///tmp/nimi-forge/world/highlight-1.png',
      ],
      assets: {
        icon: { id: 'world-icon-resource', kind: 'icon', url: 'https://cdn.example.test/world/icon.png', provider: 'CF_IMAGE' },
        banner: { id: 'world-banner-resource', kind: 'banner', url: 'https://cdn.example.test/world/banner.png', provider: 'CF_IMAGE' },
        hero: { id: 'world-hero-resource', kind: 'hero', url: 'https://cdn.example.test/world/hero.png', provider: 'CF_IMAGE' },
        highlights: [
          { id: 'world-highlight-1-resource', kind: 'highlight', url: 'https://cdn.example.test/world/highlight-1.png', provider: 'CF_IMAGE' },
          { id: 'world-highlight-2-resource', kind: 'highlight', url: 'https://cdn.example.test/world/highlight-2.png', provider: 'CF_IMAGE' },
          { id: 'world-highlight-3-resource', kind: 'highlight', url: 'https://cdn.example.test/world/highlight-3.png', provider: 'CF_IMAGE' },
        ],
      },
    },
  });
  const resourceCharacter = publicSource({
    media: {
      avatarUrl: '/tmp/nimi-forge/character/avatar.png',
      profileCoverUrl: '/tmp/nimi-forge/character/profile-cover.png',
      referenceImageUrl: '/tmp/nimi-forge/character/reference.png',
      voiceSampleUrl: '/tmp/nimi-forge/character/voice.wav',
      assets: {
        avatar: { id: 'character-avatar-resource', kind: 'avatar', url: 'https://cdn.example.test/character/avatar.png', provider: 'CF_IMAGE' },
        profileCover: { id: 'character-cover-resource', kind: 'profileCover', url: 'https://cdn.example.test/character/profile-cover.png', provider: 'CF_IMAGE' },
        referenceImage: { id: 'character-reference-resource', kind: 'referenceImage', url: 'https://cdn.example.test/character/reference.png', provider: 'CF_IMAGE' },
        voiceSample: {
          id: 'character-voice-resource',
          kind: 'voiceSample',
          url: 'https://cdn.example.test/character/voice.wav',
          provider: 'S3_OBJECT',
          mimeType: 'audio/wav',
          durationSec: 8.42,
          sha256: 'sha256-voice',
        },
      },
    },
  });
  const { callApi } = createWorldPublicCallApi({
    detail: resourceWorld,
    characters: [resourceCharacter],
    personas: [],
  });

  const result = await loadWorldDetailWithCharacters(
    callApi as never,
    createEmitter(errors),
    'world-1',
  );

  assert.equal(result?.heroUrl, 'https://cdn.example.test/world/hero.png');
  assert.deepEqual(result?.highlightUrls, [
    'https://cdn.example.test/world/highlight-1.png',
    'https://cdn.example.test/world/highlight-2.png',
    'https://cdn.example.test/world/highlight-3.png',
  ]);
  assert.equal(result?.characters[0]?.avatarUrl, 'https://cdn.example.test/character/avatar.png');
  assert.equal(
    (result?.characters[0] as { profileCoverUrl?: string | null } | undefined)?.profileCoverUrl,
    'https://cdn.example.test/character/profile-cover.png',
  );
  assert.equal(
    (result?.characters[0] as { referenceImageUrl?: string | null } | undefined)?.referenceImageUrl,
    'https://cdn.example.test/character/reference.png',
  );
  assert.equal(
    (result?.characters[0] as { voiceSampleUrl?: string | null } | undefined)?.voiceSampleUrl,
    'https://cdn.example.test/character/voice.wav',
  );
  assert.equal(JSON.stringify(result).includes('/tmp/nimi-forge'), false);
  assert.equal(errors.length, 0);
});

test('World assets projection exposes hero banner icon and accepted public highlights', async () => {
  const errors: RealmWorldDataError[] = [];
  const { callApi } = createWorldPublicCallApi({
    detail: publicWorld({
      media: {
        assets: {
          icon: { id: 'world-icon-resource', kind: 'icon', url: 'https://cdn.example.test/world/icon.png', provider: 'CF_IMAGE' },
          banner: { id: 'world-banner-resource', kind: 'banner', url: 'https://cdn.example.test/world/banner.png', provider: 'CF_IMAGE' },
          hero: { id: 'world-hero-resource', kind: 'hero', url: 'https://cdn.example.test/world/hero.png', provider: 'CF_IMAGE' },
          highlights: [
            { id: 'world-highlight-1-resource', kind: 'highlight', url: 'https://cdn.example.test/world/highlight-1.png', provider: 'CF_IMAGE' },
            { id: 'world-highlight-2-resource', kind: 'highlight', url: 'https://cdn.example.test/world/highlight-2.png', provider: 'CF_IMAGE' },
            { id: 'world-highlight-3-resource', kind: 'highlight', url: 'https://cdn.example.test/world/highlight-3.png', provider: 'CF_IMAGE' },
          ],
        },
      },
    }),
  });

  const assets = await loadWorldAssets(
    callApi as never,
    createEmitter(errors),
    'world-1',
  );

  assert.deepEqual(assets.externalRefs.map((ref) => [ref.kind, ref.uri]), [
    ['icon', 'https://cdn.example.test/world/icon.png'],
    ['banner', 'https://cdn.example.test/world/banner.png'],
    ['hero', 'https://cdn.example.test/world/hero.png'],
    ['highlight', 'https://cdn.example.test/world/highlight-1.png'],
    ['highlight', 'https://cdn.example.test/world/highlight-2.png'],
    ['highlight', 'https://cdn.example.test/world/highlight-3.png'],
  ]);
  assert.deepEqual(assets.resourceRefs.map((ref) => [ref.kind, ref.refId]), [
    ['icon', 'world-icon-resource'],
    ['banner', 'world-banner-resource'],
    ['hero', 'world-hero-resource'],
    ['highlight', 'world-highlight-1-resource'],
    ['highlight', 'world-highlight-2-resource'],
    ['highlight', 'world-highlight-3-resource'],
  ]);
  assert.equal(errors.length, 0);
});

test('World detail highlight model prefers accepted public highlight assets over bundled samples', () => {
  const highlights = worldPublicHighlightImages({
    resourceRefs: [],
    externalRefs: [
      { refId: 'world-media-icon', kind: 'icon', uri: 'https://cdn.example.test/world/icon.png' },
      { refId: 'world-media-highlight-1', kind: 'highlight', uri: 'https://cdn.example.test/world/highlight-1.png' },
      { refId: 'world-media-highlight-2', kind: 'highlight', uri: 'https://cdn.example.test/world/highlight-2.png' },
      { refId: 'world-media-highlight-3', kind: 'highlight', uri: 'https://cdn.example.test/world/highlight-3.png' },
    ],
    intents: [],
    scenes: [],
  });

  assert.deepEqual(highlights, [
    'https://cdn.example.test/world/highlight-1.png',
    'https://cdn.example.test/world/highlight-2.png',
    'https://cdn.example.test/world/highlight-3.png',
  ]);
});
