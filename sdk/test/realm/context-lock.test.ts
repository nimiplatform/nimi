import assert from 'node:assert/strict';
import test from 'node:test';

import { Realm } from '../../src/realm/client.js';
import { withRealmContextLock } from '../../src/realm/context-lock.js';

test('withRealmContextLock serializes concurrent calls', async () => {
  const originalConnect = Realm.prototype.connect;
  const originalClose = Realm.prototype.close;
  const order: number[] = [];

  Realm.prototype.connect = async function patchedConnect() { /* noop */ };
  Realm.prototype.close = async function patchedClose() { /* noop */ };

  try {
    const input = { realmBaseUrl: 'https://lock-test.nimi.xyz', accessToken: 'test-token' };

    const p1 = withRealmContextLock(input, async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 50));
      order.push(2);
      return 'first';
    });

    const p2 = withRealmContextLock(input, async () => {
      order.push(3);
      return 'second';
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1, 'first');
    assert.equal(r2, 'second');
    assert.deepEqual(order, [1, 2, 3]);
  } finally {
    Realm.prototype.connect = originalConnect;
    Realm.prototype.close = originalClose;
  }
});

test('withRealmContextLock error in first task does not block second', async () => {
  const originalConnect = Realm.prototype.connect;
  const originalClose = Realm.prototype.close;

  Realm.prototype.connect = async function patchedConnect() { /* noop */ };
  Realm.prototype.close = async function patchedClose() { /* noop */ };

  try {
    const input = { realmBaseUrl: 'https://lock-error.nimi.xyz', accessToken: 'test-token' };

    const p1 = withRealmContextLock(input, async () => {
      throw new Error('task-1-failed');
    });

    const p2 = withRealmContextLock(input, async () => 'ok');

    await assert.rejects(p1, /task-1-failed/);
    assert.equal(await p2, 'ok');
  } finally {
    Realm.prototype.connect = originalConnect;
    Realm.prototype.close = originalClose;
  }
});

test('withRealmContextLock calls connect before task and close after', async () => {
  const originalConnect = Realm.prototype.connect;
  const originalClose = Realm.prototype.close;
  const events: string[] = [];

  Realm.prototype.connect = async function patchedConnect() {
    events.push('connect');
  };
  Realm.prototype.close = async function patchedClose() {
    events.push('close');
  };

  try {
    const input = { realmBaseUrl: 'https://lock-lifecycle.nimi.xyz', accessToken: 'test-token' };

    await withRealmContextLock(input, async () => {
      events.push('task');
    });

    assert.deepEqual(events, ['connect', 'task', 'close']);
  } finally {
    Realm.prototype.connect = originalConnect;
    Realm.prototype.close = originalClose;
  }
});
