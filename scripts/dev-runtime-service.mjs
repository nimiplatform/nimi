#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  accessSync,
  constants as fsConstants,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseMacOSDevRuntimeArguments, runMacOSDevRuntimeService } from './macos-dev-runtime-service.mjs';
import {
  parsePowerShellJsonResult,
  resolveWindowsPowerShell7,
} from './lib/windows-powershell.mjs';
import { resolveProductControlDataRoot } from './lib/product-control-data-root.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const installerPath = path.join(repoRoot, 'dist', 'windows-runtime-service-installer', 'install-nimi-runtime.ps1');

export function assertRuntimeServiceInstalled(status) {
  if (status?.status !== 'present') {
    throw workflowError(
      'NimiRuntime fixed service is not installed; dev:runtime will not perform a silent full installation.',
      'dev-runtime-service-not-installed',
      'run_pnpm_install_dev_kernel_service_candidate_from_an_elevated_terminal',
    );
  }
}

export function assertRuntimeServiceHealthy(status) {
  const healthy = status?.status === 'present'
    && status?.state === 'running'
    && status?.serviceAccountMatches === true
    && status?.binaryPathMatches === true
    && status?.serviceSidMatches === true
    && status?.restrictedSid === true
    && status?.desktopPipePresent === true
    && status?.localAppPipePresent === true
    && status?.runtimeBinaryMatchesCandidate === true
    && status?.runtimeBuildRecordMatchesCandidate === true
    && status?.checkpointCandidatePostureVerified === true
    && status?.signatureStatus === 'Valid';
  if (!healthy) {
    throw workflowError(
      'NimiRuntime did not reach the required signed fixed-service state after update.',
      'dev-runtime-service-update-unhealthy',
      'inspect_dev_runtime_status_summary',
      { status },
    );
  }
}

export function rejectBinaryOnlyRequest(args) {
  parseDevRuntimeArguments(args);
}

export function parseDevRuntimeArguments(args) {
  args = args.slice();
  while (args[0] === '--') args.shift();
  if (args.includes('--binary-only')) {
    throw workflowError(
      'Binary-only Runtime replacement is not admitted because installer resource/layout equivalence is not proven.',
      'dev-runtime-binary-only-layout-unverified',
      'run_full_dev_runtime_service_update',
    );
  }
  if (args.length === 0) {
    return {};
  }
  throw workflowError(
    `Unsupported dev:runtime argument: ${args[0]}`,
    'dev-runtime-argument-invalid',
    'run_pnpm_dev_runtime_without_data_root_override',
  );
}

function resolveNimiDataRootFromProductControlWith(resolveRecord) {
  try {
    return resolveRecord();
  } catch (error) {
    throw workflowError(
      'Product Control must contain a usable dataRoot.path before a Runtime service update.',
      'dev-runtime-product-control-unavailable',
      'complete_or_repair_product_control_in_desktop',
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
}

export function resolveNimiDataRootFromProductControl(...args) {
  if (args.length !== 0) {
    throw workflowError(
      'Production Product Control resolution does not accept locator injection.',
      'dev-runtime-product-control-locator-injection-forbidden',
      'use_os_verified_interactive_user_profile',
    );
  }
  return resolveNimiDataRootFromProductControlWith(resolveProductControlDataRoot);
}

export function resolveNimiDataRootFromProductControlForTest(resolveRecord) {
  if (typeof resolveRecord !== 'function') {
    throw new TypeError('explicit test Product Control resolver is required');
  }
  return resolveNimiDataRootFromProductControlWith(resolveRecord);
}

export function assertAccessibleNimiDataRoot(value, platform = process.platform) {
  const normalized = normalizeNimiDataRoot(value, platform);
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const volumeRoot = pathApi.parse(normalized).root;
  let current = volumeRoot;
  try {
    const volumeMetadata = lstatSync(volumeRoot);
    if (!volumeMetadata.isDirectory() || volumeMetadata.isSymbolicLink()) {
      throw new Error('volume root is not a direct directory');
    }
    for (const segment of normalized.slice(volumeRoot.length).split(/[\\/]/u).filter(Boolean)) {
      current = pathApi.join(current, segment);
      const metadata = lstatSync(current);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new Error('path component is not a direct directory');
      }
    }
    accessSync(normalized, fsConstants.R_OK | fsConstants.W_OK);
  } catch (error) {
    throw workflowError(
      'Nimi dataRoot must already exist as an accessible direct directory tree before the Runtime build starts.',
      'dev-runtime-data-root-unavailable',
      'repair_or_select_accessible_nimi_data_root',
      { path: normalized, cause: error instanceof Error ? error.message : String(error) },
    );
  }
  return normalized;
}

export async function runDevRuntimeService(input = {}) {
  const platform = input.platform ?? process.platform;
  if (platform === 'darwin') {
    return runMacOSDevRuntimeService(input);
  }
  if (platform !== 'win32') {
    throw workflowError(
      `dev:runtime fixed-service update is available only on Windows, received ${platform}.`,
      'dev-runtime-platform-unsupported',
      'use_windows_fixed_runtime_service_host',
    );
  }
  const resolveConfiguredDataRoot = input.resolveProductControlDataRoot
    ?? (() => resolveNimiDataRootFromProductControl());
  const validateNimiDataRoot = input.validateNimiDataRoot
    ?? ((value) => assertAccessibleNimiDataRoot(value, platform));
  const now = input.now ?? (() => performance.now());
  const queryInstalled = input.queryInstalled ?? queryInstalledService;
  const buildRuntime = input.buildRuntime ?? (() => runChecked(process.execPath, ['scripts/build-runtime.mjs', '--dev-kernel-checkpoint']));
  const buildInstaller = input.buildInstaller ?? (() => runChecked(process.execPath, ['scripts/build-windows-runtime-service-installer.mjs']));
  const install = input.install ?? installGeneratedCandidate;
  const queryCandidate = input.queryCandidate ?? queryGeneratedInstallerStatus;

  const initial = await queryInstalled();
  assertRuntimeServiceInstalled(initial);
  const nimiDataRoot = validateNimiDataRoot(
    normalizeNimiDataRoot(await resolveConfiguredDataRoot(), platform),
  );

  const timings = {};
  let started = now();
  await buildRuntime();
  timings.runtimeBuildAndSignMs = elapsed(now, started);

  started = now();
  await buildInstaller();
  timings.installerBuildAndSignMs = elapsed(now, started);

  const candidateStatus = await queryCandidate();
  assertRuntimeServiceInstalled(candidateStatus);

  started = now();
  const installStatus = await install();
  timings.serviceInstallAndRestartMs = elapsed(now, started);

  started = now();
  const finalStatus = await queryCandidate();
  timings.statusMs = elapsed(now, started);
  assertRuntimeServiceHealthy(finalStatus);
  const developmentStateLineage = validatePreservedDevelopmentStateLineage({
    candidateStatus,
    installStatus,
    finalStatus,
  });

  return {
    status: 'updated',
    serviceName: finalStatus.serviceName,
    state: finalStatus.state,
    runtimeCandidateId: finalStatus.runtimeCandidateId,
    runtimeBinarySha256: finalStatus.runtimeBinarySha256,
    signatureStatus: finalStatus.signatureStatus,
    developmentStateLineage,
    dataRootResolution: {
      path: nimiDataRoot,
      authority: 'fixed_user_product_control',
      source: '~/.nimi/nimi.json',
    },
    timings,
    totalMs: Object.values(timings).reduce((sum, value) => sum + value, 0),
    consequence: 'Runtime boot epoch rotated; Desktop/local-app sessions and bindings must reopen through their existing supervisors. Login and durable grants remain Runtime-owned.',
  };
}

function validatePreservedDevelopmentStateLineage({ candidateStatus, installStatus, finalStatus }) {
  const installed = parseDevelopmentStateLineage(installStatus, 'signed installer receipt');
  const before = parseOptionalDevelopmentStateLineage(candidateStatus, 'pre-install status');
  const observed = parseOptionalDevelopmentStateLineage(finalStatus, 'post-install status');
  if (installStatus?.developmentStateLineageAuthority !== 'signed_installer_preserved_development_state_lineage'
    || (before && !sameDevelopmentStateLineage(installed, before))
    || (observed && !sameDevelopmentStateLineage(installed, observed))) {
    throw developmentStateLineageReceiptError({ before, installStatus, finalStatus });
  }
  return {
    ...installed,
    authority: 'signed_installer_preserved_development_state_lineage',
  };
}

function parseOptionalDevelopmentStateLineage(status, label) {
  const developmentStateCandidateId = String(status?.developmentStateCandidateId ?? '');
  const acceptanceRoundId = String(status?.acceptanceRoundId ?? '');
  if (!developmentStateCandidateId && !acceptanceRoundId) return undefined;
  return parseDevelopmentStateLineage(status, label);
}

function sameDevelopmentStateLineage(left, right) {
  return left.developmentStateCandidateId === right.developmentStateCandidateId
    && left.acceptanceRoundId === right.acceptanceRoundId;
}

function parseDevelopmentStateLineage(status, label) {
  const developmentStateCandidateId = typeof status?.developmentStateCandidateId === 'string'
    ? status.developmentStateCandidateId
    : '';
  const acceptanceRoundId = typeof status?.acceptanceRoundId === 'string'
    ? status.acceptanceRoundId
    : '';
  if (!/^dev-kernel-runtime-[0-9a-f]{32}$/u.test(developmentStateCandidateId)
    || !/^dev-kernel-round-[0-9a-f]{32}$/u.test(acceptanceRoundId)) {
    throw developmentStateLineageReceiptError({ label, status });
  }
  return { developmentStateCandidateId, acceptanceRoundId };
}

function developmentStateLineageReceiptError(receipt) {
  return workflowError(
    'The signed Runtime update did not prove preservation of the existing development state lineage.',
    'dev-runtime-state-lineage-unverified',
    'inspect_signed_installer_state_lineage_receipt',
    { receipt },
  );
}

async function queryInstalledService() {
  const command = [
    "$record = Get-CimInstance Win32_Service -Filter \"Name='NimiRuntime'\" -ErrorAction SilentlyContinue",
    "$status = if ($null -eq $record) { @{ status = 'absent' } } else { @{ status = 'present'; state = ([string]$record.State).ToLowerInvariant() } }",
    '$status | ConvertTo-Json -Compress',
  ].join('; ');
  const result = runCaptured(resolveWindowsPowerShell7(), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command]);
  return parsePowerShellJsonResult(result, 'dev-runtime-service-query-invalid');
}

async function queryGeneratedInstallerStatus() {
  const result = runCaptured(resolveWindowsPowerShell7(), installerArguments('Status'));
  return parsePowerShellJsonResult(result, 'dev-runtime-status-invalid');
}

async function installGeneratedCandidate() {
  const powershellPath = resolveWindowsPowerShell7();
  if (isAdministrator(powershellPath)) {
    const result = runCaptured(
      powershellPath,
      installerArguments('Install'),
    );
    return parsePowerShellJsonResult(result, 'dev-runtime-install-result-invalid');
  }
  return installGeneratedCandidateElevated({ powershellPath });
}

function installGeneratedCandidateElevated({ powershellPath } = {}) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-dev-runtime-service-'));
  const stdoutPath = path.join(tempRoot, 'stdout.txt');
  const stderrPath = path.join(tempRoot, 'stderr.txt');
  const innerCommand = [
    `$ErrorActionPreference = 'Stop'`,
    'try {',
    `$output = & '${powerShellLiteral(powershellPath)}' -NoProfile -ExecutionPolicy Bypass -File '${powerShellLiteral(installerPath)}' -Mode Install -DevKernelCheckpoint -Json 2> '${powerShellLiteral(stderrPath)}'`,
    '$exitCode = $LASTEXITCODE',
    "if ($exitCode -ne 0) { exit $exitCode }",
    '$raw = ($output | Out-String).Trim()',
    `[IO.File]::WriteAllText('${powerShellLiteral(stdoutPath)}', $raw, [Text.UTF8Encoding]::new($false))`,
    'exit 0',
    '} catch {',
    `[IO.File]::AppendAllText('${powerShellLiteral(stderrPath)}', [Environment]::NewLine + $_.Exception.Message, [Text.UTF8Encoding]::new($false))`,
    'exit 1',
    '}',
  ].join('; ');
  const encodedCommand = Buffer.from(innerCommand, 'utf16le').toString('base64');
  const outerCommand = [
    `$ErrorActionPreference = 'Stop'`,
    'try {',
    `$process = Start-Process -FilePath '${powerShellLiteral(powershellPath)}' -Verb RunAs -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encodedCommand}') -Wait -PassThru`,
    'exit $process.ExitCode',
    '} catch {',
    '[Console]::Error.WriteLine($_.Exception.Message)',
    'exit 1',
    '}',
  ].join('; ');
  try {
    const elevated = spawnSync(powershellPath, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', outerCommand], {
      cwd: repoRoot,
      env: process.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout = safeRead(stdoutPath);
    const installerStderr = safeRead(stderrPath);
    const launcherStderr = String(elevated.stderr || '').trim();
    if (elevated.error || elevated.status !== 0) {
      throw workflowError(
        `Elevated NimiRuntime update failed: ${elevated.error?.message || installerStderr || launcherStderr || `exit ${elevated.status}`}`,
        'dev-runtime-elevated-install-failed',
        'approve_uac_and_inspect_installer_error',
      );
    }
    return parsePowerShellJsonResult({
      stdout,
      stderr: [installerStderr, launcherStderr].filter(Boolean).join('\n'),
    }, 'dev-runtime-install-result-invalid');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function installerArguments(mode) {
  return [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installerPath,
    '-Mode', mode,
    ...(mode === 'Install'
      ? ['-DevKernelCheckpoint']
      : []),
    '-Json',
  ];
}

function normalizeNimiDataRoot(value, platform) {
  const candidate = String(value ?? '').trim();
  if (!candidate) return '';
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  if (!pathApi.isAbsolute(candidate)) {
    throw workflowError(
      'Nimi dataRoot must be an explicit absolute non-volume-root path.',
      'dev-runtime-data-root-invalid',
      'select_existing_absolute_nimi_data_root',
    );
  }
  const normalized = pathApi.normalize(candidate);
  const volumeRoot = pathApi.parse(normalized).root;
  if (!volumeRoot || normalized === volumeRoot) {
    throw workflowError(
      'Nimi dataRoot must be an explicit absolute non-volume-root path.',
      'dev-runtime-data-root-invalid',
      'select_existing_absolute_nimi_data_root',
    );
  }
  return normalized.replace(/[\\/]+$/u, '');
}

function isAdministrator(powershellPath) {
  const result = spawnSync(powershellPath, [
    '-NoProfile', '-Command',
    'exit -not ([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))',
  ], { cwd: repoRoot, stdio: 'ignore', windowsHide: true });
  return result.status === 0;
}

function runChecked(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, env: process.env, stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) {
    throw workflowError(
      `${command} ${args.join(' ')} failed: ${result.error?.message || `exit ${result.status}`}`,
      'dev-runtime-build-failed',
      'fix_runtime_build_or_signing_error',
    );
  }
}

function runCaptured(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw workflowError(
      `${command} failed: ${result.error?.message || String(result.stderr || '').trim() || `exit ${result.status}`}`,
      'dev-runtime-command-failed',
      'inspect_dev_runtime_command_error',
    );
  }
  return result;
}

function workflowError(message, reasonCode, actionHint, details = undefined) {
  return Object.assign(new Error(message), { reasonCode, actionHint, details });
}

function elapsed(now, started) {
  return Math.max(0, Math.round(now() - started));
}

function powerShellLiteral(value) {
  return String(value).replaceAll("'", "''");
}

function safeRead(filePath) {
  try {
    const bytes = readFileSync(filePath);
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      return bytes.subarray(2).toString('utf16le').trim();
    }
    if (bytes.includes(0)) {
      return bytes.toString('utf16le').replace(/^\ufeff/u, '').trim();
    }
    return bytes.toString('utf8').replace(/^\ufeff/u, '').trim();
  } catch {
    return '';
  }
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  try {
    const options = process.platform === 'darwin'
      ? parseMacOSDevRuntimeArguments(process.argv.slice(2))
      : parseDevRuntimeArguments(process.argv.slice(2));
    const result = await runDevRuntimeService(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const failure = {
      status: 'failed',
      reasonCode: error?.reasonCode || 'dev-runtime-service-failed',
      actionHint: error?.actionHint || 'inspect_dev_runtime_failure',
      message: error instanceof Error ? error.message : String(error),
    };
    process.stderr.write(`${JSON.stringify(failure)}\n`);
    process.exitCode = 1;
  }
}
