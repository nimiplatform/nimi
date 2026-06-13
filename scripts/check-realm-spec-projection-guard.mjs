#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import YAML from 'yaml';

const REALM_SPEC_ROOT = '.nimi/spec/realm';
const BYPASS_ENV = 'NIMI_ALLOW_REALM_SPEC_PROJECTION_SYNC';
const REALM_SOURCE_ROOT_ENV = 'NIMI_REALM_SOURCE_ROOT';
const BASE_SHA_ENVS = [
  'NIMI_REALM_SPEC_PROJECTION_BASE_SHA',
  'NIMI_BASE_SHA',
  'PR_BASE_SHA',
  'GITHUB_BASE_SHA',
];
const DELEGATED_PROJECTION_ADMISSIONS =
  '.nimi/spec/platform/kernel/tables/delegated-projection-admissions.yaml';
const REALM_ADMISSION_ID = 'realm-parent-spec-projection';
const REALM_SOURCE_CHECK_COMMANDS = new Map([
  ['realm-source-check://nimi-sync', 'pnpm spec:realm:check:nimi-sync'],
  ['realm-source-check://drift', 'pnpm spec:realm:check:drift'],
  ['realm-source-check://nimi-generated', 'pnpm spec:realm:check:nimi-generated'],
]);

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

function isRealmSourceRoot(sourceRoot) {
  if (!sourceRoot) return false;
  const packageJsonPath = path.join(sourceRoot, 'package.json');
  const syncScriptPath = path.join(sourceRoot, 'scripts', 'spec', 'realm', 'sync-nimi-open-spec.ts');
  const projectedRootPath = path.join(sourceRoot, 'nimi', REALM_SPEC_ROOT);
  if (!fs.existsSync(packageJsonPath) || !fs.existsSync(syncScriptPath) || !fs.existsSync(projectedRootPath)) {
    return false;
  }
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const scripts = packageJson && typeof packageJson === 'object' ? packageJson.scripts : null;
    return Boolean(
      scripts?.['spec:realm:check:nimi-sync'] &&
      scripts?.['spec:realm:check:drift'] &&
      scripts?.['spec:realm:check:nimi-generated'],
    );
  } catch {
    return false;
  }
}

function resolveRealmSourceRoot() {
  const explicit = String(process.env[REALM_SOURCE_ROOT_ENV] || '').trim();
  if (explicit) {
    const resolved = path.resolve(process.cwd(), explicit);
    if (!isRealmSourceRoot(resolved)) {
      throw new Error(`${REALM_SOURCE_ROOT_ENV} is not a Realm source checkout with projection check scripts: ${resolved}`);
    }
    return resolved;
  }
  const parent = path.resolve(process.cwd(), '..');
  return isRealmSourceRoot(parent) ? parent : null;
}

function runShell(command, cwd) {
  const result = spawnSync(command, {
    cwd,
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

function runRequiredProjectionVerification({ requireSource }) {
  const admission = loadRealmProjectionAdmission();
  const sourceRoot = resolveRealmSourceRoot();
  if (!sourceRoot) {
    if (requireSource) {
      throw new Error(
        [
          'Realm projection changes require source-authority verification.',
          `Set ${REALM_SOURCE_ROOT_ENV} to the Realm source checkout, or run from the nested checkout layout.`,
          `Do not use ${BYPASS_ENV}=1 without a successful source-authority projection check.`,
        ].join('\n'),
      );
    }
    return 'skipped-no-local-source-clean-projection';
  }
  for (const command of admission.commands) {
    const shellCommand = REALM_SOURCE_CHECK_COMMANDS.get(command);
    if (!shellCommand) {
      throw new Error(`unsupported delegated Realm source check locator: ${command}`);
    }
    runShell(shellCommand, sourceRoot);
  }
  return `verified:${sourceRoot}`;
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
      `ERROR: ${REALM_SPEC_ROOT}/ is a delegated Realm source projection.`,
      '',
      'Do not edit Realm spec projection files directly in this repository.',
      '',
      'Fix:',
      '  update the Realm source authority',
      '  regenerate the Realm projection',
      '  sync the projection into this repository',
      '  run the Realm source projection checks',
      '',
      'Only for projection-sync commits produced by the Realm source authority, after the source gate passes:',
      `  ${BYPASS_ENV}=1 <gate-or-commit-command>`,
      '',
      `${BYPASS_ENV} is not a general force switch. It only acknowledges that this diff`,
      'came from Realm source projection sync.',
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
    requireSource: paths.length > 0 || process.env[BYPASS_ENV] === '1',
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
