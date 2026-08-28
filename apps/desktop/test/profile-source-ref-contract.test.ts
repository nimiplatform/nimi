import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePersonaSources } from '../src/shell/renderer/features/explore/explore-persona-source-projection.js';
import { resolveCharacterSourceRefV3 } from '../src/shell/renderer/features/explore/character-source-materialization.js';
import {
  buildRelationshipProfileNavigationTarget,
} from '../src/shell/renderer/features/chat/chat-relationship-hover-card.js';
import {
  toAgentTargetSnapshotFromSummary,
  toHumanFriendTargetSummary,
} from '../src/shell/renderer/features/chat/chat-sidebar-targets.js';
import { buildPostCardAuthorProjection } from '../src/shell/renderer/features/home/post-card-projections.js';
import { toFriendContact } from '../src/shell/renderer/features/relationship/relationship-model.js';
import { toWorldListItem } from '../src/shell/renderer/features/world/world-list-model.js';

const sourceRef = {
  kind: 'personaCharacter' as const,
  id: 'persona-a',
  worldId: 'world-a',
  ownerAccountId: 'account-a',
  sourceHash: 'a'.repeat(64),
};

const worldCharacterSourceRef = {
  kind: 'worldCharacter' as const,
  id: 'character-a',
  worldId: 'world-a',
  worldEntityRef: {
    kind: 'worldEntity' as const,
    worldId: 'world-a',
    entityId: 'character-a',
  },
  sourceHash: 'b'.repeat(64),
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

test('world list drops a Character sourceRef that belongs to another world', () => {
  const worldRecord = {
    id: 'world-a',
    name: 'World A',
    summary: 'World summary',
    media: {},
    stats: {},
    time: {},
    characters: [{
      id: worldCharacterSourceRef.id,
      name: 'Character A',
      sourceKind: worldCharacterSourceRef.kind,
      sourceRef: worldCharacterSourceRef,
    }],
  };

  assert.deepEqual(
    toWorldListItem(worldRecord).characters?.[0]?.sourceRef,
    worldCharacterSourceRef,
  );
  assert.equal(
    toWorldListItem({
      ...worldRecord,
      characters: [{
        ...worldRecord.characters[0],
        sourceRef: {
          ...worldCharacterSourceRef,
          worldId: 'world-b',
        },
      }],
    }).characters?.[0]?.sourceRef,
    null,
  );
});

test('explore projection rejects display/sourceRef mismatch and friendship rejects source payloads', () => {
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
  assert.throws(() => toFriendContact(mismatchedPayload), /requires a human contact/i);
  const humanContact = toFriendContact({
    id: 'account-a',
    displayName: 'Human A',
    handle: 'human-a',
  });
  assert.equal(humanContact.id, 'account-a');
  assert.equal('isSource' in humanContact, false);
  assert.throws(() => toFriendContact({
    id: 'local-agent:user-a:agent-a',
    displayName: 'Runtime LocalAgent',
    handle: 'agent-a',
    localAgentRef: 'local-agent:user-a:agent-a',
  }), /requires a human contact/i);
  assert.throws(() => toFriendContact({
    id: 'local-agent:user-a:agent-a',
    displayName: 'Runtime LocalAgent',
    handle: 'agent-a',
  }), /requires a human account id/i);
  assert.throws(() => toFriendContact({
    id: 'account-a',
    displayName: 'Legacy-shaped Human',
    handle: 'account-a',
    isSource: false,
  }), /requires a human contact/i);
  assert.equal(toHumanFriendTargetSummary({
    id: 'account-a',
    displayName: 'Legacy-shaped Human',
    handle: 'account-a',
    isSource: false,
  }), null);
});

test('chat relationship profile navigation discriminates human account ids from Character sourceRefs', () => {
  assert.equal(buildRelationshipProfileNavigationTarget({
    id: 'local-agent:user-a:runtime-source:personaCharacter:world-a:persona-a',
    source: 'agent',
    canonicalSessionId: 'conversation-a',
    title: 'Persona A',
    handle: '~persona-a',
    metadata: {
      runtimeSourceRef: 'runtime-source:personaCharacter:world-a:persona-a',
    },
  }), null);

  assert.deepEqual(buildRelationshipProfileNavigationTarget({
    id: 'local-agent:user-a:runtime-source:personaCharacter:world-a:persona-a',
    source: 'agent',
    canonicalSessionId: 'conversation-a',
    title: 'Persona A',
    metadata: { sourceRef },
  }), {
    kind: 'character',
    sourceRef,
  });

  assert.deepEqual(buildRelationshipProfileNavigationTarget({
    id: 'chat-a',
    source: 'human',
    canonicalSessionId: 'chat-a',
    title: 'Human A',
    metadata: { otherUserId: 'account-a' },
  }), {
    kind: 'human',
    profileId: 'account-a',
  });

  assert.equal(buildRelationshipProfileNavigationTarget({
    id: 'local-agent:user-a:agent-a',
    source: 'human',
    canonicalSessionId: 'local-agent:user-a:agent-a',
    title: 'Misclassified LocalAgent',
    metadata: { otherUserId: 'local-agent:user-a:agent-a' },
  }), null);
});

test('chat target projection accepts only canonical handle plus Runtime-issued anchor', () => {
  const target = toAgentTargetSnapshotFromSummary({
    id: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    source: 'agent',
    canonicalSessionId: 'anchor-a',
    title: 'Persona A',
    metadata: {
      agentHandle: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      conversationAnchorId: 'anchor-a',
      displayName: 'Persona A',
    },
  });

  assert.equal(target?.agentHandle, 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  assert.equal(target?.conversationAnchorId, 'anchor-a');
  assert.equal(Object.hasOwn(target ?? {}, 'localAgentRef'), false);
  assert.equal(toAgentTargetSnapshotFromSummary({
    id: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    source: 'agent',
    canonicalSessionId: 'anchor-a',
    title: 'Persona A',
    metadata: {
      agentHandle: 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      displayName: 'Persona A',
    },
  }), null);
});

test('post author projection keeps Character sourceRef separate from human profileId', () => {
  const characterProjection = buildPostCardAuthorProjection({
    authorId: '',
    unknownDisplayName: 'Unknown',
    post: {
      authorKind: 'personaCharacter',
      sourceAuthor: {
        id: sourceRef.id,
        kind: sourceRef.kind,
        worldId: sourceRef.worldId,
        sourceRef,
        displayName: 'Persona A',
        handle: '~persona-a',
        avatarUrl: null,
      },
    } as never,
  });
  assert.deepEqual(characterProjection.authorProfileTarget, {
    kind: 'character',
    sourceRef,
  });

  assert.throws(() => buildPostCardAuthorProjection({
    authorId: sourceRef.id,
    unknownDisplayName: 'Unknown',
    post: {
      authorKind: 'personaCharacter',
    } as never,
  }), /Character-authored post requires sourceAuthor/i);

  assert.throws(() => buildPostCardAuthorProjection({
    authorId: 'account-a',
    unknownDisplayName: 'Unknown',
    post: {
      authorKind: 'human',
      sourceAuthor: {
        id: sourceRef.id,
        kind: sourceRef.kind,
        worldId: sourceRef.worldId,
        sourceRef,
      },
    } as never,
  }), /Human-authored post cannot include Character sourceAuthor/i);

  const humanProjection = buildPostCardAuthorProjection({
    authorId: 'account-a',
    unknownDisplayName: 'Unknown',
    post: {
      authorKind: 'human',
      author: {
        displayName: 'Human A',
        handle: 'human-a',
        avatarUrl: null,
      },
    } as never,
  });
  assert.equal(humanProjection.authorProfileTarget?.kind, 'human');
  if (humanProjection.authorProfileTarget?.kind === 'human') {
    assert.equal(humanProjection.authorProfileTarget.profileId, 'account-a');
  }
});
