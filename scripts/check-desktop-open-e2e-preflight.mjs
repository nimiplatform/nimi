#!/usr/bin/env node
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { failWith, pass } from './lib/desktop-open-checks.mjs';

const failures = [];

if (os.platform() === 'darwin') {
  const result = spawnSync('pnpm', [
    '--filter',
    '@nimiplatform/desktop',
    'run',
    'test:e2e:desktop-open',
    '--',
    '--skip-build',
  ], {
    encoding: 'utf8',
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.status === 0) {
    failures.push('macOS Desktop Open platform e2e preflight must fail closed under D-GATE-060');
  }
  if (!output.includes('D-GATE-060')) {
    failures.push('macOS Desktop Open platform e2e preflight must fail with D-GATE-060 before fixture imports or SDK dist checks');
  }
  if (output.includes('ERR_MODULE_NOT_FOUND') || output.includes('@nimiplatform/sdk/types')) {
    failures.push('macOS Desktop Open platform e2e preflight reached SDK dist import before D-GATE-060');
  }
}

failWith('Desktop Open e2e preflight guard failed.', failures);
pass('desktop open e2e preflight guard passed');
