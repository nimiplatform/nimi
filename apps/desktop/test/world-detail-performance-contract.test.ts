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
  fetchWorldPrimaryDisplayDetail,
  fetchWorldDisplayDetail,
  fetchWorldRecommendedCharacterPreview,
} from '../src/shell/renderer/features/world/world-detail-queries.js';

const primaryWorldFixture = {
  id: 'world-primary',
  name: 'Primary World',
  summary: 'Primary detail should render before supplemental sections.',
  description: 'Primary detail should render before supplemental sections.',
  tagline: 'Fast return',
  type: 'CREATOR',
  visibility: 'public',
  status: 'DISCOVERABLE',
  genre: null,
  themes: ['Performance'],
  era: null,
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
    personaCharacterCount: 0,
    sceneCount: 0,
    systemCount: 0,
    timelineEventCount: 0,
  },
  computed: {
    time: {
      mode: 'wallClockAnchored',
      currentWorldTime: '2026-06-19T00:00:00.000Z',
      currentLabel: 'June 19, 2026',
      anchorLabel: 'June 18, 2026',
      flowRatio: 1,
      isPaused: false,
    },
    languages: { primary: null, common: [] },
    entry: { recommendedCharacters: [] },
    score: { scoreEwma: 0 },
    featuredCharacterCount: 1,
  },
  characterCount: 1,
  personaCharacterCount: 0,
  charactersNextCursor: null,
  personaCharactersNextCursor: null,
  sceneCount: 0,
  systemCount: 0,
  timelineEventCount: 0,
  createdAt: '2026-06-18T00:00:00.000Z',
  updatedAt: '2026-06-19T00:00:00.000Z',
  characters: [{
    id: 'character-primary',
    name: 'Fast Character',
    handle: 'fast-character',
    bio: 'Primary character.',
    avatarUrl: null,
    sourceKind: 'worldCharacter',
    ownership: 'worldOwned',
    sourceRef: {
      kind: 'worldCharacter',
      id: 'character-primary',
      worldId: 'world-primary',
      worldEntityRef: { kind: 'worldEntity', worldId: 'world-primary', entityId: 'entity-primary' },
      sourceHash: 'a'.repeat(64),
    },
    relation: {
      state: 'connectable',
      connectionId: null,
    },
    createdAt: '2026-06-19T00:00:00.000Z',
    importance: 'PRIMARY',
    display: {
      role: 'Guide',
      tags: [],
      sourceKind: 'worldCharacter',
      ownership: 'worldOwned',
      worldName: 'Primary World',
    },
    stats: null,
  }],
} satisfies NonNullable<Awaited<ReturnType<typeof realmWorldData.loadWorldDetailWithCharacters>>>;

test('world detail derives its sections from one combined response and degrades an invalid timeline independently', async () => {
  let calls = 0;
  const data = { ...realmWorldData, loadWorldDetailWithCharacters: async () => {
    calls++;
    return { ...primaryWorldFixture, timeline: [{ eventId: 'spring', title: 'Spring' }] };
  } };
  const display = await fetchWorldDisplayDetail('world-primary', data);
  assert.equal(calls, 1);
  assert.equal(display.world.id, 'world-primary');
  assert.equal(display.characters.length, 1);
  assert.equal(display.history.items[0]?.title, 'Spring');
  assert.equal(display.sections.publicAssets, 'success');
  const partial = await fetchWorldDisplayDetail('world-primary', { ...data, loadWorldDetailWithCharacters: async () =>
    ({ ...primaryWorldFixture, timeline: [{ title: 'Missing an event identity' }] }) });
  assert.equal(partial.sections.history, 'error');
  assert.equal(partial.sections.semantic, 'success');
  assert.equal(partial.world.id, 'world-primary');
});

test('world primary display detail preserves connected local-agent relation state', async () => {
  const originalLoadWorldDetailWithCharacters = realmWorldData.loadWorldDetailWithCharacters;
  realmWorldData.loadWorldDetailWithCharacters = async () => ({
    ...primaryWorldFixture,
    characters: primaryWorldFixture.characters.map((character) => ({
      ...character,
      relation: {
        state: 'connected',
        connectionId: 'local-agent-primary',
        runtimeSourceRef: 'realm-source:world-primary:character-primary',
      },
    })),
  });

  try {
    const detail = await fetchWorldPrimaryDisplayDetail('world-primary', realmWorldData);
    const relation = detail.characters[0]?.relation;

    assert.equal(relation?.state, 'connected');
    assert.equal(relation?.connectionId, 'local-agent-primary');
    assert.equal(relation?.runtimeSourceRef, 'realm-source:world-primary:character-primary');
  } finally {
    realmWorldData.loadWorldDetailWithCharacters = originalLoadWorldDetailWithCharacters;
  }
});

test('world recommended character preview loads only three source cards without full detail', async () => {
  const originalLoadWorldCharacterPage = realmWorldData.loadWorldCharacterPage;
  const originalLoadWorldDetailWithCharacters = realmWorldData.loadWorldDetailWithCharacters;
  const calls: Array<{ worldId: string; limit?: number }> = [];
  realmWorldData.loadWorldCharacterPage = async (worldId, request) => {
    calls.push({ worldId, limit: request.limit });
    return {
      items: primaryWorldFixture.characters as never,
      nextCursor: 'cursor-2',
      hasMore: true,
      totalCount: 42,
    };
  };
  realmWorldData.loadWorldDetailWithCharacters = async () => {
    throw new Error('FULL_WORLD_DETAIL_MUST_NOT_LOAD_FOR_RECOMMENDED_PREVIEW');
  };

  try {
    const characters = await fetchWorldRecommendedCharacterPreview(
      'world-primary',
      primaryWorldFixture.createdAt,
      realmWorldData,
    );

    assert.equal(characters.length, 1);
    assert.equal(characters[0]?.id, 'character-primary');
    assert.deepEqual(calls, [{ worldId: 'world-primary', limit: 3 }]);
  } finally {
    realmWorldData.loadWorldCharacterPage = originalLoadWorldCharacterPage;
    realmWorldData.loadWorldDetailWithCharacters = originalLoadWorldDetailWithCharacters;
  }
});
