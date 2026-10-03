import assert from 'node:assert/strict';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import test from 'node:test';

import {
  parseSourceRuntimeArguments,
  resolveSourceRuntimeLaunch,
  runSourceRuntimeDevelopment,
  stopSourceRuntimeDevelopment,
} from './dev-runtime.mjs';

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
  });
  assert.equal(plan.runtimeRoot, path.join(root, 'runtime'));
  assert.equal(plan.electronExecutable, electron);
  assert.equal(plan.build.command, 'go');
  assert.deepEqual(plan.build.args.slice(0, 2), ['build', '-o']);
  assert.equal(plan.run.command, plan.supervisorExecutable);
  assert.deepEqual(plan.run.args, [
    '--repo-root', root,
    '--desktop-executable', electron,
    '--realm-url', 'http://127.0.0.1:3002',
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

test('source Runtime launcher removes its temporary supervisor after child shutdown', async () => {
  const events = [];
  const fakeChild = {
    stdin: { end: () => events.push('stdin-end') },
    once(name, listener) {
      if (name === 'exit') queueMicrotask(() => listener(0, null));
      return this;
    },
  };
  const result = await runSourceRuntimeDevelopment({
    argv: [],
    repoRoot: process.cwd(),
    electronExecutable: process.execPath,
    tempRoot: path.join(process.cwd(), '.nimi', 'local', 'test-source-supervisor'),
    platform: 'win32',
    architecture: 'x64',
    makeTemp: () => events.push('make'),
    removeTemp: () => events.push('remove'),
    spawnSync: () => ({ status: 0 }),
    spawn: () => fakeChild,
  });
  assert.equal(result, 0);
  assert.deepEqual(events, ['make', 'remove']);
});
