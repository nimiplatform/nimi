import assert from 'node:assert/strict';
import { lstatSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  privilegedRepairFailurePermitsBootstrapCleanup,
  sanitizeRepairFailureDetails,
  validateMacOSDevRepairSuccessReceipt,
  writeMacOSDevRepairFailureEvidence,
} from './lib/macos-dev-repair-evidence.mjs';
import { MACOS_LOCAL_DEVELOPMENT_PROFILE } from '../apps/desktop/scripts/generated/macos-local-development-profile.mjs';

const fixtureUID = 501;

test('repair failure evidence is bounded, private, and excludes undeclared diagnostic fields', () => {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-repair-evidence-'));
  try {
    const relative = writeMacOSDevRepairFailureEvidence({
      repoRoot,
      reasonCode: 'runtime-principal-posix-cache-stale',
      actionHint: 'inspect_exact_projection',
      message: 'fresh verifier rejected the cached projection',
      details: {
        phase: 'group-removed',
        probe: 'getgrnam_r',
        state: 'present-exact',
        observed_primary_group_identifier: 499,
        observed_name_sha256: 'c'.repeat(64),
        projection_sha256: 'a'.repeat(64),
        attempt: 3,
        elapsed_ms: 1250,
        secret: 'must-not-be-persisted',
        stderr: 'must-not-be-persisted',
      },
      sourceHelper: { sha256: 'b'.repeat(64), device: 1, inode: 2 },
      installedBootstrap: { sha256: 'b'.repeat(64), device: 3, inode: 4 },
      commandResult: { status: 1, signal: null, error: undefined },
      cleanupDisposition: 'exact bootstrap removed',
      bootstrapPresentAfterCleanup: false,
      now: new Date('2026-07-20T12:34:56.000Z'),
      pid: 42,
      currentUID: fixtureUID,
      lstat: privateMacOSMetadata,
    });
    assert.equal(
      relative,
      '.nimi/local/acceptance/2026-07-20-macos-runtime-desktop-zhiyu/privileged-repair-failure-2026-07-20T123456-000Z-42.json',
    );
    const absolute = path.join(repoRoot, relative);
    const metadata = privateMacOSMetadata(absolute);
    assert.equal(metadata.mode & 0o777, 0o600);
    const evidence = JSON.parse(readFileSync(absolute, 'utf8'));
    assert.equal(evidence.retryPolicy, 'stop_after_single_privileged_failure');
    assert.equal(evidence.details.projection_sha256, 'a'.repeat(64));
    assert.equal(evidence.details.observed_primary_group_identifier, 499);
    assert.equal(evidence.details.observed_name_sha256, 'c'.repeat(64));
    assert.equal(evidence.details.attempt, 3);
    assert.equal(evidence.details.elapsed_ms, 1250);
    assert.equal('secret' in evidence.details, false);
    assert.equal('stderr' in evidence.details, false);
    assert.equal(evidence.cleanup.bootstrapPresentAfterCleanup, false);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('repair failure detail sanitizer rejects multiline, oversized, and object values', () => {
  assert.deepEqual(sanitizeRepairFailureDetails({
    phase: 'user-removed',
    state: 'x\ny',
    probe: 'a'.repeat(257),
    return_code: 5,
    child_reaped: true,
    projection_sha256: { secret: true },
  }), {
    phase: 'user-removed',
    return_code: 5,
    child_reaped: true,
  });
});

test('repair failure evidence admits every generated non-sensitive principal diagnostic field', () => {
  const details = Object.fromEntries(
    MACOS_LOCAL_DEVELOPMENT_PROFILE.runtimePrincipalDiagnosticFields.map(
      (field, index) => [field, index + 1],
    ),
  );
  assert.deepEqual(sanitizeRepairFailureDetails(details), details);
});

test('repair failure evidence never persists raw subprocess output', () => {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-repair-evidence-'));
  try {
    const relative = writeMacOSDevRepairFailureEvidence({
      repoRoot,
      reasonCode: 'runtime-service-repair-required',
      actionHint: 'inspect_bounded_child',
      message: 'bounded child failed',
      details: { child_reaped: false, stderr: 'forbidden', stdout: 'forbidden' },
      commandResult: {
        status: 1,
        signal: 'SIGKILL',
        stderr: 'private stderr',
        stdout: 'private stdout',
      },
      cleanupDisposition: 'bootstrap preserved',
      bootstrapPresentAfterCleanup: true,
      currentUID: fixtureUID,
      lstat: privateMacOSMetadata,
    });
    const evidence = JSON.parse(readFileSync(path.join(repoRoot, relative), 'utf8'));
    assert.equal(evidence.details.child_reaped, false);
    assert.equal('stderr' in evidence.details, false);
    assert.equal('stdout' in evidence.details, false);
    assert.equal('stderr' in evidence.subprocess, false);
    assert.equal('stdout' in evidence.subprocess, false);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('wrapper cleanup remains forbidden until a bounded privileged child is proven reaped', () => {
  assert.equal(privilegedRepairFailurePermitsBootstrapCleanup({ child_reaped: false }), false);
  assert.equal(privilegedRepairFailurePermitsBootstrapCleanup({ child_reaped: true }), true);
  assert.equal(privilegedRepairFailurePermitsBootstrapCleanup(undefined), false);
  assert.equal(privilegedRepairFailurePermitsBootstrapCleanup({}), false);
});

test('repair success receipt binds the preserved source carrier to the required install carrier', () => {
  const receipt = {
    schemaVersion: MACOS_LOCAL_DEVELOPMENT_PROFILE.runtimeLegacyRepairSuccessReceiptSchemaVersion,
    status: 'repaired',
    disposition: 'residue-removed',
    serviceName: MACOS_LOCAL_DEVELOPMENT_PROFILE.runtimeServiceLabel,
    removed: ['partial_launchd_definition', 'empty_install_directories', 'exact_runtime_principal'],
    preserved: [...MACOS_LOCAL_DEVELOPMENT_PROFILE.runtimeLegacyRepairSuccessReceiptPreservedFields],
    sourcePrincipalCarrierContractVersion: 2,
    requiredInstallPrincipalCarrierContractVersion: 4,
    sourceHelperDisposition: 'preserved',
    installReadiness: 'trust-helper-rotation-required',
    trustHelperRotationRequired: true,
    nextPrivilegedAction: 'separately_confirmed_trust_helper_rotation',
  };
  assert.equal(validateMacOSDevRepairSuccessReceipt(receipt), true);
  assert.equal(validateMacOSDevRepairSuccessReceipt({ ...receipt, unexpected: true }), false);
  assert.equal(validateMacOSDevRepairSuccessReceipt({
    ...receipt,
    sourcePrincipalCarrierContractVersion: 4,
  }), false);
  assert.equal(validateMacOSDevRepairSuccessReceipt({
    ...receipt,
    trustHelperRotationRequired: false,
  }), false);
});

function privateMacOSMetadata(file) {
  const metadata = lstatSync(file);
  const privateMode = metadata.isDirectory() ? 0o700 : 0o600;
  return Object.freeze({
    isDirectory: () => metadata.isDirectory(),
    isFile: () => metadata.isFile(),
    isSymbolicLink: () => metadata.isSymbolicLink(),
    uid: fixtureUID,
    mode: (metadata.mode & ~0o777) | privateMode,
    nlink: metadata.nlink,
  });
}
