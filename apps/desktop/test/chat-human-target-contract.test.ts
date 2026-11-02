import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collapseRealmHumanChatsToTargets,
  compareRealmHumanChatsByRecency,
  resolveCanonicalRealmHumanChatId,
  type RealmChatViewDto,
} from '@nimiplatform/kit/features/chat/realm';
import {
  chatSidebarQueryAuthStatus,
  mergeHumanChatTargetsWithFriendTargets,
  toAgentReferenceTargetSummary,
  toRecentAgentTargets,
  toAgentTargetSnapshotFromSummary,
  toHumanFriendTargetsFromSocialSnapshot,
  visibleChatRailTargets,
} from '../src/shell/renderer/features/chat/chat-sidebar-targets.js';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import type { NimiAppActivityRecord, NimiLocalAppAgentReference } from '@nimiplatform/sdk/app';

const SOURCE_HASH = 'a'.repeat(64);
const AGENT_HANDLE = `agent_ref_${'A'.repeat(43)}`;

test('scrollable rails preserve chronological membership after unread attention clears', () => {
  const people = Array.from({ length: 12 }, (_, index) => ({
    id: `user-${index}`, title: `Person ${index}`, source: 'human' as const, canonicalSessionId: `chat-${index}`, unreadCount: 1,
  }));
  const agents = people.map(person => ({ ...person, source: 'agent' as const }));
  const targets = [...people, ...agents];
  assert.deepEqual(visibleChatRailTargets(targets, true), people);
  assert.deepEqual(visibleChatRailTargets(targets, false), agents);
  const readTargets = targets.map(target => ({ ...target, unreadCount: 0 }));
  for (const side of [true, false]) assert.deepEqual(visibleChatRailTargets(readTargets, side).map(t => t.id), visibleChatRailTargets(targets, side).map(t => t.id));
});

test('companion recency uses message occurrence, never unread status or the time of a read update', () => {
  const reference = (id: string, name: string) => ({ agentHandle: id, agentBinding: `binding-${id}`, activityAgentRef: `activity-${id}`, displayName: name, avatarUrl: null }) as NimiLocalAppAgentReference;
  const references = [reference('older', 'A'), reference('newer', 'Z'), reference('unchatted', 'B')];
  const reply = (id: string, occurredAt: string, unread: boolean) => ({
    key: `turn:${id}:${occurredAt}`, source: { kind: 'runtime-agent' }, type: 'nimi.runtime.agent-conversation.turn-completed.v1',
    agent: { agentRef: `activity-${id}` }, occurredAt, updatedAt: '2026-11-02T20:00:00Z', userView: { unread },
  }) as NimiAppActivityRecord;
  const records = [reply('older', '2026-11-01T10:00:00Z', true), reply('newer', '2026-11-02T10:00:00Z', false)];
  const before = toRecentAgentTargets(references, records);
  assert.deepEqual(before.map(target => target.id), ['newer', 'older', 'unchatted']);
  assert.equal(before[1]?.unreadCount, 1);
  const after = toRecentAgentTargets(references, records.map(record => ({ ...record, userView: { ...record.userView, unread: false } })));
  assert.deepEqual(after.map(target => target.id), before.map(target => target.id));
  assert.equal(after[1]?.unreadCount, 0);
  const appNotice = { ...reply('unchatted', '2026-11-03T10:00:00Z', true), source: { kind: 'app' } } as NimiAppActivityRecord;
  assert.deepEqual(toRecentAgentTargets(references, [...records, appNotice]).map(target => target.id), before.map(target => target.id));
  assert.deepEqual(toRecentAgentTargets(references, [...records, reply('older', '2026-11-03T10:00:00Z', false)]).map(target => target.id), ['older', 'newer', 'unchatted']);
});

test('human recency ignores acknowledgement updates and changes only for a newer message', () => {
  const chats = [
    { id: 'old', createdAt: '2026-10-01T00:00:00Z', lastMessageAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-03T00:00:00Z', unreadCount: 8 },
    { id: 'recent', createdAt: '2026-10-01T00:00:00Z', lastMessageAt: '2026-11-02T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z', unreadCount: 0 },
  ] as RealmChatViewDto[];
  assert.deepEqual([...chats].sort(compareRealmHumanChatsByRecency).map(chat => chat.id), ['recent', 'old']);
  const read = chats.map(chat => ({ ...chat, unreadCount: 0, updatedAt: '2026-11-04T00:00:00Z' }));
  assert.deepEqual(read.sort(compareRealmHumanChatsByRecency).map(chat => chat.id), ['recent', 'old']);
  const received = chats.map(chat => chat.id === 'old' ? { ...chat, lastMessageAt: '2026-11-05T00:00:00Z' } : chat);
  assert.deepEqual(received.sort(compareRealmHumanChatsByRecency).map(chat => chat.id), ['old', 'recent']);
});

test('normal account refresh retains the same Agent reference cache without issuing pending reads', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  let reads = 0;
  const references = [{ agentHandle: AGENT_HANDLE, displayName: '杜佑' }];
  const options = (status: Parameters<typeof chatSidebarQueryAuthStatus>[0], owner: string) => ({
    queryKey: ['desktop-local-app-agent-references', chatSidebarQueryAuthStatus(status, owner), owner],
    queryFn: async () => { reads++; return references; },
    enabled: status === 'authenticated' && Boolean(owner),
  });
  const observer = new QueryObserver(client, options('authenticated', 'account-one'));
  const unsubscribe = observer.subscribe(() => undefined);
  try {
    await observer.refetch();
    assert.equal(reads, 1);
    observer.setOptions(options('refresh-pending', 'account-one'));
    assert.deepEqual(observer.getCurrentResult().data, references);
    assert.equal(reads, 1);
    observer.setOptions(options('refresh-pending', 'account-two'));
    assert.equal(observer.getCurrentResult().data, undefined, 'another account cannot inherit the displayed partner');
    observer.setOptions(options('refresh-pending', ''));
    assert.equal(observer.getCurrentResult().data, undefined, 'initial pending without identity has no retained projection');
    assert.equal(chatSidebarQueryAuthStatus('refresh-pending', ''), 'refresh-pending');
    assert.equal(reads, 1);
    observer.setOptions(options('authenticated', 'account-one'));
    assert.deepEqual(observer.getCurrentResult().data, references);
    assert.equal(reads, 1);
  } finally {
    unsubscribe();
    client.clear();
  }
});

function worldSourceRef(id: string, worldId = 'world-1') {
  return {
    kind: 'worldCharacter' as const,
    id,
    worldId,
    worldEntityRef: { kind: 'worldEntity' as const, worldId, entityId: `entity-${id}` },
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
      otherUser: { id: 'user-1', displayName: 'Alice', handle: 'alice' },
    },
    {
      id: 'chat-newer',
      createdAt: '2026-04-02T00:00:00.000Z',
      updatedAt: '2026-04-02T00:00:00.000Z',
      lastMessageAt: '2026-04-02T00:00:00.000Z',
      lastMessage: null,
      unreadCount: 1,
      otherUser: { id: 'user-1', displayName: 'Alice', handle: 'alice' },
    },
    {
      id: 'chat-bob',
      createdAt: '2026-04-03T00:00:00.000Z',
      updatedAt: '2026-04-03T00:00:00.000Z',
      lastMessageAt: '2026-04-03T00:00:00.000Z',
      lastMessage: null,
      unreadCount: 0,
      otherUser: { id: 'user-2', displayName: 'Bob', handle: 'bob' },
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
      { id: 'user-1', displayName: 'Alice', handle: 'alice' },
      { id: 'user-2', displayName: 'Bob', handle: 'bob', avatarUrl: 'https://example.test/bob.png' },
      { id: 'agent-1', displayName: 'Companion', handle: 'companion', isSource: true },
      {
        id: 'local-agent:runtime-owned-1',
        displayName: 'Runtime-owned companion',
        localAgentRef: 'local-agent:runtime-owned-1',
        runtimeSourceRef: 'runtime-source:worldCharacter:world-1:source-1',
        isSource: false,
      },
      { id: 'source-1', displayName: 'Character source', sourceRef: worldSourceRef('source-1'), isSource: false },
    ],
  });

  assert.deepEqual(friendTargets.map((target) => target.id), ['user-1', 'user-2']);
  const merged = mergeHumanChatTargetsWithFriendTargets([{
    id: 'user-1', source: 'human', canonicalSessionId: 'chat-newer', title: 'Alice',
    previewText: 'latest chat', updatedAt: '2026-04-02T00:00:00.000Z', unreadCount: 1, status: 'active',
  }], friendTargets);
  assert.deepEqual(merged.map((target) => [target.id, target.canonicalSessionId]), [
    ['user-1', 'chat-newer'],
    ['user-2', ''],
  ]);
  const existingFriend = merged[0];
  assert.ok(existingFriend);
  assert.equal(existingFriend.metadata?.isFriend, true);
  assert.equal(existingFriend.previewText, 'latest chat');
});

test('sidebar neutral previews are derived from the current friend set and preserve the conversation identity', () => {
  const chat = { id: 'user-1', source: 'human' as const, canonicalSessionId: 'chat-1', title: 'Visitor',
    previewText: 'sensitive body', bio: 'profile text', unreadCount: 2, metadata: { otherUserId: 'user-1', isFriend: true } };
  const [stranger] = mergeHumanChatTargetsWithFriendTargets([chat], []);
  assert.ok(stranger);
  assert.equal(stranger.id, 'user-1');
  assert.equal(stranger.canonicalSessionId, 'chat-1');
  assert.equal(stranger.unreadCount, 2);
  assert.equal(stranger.metadata?.isFriend, false, 'an old target flag must not override the current friend list');
  assert.equal(stranger.previewText, null);
  assert.equal(stranger.bio, null);
});

test('agent sidebar target is built only from the canonical reference projection', () => {
  const reference: NimiLocalAppAgentReference = {
    agentHandle: AGENT_HANDLE as NimiLocalAppAgentReference['agentHandle'],
    activityAgentRef: 'agr_test', agentBinding: AGENT_HANDLE.replace('agent_ref_', 'agent_binding_'),
    displayName: 'Runtime Archivist',
    avatarUrl: 'https://cdn.example.test/agent.png',
  };
  const target = toAgentReferenceTargetSummary(reference);
  assert.equal(target.id, AGENT_HANDLE);
  assert.equal(target.canonicalSessionId, AGENT_HANDLE);
  assert.deepEqual(target.metadata, {
    agentHandle: AGENT_HANDLE,
    activityAgentRef: reference.activityAgentRef,
    agentBinding: reference.agentBinding,
    displayName: 'Runtime Archivist',
    avatarUrl: 'https://cdn.example.test/agent.png',
  });
  assert.equal(toAgentTargetSnapshotFromSummary(target), null);

  const opened = toAgentTargetSnapshotFromSummary({
    ...target,
    canonicalSessionId: 'anchor-1',
    metadata: { ...target.metadata, conversationAnchorId: 'anchor-1' },
  });
  assert.deepEqual(opened, {
    agentHandle: AGENT_HANDLE,
    agentBinding: reference.agentBinding,
    conversationAnchorId: 'anchor-1',
    displayName: 'Runtime Archivist',
    handle: '',
    avatarUrl: 'https://cdn.example.test/agent.png',
    worldId: null,
    worldName: null,
    bio: null,
    ownershipType: null,
    greeting: null,
    builtinDocsContext: null,
  });
});
