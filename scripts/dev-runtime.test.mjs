import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import {
  parseSourceRuntimeArguments,
  resolveSourceRuntimeLaunch,
  runSourceRuntimeDevelopment,
  stopSourceRuntimeDevelopment,
} from './dev-runtime.mjs';

function isolatedWindowsLaunch(t) {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-test-dev-runtime-'));
  t.after(() => rmSync(repoRoot, { recursive: true, force: true }));
  const dist = path.join(repoRoot, 'electron-dist');
  mkdirSync(path.join(dist, 'resources'), { recursive: true });
  for (const name of ['electron.exe', 'resources/default_app.asar', 'icudtl.dat', 'v8_context_snapshot.bin']) {
    writeFileSync(path.join(dist, name), name);
  }
  return {
    argv: [], repoRoot, electronExecutable: path.join(dist, 'electron.exe'),
    tempRoot: path.join(repoRoot, 'supervisor'), platform: 'win32', architecture: 'x64',
  };
}

test('dev:runtime accepts no topology overrides', () => {
  assert.deepEqual(parseSourceRuntimeArguments([]), {});
  assert.deepEqual(parseSourceRuntimeArguments(['--']), {});
  assert.throws(
    () => parseSourceRuntimeArguments(['--installed']),
    (error) => error?.reasonCode === 'source-runtime-argument-invalid',
  );
});

test('source Runtime launch uses a temporary exact supervisor and workspace Desktop carrier', () => {
  const root = process.cwd();
  const electron = realpathSync(process.execPath);
  const tempRoot = path.join(root, '.nimi', 'local', 'test-source-supervisor');
  const plan = resolveSourceRuntimeLaunch({
    repoRoot: root,
    electronExecutable: electron,
    tempRoot,
    platform: 'win32',
    architecture: 'x64',
    realm: 'official',
  });
  assert.equal(plan.runtimeRoot, path.join(root, 'runtime'));
  assert.equal(plan.electronExecutable, electron);
  assert.equal(plan.build.command, 'go');
  assert.deepEqual(plan.build.args.slice(0, 2), ['build', '-o']);
  assert.equal(plan.run.command, plan.supervisorExecutable);
  assert.deepEqual(plan.run.args, [
    '--repo-root', root,
    '--desktop-executable', electron,
    '--realm', 'official',
    '--realm-url', 'https://realm.nimi.ai',
    '--realtime-url', 'https://realm.nimi.ai',
    '--web-url', 'https://nimi.ai',
    '--realm-environment-id', 'production',
  ]);
});

test('source stop preserves arguments and distinguishes absent owner from failure', () => {
  for (const status of [0, 1, 3]) {
    const calls = [];
    const result = stopSourceRuntimeDevelopment(['--', '--timeout', '20s', '--force'], {
      platform: 'win32',
      spawnSync(command, args, options) {
        calls.push({ command, args, options });
        return { status: calls.length === 1 ? 0 : status };
      },
    });
    assert.equal(result, status);
    assert.deepEqual(calls[1].args, ['stop', '--timeout', '20s', '--force']);
    assert.equal(calls[1].options.windowsHide, true);
  }
});

test('source Runtime launcher removes its temporary supervisor after child shutdown', async (t) => {
  const events = [];
  const fakeChild = {
    stdin: { end: () => events.push('stdin-end') },
    once(name, listener) {
      if (name === 'exit') queueMicrotask(() => listener(0, null));
      return this;
    },
  };
  const result = await runSourceRuntimeDevelopment({
    ...isolatedWindowsLaunch(t),
    makeTemp: () => events.push('make'),
    removeTemp: () => events.push('remove'),
    spawnSync: () => ({ status: 0 }),
    spawn: () => fakeChild,
  });
  assert.equal(result, 0);
  assert.deepEqual(events, ['make', 'remove']);
});

test('Desktop cancellation asks its own Runtime supervisor to stop through stdin', async (t) => {
  const abort = new AbortController();
  const signalListeners = process.listenerCount('SIGINT');
  const child = new EventEmitter();
  let stopped = 0;
  child.stdin = { end() { stopped += 1; queueMicrotask(() => child.emit('exit', 0, null)); } };
  const run = runSourceRuntimeDevelopment({
    ...isolatedWindowsLaunch(t), signal: abort.signal,
    makeTemp() {}, removeTemp() {}, spawnSync: () => ({ status: 0 }), spawn: () => child,
  });
  assert.equal(process.listenerCount('SIGINT'), signalListeners);
  abort.abort();
  assert.equal(await run, 0);
  assert.equal(stopped, 1);
});

test('an owned Windows launch carries only the Runtime repair diagnosis through supervisor exit', async t => {
  for (const structured of [false, true]) {
    const child = new EventEmitter();
    child.stderr = new PassThrough();
    const run = runSourceRuntimeDevelopment({
      ...isolatedWindowsLaunch(t), signal: new AbortController().signal,
      makeTemp() {}, removeTemp() {}, spawnSync: () => ({ status: 0 }), spawn: () => child,
    });
    child.emit('exit', 1, null);
    // The child's final stderr may arrive in pieces after the exit event.
    const detail = 'required directory models is unavailable';
    const line = structured ? JSON.stringify({ event: 'runtime.source.data_root_repair_required', detail }) : 'serve failed: ' + detail;
    child.stderr.write(line.slice(0, 16));
    child.stderr.end(line.slice(16) + '\n');
    child.emit('close', 1, null);
    await assert.rejects(run, error => structured
      ? error.reasonCode === 'source-runtime-data-root-repair-required' && error.message === detail
      : error.reasonCode === 'source-runtime-supervisor-exited');
  }
});

test('opening an owned source process does not finish the startup check', async t => {
  const child = new EventEmitter();
  child.stderr = new PassThrough();
  let constructed = 0;
  const run = runSourceRuntimeDevelopment({
    ...isolatedWindowsLaunch(t), signal: new AbortController().signal,
    makeTemp() {}, removeTemp() {}, spawnSync: () => ({ status: 0 }), spawn: () => child,
    onRuntimeConstructed: () => { constructed++; },
  });
  assert.equal(constructed, 0);
  child.stderr.write('{"event":"runtime.source.');
  assert.equal(constructed, 0);
  child.stderr.end('construction_complete"}\n');
  child.emit('close', 0, null);
  assert.equal(await run, 0);
  assert.equal(constructed, 1);
});

test('an invalid Electron source leaves the existing development carrier intact', async (t) => {
  const launch = isolatedWindowsLaunch(t);
  const carrierDir = path.join(launch.repoRoot, '.nimi', 'local', 'dev-carrier', 'win32-x64');
  mkdirSync(carrierDir, { recursive: true });
  const carrier = path.join(carrierDir, 'NimiAppHost.exe');
  writeFileSync(carrier, 'previous carrier');
  await assert.rejects(runSourceRuntimeDevelopment({ ...launch, electronExecutable: process.execPath }),
    /Incomplete Windows Electron distribution/u);
  assert.equal(readFileSync(carrier, 'utf8'), 'previous carrier');
});

test('already-cancelled startup does not build or spawn Runtime', async () => {
  await assert.rejects(runSourceRuntimeDevelopment({
    argv: [], signal: AbortSignal.abort(),
    spawnSync() { assert.fail('cancelled startup must not build'); },
    spawn() { assert.fail('cancelled startup must not spawn'); },
  }), { name: 'AbortError' });
});
