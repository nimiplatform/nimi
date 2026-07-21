import assert from 'node:assert/strict';
import test from 'node:test';

import { createRealmWorldData } from '../src/shell/renderer/features/world/data/realm-world-data.js';
import type { DesktopRendererSdkPort } from '../src/shell/renderer/renderer/sdk-port.js';

const realmWorldData = createRealmWorldData({
  socialData: {
    callApi: async () => { throw new Error('TEST_REALM_API_UNAVAILABLE'); },
    emitDataError: () => undefined,
  },
} as unknown as DesktopRendererSdkPort);
import {
  fetchWorldDisplayDetail,
} from '../src/shell/renderer/features/world/world-detail-queries.js';

const world = {
  id: 'world-1',
  name: 'Eldoria',
  summary: 'A public setting for source discovery.',
  description: 'A public setting for source discovery.',
  tagline: 'High Magic',
  type: 'CREATOR',
  visibility: 'public',
  status: 'DISCOVERABLE',
  tags: ['Fantasy'],
  themes: ['Fantasy'],
  media: {
    iconUrl: null,
    bannerUrl: null,
    heroUrl: null,
    highlightUrls: [],
  },
  time: {
    mode: 'wallClockAnchored',
    flowRatio: 1,
    isPaused: false,
    anchorRealStartedAt: '2026-06-18T00:00:00.000Z',
    anchorWorldStartedAt: '2026-06-18T00:00:00.000Z',
    anchorWorldStartedAtDisplay: 'June 18, 2026',
    currentWorldTime: '2026-06-19T00:00:00.000Z',
    currentWorldTimeDisplay: 'June 19, 2026',
    computedAt: '2026-06-19T00:00:00.000Z',
  },
  stats: {
    characterCount: 1,
    personaCount: 1,
    sceneCount: 0,
    systemCount: 0,
    timelineEventCount: 0,
  },
  computed: {
    time: {
      currentWorldTime: '2026-06-19T00:00:00.000Z',
      currentLabel: 'June 19, 2026',
      eraLabel: 'June 18, 2026',
      flowRatio: 1,
      isPaused: false,
    },
    languages: { primary: null, common: [] },
    entry: { recommendedCharacters: [] },
    score: { scoreEwma: 0 },
    featuredCharacterCount: 2,
  },
  characterCount: 2,
  personaCount: 1,
  sceneCount: 0,
  systemCount: 0,
  timelineEventCount: 0,
  createdAt: '2026-06-18T00:00:00.000Z',
  updatedAt: '2026-06-19T00:00:00.000Z',
};

function source(kind: 'worldCharacter' | 'personaCharacter', id: string) {
  const ownership: 'worldOwned' | 'userOwned' = kind === 'worldCharacter' ? 'worldOwned' : 'userOwned';
  const importance: 'PRIMARY' | 'SECONDARY' = kind === 'worldCharacter' ? 'PRIMARY' : 'SECONDARY';
  const relationState = 'connectable' as const;
  return {
    id,
    name: kind === 'worldCharacter' ? 'Archivist Liora' : 'Mira Vale',
    handle: id,
    bio: kind === 'worldCharacter' ? 'World-owned source.' : 'User-owned public source.',
    avatarUrl: null,
    sourceKind: kind,
    ownership,
    sourceRef: kind === 'worldCharacter'
      ? {
          kind,
          id,
          worldId: 'world-1',
          worldEntityRef: { kind: 'worldEntity' as const, worldId: 'world-1', entityId: `entity-${id}` },
          sourceHash: 'a'.repeat(64),
        }
      : {
          kind,
          id,
          worldId: 'world-1',
          ownerAccountId: 'account-1',
          sourceHash: 'b'.repeat(64),
        },
    relation: {
      state: relationState,
      connectionId: null,
    },
    createdAt: '2026-06-19T00:00:00.000Z',
    importance,
    display: {
      role: kind === 'worldCharacter' ? 'Archivist' : 'Traveler',
      tags: [],
      sourceKind: kind,
      ownership,
      worldName: 'Eldoria',
    },
    stats: null,
  };
}

test('World detail display keeps world characters and public personas as source cards', async () => {
  const originals = {
    loadWorldDetailWithCharacters: realmWorldData.loadWorldDetailWithCharacters,
    loadWorldHistory: realmWorldData.loadWorldHistory,
    loadWorldSemanticBundle: realmWorldData.loadWorldSemanticBundle,
    loadWorldAssets: realmWorldData.loadWorldAssets,
    loadWorldScenes: realmWorldData.loadWorldScenes,
  };
  realmWorldData.loadWorldDetailWithCharacters = async () => ({
    ...world,
    characters: [
      {
        ...source('worldCharacter', 'character-1'),
        display: {
          role: 'Archivist',
          tags: ['与许有壬有交往。'],
          sourceKind: 'worldCharacter',
          ownership: 'worldOwned',
          worldName: 'Eldoria',
        },
      },
      source('personaCharacter', 'persona-1'),
    ],
  });
  realmWorldData.loadWorldHistory = async () => ({ items: [] });
  realmWorldData.loadWorldSemanticBundle = async () => ({});
  realmWorldData.loadWorldAssets = async () => ({ resourceRefs: [], externalRefs: [], intents: [] });
  realmWorldData.loadWorldScenes = async () => ({ items: [] });

  try {
    const detail = await fetchWorldDisplayDetail('world-1', realmWorldData);
    const sources = detail.characters as Array<{ id: string; sourceKind?: string; ownership?: string }>;
    assert.equal(sources.length, 2);
    assert.equal(sources[0]?.sourceKind, 'worldCharacter');
    assert.equal(sources[1]?.sourceKind, 'personaCharacter');
    assert.equal(sources[1]?.ownership, 'userOwned');
    assert.equal(
      detail.characters[0]?.sourceRef.sourceHash,
      'a'.repeat(64),
    );
    assert.deepEqual(detail.characters[0]?.tags, ['与许有壬有交往。']);
  } finally {
    realmWorldData.loadWorldDetailWithCharacters = originals.loadWorldDetailWithCharacters;
    realmWorldData.loadWorldHistory = originals.loadWorldHistory;
    realmWorldData.loadWorldSemanticBundle = originals.loadWorldSemanticBundle;
    realmWorldData.loadWorldAssets = originals.loadWorldAssets;
    realmWorldData.loadWorldScenes = originals.loadWorldScenes;
  }
});

test('World detail source cards stay Realm sources without connection overlay state', () => {
  const characters = [
    source('worldCharacter', 'character-1'),
    source('personaCharacter', 'persona-1'),
  ];

  assert.equal(characters[0]?.relation?.state, 'connectable');
  assert.equal(characters[0]?.relation?.connectionId, null);
  assert.equal(characters[1]?.relation?.state, 'connectable');
});
