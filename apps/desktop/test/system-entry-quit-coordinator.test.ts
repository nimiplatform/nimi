import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesktopQuitCoordinator } from '../src-electron/system-entry-quit-coordinator.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, refuse) => { resolve = accept; reject = refuse; });
  return { promise, resolve, reject };
}

test('quit confirmation blocks launches immediately and shares one pending intent', async () => {
  const confirmation = deferred<boolean>();
  const impact = { installedApps: ['notes'], pendingLaunches: ['writer'] };
  const calls: string[] = [];
  const host = createDesktopQuitCoordinator({
    readImpact: async () => { calls.push('impact'); return impact; },
    confirm: async (value) => { assert.equal(value, impact); calls.push('confirm'); return confirmation.promise; },
    shutdown: async () => { calls.push('shutdown'); },
    finishQuit: () => { calls.push('finish'); },
    recoverAfterFailedQuit: () => { calls.push('recover'); },
  });
  const first = host.requestUserQuit();
  assert.equal(host.isLaunchBlocked(), true);
  assert.equal(host.requestUserQuit(), first);
  await Promise.resolve();
  confirmation.resolve(false);
  assert.equal(await first, false);
  assert.equal(host.phase(), 'idle');
  assert.equal(host.isLaunchBlocked(), false);
  assert.deepEqual(calls, ['impact', 'confirm']);
});

test('confirmed quit waits for real cleanup before committing', async () => {
  const stopped = deferred<void>();
  const calls: string[] = [];
  const host = createDesktopQuitCoordinator({
    readImpact: async () => ({ apps: 2 }),
    confirm: async () => true,
    shutdown: async () => { calls.push('stop'); await stopped.promise; },
    finishQuit: () => { calls.push('finish'); },
    recoverAfterFailedQuit: () => { calls.push('recover'); },
  });
  const quitting = host.requestUserQuit();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(host.phase(), 'stopping');
  assert.deepEqual(calls, ['stop']);
  stopped.resolve();
  assert.equal(await quitting, true);
  assert.equal(host.phase(), 'committed');
  assert.equal(host.isLaunchBlocked(), true);
  assert.deepEqual(calls, ['stop', 'finish']);
});

test('failed stop retains a retry path and does not finish quit', async () => {
  let stopAttempts = 0;
  const calls: string[] = [];
  const host = createDesktopQuitCoordinator({
    readImpact: async () => ({ apps: 1 }),
    confirm: async () => true,
    shutdown: async () => { if (++stopAttempts === 1) throw new Error('app-stop-failed'); },
    finishQuit: () => { calls.push('finish'); },
    recoverAfterFailedQuit: (error) => { assert.match(String(error), /app-stop-failed/); calls.push('recover'); },
  });
  await assert.rejects(host.requestUserQuit(), /app-stop-failed/);
  assert.equal(host.phase(), 'idle');
  assert.deepEqual(calls, ['recover']);
  assert.equal(await host.requestUserQuit(), true);
  assert.deepEqual(calls, ['recover', 'finish']);
});

test('OS session end supersedes an open ordinary confirmation without starting ordinary cleanup', async () => {
  const confirmation = deferred<boolean>();
  const calls: string[] = [];
  const host = createDesktopQuitCoordinator({
    readImpact: async () => ({ apps: 1 }),
    confirm: () => confirmation.promise,
    shutdown: async () => { calls.push('stop'); },
    finishQuit: () => { calls.push('finish'); },
    recoverAfterFailedQuit: () => { calls.push('recover'); },
  });
  const quitting = host.requestUserQuit();
  await Promise.resolve();
  host.beginSystemEnd();
  confirmation.resolve(true);
  assert.equal(await quitting, false);
  assert.equal(host.phase(), 'system-ending');
  assert.equal(host.isLaunchBlocked(), true);
  assert.equal(await host.requestUserQuit(), false);
  assert.deepEqual(calls, []);
});
