import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertCurrentPrincipalCarrier,
  assertHealthyInstalledStatus,
  parseMacOSDevRuntimeArguments,
  runMacOSDevRuntimeService,
} from './macos-dev-runtime-service.mjs';

const absentProfile = Object.freeze({
  status: 'absent',
  state: 'stopped',
  signingProfile: 'absent',
});

const installed = Object.freeze({
  status: 'present',
  state: 'running',
  healthy: true,
  activationReady: true,
  signingProfile: 'present',
  signingProfileTrusted: true,
  runtimeExecutablePresent: true,
  runtimeExecutableTrusted: true,
  desktopApplicationPresent: true,
  desktopApplicationTrusted: true,
  localAppHostTrusted: true,
  launchDaemonPresent: true,
  launchDaemonDefinitionTrusted: true,
  launchDaemonLoaded: true,
  runtimeAccountTrusted: true,
  runtimePrincipalCarrierContractVersion: 4,
  installerLedgerTrusted: true,
  installedReleaseSetTrusted: true,
  runtimeProcessTrusted: true,
  desktopSocketPresent: true,
  desktopSocketTrusted: true,
  localAppSocketPresent: true,
  localAppSocketTrusted: true,
  installationTransactionClean: true,
  installationTransactionCommitted: false,
});

test('macOS dev Runtime arguments are exact, mutually exclusive, and accept pnpm separators', () => {
  assert.deepEqual(parseMacOSDevRuntimeArguments([]), { mode: 'update' });
  assert.deepEqual(parseMacOSDevRuntimeArguments(['--']), { mode: 'update' });
  assert.deepEqual(parseMacOSDevRuntimeArguments(['--', '--status']), { mode: 'status' });
  for (const mode of ['install', 'logs', 'restart', 'reset', 'uninstall']) {
    assert.deepEqual(parseMacOSDevRuntimeArguments([`--${mode}`]), { mode });
  }
  for (const invalid of [
    ['--status', '--restart'],
    ['--binary-only'],
    ['--development-data-root', '/tmp/nimi'],
  ]) {
    assert.throws(
      () => parseMacOSDevRuntimeArguments(invalid),
      (error) => error.reasonCode === 'dev-runtime-argument-invalid',
    );
  }
});

test('macOS status is read-only and does not require a provisioned signing profile', async () => {
  const status = await runMacOSDevRuntimeService({
    architecture: 'arm64',
    mode: 'status',
    platform: 'darwin',
    queryStatus: async () => absentProfile,
    confirm: async () => assert.fail('status must not confirm a mutation'),
    invokeHelper: async () => assert.fail('status must not invoke the helper'),
  });
  assert.equal(status, absentProfile);
});

test('macOS update fails closed before build, sudo, or confirmation when trust is unprovisioned', async () => {
  const calls = [];
  await assert.rejects(runMacOSDevRuntimeService({
    architecture: 'arm64',
    mode: 'update',
    platform: 'darwin',
    queryStatus: async () => absentProfile,
    confirm: async () => calls.push('confirm'),
    buildCandidate: async () => calls.push('build'),
    invokeHelper: async () => calls.push('helper'),
  }), (error) => error.reasonCode === 'dev-signing-profile-unprovisioned'
    && error.actionHint === 'run_pnpm_provision_macos_dev_signing');
  assert.deepEqual(calls, []);
});

test('macOS update never turns an absent installation into a silent first install', async () => {
  const calls = [];
  await assert.rejects(runMacOSDevRuntimeService({
    architecture: 'arm64',
    mode: 'update',
    platform: 'darwin',
    queryStatus: async () => ({ ...absentProfile, signingProfile: 'present', runtimePrincipalCarrierContractVersion: 4 }),
    confirm: async () => calls.push('confirm'),
    buildCandidate: async () => calls.push('build'),
    invokeHelper: async () => calls.push('helper'),
  }), (error) => error.reasonCode === 'dev-runtime-service-not-installed');
  assert.deepEqual(calls, []);
});

test('macOS update is typed fail-closed before confirmation, build, or sudo while lineage pending/commit is unadmitted', async () => {
  const calls = [];
  await assert.rejects(runMacOSDevRuntimeService({
    architecture: 'arm64',
    mode: 'update',
    platform: 'darwin',
    queryStatus: async () => installed,
    confirm: async () => calls.push('confirm'),
    buildCandidate: async () => calls.push('build'),
    invokeHelper: async () => calls.push('helper'),
  }), (error) => error.reasonCode === 'dev-runtime-update-not-admitted');
  assert.deepEqual(calls, []);
});

test('macOS install builds and verifies before confirmation, then invokes only the fixed candidate transaction', async () => {
  const calls = [];
  const statuses = [
    { ...absentProfile, signingProfile: 'present', runtimePrincipalCarrierContractVersion: 4 },
    installed,
  ];
  const receipt = await runMacOSDevRuntimeService({
    architecture: 'arm64',
    mode: 'install',
    platform: 'darwin',
    queryStatus: async () => statuses.shift(),
    confirm: async (impact, phrase) => calls.push(['confirm', phrase, impact.productAdmission]),
    buildCandidate: async () => {
      calls.push(['build']);
      return { outputRoot: '/private/tmp/nimi-candidate' };
    },
    verifyCandidate: async (candidate) => {
      calls.push(['verify', candidate.outputRoot]);
      return { carrier: 4, installer: { sha256: 'a'.repeat(64) } };
    },
    invokeHelper: async (arguments_) => {
      calls.push(['helper', ...arguments_]);
      return arguments_[0] === 'status' ? installed : { transaction: 'committed' };
    },
  });
  assert.deepEqual(calls, [
    ['build'],
    ['verify', '/private/tmp/nimi-candidate'],
    ['confirm', 'INSTALL NIMI MACOS DEV RUNTIME', false],
    ['helper', 'install-candidate', '/private/tmp/nimi-candidate'],
    ['helper', 'status'],
  ]);
  assert.equal(receipt.status, 'installed');
  assert.equal(receipt.state, 'running');
  assert.match(receipt.consequence, /boot epoch rotated/u);
});

test('macOS explicit reset reaches the carrier-4 cleanup helper without user signing authority', async () => {
  const calls=[];
  const result=await runMacOSDevRuntimeService({
    architecture:'arm64',mode:'reset',platform:'darwin',
    queryStatus:async()=>({status:'blocked',signingProfile:'absent',runtimePrincipalCarrierContractVersion:4,reasonCode:'runtime-service-repair-required'}),
    confirm:async(impact,phrase)=>calls.push(['confirm',phrase,impact.action]),
    invokeHelper:async(args)=>{calls.push(['helper',...args]);return{status:'reset',terminalState:'clean-unprovisioned'};},
  });
  assert.equal(result.terminalState,'clean-unprovisioned');
  assert.deepEqual(calls.map((entry)=>entry.slice(0,2)),[['confirm','RESET NIMI MACOS DEV RUNTIME'],['helper','reset-service-state']]);
});

test('macOS installed health is the complete service, code, process, record, account, and socket conjunction', () => {
  assertHealthyInstalledStatus(installed);
  for (const field of [
    'healthy',
    'activationReady',
    'runtimeExecutablePresent',
    'runtimeExecutableTrusted',
    'desktopApplicationPresent',
    'desktopApplicationTrusted',
    'localAppHostTrusted',
    'launchDaemonPresent',
    'launchDaemonDefinitionTrusted',
    'launchDaemonLoaded',
    'runtimeAccountTrusted',
    'runtimePrincipalCarrierContractVersion',
    'installerLedgerTrusted',
    'installedReleaseSetTrusted',
    'runtimeProcessTrusted',
    'desktopSocketPresent',
    'desktopSocketTrusted',
    'localAppSocketPresent',
    'localAppSocketTrusted',
    'signingProfileTrusted',
    'installationTransactionClean',
  ]) {
    assert.throws(
      () => assertHealthyInstalledStatus({ ...installed, [field]: false }),
      (error) => error.reasonCode === 'runtime-service-repair-required',
    );
  }
  assert.throws(
    () => assertHealthyInstalledStatus({ ...installed, installationTransactionCommitted: true }),
    (error) => error.reasonCode === 'runtime-service-repair-required',
  );
});

test('macOS mutation rejects every non-carrier-4 profile without mutation', async () => {
  for (const observed of [undefined, null, 1, 2, 3, 5, '4']) {
    assert.throws(
      () => assertCurrentPrincipalCarrier({ signingProfile: 'present', runtimePrincipalCarrierContractVersion: observed }),
      (error) => error.reasonCode === 'legacy-local-dev-profile-not-supported'
        && error.actionHint === 'remove_the_exact_legacy_profile_with_the_one_time_local_delete_only_cutover_before_fresh_install'
        && error.details?.mutation === 'none',
    );
  }
  const calls = [];
  await assert.rejects(runMacOSDevRuntimeService({
    architecture: 'arm64', mode: 'install', platform: 'darwin',
    queryStatus: async () => ({ ...absentProfile, signingProfile: 'present', runtimePrincipalCarrierContractVersion: 2 }),
    confirm: async () => calls.push('confirm'), buildCandidate: async () => calls.push('build'),
    verifyCandidate: async () => calls.push('verify'), invokeHelper: async () => calls.push('helper'),
  }), (error) => error.reasonCode === 'legacy-local-dev-profile-not-supported');
  assert.deepEqual(calls, []);
});

test('macOS installed health preserves actionable absent, unavailable, and untrusted states', () => {
  assert.throws(
    () => assertHealthyInstalledStatus({ ...absentProfile, reasonCode: 'dev-signing-profile-unprovisioned' }),
    (error) => error.reasonCode === 'dev-signing-profile-unprovisioned'
      && error.actionHint === 'run_pnpm_provision_macos_dev_signing',
  );
  assert.throws(
    () => assertHealthyInstalledStatus({ ...absentProfile, signingProfile: 'present' }),
    (error) => error.reasonCode === 'dev-runtime-service-not-installed',
  );
  assert.throws(
    () => assertHealthyInstalledStatus({ ...installed, healthy: false, state: 'stopped' }),
    (error) => error.reasonCode === 'runtime-service-unavailable',
  );
  assert.throws(
    () => assertHealthyInstalledStatus({
      ...installed,
      healthy: false,
      errors: [{ reasonCode: 'runtime-service-untrusted' }],
    }),
    (error) => error.reasonCode === 'runtime-service-untrusted',
  );
});
