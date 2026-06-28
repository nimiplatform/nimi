import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { composePnpmSpawn, pnpmCommandForPlatform } from './pnpm-command.mjs';

test('pnpmCommandForPlatform resolves the Windows command shim', () => {
  assert.equal(pnpmCommandForPlatform('win32'), 'pnpm.cmd');
});

test('pnpmCommandForPlatform uses pnpm directly outside Windows', () => {
  assert.equal(pnpmCommandForPlatform('linux'), 'pnpm');
  assert.equal(pnpmCommandForPlatform('darwin'), 'pnpm');
});

test('composePnpmSpawn wraps Windows command shims through cmd.exe', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pnpm-command-'));
  try {
    writeFileSync(path.join(root, 'pnpm.CMD'), '@echo off\n');
    const env = {
      PATH: root,
      PATHEXT: '.CMD;.EXE',
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
    };
    const spawn = composePnpmSpawn(['--version'], { env, platform: 'win32' });

    assert.equal(spawn.command, 'C:\\Windows\\System32\\cmd.exe');
    assert.deepEqual(spawn.args.slice(0, 3), ['/d', '/s', '/c']);
    assert.match(spawn.args[3], /pnpm\.cmd/iu);
    assert.match(spawn.args[3], /--version/u);
    assert.equal(spawn.windowsVerbatimArguments, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('composePnpmSpawn keeps direct pnpm execution outside Windows', () => {
  assert.deepEqual(composePnpmSpawn(['--version'], { platform: 'linux' }), {
    command: 'pnpm',
    args: ['--version'],
  });
});
