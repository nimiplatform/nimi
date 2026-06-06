#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const vnextRoot = path.join(repoRoot, 'sdks', 'typescript');

const testFiles = process.argv.slice(2);

function discoverDefaultTestFiles() {
  const discovered = globSync('**/*.test.ts', { cwd: vnextRoot, absolute: false })
    .map((file) => file.replace(/\\/g, '/'))
    .sort((a, b) => a.localeCompare(b));
  if (discovered.length === 0) {
    throw new Error('[run-sdk-vnext-typescript-tests] no test files matched **/*.test.ts');
  }
  return discovered;
}

function runPnpm(args) {
  return spawnSync('pnpm', args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
}

function main() {
  const buildResult = runPnpm(['--dir', vnextRoot, 'run', 'build']);
  if (buildResult.status !== 0) {
    process.exitCode = buildResult.status ?? 1;
    return;
  }

  const result = runPnpm([
    '--dir',
    vnextRoot,
    'exec',
    'tsx',
    '--test',
    '--test-concurrency=1',
    ...(testFiles.length > 0 ? testFiles : discoverDefaultTestFiles()),
  ]);

  process.exitCode = result.status ?? 1;
}

main();
