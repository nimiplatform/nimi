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
    tags: ['history', 'research'],
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

function callerFor(
  rows: unknown[],
  sourceCard: unknown = publicSourceCard(),
  onPublicSourceRequest?: (sourceRef: CharacterSourceRefV3) => void,
): RealmExploreApiCaller {
  return async (task) => task({
    worldCore: {
      worldCoreControllerListPersonaCharacters: async () => rows,
      worldCoreControllerDiscoverPersonaCharacters: async () => rows,
    },
    worldPublic: {
      worldPublicControllerGetCharacterSource: async (request: {
        body: { sourceRef: CharacterSourceRefV3 };
      }) => {
        onPublicSourceRequest?.(request.body.sourceRef);
        return sourceCard;
      },
    },
  } as never);
}

function personaProfile(assets: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: sourceRef.id,
    ownerAccountId: sourceRef.ownerAccountId,
    worldId: sourceRef.worldId,
    sourceHash: sourceRef.sourceHash,
    contentHash: 'b'.repeat(64),
    contentRevision: 1,
    schemaVersion: 'realm.persona-character-core/v1',
    visibility: 'public',
    profile: {
      profileSchemaVersion: 'realm.character-profile-core/v1',
      identity: {
        name: 'Core Resource Ref Boundary',
        summary: 'Core-only summary must not become Explore presentation.',
      },
      presentation: {
        displayName: 'Core Resource Ref Boundary',
        avatarResourceRef: 'forge-publication-ledger-record-persona-avatar',
      },
      narrative: {
        summary: 'Shared CharacterProfile narrative.',
        archetype: 'Historian',
        traits: ['careful'],
      },
      interactionProfile: {
        interactionModes: ['dialogue'],
        cadence: 'Measured',
      },
      knowledge: {
        topics: ['archives'],
        constraints: ['cite sources'],
      },
      assets: {
        resourceRefs: [],
        intents: [],
        ...assets,
      },
      authoring: { source: 'test' },
      profileCoverage: {
        aggregateStatus: 'complete',
        diagnostics: [],
        manifestSchemaVersion: 'realm.character-profile-coverage/v1',
        optionalRefs: [],
        optionalSections: [],
        profileCoverageHash: 'c'.repeat(64),
        requiredRefs: [],
        requiredSections: [],
      },
      profileHash: 'd'.repeat(64),
    },
    materializationReadiness: { blockers: [], status: 'ready' },
    origin: { kind: 'manual' },
    validity: { issues: [], status: 'valid' },
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
  };
}

test('Explore Persona projection never treats an avatar resource id as an image URL', async () => {
  const result = await loadExplorePersonas(callerFor([personaProfile()]), () => undefined);
  assert.equal(result.items[0]?.avatarUrl, null);
});

test('Explore Persona projection gets its avatar only from WorldPublicSourceCard', async () => {
  const avatarUrl = 'https://media.nimi.test/persona/avatar.png';
  const result = await loadExplorePersonas(callerFor([personaProfile({
    externalRefs: [
      { kind: 'avatar', uri: 'forge-publication-ledger-record-persona-avatar' },
      { kind: 'avatar', uri: 'https://core.nimi.test/must-not-leak.png' },
    ],
  })], publicSourceCard({
    media: { avatarUrl },
  })), () => undefined);
  assert.equal(result.items[0]?.avatarUrl, avatarUrl);
});

test('Explore Persona projection falls back through public portrait and reference image URLs', async () => {
  const portraitUrl = 'https://media.nimi.test/persona/portrait.png';
  const portraitResult = await loadExplorePersonas(callerFor(
    [personaProfile()],
    publicSourceCard({ media: { portraitUrl } }),
  ), () => undefined);
  assert.equal(portraitResult.items[0]?.avatarUrl, portraitUrl);

  const referenceImageUrl = 'https://media.nimi.test/persona/reference.png';
  const referenceResult = await loadExplorePersonas(callerFor(
    [personaProfile()],
    publicSourceCard({ media: { referenceImageUrl } }),
  ), () => undefined);
  assert.equal(referenceResult.items[0]?.avatarUrl, referenceImageUrl);
});

test('Explore Persona projection uses discovery by default and the public list for local filters', async () => {
  const calls: string[] = [];
  const callApi: RealmExploreApiCaller = async (task) => task({
    worldCore: {
      worldCoreControllerDiscoverPersonaCharacters: async () => {
        calls.push('discover');
        return [personaProfile()];
      },
      worldCoreControllerListPersonaCharacters: async () => {
        calls.push('list');
        return [personaProfile()];
      },
    },
    worldPublic: {
      worldPublicControllerGetCharacterSource: async () => {
        calls.push('public-source');
        return publicSourceCard();
      },
    },
  } as never);

  await loadExplorePersonas(callApi, () => undefined);
  await loadExplorePersonas(callApi, () => undefined, { query: 'resource' });
  assert.deepEqual(calls, ['discover', 'public-source', 'list', 'public-source']);
});

test('Explore Persona projection uses strict SourceRef, shared profile semantics, and public metadata', async () => {
  const requestedSourceRefs: CharacterSourceRefV3[] = [];
  const result = await loadExplorePersonas(
    callerFor(
      [personaProfile()],
      publicSourceCard(),
      (requestedSourceRef) => requestedSourceRefs.push(requestedSourceRef),
    ),
    () => undefined,
  );

  assert.deepEqual(requestedSourceRefs, [sourceRef]);
  assert.equal(result.items[0]?.displayName, 'Public Resource Ref Boundary');
  assert.equal(result.items[0]?.worldName, 'Public Test World');
  assert.equal(result.items[0]?.ownership, 'userOwned');
  assert.equal(result.items[0]?.role, 'Archivist');
  assert.equal(result.items[0]?.archetype, 'Historian');
  assert.equal(result.items[0]?.cadence, 'Measured');
  assert.equal('pacing' in (result.items[0] ?? {}), false);
  assert.equal('origin' in (result.items[0] ?? {}), false);
  assert.equal('tier' in (result.items[0] ?? {}), false);
});

test('Explore Persona card projection preserves public world and ownership metadata', async () => {
  const result = await loadExplorePersonas(callerFor([personaProfile()]), () => undefined);
  const [card] = parsePersonaSources(result, new Map([
    [sourceRef.worldId, {
      bannerUrl: 'https://media.nimi.test/world/banner.png',
      name: 'Stale world-list name',
    }],
  ]));

  assert.equal(card?.worldName, 'Public Test World');
  assert.equal(card?.ownership, 'userOwned');
  assert.equal(card?.role, 'Archivist');
  assert.equal(card?.cadence, 'Measured');
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

test('Explore Persona projection fails closed when WorldPublicSourceCard returns another source hash', async () => {
  const mismatchedSourceRef = {
    ...sourceRef,
    sourceHash: 'e'.repeat(64),
  };
  await assert.rejects(
    () => loadExplorePersonas(
      callerFor([personaProfile()], publicSourceCard({ sourceRef: mismatchedSourceRef })),
      () => undefined,
    ),
    /does not match the requested PersonaCharacter sourceRef/,
  );
});
