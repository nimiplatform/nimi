import assert from 'node:assert/strict';
import test from 'node:test';
import type { JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';

import { realmSourceDetailData } from '../src/shell/renderer/features/source-detail/data/realm-source-detail-data.js';
import { projectCharacterSourceProfile } from '../src/shell/renderer/features/realm-source/character-source-profile-projection.js';
import { readCharacterProfile } from '../src/shell/renderer/features/source-detail/source-detail-world-character-model.js';
import { fetchSourceDisplayDetail } from '../src/shell/renderer/features/source-detail/source-detail-queries.js';
import { toSourceDetailData } from '../src/shell/renderer/features/source-detail/source-detail-model.js';
import type { CharacterSourceRefV3 } from '../src/shell/renderer/features/realm-source/realm-source-identity.js';

const sourceRef: CharacterSourceRefV3 = {
  kind: 'worldCharacter',
  id: 'character-song-lian',
  worldId: 'world-ming',
  worldEntityRef: {
    kind: 'worldEntity',
    worldId: 'world-ming',
    entityId: 'entity-song-lian',
  },
  sourceHash: 'a'.repeat(64),
};

function characterProfile(name: string, summary: string) {
  return {
    profileSchemaVersion: 'realm.character-profile-core/v1',
    profileHash: 'f'.repeat(64),
    profileCoverage: { sections: [], refs: [], diagnostics: [] },
    identity: { name, summary },
    presentation: {
      displayName: name,
      profileLine: summary,
    },
    narrative: {
      summary,
      archetype: 'Scholar',
      traits: ['historian'],
      milestones: [],
    },
    interactionProfile: {
      interactionModes: ['conversation'],
      dialogueExemplars: [{
        exemplarId: 'example-1',
        user: 'Tell me about history.',
        character: 'Let us begin with the sources.',
      }],
      greeting: 'Welcome.',
    },
    knowledge: { topics: ['history'], constraints: [] },
    relationships: [{
      relationshipId: 'relationship-1',
      relationType: 'mentor',
      targetRef: {
        kind: 'worldEntity',
        worldId: 'world-ming',
        entityId: 'entity-mentor',
      },
      summary: 'A trusted mentor.',
    }],
    assets: { resourceRefs: [], externalRefs: [], intents: [] },
    authoring: { source: 'test' },
  };
}

function publicSourceCard(ref: CharacterSourceRefV3, displayName: string) {
  return {
    id: ref.id,
    worldId: ref.worldId,
    worldName: 'Ming World',
    displayName,
    handle: 'source-handle',
    summary: `${displayName} summary`,
    traits: ['historian'],
    topics: ['history'],
    role: 'Scholar',
    sourceKind: ref.kind,
    sourceRef: ref,
    ownership: ref.kind === 'worldCharacter' ? 'worldOwned' : 'userOwned',
    relation: {
      state: 'connectable',
      connectionId: null,
      runtimeSourceRef: null,
    },
    media: {
      avatarUrl: 'https://cdn.example.test/song-lian-avatar.png',
      assets: {},
    },
    characterBiography: null,
    updatedAt: '2026-07-28T00:00:00.000Z',
  };
}

test('worldCharacter and personaCharacter use the same shared profile projection', () => {
  const personaRef: CharacterSourceRefV3 = {
    kind: 'personaCharacter',
    id: 'persona-song-lian',
    worldId: sourceRef.worldId,
    ownerAccountId: 'account-1',
    sourceHash: 'd'.repeat(64),
  };
  const profile = characterProfile('宋濂', '明初文学家、史学家。');
  const worldProjection = projectCharacterSourceProfile(
    profile as never,
    publicSourceCard(sourceRef, '宋濂') as never,
  );
  const personaProjection = projectCharacterSourceProfile(
    profile as never,
    {
      ...publicSourceCard(personaRef, '宋濂'),
      role: 'Scholar',
    } as never,
  );

  assert.deepEqual(personaProjection.characterProfile, worldProjection.characterProfile);
  assert.strictEqual(
    readCharacterProfile(personaProjection.characterProfile),
    personaProjection.characterProfile,
  );
  assert.deepEqual(personaProjection.viewerRelation, {
    state: 'connectable',
    connectionId: null,
    runtimeSourceRef: null,
  });
  assert.equal('isFriend' in personaProjection, false);
  assert.deepEqual(personaProjection.characterProfile.conversationAnchors, [
    'Tell me about history.',
    'Let us begin with the sources.',
    'history',
  ]);
  assert.equal(personaProjection.characterProfile.relationshipNotes[0]?.targetRef, 'entity-mentor');
  assert.doesNotMatch(personaProjection.characterProfile.conversationAnchors.join('\n'), /\[object Object\]/);
});

test('public biography life events keep their explicit kind in the shared milestone projection', () => {
  const projection = projectCharacterSourceProfile(
    characterProfile('Mira', 'Station cartographer of The Last Star.') as never,
    {
      ...publicSourceCard(sourceRef, 'Mira'),
      characterBiography: {
        sourceNotes: [],
        lifeEvents: [
          { id: 'event-birth', kind: 'birth', title: 'Born on Deck 9', summary: 'Born aboard the station.', sequence: 1, periodLabel: 'Cycle 1', source: 'biographyMilestone' },
          { id: 'event-crew', kind: 'relationship', title: 'Joined Oriel Vantasse', summary: 'Mira and Oriel Vantasse chart the outer ring together.', sequence: 2, periodLabel: null, source: 'relationshipSummary' },
          { id: 'event-post', kind: 'office', title: 'Chief cartographer', summary: 'Appointed chief cartographer.', sequence: 3, periodLabel: 'Cycle 12', source: 'biographyMilestone' },
          { id: 'event-atlas', kind: 'work', title: 'The Outer Ring Atlas', summary: 'Her atlas of the outer ring.', sequence: 4, periodLabel: null, source: 'biographyMilestone' },
          { id: 'event-school', kind: 'learning', title: 'Studied at the Academy', summary: 'Trained in navigation.', sequence: 5, periodLabel: null, source: 'biographyMilestone' },
          { id: 'event-other', kind: 'other', title: '任务完成', summary: 'Mission complete.', sequence: 6, periodLabel: null, source: 'biographyMilestone' },
        ],
      },
    } as never,
  );

  assert.deepEqual(
    projection.characterProfile.milestones.map((milestone) => [milestone.id, milestone.kind, milestone.derived]),
    [
      ['event-birth', 'biography', false],
      ['event-crew', 'relationship', true],
      ['event-post', 'office', false],
      ['event-atlas', 'work', false],
      ['event-school', 'biography', false],
      ['event-other', 'biography', false],
    ],
  );
  assert.equal(readCharacterProfile(projection.characterProfile), projection.characterProfile);
});

test('source detail fails closed without a complete CharacterSourceRefV3', () => {
  const projection = projectCharacterSourceProfile(
    characterProfile('宋濂', '明初文学家、史学家。') as never,
    publicSourceCard(sourceRef, '宋濂') as never,
  );
  const incompleteProjection = {
    ...projection,
    sourceRef: null,
  } as unknown as JsonObject;

  assert.throws(
    () => toSourceDetailData(incompleteProjection, 'source_materialization_available'),
    /requires complete CharacterSourceRefV3/,
  );
});

test('source detail loads one public Character projection without the full-world aggregate', async () => {
  const calls: string[] = [];
  const publicSource = publicSourceCard(sourceRef, '宋濂');
  const publicWorld = {
    id: sourceRef.worldId,
    name: 'Ming World',
    summary: 'A world of scholars.',
    type: 'CREATOR',
    visibility: 'public',
    media: { bannerUrl: 'https://cdn.example.test/ming-world-banner.png' },
    stats: {},
    entityKinds: [],
    relationshipTypes: [],
    time: { mode: 'static', label: 'Ming' },
    rules: [],
    systems: [],
    scenes: [],
    timeline: [],
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
  };
  const realm = {
    worldCore: {
      worldCoreControllerGetWorldCharacter: async () => ({
        id: sourceRef.id,
        worldId: sourceRef.worldId,
        sourceHash: sourceRef.sourceHash,
        worldEntityRef: sourceRef.worldEntityRef,
        contentHash: 'b'.repeat(64),
        visibility: 'public',
        createdAt: '2026-07-28T00:00:00.000Z',
        updatedAt: '2026-07-28T00:00:00.000Z',
        profile: characterProfile('宋濂', '明初文学家、史学家。'),
      }),
      worldCoreControllerGetWorldEntity: async () => ({
        id: sourceRef.worldEntityRef.entityId,
        worldId: sourceRef.worldId,
        kind: 'person',
        contentHash: 'c'.repeat(64),
        core: {
          identity: { name: '宋濂', summary: '明初文学家、史学家。' },
          classification: { tags: ['明代'] },
          facts: [],
        },
      }),
      worldCoreControllerListWorldRelationships: async () => [],
    },
    worldPublic: {
      worldPublicControllerGetCharacterSource: async (request: {
        body: { sourceRef: CharacterSourceRefV3 };
      }) => {
        calls.push('worldPublicControllerGetCharacterSource');
        assert.deepEqual(request.body.sourceRef, sourceRef);
        return publicSource;
      },
      worldPublicControllerGetWorld: async (request: { path: { worldId: string } }) => {
        calls.push('worldPublicControllerGetWorld');
        assert.equal(request.path.worldId, sourceRef.worldId);
        return publicWorld;
      },
      worldPublicControllerGetWorldDetailWithCharacters: async () => {
        calls.push('worldPublicControllerGetWorldDetailWithCharacters');
        throw new Error('full-world aggregate must not be used by source detail');
      },
    },
  };

  const result = await realmSourceDetailData.loadRealmSourceDetailsBySourceRef(
    realm as never,
    sourceRef,
  );

  assert.deepEqual(calls, ['worldPublicControllerGetCharacterSource', 'worldPublicControllerGetWorld']);
  assert.equal(result.displayName, '宋濂');
  assert.equal(result.avatarUrl, 'https://cdn.example.test/song-lian-avatar.png');
  assert.equal(result.worldBannerUrl, publicWorld.media.bannerUrl);
  assert.deepEqual(result.viewerRelation, {
    state: 'connectable',
    connectionId: null,
    runtimeSourceRef: null,
  });
  assert.equal('source' in result, false);

  const displayDetail = await fetchSourceDisplayDetail(sourceRef, {
    realm: () => realm,
  } as never);
  assert.equal(displayDetail?.stats, null);
  assert.equal(displayDetail?.source.worldBannerUrl, publicWorld.media.bannerUrl);
  assert.deepEqual(calls, [
    'worldPublicControllerGetCharacterSource',
    'worldPublicControllerGetWorld',
    'worldPublicControllerGetCharacterSource',
    'worldPublicControllerGetWorld',
  ]);

  publicWorld.id = 'another-world';
  await assert.rejects(
    fetchSourceDisplayDetail(sourceRef, { realm: () => realm } as never),
    /does not match requested world/,
  );
  publicWorld.id = sourceRef.worldId;

  const getWorld = realm.worldPublic.worldPublicControllerGetWorld;
  realm.worldPublic.worldPublicControllerGetWorld = async () => { throw new Error('network unavailable'); };
  const withoutBanner = await fetchSourceDisplayDetail(sourceRef, { realm: () => realm } as never);
  assert.equal(withoutBanner?.source.worldBannerUrl, null);
  assert.equal(withoutBanner?.source.displayName, '宋濂');
  realm.worldPublic.worldPublicControllerGetWorld = getWorld;

  Object.assign(publicSource.media, { profileCoverUrl: 'https://cdn.example.test/personal-cover.png' });
  calls.length = 0;
  const coveredDetail = await fetchSourceDisplayDetail(sourceRef, { realm: () => realm } as never);
  assert.equal(coveredDetail?.source.profileCoverUrl, 'https://cdn.example.test/personal-cover.png');
  assert.deepEqual(calls, ['worldPublicControllerGetCharacterSource']);
});

test('persona source detail fails closed on a stale Runtime source hash', async () => {
  const stalePersonaRef: CharacterSourceRefV3 = {
    kind: 'personaCharacter',
    id: 'persona-1',
    worldId: 'world-ming',
    ownerAccountId: 'account-1',
    sourceHash: 'd'.repeat(64),
  };
  const currentPersonaRef: CharacterSourceRefV3 = {
    ...stalePersonaRef,
    sourceHash: 'e'.repeat(64),
  };
  let publicProjectionCalls = 0;
  const realm = {
    worldCore: {
      worldCoreControllerGetPersonaCharacter: async () => ({
        id: currentPersonaRef.id,
        worldId: currentPersonaRef.worldId,
        ownerAccountId: currentPersonaRef.ownerAccountId,
        sourceHash: currentPersonaRef.sourceHash,
        contentHash: 'f'.repeat(64),
        createdAt: '2026-07-28T00:00:00.000Z',
        updatedAt: '2026-07-28T00:00:00.000Z',
        visibility: 'public',
        profile: characterProfile('吴全节', '元代道教领袖与文人交游枢纽。'),
      }),
    },
    worldPublic: {
      worldPublicControllerGetCharacterSource: async () => {
        publicProjectionCalls += 1;
        return publicSourceCard(currentPersonaRef, '吴全节');
      },
    },
  };

  await assert.rejects(
    realmSourceDetailData.loadRealmSourceDetailsBySourceRef(
      realm as never,
      stalePersonaRef,
    ),
    /PersonaCharacter sourceRef is stale or mismatched/u,
  );
  assert.equal(publicProjectionCalls, 0);
});

test('source detail fails closed when the public projection returns another sourceRef', async () => {
  const realm = {
    worldCore: {
      worldCoreControllerGetPersonaCharacter: async () => ({
        id: 'persona-1',
        worldId: 'world-ming',
        ownerAccountId: 'account-1',
        sourceHash: 'd'.repeat(64),
        contentHash: 'e'.repeat(64),
        createdAt: '2026-07-28T00:00:00.000Z',
        updatedAt: '2026-07-28T00:00:00.000Z',
        visibility: 'public',
        profile: characterProfile('Persona', 'A public persona.'),
      }),
    },
    worldPublic: {
      worldPublicControllerGetCharacterSource: async () => {
        const mismatchedRef = {
          kind: 'personaCharacter',
          id: 'another-persona',
          worldId: 'world-ming',
          ownerAccountId: 'account-1',
          sourceHash: 'd'.repeat(64),
        } as const;
        return publicSourceCard(mismatchedRef, 'Another Persona');
      },
    },
  };
  const personaRef: CharacterSourceRefV3 = {
    kind: 'personaCharacter',
    id: 'persona-1',
    worldId: 'world-ming',
    ownerAccountId: 'account-1',
    sourceHash: 'd'.repeat(64),
  };

  await assert.rejects(
    () => realmSourceDetailData.loadRealmSourceDetailsBySourceRef(realm as never, personaRef),
    /mismatched sourceRef/,
  );
});
