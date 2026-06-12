#!/usr/bin/env node

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import YAML from 'yaml';

const REALM_SPEC_ROOT = '.nimi/spec/realm';
const BYPASS_ENV = 'NIMI_ALLOW_REALM_SPEC_PROJECTION_SYNC';
const DELEGATED_PROJECTION_ADMISSIONS =
  '.nimi/spec/platform/kernel/tables/delegated-projection-admissions.yaml';
const REALM_ADMISSION_ID = 'realm-parent-spec-projection';

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

function runShell(command) {
  const result = spawnSync(command, {
    cwd: process.cwd(),
    shell: true,
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`delegated Realm projection verification failed: ${command}`);
  }
}

function loadRealmProjectionAdmission() {
  const text = fs.readFileSync(DELEGATED_PROJECTION_ADMISSIONS, 'utf8');
  const document = YAML.parse(text);
  const admissions = Array.isArray(document?.admissions) ? document.admissions : [];
  const admission = admissions.find((item) => item?.id === REALM_ADMISSION_ID);
  if (!admission) {
    throw new Error(`${DELEGATED_PROJECTION_ADMISSIONS}: missing ${REALM_ADMISSION_ID}`);
  }
  if (admission.admission_posture !== 'active') {
    throw new Error(`${REALM_ADMISSION_ID} admission_posture must be active`);
  }
  if (admission.authority_root !== REALM_SPEC_ROOT) {
    throw new Error(`${REALM_ADMISSION_ID} authority_root must be ${REALM_SPEC_ROOT}`);
  }
  const commands = Array.isArray(admission.required_verification_commands)
    ? admission.required_verification_commands.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  if (commands.length === 0) {
    throw new Error(`${REALM_ADMISSION_ID} must declare required_verification_commands`);
  }
  return { commands };
}

function runRequiredProjectionVerification() {
  const admission = loadRealmProjectionAdmission();
  for (const command of admission.commands) {
    runShell(command);
  }
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
  runRequiredProjectionVerification();
  const paths = listRealmSpecChanges();
  if (paths.length === 0) {
    process.stdout.write('realm spec projection guard passed with delegated verification\n');
    return;
  }

  if (process.env[BYPASS_ENV] === '1') {
    process.stdout.write(
      `realm spec projection guard verified and acknowledged by ${BYPASS_ENV}=1 for ${paths.length} projected file change(s)\n`,
    );
    return;
  }

  printBlockedMessage(paths);
  process.exit(1);
}

main();
