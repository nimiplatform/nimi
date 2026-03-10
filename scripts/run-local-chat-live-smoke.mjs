#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { buildMergedEnv } from './lib/live-env.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const liveEnv = buildMergedEnv({
  baseEnv: process.env,
  filePaths: [
    path.join(repoRoot, 'dev', 'config', 'dashscope-gold-path.env'),
    path.join(repoRoot, '.env'),
  ],
});

const result = spawnSync(
  'pnpm',
  ['--dir', 'nimi-mods', 'run', 'test:local-chat-live-smoke'],
  {
    cwd: repoRoot,
    env: {
      ...liveEnv,
      NIMI_MODS_LIVE: '1',
    },
    stdio: 'inherit',
    encoding: 'utf8',
  },
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
