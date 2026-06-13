#!/usr/bin/env node

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import YAML from 'yaml';

const REALM_SPEC_ROOT = '.nimi/spec/realm';
const BYPASS_ENV = 'NIMI_ALLOW_REALM_SPEC_PROJECTION_SYNC';
const VERIFIER_COMMAND_ENV = 'NIMI_REALM_PROJECTION_VERIFIER';
const BASE_SHA_ENVS = [
  'NIMI_REALM_SPEC_PROJECTION_BASE_SHA',
  'NIMI_BASE_SHA',
  'PR_BASE_SHA',
  'GITHUB_BASE_SHA',
];
const DELEGATED_PROJECTION_ADMISSIONS =
  '.nimi/spec/platform/kernel/tables/delegated-projection-admissions.yaml';
const REALM_ADMISSION_ID = 'realm-spec-projection';
const REQUIRED_VERIFIER_LOCATOR = 'external-verifier://realm-spec-projection';

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

function tryRunGit(args) {
  const result = spawnSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    return null;
  }
  return String(result.stdout || '');
}

function runProjectionVerifier(command, changes) {
  const result = spawnSync(command, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NIMI_REALM_PROJECTION_CHANGED_PATHS: changes.paths.join('\n'),
      NIMI_REALM_PROJECTION_DIRTY_COUNT: String(changes.dirty.length),
      NIMI_REALM_PROJECTION_COMMITTED_COUNT: String(changes.committed.paths.length),
      NIMI_REALM_PROJECTION_BASE_REF: changes.committed.base?.ref || '',
      NIMI_REALM_PROJECTION_BASE_SOURCE: changes.committed.base?.source || '',
    },
    shell: true,
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`delegated Realm projection verifier failed`);
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
  if (commands.length !== 1 || commands[0] !== REQUIRED_VERIFIER_LOCATOR) {
    throw new Error(`${REALM_ADMISSION_ID} must declare ${REQUIRED_VERIFIER_LOCATOR}`);
  }
  return { commands };
}

function runRequiredProjectionVerification({ requireVerification, changes }) {
  loadRealmProjectionAdmission();
  if (!requireVerification) {
    return 'no-projection-change';
  }
  const verifierCommand = String(process.env[VERIFIER_COMMAND_ENV] || '').trim();
  if (!verifierCommand) {
    throw new Error(
      [
        'Realm projection changes require external projection verification.',
        `Set ${VERIFIER_COMMAND_ENV} to an opaque verifier command supplied by the trusted projection environment.`,
        `Do not use ${BYPASS_ENV}=1 without a successful external projection verification.`,
      ].join('\n'),
    );
  }
  runProjectionVerifier(verifierCommand, changes);
  return 'verified:external-projection-verifier';
}

function normalizeGitPath(rawPath) {
  return String(rawPath || '')
    .trim()
    .replace(/^"(.+)"$/u, '$1');
}

function listDirtyRealmSpecChanges() {
  const output = runGit([
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '--',
    REALM_SPEC_ROOT,
  ]);
  const paths = output
    .split(/\r?\n/)
    .map((line) => normalizeGitPath(line.slice(3)))
    .filter(Boolean);
  return [...new Set(paths)].sort((a, b) => a.localeCompare(b));
}

function resolveCommittedDiffBase() {
  for (const envName of BASE_SHA_ENVS) {
    const value = String(process.env[envName] || '').trim();
    if (value) {
      return { ref: value, source: envName };
    }
  }
  const mergeBase = tryRunGit(['merge-base', 'origin/develop', 'HEAD']);
  const ref = String(mergeBase || '').trim();
  if (ref) {
    return { ref, source: 'merge-base:origin/develop' };
  }
  return null;
}

function listCommittedRealmSpecChanges() {
  const base = resolveCommittedDiffBase();
  if (!base) {
    throw new Error(
      [
        'Unable to resolve a base ref for committed Realm projection diff detection.',
        `Set ${BASE_SHA_ENVS[0]} or NIMI_BASE_SHA/PR_BASE_SHA/GITHUB_BASE_SHA,`,
        'or fetch origin/develop so the guard can evaluate origin/develop..HEAD.',
      ].join(' '),
    );
  }
  const output = runGit([
    'diff',
    '--name-only',
    `${base.ref}..HEAD`,
    '--',
    REALM_SPEC_ROOT,
  ]);
  const paths = output
    .split(/\r?\n/)
    .map((line) => normalizeGitPath(line))
    .filter(Boolean);
  return {
    paths: [...new Set(paths)].sort((a, b) => a.localeCompare(b)),
    base,
  };
}

function listRealmSpecChanges() {
  const dirty = listDirtyRealmSpecChanges();
  const committed = listCommittedRealmSpecChanges();
  const paths = [...new Set([...dirty, ...committed.paths])].sort((a, b) => a.localeCompare(b));
  return { paths, dirty, committed };
}

function printBlockedMessage(paths) {
  process.stderr.write(
    [
      `ERROR: ${REALM_SPEC_ROOT}/ is a delegated Realm projection.`,
      '',
      'Do not edit Realm spec projection files directly in this repository.',
      '',
      'Fix:',
      '  produce a verified Realm projection update outside this public repository',
      '  expose only the public projection diff in this repository',
      `  run ${VERIFIER_COMMAND_ENV}=<opaque verifier> pnpm check:realm-spec-projection-guard`,
      '',
      'Only for projection-sync commits after the external verifier passes:',
      `  ${BYPASS_ENV}=1 <gate-or-commit-command>`,
      '',
      `${BYPASS_ENV} is not a general force switch. It only acknowledges that this diff`,
      'came from a verified Realm projection update.',
      '',
      'Blocked Realm spec projection changes:',
      ...paths.map((filePath) => `  - ${filePath}`),
      '',
    ].join('\n'),
  );
}

function main() {
  const changes = listRealmSpecChanges();
  const paths = changes.paths;
  const verification = runRequiredProjectionVerification({
    requireVerification: paths.length > 0 || process.env[BYPASS_ENV] === '1',
    changes,
  });
  if (paths.length === 0) {
    process.stdout.write(`realm spec projection guard passed (${verification})\n`);
    return;
  }

  if (process.env[BYPASS_ENV] === '1') {
    const committedDetail = changes.committed.base
      ? `, committed_base=${changes.committed.base.source}:${changes.committed.base.ref}`
      : '';
    process.stdout.write(
      `realm spec projection guard verified and acknowledged by ${BYPASS_ENV}=1 for ${paths.length} projected file change(s) (${changes.dirty.length} dirty, ${changes.committed.paths.length} committed${committedDetail})\n`,
    );
    return;
  }

  printBlockedMessage(paths);
  process.exit(1);
}

main();
