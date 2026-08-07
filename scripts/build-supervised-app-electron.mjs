#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { spawnSyncCommand } from './lib/command-runner.mjs';
import { inspectWorkspaceSurfaceFreshness } from './lib/dev-workspace-surfaces.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = process.cwd();
const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function parseConsumer(argv) {
  if (argv.length !== 2 || argv[0] !== '--consumer' || !/^[a-z][a-z0-9-]*$/u.test(argv[1])) {
    throw new Error('usage: build-supervised-app-electron.mjs --consumer <name>');
  }
  return argv[1];
}

function runChecked(command, args) {
  const result = spawnSyncCommand(command, args, {
    cwd: appRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${[command, ...args].join(' ')} exited with status ${result.status ?? 1}`);
  }
}

try {
  const consumer = parseConsumer(process.argv.slice(2));
  const freshness = await inspectWorkspaceSurfaceFreshness(repoRoot);
  if (!freshness.fresh) {
    throw new Error(
      `Desktop-owned SDK/Kit dist is not ready (${freshness.diagnostics.join(', ')}). `
      + 'Start or restart pnpm dev:desktop before launching supervised Apps.',
    );
  }
  runChecked(pnpmBin, ['exec', 'tsc', '-p', 'tsconfig.electron.json']);
  runChecked(process.execPath, ['scripts/bundle-electron-preload.mjs']);
  process.stdout.write(`[${consumer} build:electron] built from Desktop-owned SDK/Kit dist\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[supervised-app build:electron] ${message}\n`);
  process.exitCode = 1;
}
