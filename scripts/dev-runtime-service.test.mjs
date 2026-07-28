import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertRuntimeServiceHealthy,
  assertRuntimeServiceInstalled,
  parseDevRuntimeArguments,
  runDevRuntimeService,
} from './dev-runtime-service.mjs';

const healthyStatus = {
  status: 'present',
  serviceName: 'NimiRuntime',
  state: 'running',
  serviceAccountMatches: true,
  binaryPathMatches: true,
  serviceSidMatches: true,
  restrictedSid: true,
  desktopPipePresent: true,
  localAppPipePresent: true,
  runtimeBinaryMatchesCandidate: true,
  runtimeBuildRecordMatchesCandidate: true,
  signatureStatus: 'Valid',
  runtimeCandidateId: 'runtime-0123456789abcdef0123456789abcdef',
  runtimeBinarySha256: 'ab'.repeat(32),
};

test('missing fixed service fails before any build or install mutation', async () => {
  const calls = [];
  await assert.rejects(
    runDevRuntimeService({
      platform: 'win32',
      queryInstalled: async () => ({ status: 'absent' }),
      buildRuntime: async () => calls.push('build-runtime'),
      buildInstaller: async () => calls.push('build-installer'),
      install: async () => calls.push('install'),
    }),
    (error) => error.reasonCode === 'dev-runtime-service-not-installed'
      && error.actionHint === 'run_the_windows_runtime_service_installer_from_an_elevated_terminal',
  );
  assert.deepEqual(calls, []);
});

test('dev:runtime accepts no Windows update overrides', () => {
  assert.deepEqual(parseDevRuntimeArguments([]), {});
  for (const args of [
    ['--binary-only'],
    ['--development-data-root', 'D:/DataNimi'],
    ['--product-root', 'D:/DataNimi'],
  ]) {
    assert.throws(
      () => parseDevRuntimeArguments(args),
      (error) => error.reasonCode === 'dev-runtime-argument-invalid'
        && error.actionHint === 'run_pnpm_dev_runtime_without_overrides',
    );
  }
});

test('current Windows service update builds, installs, and checks the resulting service', async () => {
  const calls = [];
  const result = await runDevRuntimeService({
    platform: 'win32',
    queryInstalled: async () => ({ status: 'present' }),
    buildRuntime: async () => calls.push('build-runtime'),
    buildInstaller: async () => calls.push('build-installer'),
    install: async () => calls.push('install'),
    queryStatus: async () => {
      calls.push('status');
      return healthyStatus;
    },
  });
  assert.deepEqual(calls, ['build-runtime', 'build-installer', 'install', 'status']);
  assert.deepEqual(result, {
    status: 'updated',
    serviceName: 'NimiRuntime',
    state: 'running',
    runtimeCandidateId: healthyStatus.runtimeCandidateId,
    runtimeBinarySha256: healthyStatus.runtimeBinarySha256,
    signatureStatus: 'Valid',
  });
});

test('post-update status fails closed on signature, build record, or candidate mismatch', () => {
  assertRuntimeServiceInstalled(healthyStatus);
  assertRuntimeServiceHealthy(healthyStatus);
  for (const status of [
    { ...healthyStatus, signatureStatus: 'UnknownError' },
    { ...healthyStatus, runtimeBuildRecordMatchesCandidate: false },
    { ...healthyStatus, runtimeCandidateId: 'invalid' },
  ]) {
    assert.throws(
      () => assertRuntimeServiceHealthy(status),
      (error) => error.reasonCode === 'dev-runtime-service-update-unhealthy',
    );
  }
});
