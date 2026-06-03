import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collapseRealmHumanChatsToTargets,
  resolveCanonicalRealmHumanChatId,
  type RealmChatViewDto,
} from '@nimiplatform/kit/features/chat/realm';

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
