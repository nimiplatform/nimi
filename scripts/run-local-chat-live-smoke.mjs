#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { buildMergedEnv } from './lib/live-env.mjs';
import { prepareNimiModsSdkSnapshot } from './lib/prepare-nimi-mods-sdk.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modsWorkspaceDir = path.join(repoRoot, 'nimi-mods');
const localChatDir = path.join(modsWorkspaceDir, 'runtime', 'local-chat');
const liveEnv = buildMergedEnv({
  baseEnv: process.env,
  filePaths: [
    path.join(repoRoot, 'dev', 'config', 'dashscope-gold-path.env'),
    path.join(repoRoot, '.env'),
  ],
});

if (!existsSync(modsWorkspaceDir) || !existsSync(localChatDir)) {
  process.stdout.write('[run-local-chat-live-smoke] skipped: optional nimi-mods/runtime/local-chat workspace not present\n');
  process.exit(0);
}

prepareNimiModsSdkSnapshot({
  repoRoot,
  env: liveEnv,
  logPrefix: '[run-local-chat-live-smoke]',
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
