import assert from 'node:assert/strict';
import test from 'node:test';

import { realmSourceDetailData } from '../src/shell/renderer/features/source-detail/data/realm-source-detail-data.js';
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
        createdAt: '2026-07-28T00:00:00.000Z',
        updatedAt: '2026-07-28T00:00:00.000Z',
        profile: {
          identity: {
            name: '宋濂',
            summary: '明初文学家、史学家。',
          },
          presentation: {},
        },
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
        return {
          sourceRef,
          media: {
            avatarUrl: 'https://cdn.example.test/song-lian-avatar.png',
          },
        };
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
        profile: {
          identity: { name: 'Persona', summary: 'A public persona.' },
          presentation: {},
        },
      }),
    },
    worldPublic: {
      worldPublicControllerGetCharacterSource: async () => ({
        sourceRef: {
          kind: 'personaCharacter',
          id: 'another-persona',
          worldId: 'world-ming',
          ownerAccountId: 'account-1',
          sourceHash: 'd'.repeat(64),
        },
        media: {},
      }),
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
