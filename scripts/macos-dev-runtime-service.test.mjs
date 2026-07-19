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
    && error.actionHint === 'run_pnpm_provision_macos_dev_trust');
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

test('macOS install confirms before building and invokes only the fixed candidate transaction', async () => {
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
    invokeHelper: async (arguments_) => {
      calls.push(['helper', ...arguments_]);
      return { transaction: 'committed' };
    },
  });
  assert.deepEqual(calls, [
    ['confirm', 'INSTALL NIMI MACOS DEV RUNTIME', false],
    ['build'],
    ['helper', 'install-candidate', '/private/tmp/nimi-candidate'],
  ]);
  assert.equal(receipt.status, 'installed');
  assert.equal(receipt.state, 'running');
  assert.match(receipt.consequence, /boot epoch rotated/u);
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

test('macOS mutation rejects an installed helper that predates the generated Runtime principal carrier', async () => {
  assert.throws(
    () => assertCurrentPrincipalCarrier({ signingProfile: 'present' }),
    (error) => error.reasonCode === 'dev-security-helper-update-required'
      && error.actionHint === 'run_pnpm_unprovision_then_provision_macos_dev_trust_before_installing_runtime',
  );
  const calls = [];
  await assert.rejects(runMacOSDevRuntimeService({
    architecture: 'arm64',
    mode: 'install',
    platform: 'darwin',
    queryStatus: async () => ({ ...absentProfile, signingProfile: 'present' }),
    confirm: async () => calls.push('confirm'),
    buildCandidate: async () => calls.push('build'),
    invokeHelper: async () => calls.push('helper'),
  }), (error) => error.reasonCode === 'dev-security-helper-update-required');
  assert.deepEqual(calls, []);
});

test('macOS installed health preserves actionable absent, unavailable, and untrusted states', () => {
  assert.throws(
    () => assertHealthyInstalledStatus({ ...absentProfile, reasonCode: 'dev-signing-profile-unprovisioned' }),
    (error) => error.reasonCode === 'dev-signing-profile-unprovisioned'
      && error.actionHint === 'run_pnpm_provision_macos_dev_trust',
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
