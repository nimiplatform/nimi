#!/usr/bin/env node

import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSyncCommand } from './lib/command-runner.mjs';
import {
  isSdkDistPrepared,
  withSdkDistLock,
} from './lib/sdk-dist-lock.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const vnextRoot = path.join(repoRoot, 'sdks', 'typescript');

const testFiles = process.argv.slice(2);
const independentWorkspaceTestRoots = [
  'adapters/mastra/',
  'adapters/vercel-ai/',
  'doctor/',
];

function discoverDefaultTestFiles() {
  const discovered = globSync('**/*.test.ts', { cwd: vnextRoot, absolute: false })
    .map((file) => file.replace(/\\/g, '/'))
    .filter((file) => !independentWorkspaceTestRoots.some((root) => file.startsWith(root)))
    .sort((a, b) => a.localeCompare(b));
  if (discovered.length === 0) {
    throw new Error('[run-sdk-vnext-typescript-tests] no test files matched **/*.test.ts');
  }
  return discovered;
}

function runPnpm(args) {
  return spawnSyncCommand('pnpm', args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  });
}

function main() {
  if (!isSdkDistPrepared()) {
    const buildResult = runPnpm(['--dir', vnextRoot, 'run', 'build']);
    if (buildResult.status !== 0) {
      process.exitCode = buildResult.status ?? 1;
      return;
    }
  }

  const typeContractResult = runPnpm([
    '--dir',
    vnextRoot,
    'exec',
    'tsc',
    '--project',
    'tsconfig.testing-contract.json',
  ]);
  if (typeContractResult.status !== 0) {
    process.exitCode = typeContractResult.status ?? 1;
    return;
  }

  const result = runPnpm([
    '--dir',
    vnextRoot,
    'exec',
    'tsx',
    '--test',
    '--test-concurrency=4',
    ...(testFiles.length > 0 ? testFiles : discoverDefaultTestFiles()),
  ]);

  process.exitCode = result.status ?? 1;
}

try {
  await withSdkDistLock('run-sdk-vnext-typescript-tests build+test', main);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[run-sdk-vnext-typescript-tests] failed: ${message}\n`);
  process.exitCode = 1;
}
