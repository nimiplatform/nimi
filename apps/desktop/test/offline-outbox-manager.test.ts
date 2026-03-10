import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OfflineCacheManager } from '../src/runtime/offline/cache-manager.js';

const CACHE_MANAGER_PATH = resolve(import.meta.dirname, '../src/runtime/offline/cache-manager.ts');
const cacheManagerSource = readFileSync(CACHE_MANAGER_PATH, 'utf-8');

const TYPES_PATH = resolve(import.meta.dirname, '../src/runtime/offline/types.ts');
const typesSource = readFileSync(TYPES_PATH, 'utf-8');

describe('D-OFFLINE-002: outbox persistent entry', () => {
  test('D-OFFLINE-002: PersistentOutboxEntry includes enqueuedAt timestamp', () => {
    assert.match(
      typesSource,
      /export type PersistentOutboxEntry\s*=\s*\{[^}]*enqueuedAt:\s*number/s,
      'PersistentOutboxEntry must declare enqueuedAt: number',
    );
  });

  test('D-OFFLINE-002: outbox max entries is 1000', () => {
    assert.match(
      typesSource,
      /OUTBOX_MAX_ENTRIES\s*=\s*1000/,
      'OUTBOX_MAX_ENTRIES must equal 1000',
    );
  });
});

describe('D-OFFLINE-002: outbox queue/send/fail', () => {
  test('D-OFFLINE-002: queueOutboxEntry rejects when outbox full', async () => {
    const manager = new OfflineCacheManager();
    await manager.open();
    for (let index = 0; index < 1000; index += 1) {
      await manager.upsertChatOutboxEntry({
        clientMessageId: `cm-${index}`,
        chatId: 'chat-1',
        body: { text: `m-${index}` },
        enqueuedAt: index,
        attempts: 0,
        status: 'pending',
      });
    }
    await assert.rejects(
      () => manager.upsertChatOutboxEntry({
        clientMessageId: 'cm-overflow',
        chatId: 'chat-1',
        body: { text: 'overflow' },
        enqueuedAt: 1001,
        attempts: 0,
        status: 'pending',
      }),
      /Outbox full/,
    );
  });

  test('D-OFFLINE-002: outbox entries sorted FIFO by enqueuedAt', async () => {
    const manager = new OfflineCacheManager();
    await manager.open();
    await manager.upsertChatOutboxEntry({
      clientMessageId: 'later',
      chatId: 'chat-1',
      body: {},
      enqueuedAt: 20,
      attempts: 0,
      status: 'pending',
    });
    await manager.upsertChatOutboxEntry({
      clientMessageId: 'earlier',
      chatId: 'chat-1',
      body: {},
      enqueuedAt: 10,
      attempts: 0,
      status: 'pending',
    });
    const entries = await manager.getChatOutboxEntries('chat-1');
    assert.deepEqual(entries.map((entry) => entry.clientMessageId), ['earlier', 'later']);
  });

  test('D-OFFLINE-002: markOutboxSent deletes entry by clientMessageId', async () => {
    const manager = new OfflineCacheManager();
    await manager.open();
    await manager.upsertChatOutboxEntry({
      clientMessageId: 'cm-1',
      chatId: 'chat-1',
      body: {},
      enqueuedAt: 1,
      attempts: 0,
      status: 'pending',
    });
    await manager.markChatOutboxSent('cm-1');
    assert.equal(await manager.getChatOutboxEntry('cm-1'), undefined);
  });

  test('D-OFFLINE-002: markOutboxFailed sets status to failed with reason', async () => {
    const manager = new OfflineCacheManager();
    await manager.open();
    await manager.upsertChatOutboxEntry({
      clientMessageId: 'cm-2',
      chatId: 'chat-1',
      body: {},
      enqueuedAt: 1,
      attempts: 2,
      status: 'pending',
    });
    await manager.markChatOutboxFailed('cm-2', 'boom');
    const entry = await manager.getChatOutboxEntry('cm-2');
    assert.equal(entry?.status, 'failed');
    assert.equal(entry?.failReason, 'boom');
  });
});

describe('D-OFFLINE-005: cache limits', () => {
  test('D-OFFLINE-005: cache max chats is 20', () => {
    assert.match(
      typesSource,
      /CACHE_MAX_CHATS\s*=\s*20/,
      'CACHE_MAX_CHATS must equal 20',
    );
  });

  test('D-OFFLINE-005: cache max messages per chat is 50', () => {
    assert.match(
      typesSource,
      /CACHE_MAX_MESSAGES_PER_CHAT\s*=\s*50/,
      'CACHE_MAX_MESSAGES_PER_CHAT must equal 50',
    );
  });

  test('D-OFFLINE-005: IndexedDB database name is nimi-offline-cache', () => {
    assert.match(
      cacheManagerSource,
      /DB_NAME\s*=\s*'nimi-offline-cache'/,
      'DB_NAME must be nimi-offline-cache',
    );
  });
});
