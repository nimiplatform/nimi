import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildScriptTestCommands,
  discoverScriptTests,
} from './run-script-tests.mjs';

test('script test discovery passes each absolute Node and Python file as its own argv entry', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-script-test-discovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'nested'));
  for (const relative of [
    'alpha.test.mjs',
    'nested/beta.test.mjs',
    'gamma_test.py',
    'nested/test_delta.py',
  ]) fs.writeFileSync(path.join(root, relative), '');

  const discovered = discoverScriptTests(root);
  assert.deepEqual(discovered.nodeTests, [
    path.join(root, 'alpha.test.mjs'),
    path.join(root, 'nested/beta.test.mjs'),
  ]);
  assert.deepEqual(discovered.pythonTests, [
    path.join(root, 'gamma_test.py'),
    path.join(root, 'nested/test_delta.py'),
  ]);
  const [[nodeCommand, nodeArgs], [pythonCommand, pythonArgs]] = buildScriptTestCommands(discovered);
  assert.equal(nodeCommand, process.execPath);
  assert.deepEqual(nodeArgs.slice(2), discovered.nodeTests);
  assert.equal(pythonCommand, process.platform === 'win32' ? 'python' : 'python3');
  assert.deepEqual(pythonArgs.slice(2), discovered.pythonTests);
  assert.ok([...nodeArgs.slice(2), ...pythonArgs.slice(2)].every(path.isAbsolute));
});
