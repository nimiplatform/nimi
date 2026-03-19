import { describe, test } from 'node:test';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import assert from 'node:assert/strict';

type ChatViewDto = RealmModel<'ChatViewDto'>;
type MessageViewDto = RealmModel<'MessageViewDto'>;

import {
  applyRealtimeMessageUpdateToChatsResult,
  applyRealtimeMessageUpdateToMessagesResult,
  mergeRealtimeMessageIntoMessagesResult,
} from '../src/shell/renderer/features/realtime/chat-realtime-cache.js';

function createMessage(input: Partial<MessageViewDto> & { id: string; chatId: string; createdAt: string }): MessageViewDto {
  return {
    id: input.id,
    chatId: input.chatId,
    senderId: input.senderId || 'user-1',
    type: input.type || 'TEXT',
    text: input.text ?? null,
    payload: input.payload ?? null,
    isRead: input.isRead ?? true,
    createdAt: input.createdAt,
    clientMessageId: input.clientMessageId,
  };
}

describe('D-OFFLINE-004: conflict handling uses the latest server timestamp', () => {
  test('mergeRealtimeMessageIntoMessagesResult keeps the newer version for the same message identity', () => {
    const newer = createMessage({
      id: 'msg-1',
      chatId: 'chat-1',
      clientMessageId: 'cm-1',
      createdAt: '2026-03-10T10:00:00.000Z',
      text: 'new state',
    });
    const older = createMessage({
      id: 'msg-1',
      chatId: 'chat-1',
      clientMessageId: 'cm-1',
      createdAt: '2026-03-10T09:59:00.000Z',
      text: 'stale replay',
    });

    const result = mergeRealtimeMessageIntoMessagesResult({
      items: [newer],
      nextBefore: null,
      nextAfter: null,
    }, older);

    assert.equal(result.items[0]?.text, 'new state');
    assert.equal(result.items[0]?.createdAt, '2026-03-10T10:00:00.000Z');
  });

  test('applyRealtimeMessageUpdateToMessagesResult ignores stale updates for the same message identity', () => {
    const current = createMessage({
      id: 'msg-1',
      chatId: 'chat-1',
      clientMessageId: 'cm-1',
      createdAt: '2026-03-10T10:00:00.000Z',
      text: 'fresh',
      isRead: true,
    });
    const stale = createMessage({
      id: 'msg-1',
      chatId: 'chat-1',
      clientMessageId: 'cm-1',
      createdAt: '2026-03-10T09:58:00.000Z',
      text: 'stale',
      isRead: false,
    });

    const result = applyRealtimeMessageUpdateToMessagesResult({
      items: [current],
      nextBefore: null,
      nextAfter: null,
    }, stale);

    assert.equal(result?.items[0]?.text, 'fresh');
    assert.equal(result?.items[0]?.isRead, true);
  });

  test('applyRealtimeMessageUpdateToChatsResult ignores stale last-message replays', () => {
    const currentMessage = createMessage({
      id: 'msg-1',
      chatId: 'chat-1',
      createdAt: '2026-03-10T10:00:00.000Z',
      text: 'fresh preview',
    });
    const staleMessage = createMessage({
      id: 'msg-1',
      chatId: 'chat-1',
      createdAt: '2026-03-10T09:58:00.000Z',
      text: 'stale preview',
    });
    const currentChat = {
      id: 'chat-1',
      lastMessage: currentMessage,
      lastMessageAt: currentMessage.createdAt,
      unreadCount: 0,
    } as ChatViewDto;

    const result = applyRealtimeMessageUpdateToChatsResult({
      current: {
        items: [currentChat],
        nextCursor: null,
      } as unknown as { items: ChatViewDto[] },
      chatId: 'chat-1',
      message: staleMessage,
    });

    assert.equal(result.data?.items[0]?.lastMessage?.text, 'fresh preview');
    assert.equal(result.data?.items[0]?.lastMessage?.createdAt, '2026-03-10T10:00:00.000Z');
  });
});
