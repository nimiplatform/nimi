import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { MACOS_LOCAL_DEVELOPMENT_PROFILE } from '../apps/desktop/scripts/generated/macos-local-development-profile.mjs';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptRoot, '..');
const helperPath = '/usr/local/libexec/nimi-macos-dev-security';
const legacySigningProfilePath = '/Library/Application Support/Nimi/RuntimeDev/dev-signing-profile.json';
const userSigningProfilePath = path.join(process.env.HOME ?? '', '.nimi/macos-dev-signing/public-profile.json');
const installJournalPath = '/Library/Application Support/Nimi/RuntimeDev/installation-transaction.json';
const bootstrapRoot = '/Library/Application Support/Nimi/RuntimeDev/bootstrap';
const runtimePath = '/Library/Application Support/Nimi/RuntimeDev/active/bin/nimi-runtime';
const desktopPath = '/Applications/Nimi Dev.app';
const launchDaemonPath = '/Library/LaunchDaemons/ai.nimi.runtime.dev.plist';

const modes = new Map([
  ['--install', 'install'],
  ['--status', 'status'],
  ['--logs', 'logs'],
  ['--restart', 'restart'],
  ['--reset', 'reset'],
  ['--uninstall', 'uninstall'],
]);

export function parseMacOSDevRuntimeArguments(args) {
  const normalized = args.slice();
  while (normalized[0] === '--') normalized.shift();
  if (normalized.length === 0) return Object.freeze({ mode: 'update' });
  if (normalized.length !== 1 || !modes.has(normalized[0])) {
    throw workflowError(
      'macOS dev:runtime accepts no argument or exactly one of --install, --status, --logs, --restart, --reset, or --uninstall.',
      'dev-runtime-argument-invalid',
      'use_one_documented_macos_dev_runtime_mode',
    );
  }
  return Object.freeze({ mode: modes.get(normalized[0]) });
}

export async function runMacOSDevRuntimeService(input = {}) {
  const platform = input.platform ?? process.platform;
  const architecture = input.architecture ?? process.arch;
  if (platform !== 'darwin' || architecture !== 'arm64') {
    throw workflowError(
      `macOS development Runtime requires darwin/arm64, received ${platform}/${architecture}.`,
      'dev-runtime-platform-unsupported',
      'use_native_apple_silicon_macos',
    );
  }
  const mode = input.mode ?? 'update';
  const queryStatus = input.queryStatus ?? readDevelopmentStatus;
  if (mode === 'status') return queryStatus();
  if (mode === 'logs') return readRuntimeLogs();

  const initial = await queryStatus();
  assertCurrentPrincipalCarrier(initial);
  if ((mode === 'install' || mode === 'update') && initial.signingProfile !== 'present') {
    throw workflowError(
      'The macOS local-development signing profile is not provisioned.',
      'dev-signing-profile-unprovisioned',
      'run_pnpm_provision_macos_dev_signing',
    );
  }
  if (mode === 'install' && initial.status !== 'absent') {
    if (initial.status === 'present') {
      throw workflowError(
        'The macOS development Runtime is already installed; fresh install cannot act as an update.',
        'dev-runtime-update-not-admitted',
        'use_explicit_uninstall_then_install_for_the_current_local_development_profile',
        { status: initial },
      );
    }
    throw workflowError(
      'The macOS development Runtime namespace is partial or unknown; fresh install requires exact absence.',
      initial.reasonCode === MACOS_LOCAL_DEVELOPMENT_PROFILE.legacyReasonCode
        ? MACOS_LOCAL_DEVELOPMENT_PROFILE.legacyReasonCode
        : 'runtime-service-repair-required',
      'inspect_or_run_the_exact_confirmed_reset_for_the_reported_namespace',
      { status: initial, mutation: 'none' },
    );
  }
  if (mode === 'update' && initial.status !== 'present') {
    throw workflowError(
      'The macOS development Runtime service is not installed; update will not perform a silent first installation.',
      'dev-runtime-service-not-installed',
      'run_pnpm_dev_runtime_install',
    );
  }
  if (mode === 'update') {
    throw workflowError(
      'macOS development Runtime update remains fail-closed until release-lineage validation has a non-mutating pending/commit protocol; restoring an older candidate after the current anchored admission would be unsafe.',
      'dev-runtime-update-not-admitted',
      'use_explicit_uninstall_then_install_for_the_current_local_development_profile',
    );
  }

  const confirm = input.confirm ?? confirmMachineMutation;
  const invokeHelper = input.invokeHelper ?? runPrivilegedHelper;
  if (mode === 'restart') {
    await confirm(restartImpact(), 'RESTART NIMI MACOS DEV RUNTIME');
    return invokeHelper(['restart-service']);
  }
  if (mode === 'reset') {
    await confirm(resetImpact(), 'RESET NIMI MACOS DEV RUNTIME');
    return invokeHelper(['reset-service-state']);
  }
  if (mode === 'uninstall') {
    await confirm(uninstallImpact(), 'UNINSTALL NIMI MACOS DEV RUNTIME');
    return invokeHelper(['uninstall-service']);
  }
  if (mode !== 'install' && mode !== 'update') {
    throw workflowError('Unsupported macOS dev Runtime mode.', 'dev-runtime-argument-invalid', 'use_one_documented_macos_dev_runtime_mode');
  }

  const buildCandidate = input.buildCandidate ?? buildDevelopmentCandidate;
  const verifyCandidate = input.verifyCandidate ?? verifyDevelopmentCandidate;
  const candidate = await buildCandidate();
  const verification = await verifyCandidate(candidate);
  await confirm(installImpact(mode, verification), mode === 'install' ? 'INSTALL NIMI MACOS DEV RUNTIME' : 'UPDATE NIMI MACOS DEV RUNTIME');
  const receipt = await invokeHelper(['install-candidate', candidate.outputRoot], verification);
  const final = await invokeHelper(['status']);
  assertHealthyInstalledStatus(final);
  return Object.freeze({
    ...receipt,
    status: mode === 'install' ? 'installed' : 'updated',
    serviceName: 'ai.nimi.runtime.dev',
    state: final.state,
    consequence: 'Runtime boot epoch rotated; all old Desktop and local-app sessions must fail with runtime-restarted and reconnect through the verified supervisor.',
  });
}

export function assertHealthyInstalledStatus(status) {
  const healthy = status?.status === 'present'
    && status?.state === 'running'
    && status?.healthy === true
    && status?.activationReady === true
    && status?.signingProfile === 'present'
    && status?.signingProfileTrusted === true
    && status?.runtimeExecutablePresent === true
    && status?.runtimeExecutableTrusted === true
    && status?.desktopApplicationPresent === true
    && status?.desktopApplicationTrusted === true
    && status?.localAppHostTrusted === true
    && status?.launchDaemonPresent === true
    && status?.launchDaemonDefinitionTrusted === true
    && status?.launchDaemonLoaded === true
    && status?.runtimeAccountTrusted === true
    && status?.runtimePrincipalCarrierContractVersion === MACOS_LOCAL_DEVELOPMENT_PROFILE.carrier
    && status?.installerLedgerTrusted === true
    && status?.installedReleaseSetTrusted === true
    && status?.runtimeProcessTrusted === true
    && status?.desktopSocketPresent === true
    && status?.desktopSocketTrusted === true
    && status?.localAppSocketPresent === true
    && status?.localAppSocketTrusted === true
    && status?.installationTransactionClean === true
    && status?.installationTransactionCommitted === false;
  if (healthy) return;
  if (status?.signingProfile !== 'present') {
    throw workflowError(
      'The macOS local-development signing profile is not provisioned.',
      'dev-signing-profile-unprovisioned',
      'run_pnpm_provision_macos_dev_signing',
      { status },
    );
  }
  if (status?.status !== 'present') {
    throw workflowError(
      'The macOS development Runtime service is not installed.',
      'dev-runtime-service-not-installed',
      'run_pnpm_dev_runtime_install',
      { status },
    );
  }
  const reportedReasons = Array.isArray(status?.errors)
    ? status.errors.map((entry) => entry?.reasonCode).filter((value) => typeof value === 'string')
    : [];
  if (reportedReasons.includes('runtime-service-untrusted')) {
    throw workflowError(
      'The installed macOS development Runtime identity is untrusted.',
      'runtime-service-untrusted',
      'repair_the_installed_macos_development_candidate',
      { status },
    );
  }
  if (status?.state !== 'running') {
    throw workflowError(
      'The installed macOS development Runtime service is unavailable.',
      'runtime-service-unavailable',
      'run_pnpm_dev_runtime_status_and_inspect_launchd_logs',
      { status },
    );
  }
  throw workflowError(
    'The macOS development Runtime did not reach the complete mutually verified installed state.',
    'runtime-service-repair-required',
    'run_pnpm_dev_runtime_status_and_inspect_launchd_logs',
    { status },
  );
}

export function assertCurrentPrincipalCarrier(status) {
  const expected = MACOS_LOCAL_DEVELOPMENT_PROFILE.carrier;
  const observed = status?.runtimePrincipalCarrierContractVersion;
  if (observed === expected) return;
  throw workflowError(
    `The installed macOS development profile carries legacy, unknown, or absent Runtime principal contract ${observed ?? 'absent'}; fresh carrier ${expected} does not migrate it.`,
    MACOS_LOCAL_DEVELOPMENT_PROFILE.legacyReasonCode,
    'remove_the_exact_legacy_profile_with_the_one_time_local_delete_only_cutover_before_fresh_install',
    { expected, observed: observed ?? null, mutation: 'none' },
  );
}

async function readDevelopmentStatus() {
  if (existsSync(legacySigningProfilePath)) {
    return Object.freeze({
      status: 'blocked',
      state: 'stopped',
      serviceName: 'ai.nimi.runtime.dev',
      signingProfile: existsSync(userSigningProfilePath) ? 'present' : 'absent',
      signingProfileTrusted: false,
      runtimePrincipalCarrierContractVersion: null,
      reasonCode: MACOS_LOCAL_DEVELOPMENT_PROFILE.legacyReasonCode,
      legacyProfilePresent: true,
      mutation: 'none',
      productAdmission: false,
    });
  }
  if (!existsSync(helperPath)) {
    const installedArtifacts = [
      runtimePath,
      desktopPath,
      launchDaemonPath,
      legacySigningProfilePath,
      helperPath,
      '/Library/Application Support/Nimi/RuntimeDev',
      '/private/var/run/nimi-dev',
    ].filter(existsSync);
    if (installedArtifacts.length > 0) {
      throw workflowError(
        'macOS development Runtime artifacts exist without the fixed security helper.',
        'runtime-service-repair-required',
        'repair_or_uninstall_the_partial_macos_development_profile',
        { installedArtifacts },
      );
    }
    return Object.freeze({
      status: 'absent',
      state: 'stopped',
      serviceName: 'ai.nimi.runtime.dev',
      signingProfile: existsSync(userSigningProfilePath) ? 'present' : 'absent',
      signingProfileTrusted: existsSync(userSigningProfilePath),
      runtimePrincipalCarrierContractVersion: MACOS_LOCAL_DEVELOPMENT_PROFILE.carrier,
      reasonCode: existsSync(userSigningProfilePath) ? 'dev-runtime-service-not-installed' : 'dev-signing-profile-unprovisioned',
      productAdmission: false,
    });
  }
  requireInstalledHelperMetadata();
  const publicStatus = runJSON(helperPath, ['status']);
  return publicStatus;
}

async function buildDevelopmentCandidate() {
  const outputRoot = path.join(repoRoot, '.nimi', 'local', 'macos-dev-runtime-candidates', randomUUID());
  const result = runCaptured(process.execPath, [
    path.join(repoRoot, 'apps', 'desktop', 'scripts', 'build-macos-electron-release.mjs'),
    '--local-development-candidate',
  ], {
    ...process.env,
    NIMI_MACOS_RELEASE_OUTPUT: outputRoot,
  });
  const documents = String(result.stdout || '').split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const receipt = documents.at(-1);
  if (receipt?.outputRoot !== outputRoot
    || receipt?.posture !== 'signed_local_development_candidate_pending_independent_verifier') {
    throw workflowError(
      'macOS development candidate build did not return the exact signed and preverified candidate receipt.',
      'dev-runtime-build-failed',
      'inspect_macos_development_candidate_build_output',
    );
  }
  return Object.freeze({ outputRoot });
}

async function verifyDevelopmentCandidate(candidate) {
  const helperCandidate = path.join(candidate.outputRoot, 'installer', 'nimi-macos-dev-security');
  if (!existsSync(helperCandidate)) throw workflowError('Signed candidate does not contain its exact installer verifier.', 'dev-candidate-incomplete', 'rebuild_the_complete_candidate');
  const verification=runJSON(helperCandidate, ['verify-candidate', candidate.outputRoot]);
  if(verification?.status!=='verified'||verification?.mutation!=='none')throw workflowError('Independent macOS candidate verifier did not return the exact non-mutating verified receipt.','dev-runtime-candidate-verification-failed','inspect_the_complete_candidate_verifier_output');
  return verification;
}

async function runPrivilegedHelper(arguments_, authorizedVerification = undefined) {
  if (arguments_[0] !== 'install-candidate' || arguments_.length !== 2) {
    requireInstalledHelperMetadata();
    return runJSON('/usr/bin/sudo', [helperPath, ...arguments_]);
  }
  const source = arguments_[1];
  const transactionID = randomUUID();
  const staged = path.join(bootstrapRoot, transactionID);
  runCaptured('/usr/bin/sudo', ['/bin/mkdir', '-p', bootstrapRoot], process.env);
  try {
    runCaptured('/usr/bin/sudo', ['/usr/bin/ditto', '--noqtn', source, staged], process.env);
    runCaptured('/usr/bin/sudo', ['/usr/sbin/chown', '-R', 'root:wheel', staged], process.env);
    const stagedHelper = path.join(staged, 'installer', 'nimi-macos-dev-security');
    const stagedVerification = runJSON(stagedHelper, ['verify-candidate', staged]);
    assertEquivalentCandidateVerification(authorizedVerification, stagedVerification);
    return runJSON('/usr/bin/sudo', [stagedHelper, 'install-candidate', staged]);
  } catch (error) {
    if (!existsSync(installJournalPath)) {
      try { if(existsSync(staged))runCaptured('/usr/bin/sudo', ['/bin/rm', '-rf', staged], process.env); } catch { /* verified below */ }
      for(const directory of [bootstrapRoot,path.dirname(bootstrapRoot)]){try{if(existsSync(directory))runCaptured('/usr/bin/sudo',['/bin/rmdir',directory],process.env);}catch{/* verified below */}}
      const residue=[staged,bootstrapRoot,path.dirname(bootstrapRoot)].filter(existsSync);
      if(residue.length>0)throw workflowError('Pre-journal root-owned candidate cleanup did not reach exact absence.','runtime-service-repair-required','inspect_only_the_reported_pre_journal_paths',{primary:String(error),residue});
    }
    throw error;
  }
}

function readRuntimeLogs() {
  const result = runCaptured('/usr/bin/log', [
    'show', '--style', 'compact', '--last', '30m',
    '--predicate', 'process == "nimi-runtime" OR subsystem BEGINSWITH "ai.nimi.runtime"',
  ], process.env);
  return Object.freeze({
    status: 'ok',
    serviceName: 'ai.nimi.runtime.dev',
    window: '30m',
    logs: String(result.stdout || '').split(/\r?\n/u).slice(-2000),
  });
}

async function confirmMachineMutation(impact, phrase) {
  process.stdout.write(`${JSON.stringify({ status: 'confirmation-required', confirmation: phrase, impact })}\n`);
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw workflowError(
      'Interactive confirmation is required before privileged macOS service mutation.',
      'macos-dev-machine-mutation-confirmation-required',
      'rerun_the_command_in_an_interactive_terminal_and_enter_the_exact_confirmation_phrase',
    );
  }
  const terminal = readline.createInterface({ input: process.stdin, output: process.stderr });
  const answer = await terminal.question(`Type ${JSON.stringify(phrase)} to continue: `);
  terminal.close();
  if (answer !== phrase) {
    throw workflowError('macOS development Runtime mutation was cancelled.', 'macos-dev-machine-mutation-cancelled', 'rerun_only_after_approving_the_reported_changes');
  }
}

function installImpact(mode, verification) {
  return Object.freeze({
    mode,
    stops: ['ai.nimi.runtime.dev; requires Nimi Dev and supervised hosts already stopped'],
    writes: [
      '/Applications/Nimi Dev.app',
      '/Library/Application Support/Nimi/RuntimeDev/{bootstrap,active,state,installation-transaction.json,installer-ledger.json,signing-profile-public.json}',
      '/Library/LaunchDaemons/ai.nimi.runtime.dev.plist',
      '/private/var/run/nimi-dev launchd sockets',
      'Runtime-only ai.nimi.runtime.protected-local.dev.v1 System Keychain custody items',
    ],
    createsOnFirstInstall: ['non-login _nimiruntimedev user and group'],
    authorizedCandidate: verification,
    productAdmission: false,
    notarization: false,
  });
}

function restartImpact() {
  return Object.freeze({ action: 'launchctl kickstart -k ai.nimi.runtime.dev', consequence: 'boot epoch and all protected sessions rotate', persistentDataDeleted: false });
}

function resetImpact() {
  return Object.freeze({ action: 'stop and exactly reset the current carrier-4 Nimi Dev namespace to clean-unprovisioned', deletes: [desktopPath, '/Library/Application Support/Nimi/RuntimeDev service/state/public-profile/ledger/journal/staging data', launchDaemonPath, helperPath, '_nimiruntimedev account', 'Runtime-only development Keychain custody items'], preserves: ['user-domain local CA and stable role keys', 'all non-Nimi system and user state'] });
}

function uninstallImpact() {
  return Object.freeze({ action: 'stop and remove development service', deletes: [desktopPath, '/Library/Application Support/Nimi/RuntimeDev service/state/public-profile/ledger data', launchDaemonPath, helperPath, '_nimiruntimedev account', 'Runtime-only development Keychain custody items'], preserves: ['user-domain local CA and stable role keys'] });
}

function assertEquivalentCandidateVerification(expected, observed) {
  const select = (value) => ({
    carrier: value?.carrier,
    desktop: value?.desktop,
    hardenedRuntime: value?.hardenedRuntime,
    installer: value?.installer,
    launchDaemonSHA256: value?.launchDaemonSHA256,
    localAppHost: value?.localAppHost,
    profileSHA256: value?.profileSHA256,
    releaseRecordSchemaVersion: value?.releaseRecordSchemaVersion,
    runtime: value?.runtime,
    teamID: value?.teamID,
  });
  if (!expected || !observed || JSON.stringify(select(expected)) !== JSON.stringify(select(observed))) {
    throw workflowError(
      'Root-owned staging does not match the exact candidate identity authorized before confirmation.',
      'dev-candidate-staging-verification-mismatch',
      'discard_the_staging_copy_and_rebuild_the_candidate',
      { mutation: 'root_owned_bootstrap_only' },
    );
  }
}

function requireInstalledHelperMetadata() {
  const metadata = lstatSync(helperPath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0 || metadata.gid !== 0
    || metadata.nlink !== 1 || (metadata.mode & 0o022) !== 0 || (metadata.mode & 0o111) === 0
    || realpathSync(helperPath) !== helperPath) {
    throw workflowError('Installed macOS development security helper metadata is untrusted.', 'runtime-service-repair-required', 'reinstall_the_root_owned_macos_development_security_helper');
  }
  const verify = spawnSync('/usr/bin/codesign', ['--verify', '--strict', '--verbose=4', helperPath], { encoding: 'utf8' });
  if (verify.error || verify.status !== 0) {
    throw workflowError('Installed macOS development security helper signature is invalid.', 'runtime-service-untrusted', 'reprovision_the_macos_development_security_helper');
  }
}

function runJSON(command, args) {
  const result = runCaptured(command, args, process.env);
  try {
    return JSON.parse(String(result.stdout || '').trim());
  } catch {
    throw workflowError(`${path.basename(command)} did not return one JSON document.`, 'dev-runtime-command-result-invalid', 'inspect_macos_dev_runtime_command_output');
  }
}

function runCaptured(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env,
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    const parsed = parseFailure(result.stderr);
    if (parsed) throw workflowError(parsed.message, parsed.reasonCode, parsed.actionHint, parsed.details);
    const diagnostic = `${result.stderr || ''}\n${result.stdout || ''}`.replaceAll(/\s+/gu, ' ').trim().slice(0, 1000);
    throw workflowError(`${path.basename(command)} failed with status ${result.status ?? 'unavailable'}${diagnostic ? `: ${diagnostic}` : ''}`, 'dev-runtime-command-failed', 'inspect_macos_dev_runtime_command_error');
  }
  return result;
}

function parseFailure(value) {
  for (const line of String(value || '').split(/\r?\n/u).reverse()) {
    try {
      const parsed = JSON.parse(line);
      if (parsed?.status === 'failed' && parsed.reasonCode && parsed.actionHint && parsed.message) return parsed;
    } catch { /* diagnostic line */ }
  }
  return undefined;
}

function workflowError(message, reasonCode, actionHint, details = undefined) {
  return Object.assign(new Error(message), { reasonCode, actionHint, details });
}
