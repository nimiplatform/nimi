import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePersonaSources } from '../src/shell/renderer/features/explore/explore-persona-source-projection.js';
import { resolveCharacterSourceRefV3 } from '../src/shell/renderer/features/explore/character-source-materialization.js';
import { buildRelationshipProfileSeed } from '../src/shell/renderer/features/chat/chat-relationship-hover-card.js';
import { toProfileData } from '../src/shell/renderer/features/profile/profile-model.js';
import { toFriendContact } from '../src/shell/renderer/features/relationship/relationship-model.js';

const sourceRef = {
  kind: 'personaCharacter' as const,
  id: 'persona-a',
  worldId: 'world-a',
  ownerAccountId: 'account-a',
  sourceHash: 'a'.repeat(64),
};

test('shared Realm source materialization rejects nested sourceRef that does not match display identity', () => {
  assert.deepEqual(resolveCharacterSourceRefV3({
    id: 'persona-a',
    sourceKind: 'personaCharacter',
    sourceRef,
  }), sourceRef);

  assert.equal(resolveCharacterSourceRefV3({
    id: 'persona-a',
    sourceKind: 'personaCharacter',
    sourceRef: {
      ...sourceRef,
      id: 'persona-b',
    },
  }), null);
});

test('explore, relationship, and profile projections fail closed on display/sourceRef mismatch', () => {
  const mismatchedPayload = {
    id: 'persona-a',
    displayName: 'Persona A',
    handle: '~persona-a',
    isSource: true,
    sourceKind: 'personaCharacter',
    sourceId: 'persona-a',
    sourceWorldId: 'world-a',
    worldId: 'world-a',
    sourceRef: {
      ...sourceRef,
      id: 'persona-b',
    },
  };

  assert.throws(() => parsePersonaSources({ items: [mismatchedPayload] }, new Map()), /sourceRef.*mismatch/i);
  assert.throws(() => toFriendContact(mismatchedPayload), /sourceRef.*mismatch/i);
  assert.throws(() => toProfileData(mismatchedPayload), /sourceRef.*mismatch/i);
});

test('profile data preserves WorldEntityCore projection for world character sources', () => {
  const profile = toProfileData({
    id: 'character-a',
    displayName: 'Character A',
    handle: '~character-a',
    isSource: true,
    sourceKind: 'worldCharacter',
    sourceId: 'character-a',
    sourceWorldId: 'world-a',
    sourceRef: {
      kind: 'worldCharacter',
      id: 'character-a',
      worldId: 'world-a',
      worldEntityRef: { kind: 'worldEntity', worldId: 'world-a', entityId: 'entity-a' },
      sourceHash: 'b'.repeat(64),
    },
    entityId: 'entity-a',
    entityContentHash: 'entity-hash-a',
    entity: {
      id: 'entity-a',
      kind: 'person',
      name: 'Canonical Character A',
      summary: 'Entity-layer semantic identity.',
      contentHash: 'entity-hash-a',
      tags: ['scholar'],
      facts: [{ key: 'office', value: 'Hanlin scholar' }],
    },
  });

  assert.equal((profile as { entityId?: string }).entityId, 'entity-a');
  assert.equal((profile as { entityContentHash?: string }).entityContentHash, 'entity-hash-a');
  assert.deepEqual((profile as { entity?: unknown }).entity, {
    id: 'entity-a',
    kind: 'person',
    name: 'Canonical Character A',
    summary: 'Entity-layer semantic identity.',
    contentHash: 'entity-hash-a',
    tags: ['scholar'],
    facts: [{ key: 'office', value: 'Hanlin scholar' }],
  });
});

test('chat relationship profile seed requires hash-bearing sourceRef for agent targets', () => {
  assert.equal(buildRelationshipProfileSeed({
    id: 'local-agent:user-a:runtime-source:personaCharacter:world-a:persona-a',
    source: 'agent',
    canonicalSessionId: 'conversation-a',
    title: 'Persona A',
    handle: '~persona-a',
    metadata: {
      runtimeSourceRef: 'runtime-source:personaCharacter:world-a:persona-a',
    },
  }), null);

  const target = buildRelationshipProfileSeed({
    id: 'local-agent:user-a:runtime-source:personaCharacter:world-a:persona-a',
    source: 'agent',
    canonicalSessionId: 'conversation-a',
    title: 'Persona A',
    handle: '~persona-a',
    avatarUrl: '/avatar.png',
    metadata: {
      runtimeSourceRef: 'runtime-source:personaCharacter:world-a:persona-a',
      sourceRef,
    },
  });

  assert.equal(target?.profileId, 'persona-a');
  assert.deepEqual(target?.seed.sourceRef, sourceRef);
  assert.equal(target?.seed.runtimeSourceRef, 'runtime-source:personaCharacter:world-a:persona-a');
});
