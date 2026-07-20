#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSyncCommand } from './lib/command-runner.mjs';
import { resolveSystemPythonCommand } from './lib/python-venv.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const testRoot = path.join(repoRoot, 'runtime', 'internal', 'engine', 'assets');
const result = spawnSyncCommand(resolveSystemPythonCommand(), ['-m', 'unittest', 'discover', '-s', testRoot, '-p', '*_test.py'], {
  cwd: repoRoot,
  env: process.env,
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
