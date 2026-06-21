import assert from 'node:assert/strict';
import test from 'node:test';

import { realmWorldData } from '../src/shell/renderer/features/world/data/realm-world-data.js';
import {
  fetchWorldDisplayDetail,
  overlayWorldDisplaySourceConnections,
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

function source(kind: 'worldCharacter' | 'realmPersona', id: string) {
  const ownership: 'worldOwned' | 'userOwned' = kind === 'worldCharacter' ? 'worldOwned' : 'userOwned';
  const importance: 'PRIMARY' | 'SECONDARY' = kind === 'worldCharacter' ? 'PRIMARY' : 'SECONDARY';
  const relationState = 'connectable' as const;
  const sourceContentHash = `${kind}-hash-${id}`;
  return {
    id,
    name: kind === 'worldCharacter' ? 'Archivist Liora' : 'Mira Vale',
    handle: id,
    bio: kind === 'worldCharacter' ? 'World-owned source.' : 'User-owned public source.',
    avatarUrl: null,
    sourceKind: kind,
    ownership,
    sourceRef: {
      kind,
      worldId: 'world-1',
      sourceId: id,
      sourceContentHash,
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
      source('worldCharacter', 'character-1'),
      source('realmPersona', 'persona-1'),
    ],
  });
  realmWorldData.loadWorldHistory = async () => ({ items: [] });
  realmWorldData.loadWorldSemanticBundle = async () => ({});
  realmWorldData.loadWorldAssets = async () => ({ resourceRefs: [], externalRefs: [], intents: [] });
  realmWorldData.loadWorldScenes = async () => ({ items: [] });

  try {
    const detail = await fetchWorldDisplayDetail('world-1');
    const sources = detail.characters as Array<{ id: string; sourceKind?: string; ownership?: string }>;
    assert.equal(sources.length, 2);
    assert.equal(sources[0]?.sourceKind, 'worldCharacter');
    assert.equal(sources[1]?.sourceKind, 'realmPersona');
    assert.equal(sources[1]?.ownership, 'userOwned');
    assert.equal(
      (detail.characters[0]?.sourceRef as { sourceContentHash?: string } | undefined)?.sourceContentHash,
      'worldCharacter-hash-character-1',
    );
  } finally {
    realmWorldData.loadWorldDetailWithCharacters = originals.loadWorldDetailWithCharacters;
    realmWorldData.loadWorldHistory = originals.loadWorldHistory;
    realmWorldData.loadWorldSemanticBundle = originals.loadWorldSemanticBundle;
    realmWorldData.loadWorldAssets = originals.loadWorldAssets;
    realmWorldData.loadWorldScenes = originals.loadWorldScenes;
  }
});

test('World detail source connection overlay marks matching hash-bearing source cards connected', () => {
  const characters = [
    source('worldCharacter', 'character-1'),
    source('realmPersona', 'persona-1'),
  ];

  const result = overlayWorldDisplaySourceConnections(characters, {
    activeSourceRefKeys: ['worldCharacter:world-1:character-1:worldCharacter-hash-character-1'],
    activeSourceConnections: [{
      connectionId: 'connection-1',
      ownerUserId: 'viewer-1',
      sourceRef: {
        kind: 'worldCharacter',
        worldId: 'world-1',
        sourceId: 'character-1',
        sourceContentHash: 'worldCharacter-hash-character-1',
      },
      runtimeSourceRef: 'runtime-source:worldCharacter:world-1:character-1:worldCharacter-hash-character-1',
    }],
  });

  assert.equal(result[0]?.relation?.state, 'connected');
  assert.equal(result[0]?.relation?.connectionId, 'connection-1');
  assert.equal(result[1]?.relation?.state, 'connectable');
});
