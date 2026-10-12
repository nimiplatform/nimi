import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import test from 'node:test';
import { runReleaseCommand } from '../scripts/lib/macos-release-process.mjs';

const lostConnection = {
  status: 68,
  stderr: 'error is Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost."',
  stdout: '',
};
const stapler = ['stapler', 'staple', '/candidate/Nimi.app'];

function observeCommands(t, resultForAttempt) {
  const calls = [];
  const delays = [];
  const spawn = t.mock.method(childProcess, 'spawnSync', (command, args) => {
    calls.push({ command, args });
    return resultForAttempt(calls.length);
  });
  t.mock.method(Atomics, 'wait', (_array, _index, _value, milliseconds) => {
    delays.push(milliseconds);
    return 'timed-out';
  });
  syncBuiltinESMExports();
  t.after(() => {
    spawn.mock.restore();
    syncBuiltinESMExports();
  });
  return { calls, delays };
}

test('a lost Apple ticket connection retries the exact staple command before returning its actual success', (t) => {
  const observed = observeCommands(t, (attempt) => attempt === 1
    ? lostConnection : { status: 0, stdout: 'The staple and validate action worked!', stderr: '' });
  const result = runReleaseCommand('/usr/bin/xcrun', stapler);
  assert.equal(result.stdout, 'The staple and validate action worked!');
  assert.deepEqual(observed.calls, Array.from({ length: 2 }, () => ({ command: '/usr/bin/xcrun', args: stapler })));
  assert.deepEqual(observed.delays, [5000]);
});

test('persistent ticket connection loss remains a failed release after bounded retries', (t) => {
  const observed = observeCommands(t, () => lostConnection);
  assert.throws(() => runReleaseCommand('/usr/bin/xcrun', stapler), /failed with status 68/u);
  assert.equal(observed.calls.length, 4);
  assert.deepEqual(observed.delays, [5000, 15000, 30000]);
});

for (const [label, command, args, result] of [
  ['signature refusal', '/usr/bin/xcrun', stapler, { status: 68, stderr: 'Could not validate ticket' }],
  ['TLS failure', '/usr/bin/xcrun', stapler, { status: 68, stderr: 'Error Domain=NSURLErrorDomain Code=-1200' }],
  ['validation', '/usr/bin/xcrun', ['stapler', 'validate', '/candidate/Nimi.app'], lostConnection],
  ['notary submission', '/usr/bin/xcrun', ['notarytool', 'submit', '/candidate/Nimi.zip'], lostConnection],
  ['code signing', '/usr/bin/codesign', ['--verify', '/candidate/Nimi.app'], lostConnection],
  ['process launch', '/usr/bin/xcrun', stapler, { ...lostConnection, error: new Error('could not launch') }],
]) {
  test(`${label} does not retry or turn failure into success`, (t) => {
    const observed = observeCommands(t, () => result);
    assert.throws(() => runReleaseCommand(command, args), /failed with status 68/u);
    assert.equal(observed.calls.length, 1);
    assert.deepEqual(observed.delays, []);
  });
}
