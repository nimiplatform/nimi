import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertRuntimeServiceHealthy,
  assertRuntimeServiceInstalled,
  rejectBinaryOnlyRequest,
  runDevRuntimeService,
} from './dev-runtime-service.mjs';
import { readFileSync } from 'node:fs';

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
  checkpointCandidatePostureVerified: true,
  signatureStatus: 'Valid',
  runtimeCandidateId: 'dev-kernel-runtime-0123456789abcdef0123456789abcdef',
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
      && error.actionHint === 'run_pnpm_install_dev_kernel_service_candidate_from_an_elevated_terminal',
  );
  assert.deepEqual(calls, []);
});

test('binary-only update fails closed while layout equivalence is unproven', () => {
  assert.throws(
    () => rejectBinaryOnlyRequest(['--binary-only']),
    (error) => error.reasonCode === 'dev-runtime-binary-only-layout-unverified'
      && error.actionHint === 'run_full_dev_runtime_service_update',
  );
});

test('full update reports segmented timings and validates signed fixed-service status', async () => {
  const calls = [];
  const ticks = [0, 11, 11, 24, 24, 55, 55, 60];
  const result = await runDevRuntimeService({
    platform: 'win32',
    now: () => ticks.shift(),
    queryInstalled: async () => ({ status: 'present' }),
    buildRuntime: async () => calls.push('build-runtime'),
    buildInstaller: async () => calls.push('build-installer'),
    queryCandidate: async () => healthyStatus,
    install: async () => {
      calls.push('install');
      return healthyStatus;
    },
  });
  assert.deepEqual(calls, ['build-runtime', 'build-installer', 'install']);
  assert.deepEqual(result.timings, {
    runtimeBuildAndSignMs: 11,
    installerBuildAndSignMs: 13,
    serviceInstallAndRestartMs: 31,
    statusMs: 5,
  });
  assert.equal(result.status, 'updated');
  assert.match(result.consequence, /boot epoch rotated/u);
});

test('post-update status fails closed on signature or candidate mismatch', () => {
  assertRuntimeServiceInstalled(healthyStatus);
  assertRuntimeServiceHealthy(healthyStatus);
  assert.throws(
    () => assertRuntimeServiceHealthy({ ...healthyStatus, signatureStatus: 'UnknownError' }),
    (error) => error.reasonCode === 'dev-runtime-service-update-unhealthy',
  );
});

test('UAC launcher keeps stream redirection inside the elevated command', () => {
  const source = readFileSync(new URL('./dev-runtime-service.mjs', import.meta.url), 'utf8');
  const outerLauncher = source.slice(source.indexOf('const outerCommand'), source.indexOf('try {', source.indexOf('const outerCommand')));
  assert.doesNotMatch(outerLauncher, /RedirectStandard(?:Output|Error)/u);
  assert.match(source, /\$output = & .* -DevKernelCheckpoint -Json 2> /u);
  assert.match(source, /WriteAllText.*UTF8Encoding/u);
});
