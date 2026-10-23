import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import test from 'node:test';
import { stopSystemEntryOwnedProcess, systemEntryOwnedProcessAlive } from '../src-electron/system-entry-owned-process.js';

test('owned helper shutdown resolves only after the real child has exited', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
  await once(child, 'spawn');
  try {
    assert.equal(systemEntryOwnedProcessAlive(child), true);
    await stopSystemEntryOwnedProcess(child);
    assert.equal(systemEntryOwnedProcessAlive(child), false);
    assert.equal(child.exitCode !== null || child.signalCode !== null, true);
  } finally {
    if (systemEntryOwnedProcessAlive(child)) child.kill();
  }
});

test('a failed signal does not discard the live-process fact', async () => {
  const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, kill: () => false }) as unknown as ChildProcess;
  await assert.rejects(stopSystemEntryOwnedProcess(child, 10), /desktop-owned-process-stop-timeout/);
  assert.equal(systemEntryOwnedProcessAlive(child), true);
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(child.listenerCount('error'), 0);
});
