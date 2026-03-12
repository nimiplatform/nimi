#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { prepareNimiModsSdkSnapshot } from './lib/prepare-nimi-mods-sdk.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modsWorkspaceDir = path.join(repoRoot, 'nimi-mods');
const localChatDir = path.join(modsWorkspaceDir, 'runtime', 'local-chat');

if (!existsSync(modsWorkspaceDir) || !existsSync(localChatDir)) {
  process.stdout.write('[run-local-chat-e2e] skipped: optional nimi-mods/runtime/local-chat workspace not present\n');
  process.exit(0);
}

prepareNimiModsSdkSnapshot({
  repoRoot,
  logPrefix: '[run-local-chat-e2e]',
});

const result = spawnSync(
  'pnpm',
  ['--dir', 'nimi-mods', 'run', 'test:local-chat-e2e'],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    encoding: 'utf8',
  },
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
