#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { MACOS_LOCAL_DEVELOPMENT_PROFILE } from '../apps/desktop/scripts/generated/macos-local-development-profile.mjs';
import {
  privilegedRepairFailurePermitsBootstrapCleanup,
  validateMacOSDevRepairSuccessReceipt,
  writeMacOSDevRepairFailureEvidence,
} from './lib/macos-dev-repair-evidence.mjs';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptRoot, '..');
const helperSource = path.join(repoRoot, '.nimi', 'local', 'macos-dev-security-build', 'nimi-macos-dev-security');
const finalHelperPath = '/usr/local/libexec/nimi-macos-dev-security';
const bootstrapHelperPath = MACOS_LOCAL_DEVELOPMENT_PROFILE.bootstrapHelperPath;
const repairJournalPath = MACOS_LOCAL_DEVELOPMENT_PROFILE.runtimePartialInstallRepairJournalPath;
const confirmation = 'REPAIR NIMI MACOS DEV RUNTIME INSTALL';
const expectedRepairAuthority = Object.freeze({
  invocationDeadline: 'root_repair_helper_owns_one_hard_600-second_deadline;_every_child_has_a_shorter_bounded_timeout_and_must_fit_inside_the_remaining_outer_budget;_direct-child_commands_atomically_reserve_one_launch-slot_before_Process.run_and_bind_the_child_PID_before_input_or-wait;_bootstrap-owned_process-group_commands_use_posix_spawn_with_POSIX_SPAWN_SETPGROUP_and_POSIX_SPAWN_CLOEXEC_DEFAULT_while_the_deadline-lock-is-held_so_a-successful-spawn-and-PID/PGID-binding-are-one-atomic-transition;_an-expired-repair-invocation_fails-before-the-next-spawn;_timeout-or-output-overflow_signals-the-whole-owned-PGID_TERM-then-KILL_reaps-the-direct-child_drains-both-pipes-to-EOF_and-requires-kill-minus-PGID-zero-to-return-ESRCH_before-child_reaped-true;_any-unbound-or-unreaped-state_is-quiescence-unproven_and-forbids-wrapper-cleanup;_the_Node-launcher_never-times-out-sudo_or-cleans-up-before-sudo-has-observed-the-root-helper-exit;_deadline-termination_preserves-the-exact-journal-for-effect-ahead-recovery',
  failureEvidence: 'one_sanitized_non-authoritative_local_JSON_record_under_.nimi/local/acceptance_is_written_after-the_privileged_helper_has_exited;_it-preserves-every-authority-admitted_non-sensitive_diagnostic-field_plus-bounded-subprocess-status_and-never-persists-stderr_Keychain-material_tokens_or-private-keys;_vnode-diagnostics-preserve-exact-event-flags-and-names_lock-device/inode/SHA256_before/after-ctime_journal-phase/presence_completion/bootstrap-state_and-primary-failure-identity;_missing-structured-JSON_or-missing-explicit-child_reaped-true_preserves-the-exact-bootstrap;_only-explicit-child_reaped-true-permits-exact-bootstrap-cleanup;_one-failure-stops-automatic-retry',
  postRepairCarrier: 'repair_preserves_the_source_final_helper;_when_its_source_carrier_is_not_current_carrier_4_Runtime_install_remains_fail-closed_until_a_separately_confirmed_trust-helper_rotation_reprovisions_and_proves_one_current_signed_helper;_delete-only_repair_success_is_not_install-readiness',
  terminalCommit: 'executor-prepares-the-exact-success-receipt-while-the-principal-removed-journal-remains-durable;_outer-final-helper-vnode-and-static-code-proof_then-bootstrap-self-retirement-must-complete-while-that-journal-still-exists;_a-second-final-helper-proof-immediately-precedes-one-exact-journal-unlink-as-the-last-semantic-effect;_any-proof-retirement-or-unlink-failure-preserves-a-journal-or-reaches-the-independent-clean-no-journal-boundary_and-never-emits-repair-success;_no-post-unlink-authority-check-may-turn-a-committed-repair-into-an-unrecoverable-failure',
  successReceiptSchema: 'nimi.macos-local-development-partial-install-repair-receipt/v1',
  successReceiptFields: ['schemaVersion', 'status', 'disposition', 'serviceName', 'removed', 'preserved', 'sourcePrincipalCarrierContractVersion', 'requiredInstallPrincipalCarrierContractVersion', 'sourceHelperDisposition', 'installReadiness', 'trustHelperRotationRequired', 'nextPrivilegedAction'],
});

if (process.argv.length !== 2) {
  fail('macos-dev-runtime-repair-argument-invalid', 'run_pnpm_repair_macos_dev_runtime_install_without_arguments', 'repair:macos-dev-runtime-install accepts no arguments');
}
if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  fail('dev-runtime-platform-unsupported', 'use_native_apple_silicon_macos', 'macOS Runtime partial-install repair requires native Apple Silicon macOS.');
}
if (MACOS_LOCAL_DEVELOPMENT_PROFILE.runtimeLegacyRepairInvocationDeadline
      !== expectedRepairAuthority.invocationDeadline
    || MACOS_LOCAL_DEVELOPMENT_PROFILE.runtimeLegacyRepairFailureEvidence
      !== expectedRepairAuthority.failureEvidence
    || MACOS_LOCAL_DEVELOPMENT_PROFILE.runtimeLegacyRepairPostRepairCarrierDisposition
      !== expectedRepairAuthority.postRepairCarrier
    || MACOS_LOCAL_DEVELOPMENT_PROFILE.runtimeLegacyRepairTerminalCommitPolicy
      !== expectedRepairAuthority.terminalCommit
    || MACOS_LOCAL_DEVELOPMENT_PROFILE.runtimeLegacyRepairSuccessReceiptSchemaVersion
      !== expectedRepairAuthority.successReceiptSchema
    || JSON.stringify(MACOS_LOCAL_DEVELOPMENT_PROFILE.runtimeLegacyRepairSuccessReceiptRequiredFields)
      !== JSON.stringify(expectedRepairAuthority.successReceiptFields)) {
  fail(
    'runtime-service-repair-required',
    'regenerate_the_authority_bound_macos_repair_profile',
    'The generated partial-install repair orchestration authority is stale or incomplete.',
  );
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
  postRepairBoundary: [
    'success repairs only the exact delete-only residue and preserves the source final helper',
    'a preserved carrier-v2 final helper is not install-ready; current carrier-v4 trust/helper rotation remains a separate confirmed transaction',
  ],
  transientSystemEffects: [
    'after exact raw OpenDirectory user/group deletion, runs /usr/bin/odutil reset cache once per recovery attempt; this resets OpenDirectory, membership, and kernel identity caches but not DNS or persistent directory configuration',
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
let sourceBefore;
try {
  sourceBefore = await inspectHelper(helperSource, { uid: process.getuid(), gid: process.getgid() });
} catch (error) {
  fail(
    'runtime-service-untrusted',
    'inspect_the_exact_repair_helper_metadata',
    error.message,
  );
}
const installResult = execute(
  '/usr/bin/sudo',
  ['/usr/bin/install', '-o', 'root', '-g', 'wheel', '-m', '0755', helperSource, bootstrapHelperPath],
  'inherit',
  { timeoutMilliseconds: null },
);
if (commandFailed(installResult)) {
  const cleanup = cleanupExactBootstrap(sourceBefore.sha256);
  const evidence = persistPrivilegedFailure({
    reasonCode: 'runtime-service-repair-required',
    actionHint: 'inspect_the_exact_repair_bootstrap_install_failure',
    message: `install failed with status ${installResult.status ?? 'unavailable'}`,
    sourceHelper: sourceBefore,
    commandResult: installResult,
    cleanupDisposition: cleanup,
  });
  fail(
    'runtime-service-repair-required',
    'inspect_the_exact_repair_bootstrap_install_failure',
    `The exact repair bootstrap install failed.${cleanup ? ` Bootstrap cleanup: ${cleanup}.` : ''} ${evidence}`,
  );
}
let sourceAfter;
let installed;
try {
  [sourceAfter, installed] = await Promise.all([
    inspectHelper(helperSource, { uid: process.getuid(), gid: process.getgid() }),
    inspectHelper(bootstrapHelperPath, { uid: 0, gid: 0 }),
  ]);
} catch (error) {
  const cleanup = cleanupExactBootstrap(sourceBefore.sha256);
  const evidence = persistPrivilegedFailure({
    reasonCode: 'runtime-service-untrusted',
    actionHint: 'inspect_the_exact_repair_helper_metadata',
    message: error.message,
    sourceHelper: sourceBefore,
    commandResult: installResult,
    cleanupDisposition: cleanup,
  });
  fail(
    'runtime-service-untrusted',
    'inspect_the_exact_repair_helper_metadata',
    `The installed repair bootstrap metadata could not be proven.${cleanup ? ` Bootstrap cleanup: ${cleanup}.` : ''} ${evidence}`,
  );
}
if (sourceBefore.device !== sourceAfter.device || sourceBefore.inode !== sourceAfter.inode
  || sourceBefore.sha256 !== sourceAfter.sha256 || installed.sha256 !== sourceBefore.sha256) {
  const cleanup = cleanupExactBootstrap(sourceBefore.sha256);
  const evidence = persistPrivilegedFailure({
    reasonCode: 'runtime-service-untrusted',
    actionHint: 'rebuild_the_exact_repair_bootstrap',
    message: 'The repair helper source or installed root-owned snapshot changed before execution.',
    sourceHelper: sourceBefore,
    installedBootstrap: installed,
    commandResult: installResult,
    cleanupDisposition: cleanup,
  });
  fail('runtime-service-untrusted', 'rebuild_the_exact_repair_bootstrap', `The repair helper source or installed root-owned snapshot changed before execution. ${evidence}`);
}

// The root helper owns the admitted hard deadline and every child-process
// timeout. This launcher waits for sudo to observe the helper's actual exit;
// it never races cleanup against a possibly live privileged descendant.
const result = execute(
  '/usr/bin/sudo',
  [bootstrapHelperPath, 'repair-partial-runtime-install'],
  ['ignore', 'pipe', 'pipe'],
  { timeoutMilliseconds: null },
);
if (commandFailed(result)) {
  const structured = parseLastFailure(result.stderr);
  const cleanup = privilegedRepairFailurePermitsBootstrapCleanup(structured?.details)
    ? cleanupExactBootstrap(sourceBefore.sha256)
    : 'bootstrap preserved because a bounded helper child could not be proven reaped';
  if (structured) {
    const evidence = persistPrivilegedFailure({
      reasonCode: structured.reasonCode,
      actionHint: structured.actionHint,
      message: structured.message,
      details: structured.details,
      sourceHelper: sourceBefore,
      installedBootstrap: installed,
      commandResult: result,
      cleanupDisposition: cleanup,
    });
    fail(
      structured.reasonCode,
      structured.actionHint,
      `${structured.message}${cleanup ? ` Bootstrap cleanup: ${cleanup}.` : ''} ${evidence}`,
      structured.details,
    );
  }
  const evidence = persistPrivilegedFailure({
    reasonCode: 'runtime-service-repair-required',
    actionHint: 'inspect_the_exact_partial_install_repair_journal_before_retrying',
    message: `The privileged repair helper failed with status ${result.status ?? 'unavailable'}.`,
    sourceHelper: sourceBefore,
    installedBootstrap: installed,
    commandResult: result,
    cleanupDisposition: cleanup,
  });
  fail(
    'runtime-service-repair-required',
    'inspect_the_exact_partial_install_repair_journal_before_retrying',
    `The privileged repair helper failed with status ${result.status ?? 'unavailable'}.${cleanup ? ` Bootstrap cleanup: ${cleanup}.` : ''} ${evidence}`,
  );
}

let receipt;
try { receipt = JSON.parse(String(result.stdout || '').trim()); }
catch {
  const cleanup = 'bootstrap preserved because no exact success receipt was available';
  const evidence = persistPrivilegedFailure({
    reasonCode: 'runtime-service-repair-required',
    actionHint: 'inspect_the_privileged_repair_result',
    message: 'The privileged repair helper did not return one JSON receipt.',
    sourceHelper: sourceBefore,
    installedBootstrap: installed,
    commandResult: result,
    cleanupDisposition: cleanup,
  });
  fail('runtime-service-repair-required', 'inspect_the_privileged_repair_result', `The privileged repair helper did not return one JSON receipt. ${evidence}`);
}
if (!validateMacOSDevRepairSuccessReceipt(receipt)) {
  const cleanup = 'bootstrap preserved because the success receipt schema or carrier relation was invalid';
  const evidence = persistPrivilegedFailure({
    reasonCode: 'runtime-service-repair-required',
    actionHint: 'inspect_the_privileged_repair_result',
    message: 'The privileged repair helper returned an unrecognized receipt.',
    sourceHelper: sourceBefore,
    installedBootstrap: installed,
    commandResult: result,
    cleanupDisposition: cleanup,
  });
  fail('runtime-service-repair-required', 'inspect_the_privileged_repair_result', `The privileged repair helper returned an unrecognized receipt. ${evidence}`);
}
if (lstatSync(bootstrapHelperPath, { throwIfNoEntry: false }) !== undefined) {
  const cleanup = 'bootstrap preserved because retirement was not proven by the successful helper transaction';
  const evidence = persistPrivilegedFailure({
    reasonCode: 'runtime-service-repair-required',
    actionHint: 'inspect_the_bootstrap_retirement',
    message: 'Repair completed but the temporary bootstrap helper was not retired.',
    sourceHelper: sourceBefore,
    installedBootstrap: installed,
    commandResult: result,
    cleanupDisposition: cleanup,
  });
  fail('runtime-service-repair-required', 'inspect_the_bootstrap_retirement', `Repair completed but the temporary bootstrap helper was not retired. ${evidence}`);
}
process.stdout.write(`${JSON.stringify(receipt)}\n`);

function execute(
  command,
  args,
  stdio = ['ignore', 'pipe', 'pipe'],
  { timeoutMilliseconds = 300_000 } = {},
) {
  const options = {
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
  };
  if (timeoutMilliseconds !== null) {
    options.timeout = timeoutMilliseconds;
    options.killSignal = 'SIGTERM';
  }
  return spawnSync(command, args, options);
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
    const removal = execute(
      '/usr/bin/sudo',
      [bootstrapHelperPath, 'retire-repair-bootstrap-after-failure'],
      'inherit',
      { timeoutMilliseconds: null },
    );
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
    throw new Error(`Unsafe repair helper metadata at ${candidate}.`);
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

function persistPrivilegedFailure({
  reasonCode,
  actionHint,
  message,
  details = undefined,
  sourceHelper = undefined,
  installedBootstrap = undefined,
  commandResult = undefined,
  cleanupDisposition = '',
}) {
  try {
    const evidencePath = writeMacOSDevRepairFailureEvidence({
      repoRoot,
      reasonCode,
      actionHint,
      message,
      details,
      sourceHelper,
      installedBootstrap,
      commandResult,
      cleanupDisposition: cleanupDisposition || 'not-required',
      bootstrapPresentAfterCleanup:
        lstatSync(bootstrapHelperPath, { throwIfNoEntry: false }) !== undefined,
    });
    return `Diagnostic evidence: ${evidencePath}. No automatic retry was attempted.`;
  } catch (error) {
    const code = typeof error?.code === 'string' ? error.code : 'EVIDENCE_WRITE_FAILED';
    return `Diagnostic evidence could not be persisted (${code}); no automatic retry was attempted.`;
  }
}

function fail(reasonCode, actionHint, message, details = undefined) {
  process.stderr.write(`${JSON.stringify({
    status: 'failed', reasonCode, actionHint, message, ...(details === undefined ? {} : { details }),
  })}\n`);
  process.exit(1);
}
