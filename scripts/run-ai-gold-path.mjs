#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const runnerPath = fileURLToPath(new URL('./ai-gold-path/run.ts', import.meta.url));
const result = spawnSync(
  'pnpm',
  ['--filter', '@nimiplatform/sdk', 'exec', 'tsx', runnerPath, ...args],
  {
    stdio: 'inherit',
    env: process.env,
  },
);

process.exit(result.status ?? 1);
