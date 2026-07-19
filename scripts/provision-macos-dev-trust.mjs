#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { MACOS_LOCAL_DEVELOPMENT_PROFILE } from '../apps/desktop/scripts/generated/macos-local-development-profile.mjs';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptRoot, '..');
const helperSource = path.join(repoRoot, '.nimi', 'local', 'macos-dev-security-build', 'nimi-macos-dev-security');
const helperTarget = '/usr/local/libexec/nimi-macos-dev-security';
const bootstrapHelperTarget = MACOS_LOCAL_DEVELOPMENT_PROFILE.bootstrapHelperPath;
const signingCleanupRecordTarget = MACOS_LOCAL_DEVELOPMENT_PROFILE.signingCleanupRecordPath;
const signingProfileTarget = path.join(path.dirname(signingCleanupRecordTarget), 'dev-signing-profile.json');
const confirmation = 'PROVISION NIMI MACOS DEV TRUST';

export const macOSDevelopmentTrustProvisionImpact = Object.freeze({
  additions: [
    `temporary immutable root-owned ${bootstrapHelperTarget}, removed before success`,
    'root-owned /usr/local/libexec/nimi-macos-dev-security',
    'one persistent local P-256 CA in /Library/Keychains/System.keychain',
    'one root-owned mode-0600 normally locked system-domain signing Keychain for Runtime, Desktop, Local Host, helper, and release-record signer identities',
    'a random signing-Keychain unlock secret held only by the exact signed helper in /Library/Keychains/System.keychain',
    'admin-domain trust constrained to the Apple code-signing policy for that local CA',
    `root-owned ${signingProfileTarget} containing public metadata only`,
    `root-owned mode-0600 ${signingCleanupRecordTarget} containing only exact System Keychain certificate fingerprints`,
  ],
  exclusions: [
    'no Developer ID identity',
    'no notarization credential',
    'no LaunchDaemon, service account, Runtime, Desktop, socket, or TCC mutation',
    'no local-development profile private key in /Library/Keychains/System.keychain',
    'no private key or signing-Keychain password in the repository, argv, environment, logs, or build output',
  ],
  productAdmission: false,
  profileId: 'macos_local_development_v1',
});

if (process.argv.length !== 2) fail('macos-dev-trust-argument-invalid', 'run_pnpm_provision_macos_dev_trust_without_arguments', 'provision:macos-dev-trust accepts no arguments');
if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  fail('dev-runtime-platform-unsupported', 'use_apple_silicon_macos', 'macOS development trust provisioning requires native Apple Silicon macOS.');
}
const existingTargets = [bootstrapHelperTarget, helperTarget, signingProfileTarget, signingCleanupRecordTarget].filter((target) => (
  lstatSync(target, { throwIfNoEntry: false }) !== undefined
));
if (existingTargets.length > 0) {
  fail(
    'macos-dev-trust-already-present',
    'inspect_status_or_run_pnpm_unprovision_macos_dev_trust_before_reprovisioning',
    `Refusing to overwrite an existing or partial macOS development trust installation: ${existingTargets.join(', ')}`,
  );
}

process.stdout.write(`${JSON.stringify({
  status: 'confirmation-required',
  confirmation,
  impact: macOSDevelopmentTrustProvisionImpact,
})}\n`);
if (!process.stdin.isTTY || !process.stderr.isTTY) {
  fail(
    'macos-dev-machine-mutation-confirmation-required',
    'run_pnpm_provision_macos_dev_trust_in_an_interactive_terminal_and_enter_the_exact_confirmation_phrase',
    'Interactive confirmation is required before System Keychain and helper installation changes.',
  );
}
const terminal = readline.createInterface({ input: process.stdin, output: process.stderr });
const answer = await terminal.question(`Type ${JSON.stringify(confirmation)} to continue: `);
terminal.close();
if (answer !== confirmation) {
  fail('macos-dev-machine-mutation-cancelled', 'rerun_only_when_the_reported_changes_are_approved', 'macOS development trust provisioning was cancelled.');
}

run(process.execPath, [path.join(scriptRoot, 'build-macos-dev-security-helper.mjs')]);
const before = await inspectHelper(helperSource);
run('/usr/bin/sudo', ['/usr/bin/install', '-d', '-o', 'root', '-g', 'wheel', '-m', '0755', '/usr/local/libexec']);
const bootstrapInstall = execute('/usr/bin/sudo', ['/usr/bin/install', '-o', 'root', '-g', 'wheel', '-m', '0755', helperSource, bootstrapHelperTarget]);
if (commandFailed(bootstrapInstall)) {
  fail('macos-dev-trust-provision-failed', 'inspect_the_immutable_bootstrap_install', commandFailureSummary('/usr/bin/sudo', bootstrapInstall));
}
const finalInstall = execute('/usr/bin/sudo', ['/usr/bin/install', '-o', 'root', '-g', 'wheel', '-m', '0755', helperSource, helperTarget]);
if (commandFailed(finalInstall)) rollbackProvisioning(commandFailureSummary('/usr/bin/sudo', finalInstall));
const [after, installedBootstrap, installedFinalCandidate] = await Promise.all([
  inspectHelper(helperSource, { uid: process.getuid(), gid: process.getgid() }),
  inspectHelper(bootstrapHelperTarget, { uid: 0, gid: 0 }),
  inspectHelper(helperTarget, { uid: 0, gid: 0 }),
]);
if (before.sha256 !== after.sha256 || before.device !== after.device || before.inode !== after.inode
  || installedBootstrap.sha256 !== before.sha256 || installedFinalCandidate.sha256 !== before.sha256) {
  rollbackProvisioning('The helper source or one installed root-owned copy changed during the privileged snapshot.');
}
const result = execute('/usr/bin/sudo', [bootstrapHelperTarget, 'provision-signing-profile'], { capture: true });
if (commandFailed(result)) {
  rollbackProvisioning(commandFailureSummary('/usr/bin/sudo', result));
}
const projection = parseProjection(result.stdout);
const bootstrapResidue = lstatSync(bootstrapHelperTarget, { throwIfNoEntry: false });
const finalHelper = lstatSync(helperTarget, { throwIfNoEntry: false });
if (projection?.status !== 'provisioned' || projection?.profileId !== 'macos_local_development_v1'
  || bootstrapResidue !== undefined || !finalHelper?.isFile() || finalHelper.isSymbolicLink()
  || finalHelper.uid !== 0 || finalHelper.gid !== 0 || finalHelper.nlink !== 1) {
  rollbackProvisioning('Provisioning did not retire the immutable bootstrap into one exact signed final helper.');
}
process.stdout.write(result.stdout);

function run(command, args, options = {}) {
  const result = execute(command, args, options);
  if (commandFailed(result)) {
    fail(
      'macos-dev-trust-provision-failed',
      'inspect_the_privileged_helper_and_System_Keychain_failure',
      `${path.basename(command)} failed with status ${result.status ?? 'unavailable'}${commandDiagnostic(result) ? `: ${commandDiagnostic(result)}` : ''}`,
    );
  }
  return result;
}

function execute(command, args, options = {}) {
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
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
}

function commandFailed(result) {
  return result.error !== undefined || result.status !== 0;
}

function commandDiagnostic(result) {
  return `${result.stderr || ''}\n${result.stdout || ''}`.replaceAll(/\s+/gu, ' ').trim().slice(0, 500);
}

function commandFailureSummary(command, result) {
  const diagnostic = commandDiagnostic(result);
  return `${path.basename(command)} status ${result.status ?? 'unavailable'}${diagnostic ? `: ${diagnostic}` : ''}`;
}

function rollbackProvisioning(provisioningDiagnostic) {
  const rollbackDiagnostics = [];
  const helpers = [helperTarget, bootstrapHelperTarget].filter((candidate) => (
    lstatSync(candidate, { throwIfNoEntry: false }) !== undefined
  ));
  for (const rollbackHelper of helpers) {
    const rollback = execute('/usr/bin/sudo', [rollbackHelper, 'unprovision-signing-profile'], { capture: true });
    if (!commandFailed(rollback)) {
      fail(
        'macos-dev-trust-provision-failed',
        'inspect_the_privileged_helper_and_System_Keychain_failure_before_retrying',
        `Provisioning failed (${provisioningDiagnostic}); the privileged installation transaction was rolled back completely by ${rollbackHelper}.`,
      );
    }
    rollbackDiagnostics.push(`${rollbackHelper}: ${commandFailureSummary('/usr/bin/sudo', rollback)}`);
  }
  fail(
    'runtime-service-repair-required',
    'run_pnpm_unprovision_macos_dev_trust_before_retrying_provisioning',
    `Provisioning failed (${provisioningDiagnostic}) and final-helper-first privileged rollback failed (${rollbackDiagnostics.join('; ')}).`,
  );
}

async function inspectHelper(candidate, expectedOwner = { uid: process.getuid(), gid: process.getgid() }) {
  const metadata = lstatSync(candidate);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
    || metadata.uid !== expectedOwner.uid || metadata.gid !== expectedOwner.gid || (metadata.mode & 0o022) !== 0
    || (metadata.mode & 0o111) === 0 || realpathSync(candidate) !== candidate) {
    fail('runtime-service-untrusted', 'rebuild_the_local_helper', 'The helper build output has unsafe metadata.');
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

function parseProjection(stdout) {
  try {
    return JSON.parse(String(stdout || '').trim());
  } catch {
    return undefined;
  }
}

function fail(reasonCode, actionHint, message) {
  process.stderr.write(`${JSON.stringify({ status: 'failed', reasonCode, actionHint, message })}\n`);
  process.exit(1);
}
