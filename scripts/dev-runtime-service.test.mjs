import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseMacOSDevRuntimeArguments } from './macos-dev-runtime-service.mjs';
import {
  assertRuntimeServiceDeploymentProfile,
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
  deploymentProfile: 'local-development',
  realmOrigin: 'http://127.0.0.1:3002',
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
    install: async () => {
      calls.push('install');
      return healthyStatus;
    },
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
    deploymentProfile: healthyStatus.deploymentProfile,
    realmOrigin: healthyStatus.realmOrigin,
  });
});

test('post-update status fails closed on signature, build record, or candidate mismatch', () => {
  assertRuntimeServiceInstalled(healthyStatus);
  assertRuntimeServiceHealthy(healthyStatus);
  assertRuntimeServiceDeploymentProfile(healthyStatus);
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
  assert.throws(
    () => assertRuntimeServiceDeploymentProfile({
      ...healthyStatus,
      deploymentProfile: 'production',
      realmOrigin: 'https://realm.nimi.ai',
    }),
    (error) => error.reasonCode === 'dev-runtime-deployment-profile-mismatch',
  );
});

test('macOS install stops on candidate build failure before privileged mutation', async () => {
  const calls = [];
  await assert.rejects(
    runDevRuntimeService({
      platform: 'darwin',
      architecture: 'arm64',
      mode: 'install',
      queryStatus: async () => ({
        status: 'absent',
        state: 'stopped',
        healthy: false,
        serviceName: 'ai.nimi.runtime.dev',
      }),
      buildCandidate: async () => {
        calls.push('build-candidate');
        throw Object.assign(new Error('ad-hoc development candidate build failed'), {
          reasonCode: 'dev-runtime-build-failed',
          actionHint: 'inspect_macos_development_build_output',
        });
      },
      confirm: async () => calls.push('confirm'),
      invokeHelper: async () => calls.push('sudo-helper'),
    }),
    (error) => error.reasonCode === 'dev-runtime-build-failed',
  );
  assert.deepEqual(calls, ['build-candidate']);
});

test('macOS dev:runtime accepts only the fixed current modes', () => {
  assert.deepEqual(parseMacOSDevRuntimeArguments([]), { mode: 'status' });
  assert.deepEqual(parseMacOSDevRuntimeArguments(['--', '--desktop']), { mode: 'desktop' });
  for (const args of [
    ['--development-data-root', '/tmp/nimi'],
    ['--install', '--status'],
    ['--reset'],
  ]) {
    assert.throws(
      () => parseMacOSDevRuntimeArguments(args),
      (error) => error.reasonCode === 'dev-runtime-argument-invalid',
    );
  }
});

test('macOS install always removes its built source candidate after an attempted install', async (context) => {
  const candidateRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-dev-candidate-test-'));
  context.after(() => rmSync(candidateRoot, { recursive: true, force: true }));
  mkdirSync(path.join(candidateRoot, 'installer'));
  writeFileSync(path.join(candidateRoot, 'installer', 'nimi-macos-dev-security'), 'test');
  const calls = [];
  await assert.rejects(
    runDevRuntimeService({
      platform: 'darwin',
      architecture: 'arm64',
      mode: 'install',
      queryStatus: async () => ({
        status: 'absent',
        state: 'stopped',
        healthy: false,
        serviceName: 'ai.nimi.runtime.dev',
      }),
      buildCandidate: async () => ({
        outputRoot: candidateRoot,
        cleanup: async () => calls.push('cleanup-candidate'),
      }),
      confirm: async () => calls.push('confirm'),
      invokeHelper: async () => {
        calls.push('sudo-helper');
        throw Object.assign(new Error('install failed'), {
          reasonCode: 'runtime-service-repair-required',
        });
      },
    }),
    (error) => error.reasonCode === 'runtime-service-repair-required',
  );
  assert.deepEqual(calls, ['confirm', 'sudo-helper', 'cleanup-candidate']);
});

test('installed macOS Desktop launcher requires one healthy fixed service', async () => {
  const calls = [];
  await assert.rejects(
    runDevRuntimeService({
      platform: 'darwin',
      architecture: 'arm64',
      mode: 'desktop',
      queryStatus: async () => ({ status: 'absent', state: 'stopped', healthy: false }),
      launchDesktop: async () => calls.push('launch'),
    }),
    (error) => error.reasonCode === 'dev-runtime-service-not-installed',
  );
  const result = await runDevRuntimeService({
    platform: 'darwin',
    architecture: 'arm64',
    mode: 'desktop',
    queryStatus: async () => ({
      status: 'present',
      state: 'running',
      healthy: true,
      pid: 123,
    }),
    launchDesktop: async () => {
      calls.push('launch');
      return { status: 'stopped' };
    },
  });
  assert.deepEqual(calls, ['launch']);
  assert.deepEqual(result, { status: 'stopped' });
});
