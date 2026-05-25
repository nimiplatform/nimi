#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import process from 'node:process';

const REALM_SPEC_ROOT = '.nimi/spec/realm';
const BYPASS_ENV = 'NIMI_ALLOW_REALM_SPEC_PROJECTION_SYNC';

function runGit(args) {
  const result = spawnSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return String(result.stdout || '');
}

function listRealmSpecChanges() {
  const output = runGit([
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '--',
    REALM_SPEC_ROOT,
  ]);
  const paths = output
    .split(/\r?\n/)
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
  return [...new Set(paths)].sort((a, b) => a.localeCompare(b));
}

function printBlockedMessage(paths) {
  process.stderr.write(
    [
      `ERROR: ${REALM_SPEC_ROOT}/ is a projection from the parent nimi-realm repo.`,
      '',
      'Do not edit Realm spec projection files directly in the nested nimi repo.',
      '',
      'Fix:',
      '  cd ~/nimi-realm',
      '  edit .nimi/spec/realm',
      '  pnpm spec:realm:generate',
      '  pnpm spec:realm:sync:nimi',
      '  pnpm spec:realm:check:nimi-sync',
      '',
      'Only for projection-sync commits produced by the parent repo, after the root gate passes:',
      `  ${BYPASS_ENV}=1 <gate-or-commit-command>`,
      '',
      `${BYPASS_ENV} is not a general force switch. It only acknowledges that this diff`,
      'came from parent root projection sync.',
      '',
      'Blocked Realm spec projection changes:',
      ...paths.map((filePath) => `  - ${filePath}`),
      '',
    ].join('\n'),
  );
}

function main() {
  const paths = listRealmSpecChanges();
  if (paths.length === 0) {
    process.stdout.write('realm spec projection guard passed\n');
    return;
  }

  if (process.env[BYPASS_ENV] === '1') {
    process.stdout.write(
      `realm spec projection guard bypassed by ${BYPASS_ENV}=1 for ${paths.length} projected file change(s)\n`,
    );
    return;
  }

  printBlockedMessage(paths);
  process.exit(1);
}

main();
