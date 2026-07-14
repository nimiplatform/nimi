import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';

import {
  terminateRuntimeDaemon,
  waitForRuntimeDaemonReadyOrExit,
} from './live-runtime-daemon.test-helper';

test('direct Runtime daemon diagnostics fail fast when the spawned process exits', async () => {
  const daemon = spawn(process.execPath, ['-e', 'process.exit(17)'], { stdio: 'ignore' });
  const startedAt = Date.now();

  await assert.rejects(
    waitForRuntimeDaemonReadyOrExit(daemon, new Promise<void>(() => {})),
    /runtime daemon exited before ready: code=17/u,
  );
  assert.ok(Date.now() - startedAt < 5_000, 'spawn exit must not fall through to Runtime readiness polling');
});

test('direct Runtime daemon cleanup returns immediately for an already-exited process', async () => {
  const daemon = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
  await new Promise<void>((resolvePromise, reject) => {
    daemon.once('exit', () => resolvePromise());
    daemon.once('error', reject);
  });
  const startedAt = Date.now();

  await terminateRuntimeDaemon(daemon);
  assert.ok(Date.now() - startedAt < 1_000, 'cleanup must not wait for an exit event that already fired');
});
