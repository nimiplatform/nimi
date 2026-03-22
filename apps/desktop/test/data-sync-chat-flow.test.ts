import { describe, test } from 'node:test';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ReasonCode } from '@nimiplatform/sdk/types';
import {
  flushPendingChatOutbox,
  sameMessageIdentity,
  sendChatMessage,
  startChatWithTarget,
} from '../src/runtime/data-sync/flows/chat-flow.js';
import { createOfflineError, getOfflineCacheManager } from '../src/runtime/offline/index.js';

type MessageViewDto = RealmModel<'MessageViewDto'>;

const chatFlowSource = readFileSync(
  resolve(import.meta.dirname, '../src/runtime/data-sync/flows/chat-flow.ts'),
  'utf8',
);

describe('D-DSYNC-003: chat-flow source scanning', () => {
  test('D-DSYNC-003: sendChatMessage includes clientMessageId', () => {
    const fnStart = chatFlowSource.indexOf('export async function sendChatMessage');
    assert.ok(fnStart !== -1, 'sendChatMessage function not found in source');

    const fnBody = chatFlowSource.slice(fnStart, fnStart + 800);
    assert.ok(
      fnBody.includes('clientMessageId'),
      'sendChatMessage must include clientMessageId in its body',
    );
  });

  test('D-DSYNC-003: failed send queues to outbox with attempts tracking', async () => {
    const manager = await getOfflineCacheManager();
    manager.close();
    await manager.open();
    const result = await sendChatMessage(
      async () => {
        throw createOfflineError({
          source: 'realm',
          reasonCode: ReasonCode.REALM_UNAVAILABLE,
          message: 'realm offline',
          actionHint: 'retry',
        });
      },
      () => undefined,
      'chat-1',
      'hello',
      {},
    );
    const entries = await manager.getChatOutboxEntries('chat-1');
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.attempts, 1);
    assert.equal(entries[0]?.status, 'pending');
    assert.equal(String(result.clientMessageId || '').trim(), entries[0]?.clientMessageId);
    assert.deepEqual(entries[0]?.body.payload, { content: 'hello' });
  });

  test('D-DSYNC-003: sendChatMessage writes canonical TEXT payload', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    await sendChatMessage(
      async (task) => task({
        services: {
          HumanChatService: {
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
          },
        },
      } as never),
      () => undefined,
      'chat-1',
      'hello world',
      {},
    );

    assert.ok(capturedBody);
    assert.deepEqual((capturedBody as Record<string, unknown>).payload, { content: 'hello world' });
    assert.equal((capturedBody as Record<string, unknown>).text, 'hello world');
  });

  test('D-DSYNC-003: flushChatOutbox replays FIFO order by enqueuedAt', async () => {
    const manager = await getOfflineCacheManager();
    manager.close();
    await manager.open();
    await manager.upsertChatOutboxEntry({
      clientMessageId: 'later',
      chatId: 'chat-1',
      body: { clientMessageId: 'later', text: 'later', type: 'TEXT', payload: { content: 'later' } },
      enqueuedAt: 20,
      attempts: 0,
      status: 'pending',
    });
    await manager.upsertChatOutboxEntry({
      clientMessageId: 'earlier',
      chatId: 'chat-1',
      body: { clientMessageId: 'earlier', text: 'earlier', type: 'TEXT', payload: { content: 'earlier' } },
      enqueuedAt: 10,
      attempts: 0,
      status: 'pending',
    });
    const replayed: string[] = [];
    await flushPendingChatOutbox(
      async (task) => task({
        services: {
          HumanChatService: {
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
          },
        },
      } as never),
      () => undefined,
      'chat-1',
    );
    assert.deepEqual(replayed, ['earlier', 'later']);
  });

  test('D-DSYNC-003: startChatWithTarget writes canonical TEXT payload for initial message', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    await startChatWithTarget(
      async (task) => task({
        services: {
          HumanChatService: {
            startChat: async (body: Record<string, unknown>) => {
              capturedBody = body;
              return { chatId: 'chat-1' };
            },
            getChatById: async (chatId: string) => ({ id: chatId }),
          },
        },
      } as never),
      () => undefined,
      'user-2',
      'hi there',
    );

    assert.ok(capturedBody);
    assert.equal((capturedBody as Record<string, unknown>).type, 'TEXT');
    assert.equal((capturedBody as Record<string, unknown>).text, 'hi there');
    assert.deepEqual((capturedBody as Record<string, unknown>).payload, { content: 'hi there' });
  });
});

describe('D-DSYNC-003: sameMessageIdentity behavioral tests', () => {
  test('D-DSYNC-003: sameMessageIdentity matches by id', () => {
    const result = sameMessageIdentity(
      { id: '1', clientMessageId: '' } as unknown as MessageViewDto,
      { id: '1', clientMessageId: '' } as unknown as MessageViewDto,
    );
    assert.equal(result, true, 'Messages with the same id should be considered identical');
  });

  test('D-DSYNC-003: sameMessageIdentity matches by clientMessageId', () => {
    const result = sameMessageIdentity(
      { id: 'a', clientMessageId: 'cm_abc' } as unknown as MessageViewDto,
      { id: 'b', clientMessageId: 'cm_abc' } as unknown as MessageViewDto,
    );
    assert.equal(result, true, 'Messages with matching clientMessageId should be considered identical');
  });

  test('D-DSYNC-003: sameMessageIdentity rejects mismatched', () => {
    const result = sameMessageIdentity(
      { id: 'a', clientMessageId: 'cm_1' } as unknown as MessageViewDto,
      { id: 'b', clientMessageId: 'cm_2' } as unknown as MessageViewDto,
    );
    assert.equal(result, false, 'Messages with different ids and clientMessageIds should not match');
  });
});

describe('D-DSYNC-000: chat-flow defaults', () => {
  test('D-DSYNC-000: default chat page size is 20', () => {
    const fnStart = chatFlowSource.indexOf('export async function loadChatList');
    assert.ok(fnStart !== -1, 'loadChatList function not found in source');

    const fnSignature = chatFlowSource.slice(fnStart, fnStart + 300);
    assert.ok(
      fnSignature.includes('limit = 20'),
      'loadChatList must default its limit parameter to 20',
    );
  });
});
