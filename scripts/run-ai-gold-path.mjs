#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import process from 'node:process';

const args = process.argv.slice(2);
const result = spawnSync(
  'npx',
  ['tsx', 'scripts/ai-gold-path/run.ts', ...args],
  {
    stdio: 'inherit',
    env: process.env,
  },
);

process.exit(result.status ?? 1);
