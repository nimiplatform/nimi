import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createOfflineNimiError as createOfflineError,
  ReasonCode,
} from '@nimiplatform/sdk/types';
import {
  flushPendingChatOutbox,
  loadChatList,
  loadMoreChatMessages,
  sendChatMessage,
  startChatWithTarget,
} from '../src/shell/renderer/features/chat/data/realm-human-chat-data.js';
import { OfflineCoordinator } from '@nimiplatform/kit/core/offline-coordinator';
import { createDesktopProductionOfflinePort } from '../src/shell/renderer/infra/offline/production-offline-port.js';

function createTestOfflinePort() {
  return createDesktopProductionOfflinePort(
    new OfflineCoordinator(),
    { enableEphemeralStore: true },
  );
}

describe('desktop human chat behavior', () => {
  test('failed send remains explicit retry and does not enter a durable outbox', async () => {
    const offline = createTestOfflinePort();
    await assert.rejects(() => sendChatMessage('chat-1', 'hello', {}, {
      sendMessage: async () => {
        throw createOfflineError({
          source: 'realm',
          reasonCode: ReasonCode.REALM_UNAVAILABLE,
          message: 'realm offline',
          actionHint: 'retry',
        });
      },
    } as never, undefined, offline), { reasonCode: ReasonCode.REALM_UNAVAILABLE });
    assert.deepEqual(await offline.getChatOutboxEntries('chat-1'), []);
  });

  test('sendChatMessage writes canonical TEXT payload', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const offline = createTestOfflinePort();
    await sendChatMessage('chat-1', 'hello world', {}, {
      sendMessage: async (_chatId: string, body: Record<string, unknown>) => {
        capturedBody = body;
        return {
          id: 'server:1',
          chatId: 'chat-1',
          clientMessageId: String(body.clientMessageId || ''),
          senderId: 'user-1',
          createdAt: new Date().toISOString(),
          isRead: true,
          text: String(body.text || ''),
          type: 'TEXT',
          payload: body.payload as Record<string, unknown>,
        };
      },
    } as never, undefined, offline);

    assert.ok(capturedBody);
    assert.deepEqual((capturedBody as Record<string, unknown>).payload, { content: 'hello world' });
    assert.equal((capturedBody as Record<string, unknown>).text, 'hello world');
  });

  test('flushChatOutbox replays FIFO order by enqueuedAt', async () => {
    const offline = createTestOfflinePort();
    await offline.upsertChatOutboxEntry({
      clientMessageId: 'later',
      chatId: 'chat-1',
      body: { clientMessageId: 'later', text: 'later', type: 'TEXT', payload: { content: 'later' } },
      enqueuedAt: 20,
      attempts: 0,
      status: 'pending',
    });
    await offline.upsertChatOutboxEntry({
      clientMessageId: 'earlier',
      chatId: 'chat-1',
      body: { clientMessageId: 'earlier', text: 'earlier', type: 'TEXT', payload: { content: 'earlier' } },
      enqueuedAt: 10,
      attempts: 0,
      status: 'pending',
    });
    const replayed: string[] = [];
    await flushPendingChatOutbox('chat-1', {
      sendMessage: async (_chatId: string, body: Record<string, unknown>) => {
        replayed.push(String(body.clientMessageId || ''));
        return {
          id: `server:${String(body.clientMessageId || '')}`,
          chatId: 'chat-1',
          clientMessageId: String(body.clientMessageId || ''),
          senderId: 'user-1',
          createdAt: new Date().toISOString(),
          isRead: true,
          text: String(body.text || ''),
          type: 'TEXT',
          payload: body.payload as Record<string, unknown>,
        };
      },
    } as never, undefined, offline);
    assert.deepEqual(replayed, ['earlier', 'later']);
  });

  test('flushChatOutbox fails closed for malformed persistent message bodies', async () => {
    const offline = createTestOfflinePort();
    await offline.upsertChatOutboxEntry({
      clientMessageId: 'malformed',
      chatId: 'chat-1',
      body: { clientMessageId: 'malformed', payload: { content: 'missing type' } },
      enqueuedAt: 10,
      attempts: 0,
      status: 'pending',
    });

    await assert.rejects(
      () => flushPendingChatOutbox('chat-1', {
        sendMessage: async () => {
          throw new Error('service should not receive malformed persistent outbox body');
        },
      } as never, undefined, offline),
      /Persistent chat outbox body\.type must be a non-empty string/,
    );
  });

  test('startChatWithTarget writes canonical TEXT payload for initial message', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    await startChatWithTarget('user-2', 'hi there', {
      startChat: async (body: Record<string, unknown>) => {
        capturedBody = body;
        return { chatId: 'chat-1' };
      },
      getChatById: async (chatId: string) => ({ id: chatId }),
    } as never);

    assert.ok(capturedBody);
    assert.equal((capturedBody as Record<string, unknown>).type, 'TEXT');
    assert.equal((capturedBody as Record<string, unknown>).text, 'hi there');
    assert.deepEqual((capturedBody as Record<string, unknown>).payload, { content: 'hi there' });
  });
});

describe('desktop human chat filtering', () => {
  test('loadChatList fails closed for missing, malformed, or source chat rows', async () => {
    const offline = createTestOfflinePort();
    const result = await loadChatList({
      listChats: async () => ({
        items: [
          { id: 'human-1', otherUser: { id: 'user-1', isSource: false } },
          { id: 'missing-other-user' },
          { id: 'malformed-other-user', otherUser: 'user-2' },
          {
            id: 'source-ref-chat',
            sourceRef: {
              kind: 'personaCharacter',
              id: 'persona-1',
              worldId: 'oasis',
              ownerAccountId: 'account-1',
              sourceHash: 'a'.repeat(64),
            },
            otherUser: { id: 'persona-1' },
          },
          {
            id: 'runtime-source-chat',
            runtimeSourceRef: 'runtime-source:personaCharacter:oasis:persona-2',
            otherUser: { id: 'persona-2' },
          },
          { id: 'human-2', otherUser: { id: 'user-3' } },
        ],
      }),
    } as never, undefined, 20, offline);

    assert.deepEqual(
      (result.items as Array<{ id: string }>).map((item) => item.id),
      ['human-1', 'human-2'],
    );
  });
});

describe('desktop human chat pagination', () => {
  test('loadMoreChatMessages defaults to page size 20', async () => {
    let capturedLimit: number | undefined;
    await loadMoreChatMessages('chat-1', 'cursor-1', undefined, {
      listMessages: async (_chatId: string, limit: number) => {
        capturedLimit = limit;
        return { items: [], hasMore: false };
      },
    } as never);

    assert.equal(capturedLimit, 20);
  });

  test('loadMoreChatMessages allows override and caps at 100', async () => {
    const capturedLimits: number[] = [];
    const service = {
      listMessages: async (_chatId: string, limit: number) => {
        capturedLimits.push(limit);
        return { items: [], hasMore: false };
      },
    };

    await loadMoreChatMessages('chat-1', 'cursor-1', 35, service as never);
    await loadMoreChatMessages('chat-1', 'cursor-2', 250, service as never);
    await loadMoreChatMessages('chat-1', 'cursor-3', 0, service as never);

    assert.deepEqual(capturedLimits, [35, 100, 20]);
  });
});

describe('desktop human chat shared Kit identity ownership', () => {
});

describe('desktop human chat defaults', () => {
});
