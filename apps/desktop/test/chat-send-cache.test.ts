import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient, type InfiniteData } from '@tanstack/react-query';
import type { RealmListChatsResultDto, RealmListMessagesResultDto, RealmMessageViewDto } from '@nimiplatform/kit/features/chat/realm';
import { mergeSentRealmChatMessageIntoCache } from '../src/shell/renderer/features/turns/chat-send-cache.js';

const message: RealmMessageViewDto = {
  id: 'message-new', chatId: 'chat-1', senderId: 'account-a', type: 'TEXT', text: 'Confirmed',
  payload: { content: 'Confirmed' }, createdAt: '2026-10-31T00:00:00.000Z', isRead: false,
};

test('confirmed sends preserve history pagination and update only the issuing account and Realm caches', () => {
  const queryClient = new QueryClient();
  const messages: InfiniteData<RealmListMessagesResultDto> = {
    pageParams: [null, 'older-cursor'],
    pages: [
      { items: [], nextBefore: 'older-cursor', nextAfter: null },
      { items: [{ ...message, id: 'message-old', text: 'Older', createdAt: '2026-10-30T00:00:00.000Z' }], nextBefore: null, nextAfter: null },
    ],
  };
  const chats: InfiniteData<RealmListChatsResultDto> = { pageParams: [null], pages: [{ items: [{
    id: 'chat-1', createdAt: message.createdAt, updatedAt: message.createdAt, unreadCount: 0, lastMessageAt: null,
    otherUser: { id: 'peer', handle: 'peer', displayName: 'Peer', createdAt: message.createdAt },
  }], nextCursor: null }] };
  for (const [realm, account] of [['realm-1', 'account-a'], ['realm-1', 'account-b'], ['realm-2', 'account-a']]) {
    queryClient.setQueryData(['messages', 'chat-1', realm, account], messages);
    queryClient.setQueryData(['chats', realm, account], chats);
  }
  mergeSentRealmChatMessageIntoCache({ queryClient, message, realmEnvironmentId: 'realm-1', currentUserId: 'account-a', selectedChatId: 'chat-1' });
  const updated = queryClient.getQueryData<InfiniteData<RealmListMessagesResultDto>>(['messages', 'chat-1', 'realm-1', 'account-a'])!;
  assert.equal(updated.pages[0]?.items[0]?.id, message.id);
  assert.deepEqual(updated.pages[1], messages.pages[1]);
  assert.deepEqual(updated.pageParams, messages.pageParams);
  assert.equal(queryClient.getQueryData<InfiniteData<RealmListChatsResultDto>>(['chats', 'realm-1', 'account-a'])?.pages[0]?.items[0]?.lastMessage?.id, message.id);
  for (const [realm, account] of [['realm-1', 'account-b'], ['realm-2', 'account-a']]) {
    assert.deepEqual(queryClient.getQueryData(['messages', 'chat-1', realm, account]), messages);
    assert.deepEqual(queryClient.getQueryData(['chats', realm, account]), chats);
  }
  queryClient.clear();
});

test('a late confirmed send does not invent a complete history page when its cache has been cleared', () => {
  const queryClient = new QueryClient();
  mergeSentRealmChatMessageIntoCache({ queryClient, message, realmEnvironmentId: 'realm-1', currentUserId: 'account-a', selectedChatId: 'chat-1' });
  assert.equal(queryClient.getQueryData(['messages', 'chat-1', 'realm-1', 'account-a']), undefined);
  queryClient.clear();
});
