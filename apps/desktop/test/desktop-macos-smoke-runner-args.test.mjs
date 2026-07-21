import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseArgs } from '../scripts/run-macos-smoke-helpers.mjs';
import { applicationPath } from '../scripts/run-macos-smoke-process.mjs';

test('macOS smoke runner arguments use fail-closed execution defaults', () => {
  assert.deepEqual(parseArgs([]), {
    suite: 'all',
    scenario: '',
    skipBuild: false,
    timeoutMs: 45000,
  });
});

test('macOS smoke runner arguments select an explicit scenario and timeout', () => {
  assert.deepEqual(parseArgs([
    '--suite',
    'boot',
    '--scenario',
    'boot.anonymous.login-screen',
    '--timeout-ms',
    '90000',
    '--skip-build',
  ]), {
    suite: 'boot',
    scenario: 'boot.anonymous.login-screen',
    skipBuild: true,
    timeoutMs: 90000,
  });
});

test('macOS smoke runner arguments retain the bounded timeout for invalid input', () => {
  assert.equal(parseArgs(['--timeout-ms', 'invalid']).timeoutMs, 45000);
});

test('macOS smoke runner selects the configured product instead of a stale bundle', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-macos-smoke-runner-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundleRoot = path.join(root, 'bundle');
  const tauriConfigPath = path.join(root, 'tauri.conf.json');
  const currentExecutable = path.join(bundleRoot, 'Nimi.app', 'Contents', 'MacOS', 'nimi');
  const staleExecutable = path.join(bundleRoot, 'Nimi Desktop Runtime.app', 'Contents', 'MacOS', 'legacy');
  fs.mkdirSync(path.dirname(currentExecutable), { recursive: true });
  fs.mkdirSync(path.dirname(staleExecutable), { recursive: true });
  fs.writeFileSync(currentExecutable, 'current');
  fs.writeFileSync(staleExecutable, 'legacy');
  fs.writeFileSync(tauriConfigPath, JSON.stringify({ productName: 'Nimi' }));

  assert.equal(applicationPath({ bundleRoot, tauriConfigPath }), currentExecutable);
});

test('macOS smoke runner rejects an ambiguous configured bundle executable', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-macos-smoke-runner-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundleRoot = path.join(root, 'bundle');
  const tauriConfigPath = path.join(root, 'tauri.conf.json');
  const executableRoot = path.join(bundleRoot, 'Nimi.app', 'Contents', 'MacOS');
  fs.mkdirSync(executableRoot, { recursive: true });
  fs.writeFileSync(path.join(executableRoot, 'one'), 'one');
  fs.writeFileSync(path.join(executableRoot, 'two'), 'two');
  fs.writeFileSync(tauriConfigPath, JSON.stringify({ productName: 'Nimi' }));

  assert.throws(
    () => applicationPath({ bundleRoot, tauriConfigPath }),
    /exactly one executable/,
  );
});
