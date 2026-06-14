import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  collapseRealmHumanChatsToTargets,
  resolveCanonicalRealmHumanChatId,
  type RealmChatViewDto,
} from '@nimiplatform/kit/features/chat/realm';
import {
  mergeHumanChatTargetsWithFriendTargets,
  toHumanFriendTargetsFromSocialSnapshot,
} from '../src/shell/renderer/features/chat/chat-sidebar-targets.js';

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
        isAgent: false,
      },
      {
        id: 'user-2',
        displayName: 'Bob',
        handle: 'bob',
        avatarUrl: 'https://example.test/bob.png',
        isAgent: false,
      },
      {
        id: 'agent-1',
        displayName: 'Companion',
        handle: 'companion',
        isAgent: true,
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

test('human target selection starts a Realm chat when the friend has no existing chat', () => {
  const source = readFileSync(
    new URL('../src/shell/renderer/features/chat/chat-human-adapter.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ loadChatList, startChatWithTarget \} from '\.\/data\/realm-human-chat-data';/);
  assert.match(source, /const existingChatId = resolveCanonicalRealmHumanChatId\(allChats, normalizedTargetId\);/);
  assert.match(source, /void startChatWithTarget\(normalizedTargetId, null\)/);
  assert.match(source, /setSelectedChatId\(chatId\);/);
  assert.match(source, /queryClient\.invalidateQueries\(\{ queryKey: \['chats'\] \}\)/);
});
