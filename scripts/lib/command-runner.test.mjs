import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { spawnSyncCommand } from './command-runner.mjs';
import { composePnpmSpawn } from './pnpm-command.mjs';

test('spawnSyncCommand preserves verbatim arguments for a composed Windows pnpm command', {
  skip: process.platform !== 'win32',
}, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'command-runner-'));
  try {
    writeFileSync(path.join(root, 'pnpm.cmd'), '@echo off\r\necho pnpm-command-ok\r\n');
    const env = {
      ...process.env,
      PATH: root,
      PATHEXT: '.CMD;.EXE',
    };
    const invocation = composePnpmSpawn(['--version'], { env, platform: 'win32' });
    const result = spawnSyncCommand(invocation.command, invocation.args, {
      env,
      encoding: 'utf8',
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /pnpm-command-ok/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
