import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  assertRuntimeServiceHealthy,
  assertRuntimeServiceInstalled,
  assertAccessibleDevelopmentDataRoot,
  parseDevRuntimeArguments,
  parseFirstJsonDocument,
  rejectBinaryOnlyRequest,
  resolveConfiguredDevelopmentDataRoot,
  runDevRuntimeService,
} from './dev-runtime-service.mjs';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';

const rootPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const durableStateCandidateId = 'dev-kernel-runtime-fedcba9876543210fedcba9876543210';
const acceptanceRoundId = 'dev-kernel-round-00112233445566778899aabbccddeeff';
const defaultDevelopmentDataRoot = path.win32.join('D:\\', 'DataNimi');
const acceptSyntheticDataRoot = (value) => value;

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
  developmentDataRootRef: defaultDevelopmentDataRoot,
  developmentStateCandidateId: durableStateCandidateId,
  acceptanceRoundId,
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

test('default service update resolves the existing data root from Runtime user config', () => {
  const dataRoot = path.win32.join('D:\\', 'DataNimi');
  assert.equal(resolveConfiguredDevelopmentDataRoot({
    platform: 'win32',
    configPath: 'C:\\Users\\dev\\.nimi\\runtime\\config.json',
    readConfig: () => JSON.stringify({ schemaVersion: 1, dataRootRef: 'D:/DataNimi/' }),
  }), dataRoot);
  assert.throws(
    () => resolveConfiguredDevelopmentDataRoot({
      platform: 'win32',
      readConfig: () => JSON.stringify({ schemaVersion: 1 }),
    }),
    (error) => error.reasonCode === 'dev-runtime-data-root-config-invalid'
      && error.actionHint === 'repair_runtime_user_config_data_root',
  );
  assert.throws(
    () => resolveConfiguredDevelopmentDataRoot({
      platform: 'win32',
      readConfig: () => '{not-json',
    }),
    (error) => error.reasonCode === 'dev-runtime-data-root-config-unavailable'
      && error.actionHint === 'repair_runtime_user_config_data_root',
  );
  assert.throws(
    () => resolveConfiguredDevelopmentDataRoot({
      platform: 'win32',
      readConfig: () => '{"dataRootRef":"D:/first","dataRootRef":"D:/second"}',
    }),
    (error) => error.reasonCode === 'dev-runtime-data-root-config-unavailable',
  );
  assert.throws(
    () => resolveConfiguredDevelopmentDataRoot({
      platform: 'win32',
      readConfig: () => JSON.stringify({ dataRootRef: 'D:/DataNimi', padding: 'x'.repeat(70_000) }),
    }),
    (error) => error.reasonCode === 'dev-runtime-data-root-config-unavailable',
  );
});

test('default Runtime user config reader rejects an oversized real file within the read bound', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nimi-dev-runtime-config-'));
  const configPath = path.join(root, 'config.json');
  try {
    writeFileSync(configPath, JSON.stringify({
      schemaVersion: 1,
      dataRootRef: 'D:/DataNimi',
      padding: 'x'.repeat(70_000),
    }));
    assert.throws(
      () => resolveConfiguredDevelopmentDataRoot({ platform: 'win32', configPath }),
      (error) => error.reasonCode === 'dev-runtime-data-root-config-unavailable',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('development data root accessibility rejects missing, file, and reparse-ancestor paths', (t) => {
  const temporaryRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'nimi-dev-root-')));
  try {
    const directRoot = path.join(temporaryRoot, 'direct', 'nimi-data');
    mkdirSync(directRoot, { recursive: true });
    assert.equal(assertAccessibleDevelopmentDataRoot(directRoot), directRoot);
    assert.throws(
      () => assertAccessibleDevelopmentDataRoot(path.join(temporaryRoot, 'missing')),
      (error) => error.reasonCode === 'dev-runtime-development-data-root-unavailable',
    );
    const filePath = path.join(temporaryRoot, 'file');
    writeFileSync(filePath, 'not a directory', 'utf8');
    assert.throws(
      () => assertAccessibleDevelopmentDataRoot(filePath),
      (error) => error.reasonCode === 'dev-runtime-development-data-root-unavailable',
    );

    const targetRoot = path.join(temporaryRoot, 'target');
    mkdirSync(path.join(targetRoot, 'nested'), { recursive: true });
    const linkedRoot = path.join(temporaryRoot, 'linked');
    try {
      symlinkSync(targetRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      t.diagnostic(`symlink privilege unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    assert.throws(
      () => assertAccessibleDevelopmentDataRoot(path.join(linkedRoot, 'nested')),
      (error) => error.reasonCode === 'dev-runtime-development-data-root-unavailable',
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('full update reports segmented timings and validates signed fixed-service status', async () => {
  const calls = [];
  const developmentDataRoot = path.win32.join('D:\\', 'DataNimi');
  const ticks = [0, 11, 11, 24, 24, 55, 55, 60];
  const installStatus = {
    ...healthyStatus,
    developmentDataRootRef: developmentDataRoot,
    developmentDataRootAuthority: 'signed_installer_explicit_operator_selection',
    developmentDataRootDisposition: 'runtime_validated_development_payload_root',
    developmentStateLineageAuthority: 'signed_installer_preserved_development_state_lineage',
  };
  const result = await runDevRuntimeService({
    platform: 'win32',
    developmentDataRoot,
    validateDevelopmentDataRoot: acceptSyntheticDataRoot,
    now: () => ticks.shift(),
    queryInstalled: async () => ({ status: 'present' }),
    buildRuntime: async () => calls.push('build-runtime'),
    buildInstaller: async () => calls.push('build-installer'),
    queryCandidate: async () => healthyStatus,
    install: async (input) => {
      calls.push(['install', input]);
      return installStatus;
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
    disposition: 'runtime_validated_development_payload_root',
    source: 'command_line',
  });
  assert.deepEqual(result.developmentStateLineage, {
    developmentStateCandidateId: durableStateCandidateId,
    acceptanceRoundId,
    authority: 'signed_installer_preserved_development_state_lineage',
  });
  assert.match(result.consequence, /boot epoch rotated/u);
});

test('full update passes the Runtime user-config data root as an exact signed-installer selection', async () => {
  const developmentDataRoot = path.win32.join('D:\\', 'DataNimi');
  const installStatus = {
    ...healthyStatus,
    developmentDataRootRef: developmentDataRoot,
    developmentDataRootAuthority: 'signed_installer_explicit_operator_selection',
    developmentDataRootDisposition: 'runtime_validated_development_payload_root',
    developmentStateLineageAuthority: 'signed_installer_preserved_development_state_lineage',
  };
  const installs = [];
  const result = await runDevRuntimeService({
    platform: 'win32',
    validateDevelopmentDataRoot: acceptSyntheticDataRoot,
    queryInstalled: async () => ({ status: 'present' }),
    resolveConfiguredDevelopmentDataRoot: async () => developmentDataRoot,
    buildRuntime: async () => undefined,
    buildInstaller: async () => undefined,
    queryCandidate: async () => healthyStatus,
    install: async (input) => {
      installs.push(input);
      return installStatus;
    },
  });
  assert.deepEqual(installs, [{ developmentDataRoot }]);
  assert.deepEqual(result.developmentDataRootBinding, {
    path: developmentDataRoot,
    authority: 'signed_installer_explicit_operator_selection',
    disposition: 'runtime_validated_development_payload_root',
    source: 'runtime_user_config',
  });
});

test('full update fails closed when the signed installer rotates durable development state lineage', async () => {
  const developmentDataRoot = defaultDevelopmentDataRoot;
  await assert.rejects(
    runDevRuntimeService({
      platform: 'win32',
      developmentDataRoot,
      validateDevelopmentDataRoot: acceptSyntheticDataRoot,
      queryInstalled: async () => ({ status: 'present' }),
      buildRuntime: async () => undefined,
      buildInstaller: async () => undefined,
      queryCandidate: async () => healthyStatus,
      install: async () => ({
        ...healthyStatus,
        developmentDataRootRef: developmentDataRoot,
        developmentDataRootAuthority: 'signed_installer_explicit_operator_selection',
        developmentDataRootDisposition: 'runtime_validated_development_payload_root',
        developmentStateCandidateId: 'dev-kernel-runtime-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        developmentStateLineageAuthority: 'signed_installer_preserved_development_state_lineage',
      }),
    }),
    (error) => error.reasonCode === 'dev-runtime-state-lineage-unverified'
      && error.actionHint === 'inspect_signed_installer_state_lineage_receipt',
  );
});

test('full update requires an independently observed healthy post-install status', async () => {
  const developmentDataRoot = defaultDevelopmentDataRoot;
  let statusCalls = 0;
  await assert.rejects(
    runDevRuntimeService({
      platform: 'win32',
      developmentDataRoot,
      validateDevelopmentDataRoot: acceptSyntheticDataRoot,
      queryInstalled: async () => ({ status: 'present' }),
      buildRuntime: async () => undefined,
      buildInstaller: async () => undefined,
      queryCandidate: async () => {
        statusCalls += 1;
        return statusCalls === 1 ? healthyStatus : { status: 'absent' };
      },
      install: async () => ({
        ...healthyStatus,
        developmentDataRootRef: developmentDataRoot,
        developmentDataRootAuthority: 'signed_installer_explicit_operator_selection',
        developmentDataRootDisposition: 'runtime_validated_development_payload_root',
        developmentStateLineageAuthority: 'signed_installer_preserved_development_state_lineage',
      }),
    }),
    (error) => error.reasonCode === 'dev-runtime-service-update-unhealthy',
  );
});

test('data-root reporting rejects command-input fallback and requires the signed installer receipt', async () => {
  const developmentDataRoot = path.win32.join('D:\\', 'DataNimi');
  await assert.rejects(
    runDevRuntimeService({
      platform: 'win32',
      developmentDataRoot,
      validateDevelopmentDataRoot: acceptSyntheticDataRoot,
      queryInstalled: async () => ({ status: 'present' }),
      buildRuntime: async () => undefined,
      buildInstaller: async () => undefined,
      queryCandidate: async () => healthyStatus,
      install: async () => healthyStatus,
    }),
    (error) => error.reasonCode === 'dev-runtime-data-root-binding-unverified'
      && error.actionHint === 'inspect_signed_installer_data_root_receipt',
  );
});

test('missing Runtime user-config data root fails before build or installation', async () => {
  const calls = [];
  await assert.rejects(
    runDevRuntimeService({
      platform: 'win32',
      queryInstalled: async () => ({ status: 'present' }),
      resolveConfiguredDevelopmentDataRoot: async () => {
        throw Object.assign(new Error('missing data root'), {
          reasonCode: 'dev-runtime-data-root-config-unavailable',
        });
      },
      buildRuntime: async () => calls.push('build-runtime'),
      buildInstaller: async () => calls.push('build-installer'),
      install: async () => calls.push('install'),
    }),
    (error) => error.reasonCode === 'dev-runtime-data-root-config-unavailable',
  );
  assert.deepEqual(calls, []);
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
