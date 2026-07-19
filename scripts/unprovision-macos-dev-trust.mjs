#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, lstatSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { MACOS_LOCAL_DEVELOPMENT_PROFILE } from '../apps/desktop/scripts/generated/macos-local-development-profile.mjs';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptRoot, '..');
const helperPath = '/usr/local/libexec/nimi-macos-dev-security';
const bootstrapHelperPath = MACOS_LOCAL_DEVELOPMENT_PROFILE.bootstrapHelperPath;
const helperSource = path.join(repoRoot, '.nimi', 'local', 'macos-dev-security-build', 'nimi-macos-dev-security');
const signingCleanupRecordPath = MACOS_LOCAL_DEVELOPMENT_PROFILE.signingCleanupRecordPath;
const signingProfilePath = path.join(path.dirname(signingCleanupRecordPath), 'dev-signing-profile.json');
const signingKeychainPath = MACOS_LOCAL_DEVELOPMENT_PROFILE.signingKeychainPath;
const confirmation = 'UNPROVISION NIMI MACOS DEV TRUST';

if (process.argv.length !== 2) fail('macos-dev-trust-argument-invalid', 'run_pnpm_unprovision_macos_dev_trust_without_arguments', 'unprovision:macos-dev-trust accepts no arguments');
if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  fail('dev-runtime-platform-unsupported', 'use_apple_silicon_macos', 'macOS development trust unprovisioning requires native Apple Silicon macOS.');
}
for (const fixedHelperPath of [bootstrapHelperPath, helperPath]) {
  if (!existsSync(fixedHelperPath)) continue;
  const metadata = lstatSync(fixedHelperPath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0 || metadata.gid !== 0
    || metadata.nlink !== 1 || (metadata.mode & 0o022) !== 0 || realpathSync(fixedHelperPath) !== fixedHelperPath) {
    fail('runtime-service-repair-required', 'inspect_the_root_owned_helper_before_removal', 'The installed helper has unsafe metadata.');
  }
}

const impact = {
  preconditions: ['ai.nimi.runtime.dev uninstalled', '_nimiruntimedev absent', 'Nimi Dev, Local App Host Dev, and nimi-runtime not running'],
  deletes: [
    'public local P-256 CA certificate and final-helper-only signing-Keychain unlock secret from System Keychain',
    'all five role identities by deleting the fixed root-owned signing Keychain as one custody boundary',
    'residual keys in the fixed ai.nimi.macos-local-development.v1.* namespace only when label, application tag, EC P-256 type, and key class all match',
    'admin-domain code-signing trust setting for the local CA',
    bootstrapHelperPath,
    helperPath,
    signingProfilePath,
    signingCleanupRecordPath,
  ],
  repairMechanism: `temporarily install the exact current non-authorizing verifier at ${bootstrapHelperPath}; a present unlock secret is deleted only by the preserved exact signed final helper before both fixed paths are removed`,
  residualIdentityClosure: MACOS_LOCAL_DEVELOPMENT_PROFILE.unprovisionResidualIdentityClosure,
  preserves: ['production Nimi paths, identities, Keychain namespace, and data'],
};
process.stdout.write(`${JSON.stringify({ status: 'confirmation-required', confirmation, impact })}\n`);
if (!process.stdin.isTTY || !process.stderr.isTTY) {
  fail('macos-dev-machine-mutation-confirmation-required', 'rerun_interactively_and_enter_the_exact_confirmation_phrase', 'Interactive confirmation is required before deleting System Keychain identities.');
}
const terminal = readline.createInterface({ input: process.stdin, output: process.stderr });
const answer = await terminal.question(`Type ${JSON.stringify(confirmation)} to continue: `);
terminal.close();
if (answer !== confirmation) {
  fail('macos-dev-machine-mutation-cancelled', 'rerun_only_after_approving_the_reported_changes', 'macOS development trust unprovisioning was cancelled.');
}
run(process.execPath, [path.join(scriptRoot, 'build-macos-dev-security-helper.mjs')]);
const sourceBefore = await inspectHelper(helperSource, { uid: process.getuid(), gid: process.getgid() });
run('/usr/bin/sudo', ['/usr/bin/install', '-d', '-o', 'root', '-g', 'wheel', '-m', '0755', '/usr/local/libexec']);
run('/usr/bin/sudo', ['/usr/bin/install', '-o', 'root', '-g', 'wheel', '-m', '0755', helperSource, bootstrapHelperPath]);
const [sourceAfter, installed] = await Promise.all([
  inspectHelper(helperSource, { uid: process.getuid(), gid: process.getgid() }),
  inspectHelper(bootstrapHelperPath, { uid: 0, gid: 0 }),
]);
if (sourceBefore.device !== sourceAfter.device || sourceBefore.inode !== sourceAfter.inode
  || sourceBefore.sha256 !== sourceAfter.sha256 || installed.sha256 !== sourceBefore.sha256) {
  fail(
    'runtime-service-untrusted',
    'inspect_the_repair_helper_bytes_before_retrying_unprovision',
    'The exact cleanup helper source or installed bytes changed during the privileged replacement.',
  );
}
const finalHelperPresent = existsSync(helperPath);
const strandedRepairCandidate = finalHelperPresent
  && existsSync(signingCleanupRecordPath)
  && !existsSync(signingProfilePath)
  && !existsSync(signingKeychainPath);
if (strandedRepairCandidate) {
  const handoff = executePrivilegedHelper(bootstrapHelperPath, 'prepare-stranded-unprovision');
  if (commandFailed(handoff)) surfaceHelperFailure(handoff, 'prepare the exact stranded final-helper cleanup handoff');
}
const cleanupHelper = finalHelperPresent ? helperPath : bootstrapHelperPath;
const result = executePrivilegedHelper(cleanupHelper, 'unprovision-signing-profile');
if (commandFailed(result)) surfaceHelperFailure(result, 'complete the exact final-helper-owned trust cleanup');
process.stdout.write(result.stdout);

function executePrivilegedHelper(helper, command) {
  return spawnSync('/usr/bin/sudo', [helper, command], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      HOME: process.env.HOME,
      LANG: process.env.LANG || 'en_US.UTF-8',
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      TMPDIR: process.env.TMPDIR || '/private/tmp',
    },
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function commandFailed(result) {
  return result.error !== undefined || result.status !== 0;
}

function surfaceHelperFailure(result, operation) {
  const lines = String(result.stderr || '').split(/\r?\n/u).filter(Boolean);
  const structured = lines.reverse().flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  })[0];
  if (structured?.status === 'failed') fail(structured.reasonCode, structured.actionHint, structured.message);
  fail('macos-dev-trust-unprovision-failed', 'inspect_the_System_Keychain_and_helper_failure', `sudo helper failed to ${operation} with status ${result.status ?? 'unavailable'}`);
}

function fail(reasonCode, actionHint, message) {
  process.stderr.write(`${JSON.stringify({ status: 'failed', reasonCode, actionHint, message })}\n`);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      HOME: process.env.HOME,
      LANG: process.env.LANG || 'en_US.UTF-8',
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      TMPDIR: process.env.TMPDIR || '/private/tmp',
    },
    maxBuffer: 16 * 1024 * 1024,
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) {
    fail('macos-dev-trust-unprovision-failed', 'inspect_the_cleanup_helper_build_or_install_failure', `${path.basename(command)} failed with status ${result.status ?? 'unavailable'}`);
  }
}

async function inspectHelper(candidate, expectedOwner) {
  const metadata = lstatSync(candidate);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || metadata.uid !== expectedOwner.uid || metadata.gid !== expectedOwner.gid
    || (metadata.mode & 0o022) !== 0 || (metadata.mode & 0o111) === 0
    || realpathSync(candidate) !== candidate) {
    fail('runtime-service-untrusted', 'inspect_the_exact_cleanup_helper_metadata', `Unsafe cleanup helper metadata at ${candidate}`);
  }
  const digest = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(candidate);
    stream.on('error', reject);
    stream.on('data', (chunk) => digest.update(chunk));
    stream.on('end', resolve);
  });
  return { device: metadata.dev, inode: metadata.ino, sha256: digest.digest('hex') };
}
