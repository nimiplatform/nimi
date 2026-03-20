import assert from 'node:assert/strict';
import test from 'node:test';

import { Realm } from '../src/realm/client.js';
import { withRealmContextLock } from '../src/realm/context-lock.js';

test('withRealmContextLock serializes tasks until close finishes', async () => {
  const originalConnect = Realm.prototype.connect;
  const originalClose = Realm.prototype.close;
  const events: string[] = [];
  let connectCount = 0;
  let closeCount = 0;
  let releaseTask1!: () => void;
  let releaseFirstClose!: () => void;
  const task1Gate = new Promise<void>((resolve) => {
    releaseTask1 = resolve;
  });
  const firstCloseGate = new Promise<void>((resolve) => {
    releaseFirstClose = resolve;
  });

  Realm.prototype.connect = async function patchedConnect() {
    connectCount += 1;
    events.push(`connect:${connectCount}`);
  };
  Realm.prototype.close = async function patchedClose() {
    closeCount += 1;
    events.push(`close:start:${closeCount}`);
    if (closeCount === 1) {
      await firstCloseGate;
    }
    events.push(`close:end:${closeCount}`);
  };

  try {
    const first = withRealmContextLock({ realmBaseUrl: 'https://realm.example', accessToken: 'token-1' }, async () => {
      events.push('task:1:start');
      await task1Gate;
      events.push('task:1:end');
      return 'first';
    });
    const second = withRealmContextLock({ realmBaseUrl: 'https://realm.example', accessToken: 'token-2' }, async () => {
      events.push('task:2');
      return 'second';
    });

    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(events, ['connect:1', 'task:1:start']);

    releaseTask1();
    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(events, ['connect:1', 'task:1:start', 'task:1:end', 'close:start:1']);
    releaseFirstClose();
    const results = await Promise.all([first, second]);
    assert.deepEqual(results, ['first', 'second']);
    assert.deepEqual(events, [
      'connect:1',
      'task:1:start',
      'task:1:end',
      'close:start:1',
      'close:end:1',
      'connect:2',
      'task:2',
      'close:start:2',
      'close:end:2',
    ]);
  } finally {
    releaseTask1?.();
    releaseFirstClose?.();
    Realm.prototype.connect = originalConnect;
    Realm.prototype.close = originalClose;
  }
});

test('withRealmContextLock continues queueing after task failure', async () => {
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
    const first = withRealmContextLock({ realmBaseUrl: 'https://realm.example', accessToken: 'token' }, async () => {
      events.push('task:fail');
      throw new Error('TASK_FAILED');
    });
    const second = withRealmContextLock({ realmBaseUrl: 'https://realm.example', accessToken: 'token' }, async () => {
      events.push('task:ok');
      return 'ok';
    });

    await assert.rejects(first, /TASK_FAILED/);
    assert.equal(await second, 'ok');
    assert.deepEqual(events, ['connect', 'task:fail', 'close', 'connect', 'task:ok', 'close']);
  } finally {
    Realm.prototype.connect = originalConnect;
    Realm.prototype.close = originalClose;
  }
});

test('withRealmContextLock closes realm after connect failure and allows the next task', async () => {
  const originalConnect = Realm.prototype.connect;
  const originalClose = Realm.prototype.close;
  const events: string[] = [];
  let attempts = 0;

  Realm.prototype.connect = async function patchedConnect() {
    attempts += 1;
    events.push(`connect:${attempts}`);
    if (attempts === 1) {
      throw new Error('CONNECT_FAILED');
    }
  };
  Realm.prototype.close = async function patchedClose() {
    events.push(`close:${attempts}`);
  };

  try {
    await assert.rejects(
      () => withRealmContextLock({ realmBaseUrl: 'https://realm.example', accessToken: 'token' }, async () => 'never'),
      /CONNECT_FAILED/,
    );

    const value = await withRealmContextLock({ realmBaseUrl: 'https://realm.example', accessToken: 'token' }, async () => {
      events.push('task:ok');
      return 'ok';
    });

    assert.equal(value, 'ok');
    assert.deepEqual(events, ['connect:1', 'close:1', 'connect:2', 'task:ok', 'close:2']);
  } finally {
    Realm.prototype.connect = originalConnect;
    Realm.prototype.close = originalClose;
  }
});
