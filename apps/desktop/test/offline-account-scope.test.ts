import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { OfflineCoordinator } from '@nimiplatform/kit/core/offline-coordinator';
import { AccountReasonCode } from '@nimiplatform/kit/core/sdk-contract';
import { createDesktopProductionOfflinePort } from '../src/shell/renderer/infra/offline/production-offline-port.js';
import { deletedOfflineAccount } from '../src/shell/renderer/infra/offline/account-cleanup.js';
import { loadChatList } from '../src/shell/renderer/features/chat/data/realm-human-chat-data.js';
import { loadUserProfileById } from '../src/shell/renderer/features/social/data/profile-data.js';
import type { RealmSocialOfflinePort } from '../src/shell/renderer/features/social/data/social-offline-port.js';
import type { OfflineAccessScope } from '../src/shell/renderer/infra/offline/types.js';
import type { AppStoreState } from '../src/shell/renderer/app-shell/providers/store-types.js';

Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
const alice = { realmEnvironmentId: 'realm-a', accountId: 'alice', generation: 0 };
const bob = { ...alice, accountId: 'bob', generation: 1 };
const create = (readScope: () => OfflineAccessScope | null) => createDesktopProductionOfflinePort(new OfflineCoordinator(), { readScope });

test('persistent caches, viewer profiles, outbox and drafts reopen only for their account and Realm', async () => {
  let current: OfflineAccessScope | null = alice;
  const first = create(() => current);
  await first.syncChatList([{ id: 'same-chat', title: 'private A' }]);
  await first.syncChatMessages('same-chat', [{ id: 'same-message', text: 'private A', createdAt: '2026-01-01' }]);
  await first.syncProfileMetadata('user:peer', { id: 'peer', bio: 'viewer A only' });
  await first.saveHumanDraft({ peerAccountId: 'peer', text: 'A draft', attachmentNames: ['image.png'] });
  await first.upsertChatOutboxEntry({ clientMessageId: 'intent', chatId: 'same-chat', peerAccountId: 'peer', body: { text: 'A intent' }, enqueuedAt: 1, attempts: 1, status: 'pending' });
  first.dispose();
  const reopened = create(() => current);
  assert.equal((await reopened.getCachedChatList())[0]?.title, 'private A');
  assert.equal((await reopened.getCachedMessages('same-chat'))[0]?.text, 'private A');
  assert.equal((await reopened.loadHumanDraft('peer'))?.text, 'A draft');
  for (const other of [bob, { ...alice, realmEnvironmentId: 'realm-b', generation: 2 }]) {
    current = other;
    await assert.rejects(() => reopened.getCachedChatList(), /OFFLINE_CHAT_CACHE_UNAVAILABLE/);
    await assert.rejects(() => reopened.getCachedMessages('same-chat'), /OFFLINE_MESSAGE_CACHE_UNAVAILABLE/);
    assert.equal(await reopened.getCachedProfileMetadata('user:peer'), null);
    assert.equal(await reopened.loadHumanDraft('peer'), null);
    assert.deepEqual(await reopened.getChatOutboxEntries(), []);
  }
  current = { ...alice, generation: 3 };
  assert.equal((await reopened.getChatOutboxEntries())[0]?.clientMessageId, 'intent');
  assert.equal((await reopened.getCachedProfileMetadata('user:peer'))?.bio, 'viewer A only');
  reopened.dispose();
});

test('remote response after account switch cannot populate the new cache', async () => {
  let current: OfflineAccessScope | null = { ...alice, accountId: 'late-a' };
  const offline = create(() => current);
  let resolve!: (value: { items: object[] }) => void;
  const task = loadChatList({ listChats: () => new Promise(done => { resolve = done; }) } as never, undefined, 20, offline);
  current = { ...bob, accountId: 'late-b' };
  resolve({ items: [{ id: 'late-chat' }] });
  await assert.rejects(task, /OFFLINE_ACCOUNT_CHANGED/);
  await assert.rejects(() => offline.getCachedChatList(), /OFFLINE_CHAT_CACHE_UNAVAILABLE/);
  const captured = offline.capture();
  current = { ...current, generation: current.generation + 1 };
  assert.throws(() => captured.getChatOutboxEntries(), /OFFLINE_ACCOUNT_CHANGED/);
  offline.dispose();
});

test('unknown scope never opens the legacy database or returns a fallback', async () => {
  const offline = create(() => null);
  assert.throws(() => offline.capture(), /OFFLINE_ACCOUNT_SCOPE_REQUIRED/);
  assert.throws(() => offline.getCachedChatList(), /OFFLINE_ACCOUNT_SCOPE_REQUIRED/);
  const old = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('nimi-offline-cache', 3);
    request.onupgradeneeded = () => request.result.createObjectStore('chat-list', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = old.transaction('chat-list', 'readwrite'); tx.objectStore('chat-list').put({ id: 'unowned' });
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
  old.close();
  const scoped = create(() => ({ ...alice, accountId: 'new-owned' }));
  await assert.rejects(() => scoped.getCachedChatList(), /OFFLINE_CHAT_CACHE_UNAVAILABLE/);
  scoped.dispose(); offline.dispose();
});

test('correlated deletion removes only its scope; logout and another user never authorize cleanup', async () => {
  let current: OfflineAccessScope | null = { ...alice, accountId: 'delete-a' };
  const offline = create(() => current);
  const removed = current;
  await offline.saveHumanDraft({ peerAccountId: 'peer', text: 'delete me', attachmentNames: [] });
  await offline.upsertChatOutboxEntry({ clientMessageId: 'remove-intent', chatId: 'chat', body: {}, enqueuedAt: 0, attempts: 0, status: 'pending' });
  current = { ...bob, accountId: 'keep-b' };
  await offline.saveHumanDraft({ peerAccountId: 'peer', text: 'keep me', attachmentNames: [] });
  await offline.purgeAccount(removed);
  assert.equal((await offline.loadHumanDraft('peer'))?.text, 'keep me');
  offline.dispose();
  current = removed;
  const reopened = create(() => current);
  assert.equal(await reopened.loadHumanDraft('peer'), null);
  assert.deepEqual(await reopened.getChatOutboxEntries(), []);
  reopened.dispose();
  const previous: AppStoreState['auth'] = { status: 'authenticated', user: { id: 'alice', realmEnvironmentId: 'realm-a' }, accountReasonCode: 0, reasonCode: 0, sequence: '1', authorizationRevision: 'revision' };
  const terminal = { ...previous, status: 'reauth-required', user: null, deletedOwner: { accountId: 'alice', realmEnvironmentId: 'realm-a' }, accountReasonCode: AccountReasonCode.ACCOUNT_DELETED } as AppStoreState['auth'];
  assert.deepEqual(deletedOfflineAccount(previous, terminal), { accountId: 'alice', realmEnvironmentId: 'realm-a' });
  assert.equal(deletedOfflineAccount(previous, { ...terminal, accountReasonCode: 0 }), null);
  assert.equal(deletedOfflineAccount(previous, { ...terminal, user: { id: 'bob', realmEnvironmentId: 'realm-a' } }), null);
  assert.deepEqual(deletedOfflineAccount({ ...previous, status: 'bootstrapping', user: null }, terminal), terminal.deletedOwner);
  assert.equal(deletedOfflineAccount(previous, { ...terminal, deletedOwner: undefined }), null);
});

test('a confirmed empty list differs from no cache, and a new draft read waits for pending writes', async () => {
  const offline = create(() => ({ ...alice, accountId: 'empty' }));
  await assert.rejects(() => offline.getCachedChatList(), /CACHE_UNAVAILABLE/);
  await offline.syncChatList([]);
  assert.deepEqual(await offline.getCachedChatList(), []);
  const one = offline.saveHumanDraft({ peerAccountId: 'peer', text: 'first', attachmentNames: [] });
  const two = offline.saveHumanDraft({ peerAccountId: 'peer', text: 'latest', attachmentNames: [] });
  assert.equal((await offline.loadHumanDraft('peer'))?.text, 'latest');
  await Promise.all([one, two]); offline.dispose();
});

test('a known private/deleted profile is retired from its viewer cache before a later offline read', async () => {
  const offline = create(() => ({ ...alice, accountId: 'viewer' }));
  await offline.syncProfileMetadata('user:peer', { id: 'peer', bio: 'previously public' });
  await offline.syncProfileMetadata('user:other', { id: 'other', bio: 'still cached' });
  const social: RealmSocialOfflinePort = {
    capture() { return this; }, syncProfileMetadata: offline.syncProfileMetadata,
    loadProfileMetadata: offline.getCachedProfileMetadata, removeProfileMetadata: offline.removeProfileMetadata,
    markCacheFallbackUsed: offline.markCacheFallbackUsed, markRealmUnreachable: offline.markRealmUnreachable,
  };
  await assert.rejects(() => loadUserProfileById(async () => { throw Object.assign(new Error('private'), { status: 403 }); }, () => undefined, social, 'peer'), /private/);
  assert.equal(await offline.getCachedProfileMetadata('user:peer'), null);
  assert.equal((await offline.getCachedProfileMetadata('user:other'))?.bio, 'still cached');
  offline.dispose();
});
