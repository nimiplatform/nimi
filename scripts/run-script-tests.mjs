#!/usr/bin/env node

import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSyncCommand } from './lib/command-runner.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

function discover(root, pattern) {
  return globSync(pattern, { cwd: root })
    .map((relative) => path.resolve(root, relative))
    .sort((left, right) => left.localeCompare(right));
}

export function discoverScriptTests(root = scriptDir) {
  return {
    nodeTests: discover(root, '**/*.test.mjs'),
    pythonTests: [...new Set([
      ...discover(root, '**/*_test.py'),
      ...discover(root, '**/test_*.py'),
    ])].sort((left, right) => left.localeCompare(right)),
  };
}

export function buildScriptTestCommands({ nodeTests, pythonTests }) {
  if (nodeTests.length === 0) throw new Error('no scripts/**/*.test.mjs files discovered');
  if (pythonTests.length === 0) throw new Error('no scripts Python test files discovered');
  return [
    [process.execPath, ['--test', '--test-concurrency=1', ...nodeTests]],
    ['python3', ['-m', 'unittest', ...pythonTests]],
  ];
}

export function runScriptTests() {
  const commands = buildScriptTestCommands(discoverScriptTests());
  let status = 0;
  for (const [command, args] of commands) {
    const result = spawnSyncCommand(command, args, { cwd: repoRoot, env: process.env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if ((result.status ?? 1) !== 0) status = result.status ?? 1;
  }
  return status;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runScriptTests();
}
