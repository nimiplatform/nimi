import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadExplorePersonas,
  type RealmExploreApiCaller,
} from '../src/shell/renderer/features/explore/data/realm-explore-data.js';
import type { CharacterSourceRefV3 } from '../src/shell/renderer/features/realm-source/realm-source-identity.js';
import { parsePersonaSources } from '../src/shell/renderer/features/explore/explore-persona-source-projection.js';

const sourceRef: Extract<CharacterSourceRefV3, { kind: 'personaCharacter' }> = {
  kind: 'personaCharacter',
  id: 'persona-resource-ref-boundary',
  ownerAccountId: 'account-1',
  worldId: 'world-1',
  sourceHash: 'a'.repeat(64),
};

function publicSourceCard(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: sourceRef.id,
    sourceKind: sourceRef.kind,
    sourceRef,
    displayName: 'Public Resource Ref Boundary',
    handle: 'public-resource-ref-boundary',
    summary: 'Public Persona summary',
    role: 'Archivist',
    traits: ['careful'],
    topics: ['history', 'research'],
    worldId: sourceRef.worldId,
    worldName: 'Public Test World',
    ownership: 'userOwned',
    media: {},
    relation: {
      state: 'connected',
      connectionId: 'connection-1',
      runtimeSourceRef: 'runtime-source-1',
    },
    updatedAt: '2026-07-30T00:00:00.000Z',
    ...overrides,
  };
}

function forbiddenOwnedApi() {
  return new Proxy({}, {
    get() {
      throw new Error('Public Persona discovery must not read owned or core Persona lists');
    },
  });
}

function callerFor(
  cards: unknown[],
  onRequest?: (query: Record<string, unknown>) => void,
  page: { nextCursor?: string | null; hasMore?: boolean; totalCount?: number } = {},
): RealmExploreApiCaller {
  return async (task) => task({
    worldCore: forbiddenOwnedApi(),
    worldPublic: {
      worldPublicControllerListPersonaCharacterCatalog: async (request: { query?: Record<string, unknown> }) => {
        onRequest?.(request.query ?? {});
        return {
          items: cards,
          nextCursor: page.nextCursor ?? null,
          hasMore: page.hasMore ?? false,
          totalCount: page.totalCount ?? cards.length,
        };
      },
    },
  } as never);
}

test('Explore Persona projection never treats an avatar resource id as an image URL', async () => {
  const result = await loadExplorePersonas(callerFor([publicSourceCard({
    media: { avatarUrl: 'forge-publication-ledger-record-persona-avatar' },
  })]), () => undefined);
  assert.equal(result.items[0]?.avatarUrl, null);
});

test('Explore Persona projection gets its avatar only from the public source card', async () => {
  const avatarUrl = 'https://media.nimi.test/persona/avatar.png';
  const result = await loadExplorePersonas(callerFor([publicSourceCard({
    media: { avatarUrl },
  })]), () => undefined);
  assert.equal(result.items[0]?.avatarUrl, avatarUrl);
});

test('Explore Persona projection falls back through public portrait and reference image URLs', async () => {
  const portraitUrl = 'https://media.nimi.test/persona/portrait.png';
  const portraitResult = await loadExplorePersonas(callerFor([
    publicSourceCard({ media: { portraitUrl } }),
  ]), () => undefined);
  assert.equal(portraitResult.items[0]?.avatarUrl, portraitUrl);

  const referenceImageUrl = 'https://media.nimi.test/persona/reference.png';
  const referenceResult = await loadExplorePersonas(callerFor([
    publicSourceCard({ media: { referenceImageUrl } }),
  ]), () => undefined);
  assert.equal(referenceResult.items[0]?.avatarUrl, referenceImageUrl);
});

test('Explore Persona discovery searches the public catalog and never switches to owned lists', async () => {
  const queries: Array<Record<string, unknown>> = [];
  const callApi = callerFor([publicSourceCard()], (query) => queries.push(query), {
    nextCursor: 'cursor-2',
    hasMore: true,
    totalCount: 45,
  });

  const firstPage = await loadExplorePersonas(callApi, () => undefined);
  const searched = await loadExplorePersonas(callApi, () => undefined, { query: ' 风筝 ', cursor: 'cursor-1' });

  assert.deepEqual(queries, [{ limit: 20 }, { q: '风筝', cursor: 'cursor-1', limit: 20 }]);
  assert.deepEqual(
    { nextCursor: firstPage.nextCursor, hasMore: firstPage.hasMore, totalCount: firstPage.totalCount },
    { nextCursor: 'cursor-2', hasMore: true, totalCount: 45 },
  );
  assert.equal(searched.items.length, 1);
});

test('Explore Persona projection uses the strict SourceRef and public metadata only', async () => {
  const result = await loadExplorePersonas(callerFor([publicSourceCard()]), () => undefined);

  assert.deepEqual(result.items[0]?.sourceRef, sourceRef);
  assert.equal(result.items[0]?.displayName, 'Public Resource Ref Boundary');
  assert.equal(result.items[0]?.worldName, 'Public Test World');
  assert.equal(result.items[0]?.ownership, 'userOwned');
  assert.equal(result.items[0]?.role, 'Archivist');
  assert.deepEqual(result.items[0]?.tags, ['careful', 'history', 'research']);
  assert.equal('pacing' in (result.items[0] ?? {}), false);
  assert.equal('origin' in (result.items[0] ?? {}), false);
  assert.equal('tier' in (result.items[0] ?? {}), false);
});

test('Explore Persona card projection preserves public world and ownership metadata', async () => {
  const result = await loadExplorePersonas(callerFor([publicSourceCard()]), () => undefined);
  const [card] = parsePersonaSources(result, new Map([
    [sourceRef.worldId, {
      bannerUrl: 'https://media.nimi.test/world/banner.png',
      name: 'Stale world-list name',
    }],
  ]));

  assert.equal(card?.worldName, 'Public Test World');
  assert.equal(card?.ownership, 'userOwned');
  assert.equal(card?.role, 'Archivist');
  assert.deepEqual(card?.viewerRelation, {
    state: 'connected',
    connectionId: 'connection-1',
    runtimeSourceRef: 'runtime-source-1',
  });
  assert.deepEqual(card?.sourceRef, sourceRef);
  assert.equal('sourceKind' in (card ?? {}), false);
  assert.equal('sourceId' in (card ?? {}), false);
  assert.equal('sourceHash' in (card ?? {}), false);
  assert.equal('runtimeSourceRef' in (card ?? {}), false);
  assert.equal('isFriend' in (card ?? {}), false);
});

test('Explore Persona projection fails closed on a card whose sourceRef does not match it', async () => {
  await assert.rejects(
    () => loadExplorePersonas(
      callerFor([publicSourceCard({ sourceRef: { ...sourceRef, id: 'another-persona' } })]),
      () => undefined,
    ),
    /sourceRef must match/,
  );
  await assert.rejects(
    () => loadExplorePersonas(
      async (task) => task({
        worldPublic: {
          worldPublicControllerListPersonaCharacterCatalog: async () => ({ items: [], nextCursor: null, hasMore: true, totalCount: 0 }),
        },
      } as never),
      () => undefined,
    ),
    /PersonaCharacter catalog page/,
  );
});
