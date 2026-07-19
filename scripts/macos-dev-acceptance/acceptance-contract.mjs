import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmod, lstat, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleRoot = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(moduleRoot, '../..');
export const ACCEPTANCE_AUTHORITY_ROOT = path.join(REPO_ROOT, '.nimi', 'local', 'acceptance');
export const REQUIRED_EVIDENCE_FILES = Object.freeze([
  'environment.json',
  'commits-and-worktree.json',
  'signing-and-entitlements.json',
  'launchd-and-sockets.json',
  'desktop-desktop.png',
  'desktop-390.png',
  'zhiyu-desktop.png',
  'zhiyu-390.png',
  'dom-accessibility-summary.json',
  'console-page-network-errors.json',
  'runtime-realm-session-evidence.json',
  'process-tree-before.json',
  'process-tree-after.json',
  'restart-session-rotation.json',
  'negative-tests.json',
  'acceptance-summary.json',
]);

export function parseAcceptanceArguments(argv) {
  const args = argv.slice();
  if (args[0] === '--') args.shift();
  let realmRoot;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--realm-root') {
      if (realmRoot !== undefined || index + 1 >= args.length) failArgument();
      realmRoot = args[index + 1];
      index += 1;
    } else if (value.startsWith('--realm-root=')) {
      if (realmRoot !== undefined) failArgument();
      realmRoot = value.slice('--realm-root='.length);
    } else {
      failArgument();
    }
  }
  if (realmRoot !== undefined && (!path.isAbsolute(realmRoot) || path.normalize(realmRoot) !== realmRoot)) {
    failArgument();
  }
  return Object.freeze({ realmRoot });
}

export async function resolveRealmRoot(explicitRoot) {
  if (explicitRoot) return requireRealmRoot(explicitRoot);
  const candidates = [];
  let current = path.dirname(REPO_ROOT);
  for (let depth = 0; depth < 5; depth += 1) {
    try {
      candidates.push(await requireRealmRoot(current));
    } catch {
      // Parent discovery admits only directories that satisfy every marker.
    }
    const next = path.dirname(current);
    if (next === current) break;
    current = next;
  }
  const unique = [...new Set(candidates)];
  if (unique.length !== 1) {
    throw acceptanceError(
      'realm-root-ambiguous-or-missing',
      'rerun_with_one_explicit_canonical_realm_root',
      `Realm root discovery requires exactly one marker-complete parent; found ${unique.length}.`,
    );
  }
  return unique[0];
}

export async function createAcceptanceContext(realmRoot) {
  await mkdir(ACCEPTANCE_AUTHORITY_ROOT, { recursive: true, mode: 0o700 });
  const canonicalAuthority = await realpath(ACCEPTANCE_AUTHORITY_ROOT);
  const metadata = await lstat(canonicalAuthority);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.()) {
    throw acceptanceError(
      'acceptance-evidence-root-untrusted',
      'repair_the_private_local_acceptance_directory',
      'The macOS acceptance authority root is not a private canonical user-owned directory.',
    );
  }
  await chmod(canonicalAuthority, 0o700);
  const evidenceRoot = path.join(canonicalAuthority, `${localDate()}-macos-runtime-desktop-zhiyu`);
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  await requirePrivateDirectory(evidenceRoot);
  const runId = `${new Date().toISOString().replaceAll(/[:.]/gu, '-')}-${randomUUID()}`;
  const workRoot = path.join(evidenceRoot, `.in-progress-${runId}`);
  await mkdir(workRoot, { mode: 0o700 });
  await mkdir(path.join(workRoot, 'logs'), { mode: 0o700 });
  await mkdir(path.join(workRoot, 'desktop-user-data'), { mode: 0o700 });
  await mkdir(path.join(workRoot, 'zhiyu-user-data'), { mode: 0o700 });
  return Object.freeze({ evidenceRoot, realmRoot, repoRoot: REPO_ROOT, runId, workRoot });
}

export async function publishAcceptanceEvidence(context) {
  for (const name of REQUIRED_EVIDENCE_FILES) {
    const source = path.join(context.workRoot, name);
    const sourceMetadata = await stat(source).catch(() => undefined);
    if (!sourceMetadata?.isFile()) {
      throw acceptanceError('acceptance-evidence-incomplete', 'inspect_the_in_progress_acceptance_run', `Required evidence is absent: ${name}`);
    }
    const target = path.join(context.evidenceRoot, name);
    if (await stat(target).catch(() => undefined)) {
      throw acceptanceError('acceptance-evidence-already-exists', 'preserve_then_move_the_prior_acceptance_evidence', `Refusing to overwrite prior evidence: ${target}`);
    }
  }
  for (const name of REQUIRED_EVIDENCE_FILES) {
    await rename(path.join(context.workRoot, name), path.join(context.evidenceRoot, name));
  }
  await rename(path.join(context.workRoot, 'logs'), path.join(context.evidenceRoot, `logs-${context.runId}`));
  await rename(path.join(context.workRoot, 'desktop-user-data'), path.join(context.evidenceRoot, `desktop-user-data-${context.runId}`));
  await rename(path.join(context.workRoot, 'zhiyu-user-data'), path.join(context.evidenceRoot, `zhiyu-user-data-${context.runId}`));
  await rename(context.workRoot, path.join(context.evidenceRoot, `completed-${context.runId}`));
  return context.evidenceRoot;
}

export async function preserveBlockedEvidence(context, failure) {
  const summary = path.join(context.workRoot, 'acceptance-summary.json');
  if (!await stat(summary).catch(() => undefined)) {
    await writeJson(summary, {
      schemaVersion: 'nimi.macos-dev-chain-acceptance/v1',
      status: 'blocked',
      capturedAt: new Date().toISOString(),
      failure: projectError(failure),
      productionAdmission: false,
      tauriAdmission: false,
    });
  }
  const target = path.join(context.evidenceRoot, `blocked-${context.runId}`);
  await rename(context.workRoot, target);
  return target;
}

export async function captureEnvironment() {
  const [macOSVersion, xcode, commandLineTools, rosetta] = await Promise.all([
    fixedOutput('/usr/bin/sw_vers', ['-productVersion']),
    fixedOutput('/usr/bin/xcodebuild', ['-version']).catch((error) => `unavailable: ${error.message}`),
    fixedOutput('/usr/bin/xcode-select', ['-p']).catch((error) => `unavailable: ${error.message}`),
    fixedOutput('/usr/bin/pgrep', ['oahd']).then(() => true).catch(() => false),
  ]);
  return Object.freeze({
    schemaVersion: 'nimi.macos-dev-chain-environment/v1',
    capturedAt: new Date().toISOString(),
    macOSVersion,
    architecture: process.arch,
    hardware: fixedOutputSync('/usr/sbin/sysctl', ['-n', 'machdep.cpu.brand_string']),
    xcode,
    commandLineTools,
    go: fixedOutputSync('/usr/bin/env', ['go', 'version']),
    rust: fixedOutputSync('/usr/bin/env', ['rustc', '--version']),
    node: process.version,
    pnpm: fixedOutputSync('/usr/bin/env', ['pnpm', '--version']),
    rosettaProcessPresent: rosetta,
    signingIdentityCount: signingIdentityCount(),
    productAdmission: false,
    profile: 'macos_local_development_v1',
  });
}

export function captureGitState(root) {
  const upstream = git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], true);
  const divergence = upstream ? git(root, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`], true) : '';
  const [behind = null, ahead = null] = divergence ? divergence.split(/\s+/u).map(Number) : [];
  return Object.freeze({
    root,
    branch: git(root, ['branch', '--show-current']),
    head: git(root, ['rev-parse', 'HEAD']),
    upstream: upstream || null,
    ahead,
    behind,
    worktree: git(root, ['status', '--short']),
  });
}

export async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
}

export function projectError(error) {
  return Object.freeze({
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
    reasonCode: error && typeof error === 'object' && typeof error.reasonCode === 'string' ? error.reasonCode : 'macos-dev-acceptance-failed',
    actionHint: error && typeof error === 'object' && typeof error.actionHint === 'string' ? error.actionHint : 'inspect_the_acceptance_evidence',
  });
}

export function acceptanceError(reasonCode, actionHint, message, details = undefined) {
  return Object.assign(new Error(message), { reasonCode, actionHint, details });
}

async function requireRealmRoot(candidate) {
  const canonical = await realpath(candidate);
  if (canonical !== candidate) throw new Error('non-canonical');
  const rootMetadata = await stat(canonical);
  if (!rootMetadata.isDirectory()) throw new Error('not-directory');
  const packageDocument = JSON.parse(await readFile(path.join(canonical, 'package.json'), 'utf8'));
  const governance = await readFile(path.join(canonical, '.nimi', 'config', 'governance.yaml'), 'utf8');
  const nestedNimi = await realpath(path.join(canonical, 'nimi'));
  const backend = await stat(path.join(canonical, 'nimi-backend'));
  if (packageDocument?.name !== 'nimi-monorepo' || !/^profile_id:\s*nimi-realm\s*$/mu.test(governance)
    || nestedNimi !== REPO_ROOT || !backend.isDirectory()) throw new Error('marker-mismatch');
  return canonical;
}

async function requirePrivateDirectory(candidate) {
  const canonical = await realpath(candidate);
  const metadata = await lstat(candidate);
  if (canonical !== candidate || !metadata.isDirectory() || metadata.isSymbolicLink()
    || metadata.uid !== process.getuid?.() || (metadata.mode & 0o077) !== 0) {
    throw acceptanceError('acceptance-evidence-root-untrusted', 'repair_the_private_local_acceptance_directory', `Unsafe acceptance directory: ${candidate}`);
  }
  await chmod(candidate, 0o700);
}

function localDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function git(root, args, optional = false) {
  try {
    return execFileSync('/usr/bin/git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (error) {
    if (optional) return '';
    throw error;
  }
}

function signingIdentityCount() {
  try {
    const output = fixedOutputSync('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning']);
    const match = output.match(/(\d+) valid identities found/u);
    return match ? Number(match[1]) : 0;
  } catch {
    return 0;
  }
}

function fixedOutputSync(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function fixedOutput(command, args) {
  return fixedOutputSync(command, args);
}

function failArgument() {
  throw acceptanceError(
    'macos-dev-acceptance-argument-invalid',
    'use_only_an_optional_exact_realm_root',
    'Usage: pnpm test:acceptance:macos-dev-chain -- --realm-root /absolute/nimi-realm',
  );
}
