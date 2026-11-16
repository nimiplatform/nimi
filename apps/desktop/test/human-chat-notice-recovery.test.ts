import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import type { RealmChatViewDto } from '@nimiplatform/kit/features/chat/realm';
import { createHumanChatNoticeSync } from '../src/shell/renderer/features/realtime/human-chat-notice-sync.js';
import { createHumanChatNoticeTracker } from '../src/shell/renderer/features/realtime/human-chat-notices.js';

const row = (id: string, unreadCount: number) => ({ id: 'eric-chat', unreadCount,
  otherUser: { id: 'eric', displayName: 'Eric' },
  lastMessage: { id, senderId: 'eric', type: 'TEXT', isRead: unreadCount === 0, createdAt: `2026-11-16T02:0${unreadCount}:00Z` },
}) as RealmChatViewDto;

test('inbox ready retains recovery through an offline list and emits once after successful read', async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const chatKey = ['chats', 'local', 'halliday'];
  let page = { items: [row('old', 0)], fromCache: false };
  const notices: unknown[] = [];
  const observer = new QueryObserver(queryClient, { queryKey: chatKey, queryFn: async () => ({ pages: [page], pageParams: [null] }) });
  const unobserve = observer.subscribe(() => {});
  const sync = createHumanChatNoticeSync({ queryClient, chatKey, tracker: createHumanChatNoticeTracker(),
    loadChat: async () => assert.fail('List already contains the requested chat'),
    notify: async notice => { notices.push(notice); }, isCurrent: () => true });
  try {
    await sync.onInboxRefreshed({ kind: 'ready' });
    await queryClient.invalidateQueries({ queryKey: chatKey });
    assert.deepEqual(notices, []);
    page = { items: [row('old', 0)], fromCache: true };
    await sync.onInboxRefreshed({ kind: 'ready' });
    await queryClient.invalidateQueries({ queryKey: chatKey });
    assert.deepEqual(notices, []);
    page = { items: [row('recovered', 2)], fromCache: false };
    await queryClient.invalidateQueries({ queryKey: chatKey });
    assert.deepEqual(notices, [{ kind: 'summary' }]);
    await queryClient.invalidateQueries({ queryKey: chatKey });
    await sync.onInboxRefreshed({ kind: 'chat', chatId: 'eric-chat' });
    assert.equal(notices.length, 1);
    await sync.onInboxRefreshed({ kind: 'ready' });
    sync.dispose();
    page = { items: [row('after-logout', 3)], fromCache: false };
    await queryClient.invalidateQueries({ queryKey: chatKey });
    assert.equal(notices.length, 1);
  } finally { sync.dispose(); unobserve(); queryClient.clear(); }
});
