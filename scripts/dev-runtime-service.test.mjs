import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  assertRuntimeServiceHealthy,
  assertRuntimeServiceInstalled,
  parseDevRuntimeArguments,
  parseFirstJsonDocument,
  rejectBinaryOnlyRequest,
  runDevRuntimeService,
} from './dev-runtime-service.mjs';
import { readFileSync } from 'node:fs';

const rootPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('root dev:runtime is the fixed-service updater and never a foreground serve alias', () => {
  assert.equal(rootPackage.scripts['dev:runtime'], 'node scripts/dev-runtime-service.mjs');
  assert.doesNotMatch(rootPackage.scripts['dev:runtime'], /(?:^|\s)serve(?:\s|$)/u);
});

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

test('development data root is an explicit absolute signed-installer selection', () => {
  const dataRoot = path.win32.join('D:\\', 'DataNimi');
  assert.deepEqual(parseDevRuntimeArguments([], 'win32'), { developmentDataRoot: '' });
  assert.deepEqual(
    parseDevRuntimeArguments(['--development-data-root', 'D:/DataNimi/'], 'win32'),
    { developmentDataRoot: dataRoot },
  );
  assert.throws(
    () => parseDevRuntimeArguments(['--development-data-root'], 'win32'),
    (error) => error.reasonCode === 'dev-runtime-argument-invalid',
  );
  assert.throws(
    () => parseDevRuntimeArguments(['--development-data-root', 'relative-data'], 'win32'),
    (error) => error.reasonCode === 'dev-runtime-development-data-root-invalid',
  );
  assert.throws(
    () => parseDevRuntimeArguments(['--development-data-root', 'D:\\'], 'win32'),
    (error) => error.reasonCode === 'dev-runtime-development-data-root-invalid',
  );
});

test('full update reports segmented timings and validates signed fixed-service status', async () => {
  const calls = [];
  const developmentDataRoot = path.win32.join('D:\\', 'DataNimi');
  const ticks = [0, 11, 11, 24, 24, 55, 55, 60];
  const result = await runDevRuntimeService({
    platform: 'win32',
    developmentDataRoot,
    now: () => ticks.shift(),
    queryInstalled: async () => ({ status: 'present' }),
    buildRuntime: async () => calls.push('build-runtime'),
    buildInstaller: async () => calls.push('build-installer'),
    queryCandidate: async () => healthyStatus,
    install: async (input) => {
      calls.push(['install', input]);
      return healthyStatus;
    },
  });
  assert.deepEqual(calls, [
    'build-runtime',
    'build-installer',
    ['install', { developmentDataRoot }],
  ]);
  assert.deepEqual(result.timings, {
    runtimeBuildAndSignMs: 11,
    installerBuildAndSignMs: 13,
    serviceInstallAndRestartMs: 31,
    statusMs: 5,
  });
  assert.equal(result.status, 'updated');
  assert.deepEqual(result.developmentDataRootBinding, {
    path: developmentDataRoot,
    authority: 'signed_installer_explicit_operator_selection',
    disposition: 'runtime_validated_candidate_payload_root',
  });
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

test('elevated installer separates a localized warning from the first complete JSON receipt', () => {
  const output = [
    '\ufeff警告: 无法加载某个可选的 PowerShell 格式化数据。',
    '{',
    '  "status": "present",',
    '  "message": "quoted \\\"value\\\" with } and ] inside the string"',
    '}',
    'VERBOSE: installer cleanup completed',
  ].join('\r\n');

  const receipt = parseFirstJsonDocument(output, 'dev-runtime-install-result-invalid');
  assert.deepEqual(receipt.value, {
    status: 'present',
    message: 'quoted "value" with } and ] inside the string',
  });
  assert.equal(
    receipt.diagnostics,
    '警告: 无法加载某个可选的 PowerShell 格式化数据。\nVERBOSE: installer cleanup completed',
  );
  assert.throws(
    () => parseFirstJsonDocument('警告: no receipt', 'dev-runtime-install-result-invalid'),
    (error) => error.reasonCode === 'dev-runtime-install-result-invalid'
      && error.actionHint === 'inspect_dev_runtime_command_output',
  );
});

test('UAC launcher keeps stream redirection inside the elevated command', () => {
  const source = readFileSync(new URL('./dev-runtime-service.mjs', import.meta.url), 'utf8');
  const outerLauncher = source.slice(source.indexOf('const outerCommand'), source.indexOf('try {', source.indexOf('const outerCommand')));
  assert.doesNotMatch(outerLauncher, /RedirectStandard(?:Output|Error)/u);
  assert.match(source, /-DevelopmentDataRoot '\$\{powerShellLiteral\(developmentDataRoot\)\}'/u);
  assert.match(source, /\$output = & powershell\.exe .* -DevKernelCheckpoint\$\{developmentDataRootArgument\} -Json 2> /u);
  assert.doesNotMatch(source, /\$parsed = \$raw \| ConvertFrom-Json/u);
  assert.match(source, /WriteAllText.*\$raw.*UTF8Encoding/u);
  assert.match(source, /process\.stderr\.write\(`\$\{diagnostics\}\\n`\)/u);
  assert.match(source, /\$ErrorActionPreference = 'Stop'[\s\S]*\[Console\]::Error\.WriteLine\(\$_\.Exception\.Message\)[\s\S]*'exit 1'/u);
});
