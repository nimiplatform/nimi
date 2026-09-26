import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collapseRealmHumanChatsToTargets,
  resolveCanonicalRealmHumanChatId,
  type RealmChatViewDto,
} from '@nimiplatform/kit/features/chat/realm';
import {
  chatSidebarQueryAuthStatus,
  mergeHumanChatTargetsWithFriendTargets,
  toAgentReferenceTargetSummary,
  toAgentTargetSnapshotFromSummary,
  toHumanFriendTargetsFromSocialSnapshot,
} from '../src/shell/renderer/features/chat/chat-sidebar-targets.js';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import type { NimiLocalAppAgentReference } from '@nimiplatform/sdk/app';

const SOURCE_HASH = 'a'.repeat(64);
const AGENT_HANDLE = `agent_ref_${'A'.repeat(43)}`;

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
    ['user-2', 'user-2'],
  ]);
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
