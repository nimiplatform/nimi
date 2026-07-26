import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  assertRuntimeServiceHealthy,
  assertRuntimeServiceInstalled,
  assertAccessibleNimiDataRoot,
  parseDevRuntimeArguments,
  rejectBinaryOnlyRequest,
  resolveNimiDataRootFromProductControl,
  resolveNimiDataRootFromProductControlForTest,
  runDevRuntimeService,
} from './dev-runtime-service.mjs';
import {
  parseFirstJsonDocument,
  parsePowerShellJsonResult,
} from './lib/windows-powershell.mjs';
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
const defaultNimiDataRoot = path.win32.join('D:\\', 'DataNimi');
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

test('dev:runtime has no data-root override channel', () => {
  assert.deepEqual(parseDevRuntimeArguments([]), {});
  for (const args of [
    ['--development-data-root', 'D:/DataNimi'],
    ['--product-root', 'D:/DataNimi'],
  ]) {
    assert.throws(
      () => parseDevRuntimeArguments(args),
      (error) => error.reasonCode === 'dev-runtime-argument-invalid'
        && error.actionHint === 'run_pnpm_dev_runtime_without_data_root_override',
    );
  }
});

test('default service update resolves dataRoot.path only from fixed Product Control', () => {
  const dataRoot = path.win32.join('D:\\', 'DataNimi');
  assert.equal(
    resolveNimiDataRootFromProductControlForTest(() => dataRoot),
    dataRoot,
  );
  assert.throws(
    () => resolveNimiDataRootFromProductControlForTest(() => {
      throw new Error('invalid Product Control');
    }),
    (error) => error.reasonCode === 'dev-runtime-product-control-unavailable'
      && error.actionHint === 'complete_or_repair_product_control_in_desktop',
  );
  assert.throws(
    () => resolveNimiDataRootFromProductControl({
      verifiedProfileDir: 'C:\\Users\\dev',
    }),
    (error) => error.reasonCode === 'dev-runtime-product-control-locator-injection-forbidden'
      && error.actionHint === 'use_os_verified_interactive_user_profile',
  );
});

test('nimi dataRoot accessibility rejects missing, file, and reparse-ancestor paths', (t) => {
  const temporaryRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'nimi-dev-root-')));
  try {
    const directRoot = path.join(temporaryRoot, 'direct', 'nimi-data');
    mkdirSync(directRoot, { recursive: true });
    assert.equal(assertAccessibleNimiDataRoot(directRoot), directRoot);
    assert.throws(
      () => assertAccessibleNimiDataRoot(path.join(temporaryRoot, 'missing')),
      (error) => error.reasonCode === 'dev-runtime-data-root-unavailable',
    );
    const filePath = path.join(temporaryRoot, 'file');
    writeFileSync(filePath, 'not a directory', 'utf8');
    assert.throws(
      () => assertAccessibleNimiDataRoot(filePath),
      (error) => error.reasonCode === 'dev-runtime-data-root-unavailable',
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
      () => assertAccessibleNimiDataRoot(path.join(linkedRoot, 'nested')),
      (error) => error.reasonCode === 'dev-runtime-data-root-unavailable',
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('full update reports segmented timings and validates signed fixed-service status', async () => {
  const calls = [];
  const nimiDataRoot = path.win32.join('D:\\', 'DataNimi');
  const ticks = [0, 11, 11, 24, 24, 55, 55, 60];
  const installStatus = {
    ...healthyStatus,
    developmentStateLineageAuthority: 'signed_installer_preserved_development_state_lineage',
  };
  const result = await runDevRuntimeService({
    platform: 'win32',
    resolveProductControlDataRoot: async () => nimiDataRoot,
    validateNimiDataRoot: acceptSyntheticDataRoot,
    now: () => ticks.shift(),
    queryInstalled: async () => ({ status: 'present' }),
    buildRuntime: async () => calls.push('build-runtime'),
    buildInstaller: async () => calls.push('build-installer'),
    queryCandidate: async () => healthyStatus,
    install: async () => {
      calls.push('install');
      return installStatus;
    },
  });
  assert.deepEqual(calls, [
    'build-runtime',
    'build-installer',
    'install',
  ]);
  assert.deepEqual(result.timings, {
    runtimeBuildAndSignMs: 11,
    installerBuildAndSignMs: 13,
    serviceInstallAndRestartMs: 31,
    statusMs: 5,
  });
  assert.equal(result.status, 'updated');
  assert.deepEqual(result.dataRootResolution, {
    path: nimiDataRoot,
    authority: 'fixed_user_product_control',
    source: '~/.nimi/nimi.json',
  });
  assert.deepEqual(result.developmentStateLineage, {
    developmentStateCandidateId: durableStateCandidateId,
    acceptanceRoundId,
    authority: 'signed_installer_preserved_development_state_lineage',
  });
  assert.match(result.consequence, /boot epoch rotated/u);
});

test('full update fails closed when the signed installer rotates durable development state lineage', async () => {
  const nimiDataRoot = defaultNimiDataRoot;
  await assert.rejects(
    runDevRuntimeService({
      platform: 'win32',
      resolveProductControlDataRoot: async () => nimiDataRoot,
      validateNimiDataRoot: acceptSyntheticDataRoot,
      queryInstalled: async () => ({ status: 'present' }),
      buildRuntime: async () => undefined,
      buildInstaller: async () => undefined,
      queryCandidate: async () => healthyStatus,
      install: async () => ({
        ...healthyStatus,
        developmentStateCandidateId: 'dev-kernel-runtime-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        developmentStateLineageAuthority: 'signed_installer_preserved_development_state_lineage',
      }),
    }),
    (error) => error.reasonCode === 'dev-runtime-state-lineage-unverified'
      && error.actionHint === 'inspect_signed_installer_state_lineage_receipt',
  );
});

test('full update requires an independently observed healthy post-install status', async () => {
  const nimiDataRoot = defaultNimiDataRoot;
  let statusCalls = 0;
  await assert.rejects(
    runDevRuntimeService({
      platform: 'win32',
      resolveProductControlDataRoot: async () => nimiDataRoot,
      validateNimiDataRoot: acceptSyntheticDataRoot,
      queryInstalled: async () => ({ status: 'present' }),
      buildRuntime: async () => undefined,
      buildInstaller: async () => undefined,
      queryCandidate: async () => {
        statusCalls += 1;
        return statusCalls === 1 ? healthyStatus : { status: 'absent' };
      },
      install: async () => ({
        ...healthyStatus,
        developmentStateLineageAuthority: 'signed_installer_preserved_development_state_lineage',
      }),
    }),
    (error) => error.reasonCode === 'dev-runtime-service-update-unhealthy',
  );
});

test('missing Product Control data root fails before build or installation', async () => {
  const calls = [];
  await assert.rejects(
    runDevRuntimeService({
      platform: 'win32',
      queryInstalled: async () => ({ status: 'present' }),
      resolveProductControlDataRoot: async () => {
        throw Object.assign(new Error('missing data root'), {
          reasonCode: 'dev-runtime-product-control-unavailable',
        });
      },
      buildRuntime: async () => calls.push('build-runtime'),
      buildInstaller: async () => calls.push('build-installer'),
      install: async () => calls.push('install'),
    }),
    (error) => error.reasonCode === 'dev-runtime-product-control-unavailable',
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

test('PowerShell service commands separate diagnostics from the first complete JSON receipt', () => {
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
      && error.actionHint === 'inspect_powershell_command_output',
  );

  const diagnostics = [];
  assert.deepEqual(parsePowerShellJsonResult({
    stdout: output,
    stderr: 'native warning from stderr',
  }, 'dev-runtime-install-result-invalid', {
    writeDiagnostics: (value) => diagnostics.push(value),
  }), receipt.value);
  assert.deepEqual(diagnostics, [
    'native warning from stderr\n警告: 无法加载某个可选的 PowerShell 格式化数据。\nVERBOSE: installer cleanup completed\n',
  ]);
});

test('UAC launcher keeps stream redirection inside the elevated command', () => {
  const source = readFileSync(new URL('./dev-runtime-service.mjs', import.meta.url), 'utf8');
  const installer = readFileSync(new URL('./install-windows-runtime-service.ps1', import.meta.url), 'utf8');
  const outerLauncher = source.slice(source.indexOf('const outerCommand'), source.indexOf('try {', source.indexOf('const outerCommand')));
  assert.doesNotMatch(outerLauncher, /RedirectStandard(?:Output|Error)/u);
  assert.doesNotMatch(source, /--development-data-root|['"]-DevelopmentDataRoot['"]/u);
  assert.doesNotMatch(installer, /\$DevelopmentDataRoot|developmentDataRootRef/u);
  assert.match(source, /\$output = & '\$\{powerShellLiteral\(powershellPath\)\}' .* -DevKernelCheckpoint -Json 2> /u);
  assert.match(source, /Start-Process -FilePath '\$\{powerShellLiteral\(powershellPath\)\}' -Verb RunAs/u);
  assert.doesNotMatch(source, /\$parsed = \$raw \| ConvertFrom-Json/u);
  assert.match(source, /WriteAllText.*\$raw.*UTF8Encoding/u);
  assert.match(source, /return parsePowerShellJsonResult\(\{/u);
  assert.ok(
    [...source.matchAll(/\bparsePowerShellJsonResult\(/gu)].length >= 4,
    'service query, candidate status, admin install, and UAC install must share the receipt parser',
  );
  assert.doesNotMatch(source, /parseJsonOutput/u);
  assert.match(source, /\$ErrorActionPreference = 'Stop'[\s\S]*\[Console\]::Error\.WriteLine\(\$_\.Exception\.Message\)[\s\S]*'exit 1'/u);
});
