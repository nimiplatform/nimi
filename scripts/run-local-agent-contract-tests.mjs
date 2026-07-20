#!/usr/bin/env node

import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSyncCommand } from './lib/command-runner.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const tests = globSync('tests/local-agent-product/**/*.test.mjs', { cwd: repoRoot, absolute: true })
  .sort((left, right) => left.localeCompare(right));
if (tests.length === 0) throw new Error('no LocalAgent contract tests discovered');

const result = spawnSyncCommand(process.execPath, ['--test', '--test-concurrency=1', ...tests], {
  cwd: repoRoot,
  env: process.env,
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
