import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NimiRealmTransferredFile } from '@nimiplatform/sdk/realm';
import { createHumanChatSender } from '../src/shell/renderer/features/chat/human-chat-send.js';
import { createDesktopProductionOfflinePort } from '../src/shell/renderer/infra/offline/production-offline-port.js';
import { OfflineCoordinator } from '@nimiplatform/kit/core/offline-coordinator';
import type { PersistentOutboxEntry } from '../src/shell/renderer/infra/offline/types.js';

function fixture(send: (entry: PersistentOutboxEntry) => Promise<string>) {
  let current = true; let count = 0;
  const confirmed: string[] = [];
  const offline = createDesktopProductionOfflinePort(new OfflineCoordinator(), {
    enableEphemeralStore: true, readScope: () => current ? { realmEnvironmentId: 'realm', accountId: 'alice', generation: 0 } : null,
  });
  const ports = { offline: offline.capture(), peerAccountId: 'bob', chatId: 'chat', isCurrent: () => current,
    newId: () => `intent-${++count}`, now: () => 1,
    finalize: async () => ({ attachment: { targetType: 'RESOURCE', targetId: 'uploaded' } }),
    upload: async () => ({ attachment: { targetType: 'RESOURCE', targetId: 'uploaded' } }), send,
    confirmed: (entry: PersistentOutboxEntry) => { confirmed.push(entry.clientMessageId); }, changed() {} };
  return { sender: createHumanChatSender(ports), ports, offline, confirmed, retire() { current = false; } };
}

test('lost response restores the same send ID and only an explicit retry dispatches it', async () => {
  const committed = new Set<string>(); let lose = true; const attempts: string[] = [];
  const f = fixture(async entry => {
    attempts.push(entry.clientMessageId); committed.add(entry.clientMessageId);
    if (lose) { lose = false; throw new Error('response lost'); }
    return 'server-message';
  });
  await assert.rejects(() => f.sender.submit('hello', []), /response lost/);
  const restored = createHumanChatSender(f.ports);
  await restored.restore();
  assert.equal(attempts.length, 1);
  await restored.retry();
  assert.deepEqual(attempts, ['intent-1', 'intent-1']);
  assert.equal(committed.size, 1);
  assert.deepEqual(await f.offline.getChatOutboxEntries(), []);
});

test('an uncertain finalize resumes the transferred resource after restart without the original file or a second upload', async () => {
  const fixtureState = fixture(async entry => entry.clientMessageId);
  let uploads = 0;
  const transfer = { resourceId: 'uploaded', requestId: 'intent-1', resourceType: 'IMAGE' as const,
    hashSha256: 'a'.repeat(64), sizeBytes: 5, contentType: 'image/png' };
  const ports = { ...fixtureState.ports,
    upload: async (_attachment: unknown, transferred: (file: NimiRealmTransferredFile) => Promise<void>) => {
      uploads++; await transferred(transfer); throw new Error('finalize response lost');
    },
    finalize: async (saved: NimiRealmTransferredFile) => {
      assert.deepEqual(saved, transfer);
      return { attachment: { targetType: 'RESOURCE', targetId: saved.resourceId } };
    },
  };
  const sender = createHumanChatSender(ports);
  await assert.rejects(sender.submit('', [{ file: new File(['image'], 'one.png'), name: 'one.png' }]), /response lost/);
  const restored = createHumanChatSender(ports);
  await restored.restore();
  await restored.retry();
  assert.equal(uploads, 1);
  assert.deepEqual(fixtureState.confirmed, ['intent-1']);
});

test('partial attachments retry only remaining items and preserve the text intent', async () => {
  const attempts: string[] = []; let fail = true;
  const f = fixture(async entry => {
    attempts.push(entry.clientMessageId);
    if (entry.clientMessageId === 'intent-2' && fail) { fail = false; throw new Error('second failed'); }
    return entry.clientMessageId;
  });
  const attachments = ['one.png', 'two.png'].map(name => ({ name, file: new File(['image'], name, { type: 'image/png' }) }));
  await assert.rejects(() => f.sender.submit('caption', attachments), /second failed/);
  assert.deepEqual(f.confirmed, ['intent-1']);
  await f.sender.retry();
  assert.deepEqual(attempts, ['intent-1', 'intent-2', 'intent-2', 'intent-3']);
  assert.deepEqual(f.confirmed, ['intent-1', 'intent-2', 'intent-3']);
});

test('account retirement after upload never sends, confirms, or writes into a new account', async () => {
  const f = fixture(async () => assert.fail('retired account must not send'));
  const sender = createHumanChatSender({ ...f.ports, upload: async () => { f.retire(); return { attachment: {} }; } });
  await assert.rejects(() => sender.submit('', [{ name: 'a.png', file: new File(['a'], 'a.png') }]), /ACCOUNT_CHANGED/);
  assert.deepEqual(f.confirmed, []);
});

test('restored missing local file cannot become a successful send', async () => {
  const f = fixture(async () => assert.fail('an unuploaded attachment cannot send'));
  await f.offline.upsertChatOutboxEntry({ clientMessageId: 'image', peerAccountId: 'bob', chatId: 'chat', enqueuedAt: 1, attempts: 0, status: 'pending', body: { type: 'ATTACHMENT', uploadNeeded: true, attachmentName: 'gone.png' } });
  await f.sender.restore();
  await assert.rejects(() => f.sender.retry(), /RESELECT_REQUIRED/);
  await f.sender.discardUnuploaded('image');
  assert.deepEqual(f.sender.pending(), []);
});

test('double submit cannot create two intents while the first is being persisted', async () => {
  const f = fixture(async entry => entry.clientMessageId);
  const first = f.sender.submit('hello', []);
  await assert.rejects(() => f.sender.submit('hello', []), /PENDING_SEND_REQUIRES_RETRY/);
  await first;
  assert.deepEqual(f.confirmed, ['intent-1']);
});

test('stopping local retries neither sends again nor claims a remote recall', async () => {
  let sends = 0;
  const f = fixture(async () => { sends += 1; throw new Error('commit result unknown'); });
  await assert.rejects(() => f.sender.submit('maybe delivered', []));
  await f.sender.stopRetrying();
  assert.equal(sends, 1);
  assert.deepEqual(f.confirmed, []);
  assert.deepEqual(await f.offline.getChatOutboxEntries(), []);
});

test('a denied contact permits only confirmation retries, not queued items never dispatched', async () => {
  const attempts: string[] = []; let lose = true;
  const f = fixture(async entry => {
    attempts.push(entry.clientMessageId);
    if (lose) { lose = false; throw new Error('response lost'); }
    return entry.clientMessageId;
  });
  await assert.rejects(() => f.sender.submit('not dispatched yet', [{ name: 'one.png', file: new File(['image'], 'one.png') }]));
  await f.sender.retry(entry => entry.attempts > 0);
  assert.deepEqual(attempts, ['intent-1', 'intent-1']);
  assert.equal(f.sender.pending()[0]?.body.text, 'not dispatched yet');
  assert.equal(f.sender.pending()[0]?.attempts, 0);
});
