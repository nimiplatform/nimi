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
    tags: ['history'],
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
        return publicSourceCard(sourceRef, '宋濂');
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

  assert.deepEqual(calls, ['worldPublicControllerGetCharacterSource']);
  assert.equal(result.displayName, '宋濂');
  assert.equal(result.avatarUrl, 'https://cdn.example.test/song-lian-avatar.png');
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
  assert.deepEqual(calls, [
    'worldPublicControllerGetCharacterSource',
    'worldPublicControllerGetCharacterSource',
  ]);
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
