import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { terminateDaemon } from '../../../apps/desktop/scripts/explore-materialization-acceptance/acceptance-files.mjs';
import {
  startProcess,
  terminateProcessTree,
  terminateProcessTreeAfterGrace,
} from '../harness/cross-app-driver.mjs';

test('Runtime report teardown waits for the detached process group to exit', {
  skip: process.platform === 'win32',
}, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-runtime-process-group-'));
  const descendantPidPath = path.join(root, 'descendant.pid');
  const child = spawn(process.execPath, ['-e', [
    "const { spawn } = require('node:child_process');",
    "spawn(process.execPath, ['-e', \"const fs = require('node:fs'); process.on('SIGTERM', () => setTimeout(() => process.exit(0), 1500)); fs.writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000);\", process.argv[1]], { stdio: 'ignore' });",
    'setInterval(() => {}, 1000);',
  ].join(''), descendantPidPath], { detached: true, stdio: 'ignore' });
  t.after(() => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  });
  for (let attempt = 0; attempt < 100 && !fs.existsSync(descendantPidPath); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(fs.existsSync(descendantPidPath), true);
  const descendantPid = Number(fs.readFileSync(descendantPidPath, 'utf8'));
  await terminateDaemon(child);
  assert.throws(() => process.kill(child.pid, 0), /ESRCH/u);
  assert.throws(() => process.kill(descendantPid, 0), /ESRCH/u);
});

test('released product processes receive a grace window before tree termination', {
  skip: process.platform === 'win32',
}, async (t) => {
  const handle = startProcess(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 300)'], {
    cwd: process.cwd(), env: process.env,
  });
  t.after(() => terminateProcessTree(handle));
  await terminateProcessTreeAfterGrace(handle, 2_000);
  const result = await handle.completed;
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
});
