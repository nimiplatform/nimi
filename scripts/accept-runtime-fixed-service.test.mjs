import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
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
  assertRuntimeOfflineRepair,
  parseDevRuntimeArguments,
  runDevRuntimeService,
} from './accept-runtime-fixed-service.mjs';

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
  localAgentChatRepairHelperMatchesCandidate: true,
  localAgentChatRepairHelperSignatureStatus: 'Valid',
  signerCertificateSha256: 'cd'.repeat(32),
  localAgentChatRepairHelperSignerCertificateSha256: 'cd'.repeat(32),
  signatureStatus: 'Valid',
  runtimeCandidateId: 'runtime-0123456789abcdef0123456789abcdef',
  runtimeBinarySha256: 'ab'.repeat(32),
  deploymentProfile: 'local-development',
  realmOrigin: 'http://127.0.0.1:3002',
  offlineRepair: {
    status: 'no-change',
    skipReason: null,
    duplicateGroups: 0,
    reactivatedAnchors: 0,
    rewrittenAnchorRefs: 0,
    rewrittenTargetRefs: 0,
    removedLegacyIdentityFields: 0,
    originalVersion: 176,
    repairedVersion: 176,
    backupPath: null,
  },
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

test('accept:runtime:fixed-service accepts no Windows update overrides', () => {
  assert.deepEqual(parseDevRuntimeArguments([]), {});
  for (const args of [
    ['--binary-only'],
    ['--development-data-root', 'D:/DataNimi'],
    ['--product-root', 'D:/DataNimi'],
  ]) {
    assert.throws(
      () => parseDevRuntimeArguments(args),
      (error) => error.reasonCode === 'dev-runtime-argument-invalid'
        && error.actionHint === 'run_pnpm_accept_runtime_fixed_service_without_overrides',
    );
  }
});

test('current Windows service update runs signed offline repair, installs, and checks the resulting service', async () => {
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
    offlineRepair: healthyStatus.offlineRepair,
  });
});

test('post-update status fails closed on signature, build record, or candidate mismatch', () => {
  assertRuntimeServiceInstalled(healthyStatus);
  assertRuntimeServiceHealthy(healthyStatus);
  assertRuntimeServiceDeploymentProfile(healthyStatus);
  assertRuntimeOfflineRepair(healthyStatus.offlineRepair);
  assertRuntimeOfflineRepair({
    ...healthyStatus.offlineRepair,
    status: 'applied',
    rewrittenAnchorRefs: 1,
    originalVersion: 176,
    repairedVersion: 177,
    backupPath: 'D:\\NimiRuntime\\runtime.sqlite.pre-local-agent-chat-repair.sqlite',
  });
  for (const status of [
    { ...healthyStatus, signatureStatus: 'UnknownError' },
    { ...healthyStatus, runtimeBuildRecordMatchesCandidate: false },
    { ...healthyStatus, localAgentChatRepairHelperMatchesCandidate: false },
    { ...healthyStatus, localAgentChatRepairHelperSignerCertificateSha256: 'ef'.repeat(32) },
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
  for (const repair of [
    undefined,
    { ...healthyStatus.offlineRepair, status: 'applied', backupPath: null },
    { ...healthyStatus.offlineRepair, status: 'not-applicable', skipReason: 'unknown' },
  ]) {
    assert.throws(
      () => assertRuntimeOfflineRepair(repair),
      (error) => error.reasonCode === 'dev-runtime-offline-repair-invalid',
    );
  }
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
        serviceName: 'ai.nimi.runtime.dev',
      }),
      buildCandidate: async () => {
        calls.push('build-candidate');
        throw Object.assign(new Error('ad-hoc development candidate build failed'), {
          reasonCode: 'dev-runtime-build-failed',
          actionHint: 'inspect_macos_development_build_output',
        });
      },
      invokeHelper: async () => calls.push('sudo-helper'),
    }),
    (error) => error.reasonCode === 'dev-runtime-build-failed',
  );
  assert.deepEqual(calls, ['build-candidate']);
});

test('macOS fixed-service acceptance accepts only the fixed current modes', (context) => {
  const candidateRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'nimi-downloaded-candidate-')));
  context.after(() => rmSync(candidateRoot, { recursive: true, force: true }));
  assert.deepEqual(parseMacOSDevRuntimeArguments([]), { mode: 'update' });
  assert.deepEqual(parseMacOSDevRuntimeArguments(['--status']), { mode: 'status' });
  assert.deepEqual(parseMacOSDevRuntimeArguments(['--', '--desktop']), { mode: 'desktop' });
  assert.deepEqual(
    parseMacOSDevRuntimeArguments(['--install-candidate', candidateRoot]),
    { mode: 'install-candidate', candidatePath: candidateRoot },
  );
  for (const args of [
    ['--development-data-root', '/tmp/nimi'],
    ['--install', '--status'],
    ['--install-candidate'],
    ['--reset'],
  ]) {
    assert.throws(
      () => parseMacOSDevRuntimeArguments(args),
      (error) => error.reasonCode === 'dev-runtime-argument-invalid',
    );
  }
  assert.throws(
    () => parseMacOSDevRuntimeArguments(['--install-candidate', 'relative-candidate']),
    (error) => error.reasonCode === 'dev-candidate-path-untrusted',
  );
});

test('macOS downloaded candidate installs exact bytes without rebuild or cleanup', async (context) => {
  const candidateRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'nimi-downloaded-candidate-')));
  context.after(() => rmSync(candidateRoot, { recursive: true, force: true }));
  const calls = [];
  const result = await runDevRuntimeService({
    platform: 'darwin',
    architecture: 'arm64',
    mode: 'install-candidate',
    candidatePath: candidateRoot,
    queryStatus: async () => {
      calls.push('status');
      return { status: 'absent', state: 'stopped', serviceName: 'ai.nimi.runtime.dev' };
    },
    buildCandidate: async () => calls.push('build-candidate'),
    invokeHelper: async (args) => {
      calls.push(args);
      return {
        status: 'installed',
        state: 'running',
        pid: 456,
        serviceName: 'ai.nimi.runtime.dev',
      };
    },
  });
  assert.deepEqual(calls, ['status', ['install-candidate', candidateRoot]]);
  assert.equal(realpathSync(candidateRoot), candidateRoot);
  assert.deepEqual(result, {
    status: 'installed',
    state: 'running',
    pid: 456,
    serviceName: 'ai.nimi.runtime.dev',
  });
});

test('macOS downloaded candidate refuses a non-absent namespace before mutation', async (context) => {
  const candidateRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'nimi-downloaded-candidate-')));
  context.after(() => rmSync(candidateRoot, { recursive: true, force: true }));
  const calls = [];
  await assert.rejects(
    runDevRuntimeService({
      platform: 'darwin',
      architecture: 'arm64',
      mode: 'install-candidate',
      candidatePath: candidateRoot,
      queryStatus: async () => ({ status: 'present', state: 'running', pid: 123 }),
      buildCandidate: async () => calls.push('build-candidate'),
      invokeHelper: async () => calls.push('sudo-helper'),
    }),
    (error) => error.reasonCode === 'runtime-service-repair-required'
      && error.actionHint === 'run_pnpm_accept_runtime_fixed_service_uninstall_before_install',
  );
  assert.deepEqual(calls, []);
});

test('current macOS service update builds once and returns the helper result', async (context) => {
  const candidateRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-dev-update-candidate-test-'));
  context.after(() => rmSync(candidateRoot, { recursive: true, force: true }));
  mkdirSync(path.join(candidateRoot, 'installer'));
  writeFileSync(path.join(candidateRoot, 'installer', 'nimi-macos-dev-security'), 'test');
  const calls = [];
  const result = await runDevRuntimeService({
    platform: 'darwin',
    architecture: 'arm64',
    queryStatus: async () => {
      calls.push('status');
      return {
        status: 'present',
        state: 'running',
        pid: 123,
        serviceName: 'ai.nimi.runtime.dev',
      };
    },
    buildCandidate: async () => {
      calls.push('build-candidate');
      return {
        outputRoot: candidateRoot,
        cleanup: async () => calls.push('cleanup-candidate'),
      };
    },
    invokeHelper: async (args) => {
      calls.push(`helper:${args[0]}`);
      return {
        status: 'updated',
        state: 'running',
        pid: 456,
        serviceName: 'ai.nimi.runtime.dev',
      };
    },
  });
  assert.deepEqual(calls, [
    'status',
    'build-candidate',
    'helper:update-candidate',
    'cleanup-candidate',
  ]);
  assert.deepEqual(result, {
    status: 'updated',
    state: 'running',
    pid: 456,
    serviceName: 'ai.nimi.runtime.dev',
  });
});

test('macOS default update refuses absent or partial namespaces before mutation', async () => {
  for (const [status, reasonCode, actionHint] of [
    [
      { status: 'absent', state: 'stopped' },
      'dev-runtime-service-not-installed',
      'run_pnpm_accept_runtime_fixed_service_install',
    ],
    [
      { status: 'partial', state: 'stopped' },
      'runtime-service-repair-required',
      'run_pnpm_accept_runtime_fixed_service_uninstall_before_update',
    ],
  ]) {
    const calls = [];
    await assert.rejects(
      runDevRuntimeService({
        platform: 'darwin',
        architecture: 'arm64',
        queryStatus: async () => status,
        buildCandidate: async () => calls.push('build-candidate'),
        invokeHelper: async () => calls.push('sudo-helper'),
      }),
      (error) => error.reasonCode === reasonCode && error.actionHint === actionHint,
    );
    assert.deepEqual(calls, []);
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
        serviceName: 'ai.nimi.runtime.dev',
      }),
      buildCandidate: async () => ({
        outputRoot: candidateRoot,
        cleanup: async () => calls.push('cleanup-candidate'),
      }),
      invokeHelper: async () => {
        calls.push('sudo-helper');
        throw Object.assign(new Error('install failed'), {
          reasonCode: 'runtime-service-repair-required',
        });
      },
    }),
    (error) => error.reasonCode === 'runtime-service-repair-required',
  );
  assert.deepEqual(calls, ['sudo-helper', 'cleanup-candidate']);
});

test('installed macOS Desktop launcher requires one running fixed service', async () => {
  const calls = [];
  await assert.rejects(
    runDevRuntimeService({
      platform: 'darwin',
      architecture: 'arm64',
      mode: 'desktop',
      queryStatus: async () => ({ status: 'absent', state: 'stopped' }),
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
