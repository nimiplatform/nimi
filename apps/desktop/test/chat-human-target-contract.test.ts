import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collapseRealmHumanChatsToTargets,
  resolveCanonicalRealmHumanChatId,
  type RealmChatViewDto,
} from '@nimiplatform/kit/features/chat/realm';
import {
  toAgentTargetSnapshotFromSummary,
  toAgentTargetsFromLocalAgentList,
  mergeHumanChatTargetsWithFriendTargets,
  toHumanFriendTargetsFromSocialSnapshot,
} from '../src/shell/renderer/features/chat/chat-sidebar-targets.js';
import type { LocalAgentListItem } from '../src/shell/renderer/features/agents/local-agent-list-model.js';
import type { SourceDetailData } from '../src/shell/renderer/features/source-detail/source-detail-model.js';

const SOURCE_HASH = 'a'.repeat(64);
function worldSourceRef(id: string, worldId = 'world-1') {
  return {
    kind: 'worldCharacter' as const,
    id,
    worldId,
    worldEntityRef: { kind: 'worldEntity' as const, worldId, entityId: `entity-${id}` },
    sourceHash: SOURCE_HASH,
  };
}

function personaSourceRef(id: string, worldId = 'world-1') {
  return {
    kind: 'personaCharacter' as const,
    id,
    worldId,
    ownerAccountId: 'owner-1',
    sourceHash: SOURCE_HASH,
  };
}

test('human target contract collapses multiple chats for the same other user into one canonical target', () => {
  const chats = [
    {
      id: 'chat-older',
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z',
      lastMessageAt: '2026-04-01T00:00:00.000Z',
      lastMessage: null,
      unreadCount: 0,
      otherUser: {
        id: 'user-1',
        displayName: 'Alice',
        handle: 'alice',
      },
    },
    {
      id: 'chat-newer',
      createdAt: '2026-04-02T00:00:00.000Z',
      updatedAt: '2026-04-02T00:00:00.000Z',
      lastMessageAt: '2026-04-02T00:00:00.000Z',
      lastMessage: null,
      unreadCount: 1,
      otherUser: {
        id: 'user-1',
        displayName: 'Alice',
        handle: 'alice',
      },
    },
    {
      id: 'chat-bob',
      createdAt: '2026-04-03T00:00:00.000Z',
      updatedAt: '2026-04-03T00:00:00.000Z',
      lastMessageAt: '2026-04-03T00:00:00.000Z',
      lastMessage: null,
      unreadCount: 0,
      otherUser: {
        id: 'user-2',
        displayName: 'Bob',
        handle: 'bob',
      },
    },
  ] as unknown as readonly RealmChatViewDto[];

  const collapsed = collapseRealmHumanChatsToTargets(chats);
  assert.equal(collapsed.length, 2);
  assert.equal(collapsed[0]?.id, 'chat-bob');
  assert.equal(collapsed[1]?.id, 'chat-newer');
  assert.equal(resolveCanonicalRealmHumanChatId(chats, 'user-1'), 'chat-newer');
  assert.equal(resolveCanonicalRealmHumanChatId(chats, 'user-2'), 'chat-bob');
});

test('human sidebar targets include human friends without duplicating existing chat targets', () => {
  const friendTargets = toHumanFriendTargetsFromSocialSnapshot({
    friends: [
      {
        id: 'user-1',
        displayName: 'Alice',
        handle: 'alice',
      },
      {
        id: 'user-2',
        displayName: 'Bob',
        handle: 'bob',
        avatarUrl: 'https://example.test/bob.png',
      },
      {
        id: 'agent-1',
        displayName: 'Companion',
        handle: 'companion',
        isSource: true,
      },
      {
        id: 'local-agent:runtime-owned-1',
        displayName: 'Runtime-owned companion',
        localAgentRef: 'local-agent:runtime-owned-1',
        runtimeSourceRef: 'runtime-source:worldCharacter:world-1:source-1',
        isSource: false,
      },
      {
        id: 'source-1',
        displayName: 'Character source',
        sourceRef: worldSourceRef('source-1'),
        isSource: false,
      },
    ],
  });

  assert.deepEqual(friendTargets.map((target) => target.id), ['user-1', 'user-2']);
  assert.equal(friendTargets[0]?.source, 'human');
  assert.equal(friendTargets[0]?.canonicalSessionId, 'user-1');
  assert.equal(friendTargets[0]?.metadata?.friendshipOnly, true);

  const merged = mergeHumanChatTargetsWithFriendTargets([
    {
      id: 'user-1',
      source: 'human',
      canonicalSessionId: 'chat-newer',
      title: 'Alice',
      previewText: 'latest chat',
      updatedAt: '2026-04-02T00:00:00.000Z',
      unreadCount: 1,
      status: 'active',
    },
  ], friendTargets);

  assert.deepEqual(merged.map((target) => [target.id, target.canonicalSessionId]), [
    ['user-1', 'chat-newer'],
    ['user-2', 'user-2'],
  ]);
});

test('agent sidebar targets include Runtime ListAgents items without a Realm source projection', () => {
  const runtimeTargets = toAgentTargetsFromLocalAgentList([{
    localAgentRef: 'local-agent:runtime-owned-yan-zhenqing',
    ownerUserId: 'owner-1',
    runtimeSourceRef: 'runtime-source:worldCharacter:tang:yan-zhenqing:hash-1',
    displayName: 'Yan Zhenqing',
    sourceRef: worldSourceRef('yan-zhenqing', 'world-tang'),
    sourceKey: 'worldCharacter:world-tang:yan-zhenqing:hash-1',
  } satisfies LocalAgentListItem], new Map([['world-tang', 'Tang Literati']]));

  assert.equal(runtimeTargets.length, 1);
  assert.equal(runtimeTargets[0]?.id, 'local-agent:runtime-owned-yan-zhenqing');
  assert.equal(runtimeTargets[0]?.source, 'agent');
  assert.equal(runtimeTargets[0]?.title, 'Yan Zhenqing');
  assert.equal(runtimeTargets[0]?.handle, 'yan-zhenqing');
  assert.equal(runtimeTargets[0]?.metadata?.ownerUserId, 'owner-1');
  assert.equal(runtimeTargets[0]?.metadata?.runtimeSourceRef, 'runtime-source:worldCharacter:tang:yan-zhenqing:hash-1');
  assert.equal(runtimeTargets[0]?.metadata?.localAgentRef, 'local-agent:runtime-owned-yan-zhenqing');
  assert.equal(runtimeTargets[0]?.metadata?.worldId, 'world-tang');
  assert.equal(runtimeTargets[0]?.metadata?.worldName, 'Tang Literati');
  assert.deepEqual(runtimeTargets[0]?.metadata?.sourceRef, worldSourceRef('yan-zhenqing', 'world-tang'));

  assert.deepEqual(toAgentTargetSnapshotFromSummary(runtimeTargets[0]), {
    ownerUserId: 'owner-1',
    runtimeSourceRef: 'runtime-source:worldCharacter:tang:yan-zhenqing:hash-1',
    localAgentRef: 'local-agent:runtime-owned-yan-zhenqing',
    sourceRef: worldSourceRef('yan-zhenqing', 'world-tang'),
    displayName: 'Yan Zhenqing',
    handle: 'yan-zhenqing',
    avatarUrl: null,
    worldId: 'world-tang',
    worldName: 'Tang Literati',
    bio: null,
    ownershipType: null,
    greeting: null,
    builtinDocsContext: null,
  });
});

test('agent sidebar targets rehydrate Runtime items from the shared character profile projection', () => {
  const localAgent = {
    localAgentRef: 'local-agent:runtime-owned-yan-zhenqing',
    ownerUserId: 'owner-1',
    runtimeSourceRef: 'runtime-source:worldCharacter:tang:yan-zhenqing:hash-1',
    displayName: 'Yan Zhenqing',
    sourceRef: worldSourceRef('yan-zhenqing', 'world-tang'),
    sourceKey: 'worldCharacter:world-tang:yan-zhenqing:hash-1',
  } satisfies LocalAgentListItem;

  const sourceDetail = {
    id: 'yan-zhenqing',
    displayName: '颜真卿',
    handle: '~yan-zhenqing',
    avatarUrl: 'https://cdn.example.test/yan/avatar.png',
    profileCoverUrl: 'https://cdn.example.test/yan/cover.png',
    referenceImageUrl: 'https://cdn.example.test/yan/reference.png',
    voiceSample: null,
    bio: '唐代书法家、忠臣、政治家。',
    createdAt: '2026-07-09T00:00:00.000Z',
    tags: ['唐代', '书法家'],
    isOnline: false,
    archetype: null,
    cadence: '缓慢有力',
    visibility: null,
    ownership: 'worldOwned',
    viewerRelation: {
      state: 'connected',
      connectionId: 'connection-yan-zhenqing',
      runtimeSourceRef: 'runtime-source:worldCharacter:tang:yan-zhenqing:hash-1',
    },
    worldId: 'world-tang',
    worldName: 'Tang Literati',
    sourceKind: 'worldCharacter',
    sourceId: 'yan-zhenqing',
    sourceHash: SOURCE_HASH,
    runtimeSourceRef: 'runtime-source:worldCharacter:tang:yan-zhenqing:hash-1',
    sourceRef: localAgent.sourceRef,
    entity: null,
    characterProfile: {
      role: '书法家、忠臣、政治家',
      archetype: null,
      traits: [],
      knowledgeTopics: [],
      knowledgeConstraints: [],
      interactionModes: [],
      milestones: [],
      relationshipNotes: [],
      conversationAnchors: ['想问书法、仕途还是安史之乱？'],
      interaction: {
        tone: '沉稳刚正',
        cadence: '缓慢有力',
        scenario: null,
        greeting: '老夫颜真卿，愿与你谈书法与世道。',
      },
    },
    worldCharacterAugmentation: {
      careerMilestones: [],
    },
    relationshipClues: [],
    works: [],
    worksAvailability: 'unavailable',
    sourceState: 'local_agent_available',
    worldBannerUrl: 'https://cdn.example.test/tang/banner.png',
  } satisfies SourceDetailData;

  const runtimeTargets = toAgentTargetsFromLocalAgentList(
    [localAgent],
    new Map([['world-tang', 'Tang Literati']]),
    new Map([[localAgent.sourceKey, sourceDetail]]),
  );

  assert.deepEqual(toAgentTargetSnapshotFromSummary(runtimeTargets[0]), {
    ownerUserId: 'owner-1',
    runtimeSourceRef: 'runtime-source:worldCharacter:tang:yan-zhenqing:hash-1',
    localAgentRef: 'local-agent:runtime-owned-yan-zhenqing',
    sourceRef: worldSourceRef('yan-zhenqing', 'world-tang'),
    displayName: '颜真卿',
    handle: '~yan-zhenqing',
    avatarUrl: 'https://cdn.example.test/yan/avatar.png',
    worldId: 'world-tang',
    worldName: 'Tang Literati',
    bio: '唐代书法家、忠臣、政治家。',
    ownershipType: null,
    greeting: '老夫颜真卿，愿与你谈书法与世道。',
    builtinDocsContext: null,
  });
});

test('agent sidebar targets read personaCharacter greeting from the shared character profile projection', () => {
  const sourceRef = personaSourceRef('persona-lin');
  const localAgent = {
    localAgentRef: 'local-agent:runtime-owned-persona-lin',
    ownerUserId: 'owner-1',
    runtimeSourceRef: 'runtime-source:personaCharacter:world-1:persona-lin:hash-1',
    displayName: 'Persona Lin',
    sourceRef,
    sourceKey: 'personaCharacter:world-1:persona-lin:hash-1',
  } satisfies LocalAgentListItem;
  const sourceDetail = {
    id: 'persona-lin',
    displayName: '林',
    handle: '~persona-lin',
    avatarUrl: null,
    profileCoverUrl: null,
    referenceImageUrl: null,
    voiceSample: null,
    bio: 'A PersonaCharacter using the shared profile contract.',
    createdAt: '2026-07-09T00:00:00.000Z',
    tags: [],
    isOnline: false,
    archetype: null,
    cadence: null,
    visibility: 'public',
    ownership: 'userOwned',
    viewerRelation: {
      state: 'connected',
      connectionId: 'connection-persona-lin',
      runtimeSourceRef: localAgent.runtimeSourceRef,
    },
    worldId: 'world-1',
    worldName: 'World One',
    sourceKind: 'personaCharacter',
    sourceId: 'persona-lin',
    sourceHash: SOURCE_HASH,
    runtimeSourceRef: localAgent.runtimeSourceRef,
    sourceRef,
    entity: null,
    relationshipClues: [],
    works: [],
    worksAvailability: 'unavailable',
    sourceState: 'local_agent_available',
    worldBannerUrl: null,
    characterProfile: {
      role: null,
      archetype: null,
      traits: [],
      knowledgeTopics: [],
      knowledgeConstraints: [],
      interactionModes: [],
      milestones: [],
      relationshipNotes: [],
      conversationAnchors: [],
      interaction: {
        tone: null,
        cadence: null,
        scenario: null,
        greeting: '你好，我是林。',
      },
    },
    worldCharacterAugmentation: null,
  } satisfies SourceDetailData;

  const targets = toAgentTargetsFromLocalAgentList(
    [localAgent],
    new Map([['world-1', 'World One']]),
    new Map([[localAgent.sourceKey, sourceDetail]]),
  );

  assert.equal(
    toAgentTargetSnapshotFromSummary(targets[0])?.greeting,
    '你好，我是林。',
  );
});

test('agent sidebar target metadata restores only Runtime inventory targets', () => {
  const [agentTarget] = toAgentTargetsFromLocalAgentList([{
    localAgentRef: 'local-agent:opaque-archivist-1',
    ownerUserId: 'owner-1',
    runtimeSourceRef: 'runtime-source-1',
    displayName: 'Runtime Archivist',
    sourceRef: worldSourceRef('source-1'),
    sourceKey: 'worldCharacter:world-1:source-1:hash-1',
  } satisfies LocalAgentListItem], new Map([['world-1', 'Runtime World']]));
  assert.ok(agentTarget);
  assert.equal(toAgentTargetSnapshotFromSummary(agentTarget)?.localAgentRef, 'local-agent:opaque-archivist-1');
  assert.equal(toAgentTargetSnapshotFromSummary({
    id: 'human-1',
    source: 'human',
    canonicalSessionId: 'human-1',
    title: 'Human',
  }), null);

  assert.equal(toAgentTargetSnapshotFromSummary({
    ...agentTarget,
    id: 'local-agent:different',
  }), null);
});
