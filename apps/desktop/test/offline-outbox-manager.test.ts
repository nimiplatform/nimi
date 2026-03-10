import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { OfflineCacheManager } from '../src/runtime/offline/cache-manager.js';

describe('D-OFFLINE-002: outbox queue/send/fail behavior', () => {
  test('queueOutboxEntry rejects when outbox full', async () => {
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

  test('outbox entries stay FIFO by enqueuedAt', async () => {
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

  test('markChatOutboxSent deletes the delivered entry', async () => {
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

  test('markChatOutboxFailed preserves the failed reason without retrying', async () => {
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

describe('D-OFFLINE-005: memory cache behavior', () => {
  test('chat list cache keeps the latest configured 20 records', async () => {
    const manager = new OfflineCacheManager();
    await manager.open();
    await manager.syncChatList(
      Array.from({ length: 25 }, (_, index) => ({
        id: `chat-${index}`,
        title: `Chat ${index}`,
      })),
    );

    const cached = await manager.getCachedChatList();
    assert.equal(cached.length, 20);
    assert.deepEqual(
      cached.map((item) => item.id),
      Array.from({ length: 20 }, (_, index) => `chat-${index}`),
    );
  });

  test('message cache keeps the latest configured 50 records per chat', async () => {
    const manager = new OfflineCacheManager();
    await manager.open();
    await manager.syncChatMessages(
      'chat-1',
      Array.from({ length: 60 }, (_, index) => ({
        id: `msg-${index}`,
        createdAt: new Date(index * 1000).toISOString(),
      })),
    );

    const cached = await manager.getCachedMessages('chat-1');
    assert.equal(cached.length, 50);
    assert.equal(cached[0]?.id, 'msg-0');
    assert.equal(cached[cached.length - 1]?.id, 'msg-49');
  });

  test('agent, world, and model metadata survive memory fallback round-trips', async () => {
    const manager = new OfflineCacheManager();
    await manager.open();

    await manager.syncAgentMetadata('agent:alice', {
      id: 'agent:alice',
      name: 'Alice',
    });
    await manager.syncWorldList([
      { id: 'world-1', title: 'World One' },
      { id: 'world-2', title: 'World Two' },
    ]);
    await manager.syncWorldMetadata('world:main', {
      id: 'world:main',
      slug: 'main',
    });
    await manager.syncModelManifests([
      { id: 'model-1', capability: 'text' },
      { id: 'model-2', capability: 'speech' },
    ]);

    assert.deepEqual(await manager.getCachedAgentMetadata('agent:alice'), {
      id: 'agent:alice',
      name: 'Alice',
    });
    assert.deepEqual(await manager.getCachedWorldList(), [
      { id: 'world-1', title: 'World One' },
      { id: 'world-2', title: 'World Two' },
    ]);
    assert.deepEqual(await manager.getCachedWorldMetadata('world:main'), {
      id: 'world:main',
      slug: 'main',
    });
    assert.deepEqual(await manager.getCachedModelManifests(), [
      { id: 'model-1', capability: 'text' },
      { id: 'model-2', capability: 'speech' },
    ]);
  });
});
