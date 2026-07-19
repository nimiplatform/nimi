#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { MACOS_LOCAL_DEVELOPMENT_PROFILE } from '../apps/desktop/scripts/generated/macos-local-development-profile.mjs';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptRoot, '..');
const helperSource = path.join(repoRoot, '.nimi', 'local', 'macos-dev-security-build', 'nimi-macos-dev-security');
const finalHelperPath = '/usr/local/libexec/nimi-macos-dev-security';
const bootstrapHelperPath = MACOS_LOCAL_DEVELOPMENT_PROFILE.bootstrapHelperPath;
const repairJournalPath = MACOS_LOCAL_DEVELOPMENT_PROFILE.runtimePartialInstallRepairJournalPath;
const confirmation = 'REPAIR NIMI MACOS DEV RUNTIME INSTALL';

if (process.argv.length !== 2) {
  fail('macos-dev-runtime-repair-argument-invalid', 'run_pnpm_repair_macos_dev_runtime_install_without_arguments', 'repair:macos-dev-runtime-install accepts no arguments');
}
if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  fail('dev-runtime-platform-unsupported', 'use_native_apple_silicon_macos', 'macOS Runtime partial-install repair requires native Apple Silicon macOS.');
}
if (!existsSync(finalHelperPath)) {
  fail('runtime-service-repair-required', 'restore_the_exact_signed_final_helper_before_repair', 'The signed final development helper is absent.');
}
if (lstatSync(bootstrapHelperPath, { throwIfNoEntry: false }) !== undefined) {
  fail('runtime-service-repair-required', 'inspect_the_existing_bootstrap_before_repair', `Refusing to overwrite an existing bootstrap helper at ${bootstrapHelperPath}.`);
}

const impact = Object.freeze({
  preconditions: [
    'the signed local-development trust profile and final helper remain installed',
    'the exact signed final helper can prove its private signing-Keychain custody without interaction',
    'ai.nimi.runtime.dev is unloaded and no Runtime, Nimi Dev, Local App Host, or service-UID process is live',
    'Runtime Keychain custody namespace is empty',
    'only the exact failed first-install residue is present',
  ],
  temporaryWrites: [
    `root-owned ${bootstrapHelperPath}; removed and proved absent before success`,
    `root-owned ${repairJournalPath} plus its fixed single-use staging vnode; both removed and proved absent before success`,
  ],
  deletesOnlyIfExactWitnessesMatch: [
    '/Library/LaunchDaemons/ai.nimi.runtime.dev.plist',
    'empty RuntimeDev state, transactions, rollback, and /private/var/run/nimi-dev directories',
    'the exact _nimiruntimedev user/group bound by UID, GID, both GeneratedUID values, raw negative attributes, POSIX projection, and full local-group reference proof',
    repairJournalPath,
  ],
  preserves: [
    'local CA and admin code-signing trust',
    'locked signing Keychain and all role identities',
    finalHelperPath,
    'public signing profile and cleanup record',
    'production Nimi paths and data',
  ],
  exclusions: [
    'does not delete unknown Keychain items, non-empty directories, mismatched accounts, payloads, sockets, or live processes',
    'does not retry installation, provision Runtime custody, or alter TCC/Gatekeeper settings',
  ],
  productAdmission: false,
});

process.stdout.write(`${JSON.stringify({ status: 'confirmation-required', confirmation, impact })}\n`);
if (!process.stdin.isTTY || !process.stderr.isTTY) {
  fail('macos-dev-machine-mutation-confirmation-required', 'rerun_interactively_and_enter_the_exact_confirmation_phrase', 'Interactive confirmation is required before exact partial-install repair.');
}
const terminal = readline.createInterface({ input: process.stdin, output: process.stderr });
const answer = await terminal.question(`Type ${JSON.stringify(confirmation)} to continue: `);
terminal.close();
if (answer !== confirmation) {
  fail('macos-dev-machine-mutation-cancelled', 'rerun_only_after_approving_the_reported_exact_deletions', 'macOS Runtime partial-install repair was cancelled.');
}

runInherited(process.execPath, [path.join(scriptRoot, 'build-macos-dev-security-helper.mjs')]);
const sourceBefore = await inspectHelper(helperSource, { uid: process.getuid(), gid: process.getgid() });
runInherited('/usr/bin/sudo', ['/usr/bin/install', '-o', 'root', '-g', 'wheel', '-m', '0755', helperSource, bootstrapHelperPath]);
const [sourceAfter, installed] = await Promise.all([
  inspectHelper(helperSource, { uid: process.getuid(), gid: process.getgid() }),
  inspectHelper(bootstrapHelperPath, { uid: 0, gid: 0 }),
]);
if (sourceBefore.device !== sourceAfter.device || sourceBefore.inode !== sourceAfter.inode
  || sourceBefore.sha256 !== sourceAfter.sha256 || installed.sha256 !== sourceBefore.sha256) {
  cleanupExactBootstrap(sourceBefore.sha256);
  fail('runtime-service-untrusted', 'rebuild_the_exact_repair_bootstrap', 'The repair helper source or installed root-owned snapshot changed before execution.');
}

const result = execute('/usr/bin/sudo', [bootstrapHelperPath, 'repair-partial-runtime-install']);
if (commandFailed(result)) {
  const cleanup = cleanupExactBootstrap(sourceBefore.sha256);
  const structured = parseLastFailure(result.stderr);
  if (structured) {
    fail(structured.reasonCode, structured.actionHint, `${structured.message}${cleanup ? ` Bootstrap cleanup: ${cleanup}` : ''}`);
  }
  fail(
    'runtime-service-repair-required',
    'inspect_the_exact_partial_install_repair_journal_before_retrying',
    `The privileged repair helper failed with status ${result.status ?? 'unavailable'}.${cleanup ? ` Bootstrap cleanup: ${cleanup}` : ''}`,
  );
}

let receipt;
try { receipt = JSON.parse(String(result.stdout || '').trim()); }
catch {
  cleanupExactBootstrap(sourceBefore.sha256);
  fail('runtime-service-repair-required', 'inspect_the_privileged_repair_result', 'The privileged repair helper did not return one JSON receipt.');
}
if (receipt?.status !== 'repaired' || !['residue-removed', 'already-clean'].includes(receipt?.disposition)) {
  cleanupExactBootstrap(sourceBefore.sha256);
  fail('runtime-service-repair-required', 'inspect_the_privileged_repair_result', 'The privileged repair helper returned an unrecognized receipt.');
}
if (lstatSync(bootstrapHelperPath, { throwIfNoEntry: false }) !== undefined) {
  cleanupExactBootstrap(sourceBefore.sha256);
  fail('runtime-service-repair-required', 'inspect_the_bootstrap_retirement', 'Repair completed but the temporary bootstrap helper was not retired.');
}
process.stdout.write(`${JSON.stringify(receipt)}\n`);

function execute(command, args, stdio = ['ignore', 'pipe', 'pipe']) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      HOME: process.env.HOME,
      LANG: process.env.LANG || 'en_US.UTF-8',
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      TMPDIR: process.env.TMPDIR || '/private/tmp',
    },
    maxBuffer: 16 * 1024 * 1024,
    stdio,
  });
}

function runInherited(command, args) {
  const result = execute(command, args, 'inherit');
  if (commandFailed(result)) {
    fail('runtime-service-repair-required', 'inspect_the_repair_helper_build_or_install_failure', `${path.basename(command)} failed with status ${result.status ?? 'unavailable'}.`);
  }
}

function cleanupExactBootstrap(expectedSHA256) {
  if (lstatSync(bootstrapHelperPath, { throwIfNoEntry: false }) === undefined) return '';
  try {
    const metadata = lstatSync(bootstrapHelperPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0 || metadata.gid !== 0
      || metadata.nlink !== 1 || (metadata.mode & 0o022) !== 0 || realpathSync(bootstrapHelperPath) !== bootstrapHelperPath) {
      return 'unsafe bootstrap metadata; it was preserved for inspection';
    }
    const digest = createHash('sha256').update(readFileSync(bootstrapHelperPath)).digest('hex');
    if (digest !== expectedSHA256) return 'bootstrap digest changed; it was preserved for inspection';
    const removal = execute('/usr/bin/sudo', ['/bin/rm', '-f', '--', bootstrapHelperPath], 'inherit');
    if (commandFailed(removal) || lstatSync(bootstrapHelperPath, { throwIfNoEntry: false }) !== undefined) return 'exact bootstrap removal failed';
    return 'exact bootstrap removed';
  } catch (error) {
    return `bootstrap cleanup could not be proven: ${error.message}`;
  }
}

function commandFailed(result) {
  return result.error !== undefined || result.status !== 0;
}

function parseLastFailure(stderr) {
  for (const line of String(stderr || '').split(/\r?\n/u).reverse()) {
    try {
      const parsed = JSON.parse(line);
      if (parsed?.status === 'failed' && parsed.reasonCode && parsed.actionHint && parsed.message) return parsed;
    } catch { /* diagnostic line */ }
  }
  return undefined;
}

async function inspectHelper(candidate, expectedOwner) {
  const metadata = lstatSync(candidate);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || metadata.uid !== expectedOwner.uid || metadata.gid !== expectedOwner.gid
    || (metadata.mode & 0o022) !== 0 || (metadata.mode & 0o111) === 0
    || realpathSync(candidate) !== candidate) {
    fail('runtime-service-untrusted', 'inspect_the_exact_repair_helper_metadata', `Unsafe repair helper metadata at ${candidate}.`);
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

function fail(reasonCode, actionHint, message) {
  process.stderr.write(`${JSON.stringify({ status: 'failed', reasonCode, actionHint, message })}\n`);
  process.exit(1);
}
