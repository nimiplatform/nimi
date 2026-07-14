#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const suites = [
  {
    name: 'kit Electron/local-app public behavior',
    command: 'pnpm',
    args: [
      '--filter', '@nimiplatform/kit', 'exec', 'vitest', 'run',
      '--config', 'ui/vitest.config.ts',
      'shell/capabilities/test/local-app-carrier-behavior.test.ts',
      'shell/electron/test/electron-local-app-carrier-behavior.test.ts',
    ],
  },
  {
    name: 'kit Tauri/local-app public behavior',
    command: 'cargo',
    args: [
      'test', '--manifest-path', 'kit/shell/tauri/Cargo.toml',
      'local_app_carrier_behavior',
    ],
  },
  {
    name: 'kit native protected-local carrier behavior',
    command: 'cargo',
    args: [
      'test', '--manifest-path', 'kit/shell/protected-local/Cargo.toml',
      '--test', 'carrier_contract',
    ],
  },
];

for (const suite of suites) {
  const result = spawnSync(suite.command, suite.args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: 'pipe',
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || `exit ${result.status ?? 'unknown'}`;
    process.stderr.write(`local-app carrier behavior failed: ${suite.name} (${detail})\n`);
    process.exit(1);
  }
}

process.stdout.write('local-app carrier behavior: OK\n');
