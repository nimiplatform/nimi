#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  accessSync,
  closeSync,
  constants as fsConstants,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
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

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const installerPath = path.join(repoRoot, 'dist', 'windows-runtime-service-installer', 'install-nimi-runtime.ps1');
const MAX_RUNTIME_USER_CONFIG_BYTES = 64 * 1024;

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

export function parseDevRuntimeArguments(args, platform = process.platform) {
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
    return { developmentDataRoot: '' };
  }
  if (args.length !== 2 || args[0] !== '--development-data-root') {
    throw workflowError(
      `Unsupported dev:runtime argument: ${args[0]}`,
      'dev-runtime-argument-invalid',
      'run_pnpm_dev_runtime_with_optional_development_data_root',
    );
  }
  return {
    developmentDataRoot: normalizeDevelopmentDataRoot(args[1], platform),
  };
}

export function resolveConfiguredDevelopmentDataRoot({
  platform = process.platform,
  configPath = path.join(os.homedir(), '.nimi', 'runtime', 'config.json'),
  readConfig = readBoundedRuntimeUserConfig,
} = {}) {
  let source;
  try {
    source = String(readConfig(configPath, 'utf8')).replace(/^\ufeff/u, '');
  } catch {
    throw workflowError(
      'Runtime user config is required to resolve the existing nimi_data root before a service update.',
      'dev-runtime-data-root-config-unavailable',
      'repair_runtime_user_config_data_root',
      { configPath },
    );
  }
  let config;
  try {
    if (Buffer.byteLength(source, 'utf8') > MAX_RUNTIME_USER_CONFIG_BYTES
      || countTopLevelJsonKey(source, 'dataRootRef') > 1) {
      throw new Error('Runtime user config dataRootRef must not be duplicated in a bounded document');
    }
    config = JSON.parse(source);
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('Runtime user config must be an object');
    }
  } catch {
    throw workflowError(
      'Runtime user config is required to resolve the existing nimi_data root before a service update.',
      'dev-runtime-data-root-config-unavailable',
      'repair_runtime_user_config_data_root',
      { configPath },
    );
  }
  const developmentDataRoot = normalizeDevelopmentDataRoot(config?.dataRootRef ?? '', platform);
  if (!developmentDataRoot) {
    throw workflowError(
      'Runtime user config does not contain an absolute non-volume-root dataRootRef.',
      'dev-runtime-data-root-config-invalid',
      'repair_runtime_user_config_data_root',
      { configPath },
    );
  }
  return developmentDataRoot;
}

function readBoundedRuntimeUserConfig(configPath) {
  const metadata = lstatSync(configPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('Runtime user config must be a direct regular file');
  }
  const handle = openSync(configPath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(MAX_RUNTIME_USER_CONFIG_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const bytesRead = readSync(handle, buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > MAX_RUNTIME_USER_CONFIG_BYTES) {
      throw new Error('Runtime user config exceeds the admitted size bound');
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
  } finally {
    closeSync(handle);
  }
}

function countTopLevelJsonKey(source, targetKey) {
  let depth = 0;
  let escaped = false;
  let inString = false;
  let previousSignificant = '';
  let stringStart = -1;
  let count = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
        if (depth === 1 && (previousSignificant === '{' || previousSignificant === ',')) {
          let cursor = index + 1;
          while (/\s/u.test(source[cursor] ?? '')) cursor += 1;
          if (source[cursor] === ':'
            && JSON.parse(source.slice(stringStart, index + 1)) === targetKey) {
            count += 1;
          }
        }
        previousSignificant = '"';
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      escaped = false;
      stringStart = index;
      continue;
    }
    if (/\s/u.test(character)) continue;
    if (character === '{' || character === '[') depth += 1;
    if (character === '}' || character === ']') depth -= 1;
    previousSignificant = character;
  }
  return count;
}

export function assertAccessibleDevelopmentDataRoot(value, platform = process.platform) {
  const normalized = normalizeDevelopmentDataRoot(value, platform);
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
      'Development data root must already exist as an accessible direct directory tree before the Runtime build starts.',
      'dev-runtime-development-data-root-unavailable',
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
  const requestedDevelopmentDataRoot = normalizeDevelopmentDataRoot(
    input.developmentDataRoot ?? '',
    platform,
  );
  const resolveConfiguredDataRoot = input.resolveConfiguredDevelopmentDataRoot
    ?? (() => resolveConfiguredDevelopmentDataRoot({ platform }));
  const validateDevelopmentDataRoot = input.validateDevelopmentDataRoot
    ?? ((value) => assertAccessibleDevelopmentDataRoot(value, platform));
  const now = input.now ?? (() => performance.now());
  const queryInstalled = input.queryInstalled ?? queryInstalledService;
  const buildRuntime = input.buildRuntime ?? (() => runChecked(process.execPath, ['scripts/build-runtime.mjs', '--dev-kernel-checkpoint']));
  const buildInstaller = input.buildInstaller ?? (() => runChecked(process.execPath, ['scripts/build-windows-runtime-service-installer.mjs']));
  const install = input.install ?? installGeneratedCandidate;
  const queryCandidate = input.queryCandidate ?? queryGeneratedInstallerStatus;

  const initial = await queryInstalled();
  assertRuntimeServiceInstalled(initial);
  const selectedDevelopmentDataRoot = requestedDevelopmentDataRoot
    || normalizeDevelopmentDataRoot(await resolveConfiguredDataRoot(), platform);
  const developmentDataRoot = validateDevelopmentDataRoot(selectedDevelopmentDataRoot);
  const developmentDataRootSource = requestedDevelopmentDataRoot
    ? 'command_line'
    : 'runtime_user_config';

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
  const installStatus = await install({ developmentDataRoot });
  timings.serviceInstallAndRestartMs = elapsed(now, started);

  started = now();
  const finalStatus = await queryCandidate();
  timings.statusMs = elapsed(now, started);
  assertRuntimeServiceHealthy(finalStatus);
  const developmentDataRootBinding = validateInstalledDevelopmentDataRootBinding({
    requestedDevelopmentDataRoot: developmentDataRoot,
    installStatus,
    finalStatus,
    platform,
  });
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
    developmentDataRootBinding: {
      ...developmentDataRootBinding,
      source: developmentDataRootSource,
    },
    timings,
    totalMs: Object.values(timings).reduce((sum, value) => sum + value, 0),
    consequence: 'Runtime boot epoch rotated; Desktop/local-app sessions and bindings must reopen through their existing supervisors. Login and durable grants remain Runtime-owned.',
  };
}

function validateInstalledDevelopmentDataRootBinding({
  requestedDevelopmentDataRoot,
  installStatus,
  finalStatus,
  platform,
}) {
  const installedPath = normalizeDevelopmentDataRoot(installStatus?.developmentDataRootRef ?? '', platform);
  const authority = String(installStatus?.developmentDataRootAuthority ?? '');
  const disposition = String(installStatus?.developmentDataRootDisposition ?? '');
  const validatedDisposition = 'runtime_validated_development_payload_root';
  if (
    !requestedDevelopmentDataRoot
    || authority !== 'signed_installer_explicit_operator_selection'
    || disposition !== validatedDisposition
    || !sameDataRoot(installedPath, requestedDevelopmentDataRoot, platform)
  ) {
    throw developmentDataRootReceiptError(requestedDevelopmentDataRoot, installStatus);
  }

  const statusPath = normalizeDevelopmentDataRoot(finalStatus?.developmentDataRootRef ?? '', platform);
  // The independent post-install status query runs as the unelevated caller.
  // Protected profile fields are therefore intentionally absent after the
  // signed installer restores the service-only ACL. When the field is visible,
  // it must still match the elevated receipt exactly.
  if (statusPath && !sameDataRoot(statusPath, installedPath, platform)) {
    throw developmentDataRootReceiptError(requestedDevelopmentDataRoot, { installStatus, finalStatus });
  }
  return {
    path: installedPath || null,
    authority,
    disposition,
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

function sameDataRoot(left, right, platform) {
  if (platform === 'win32') return left.toLowerCase() === right.toLowerCase();
  return left === right;
}

function developmentDataRootReceiptError(requestedDevelopmentDataRoot, receipt) {
  return workflowError(
    'The signed installer did not return an exact authoritative development data-root binding receipt.',
    'dev-runtime-data-root-binding-unverified',
    'inspect_signed_installer_data_root_receipt',
    { requestedDevelopmentDataRoot: requestedDevelopmentDataRoot || null, receipt },
  );
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

async function installGeneratedCandidate({ developmentDataRoot = '' } = {}) {
  const powershellPath = resolveWindowsPowerShell7();
  if (isAdministrator(powershellPath)) {
    const result = runCaptured(
      powershellPath,
      installerArguments('Install', { developmentDataRoot }),
    );
    return parsePowerShellJsonResult(result, 'dev-runtime-install-result-invalid');
  }
  return installGeneratedCandidateElevated({ developmentDataRoot, powershellPath });
}

function installGeneratedCandidateElevated({ developmentDataRoot = '', powershellPath } = {}) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-dev-runtime-service-'));
  const stdoutPath = path.join(tempRoot, 'stdout.txt');
  const stderrPath = path.join(tempRoot, 'stderr.txt');
  const developmentDataRootArgument = developmentDataRoot
    ? ` -DevelopmentDataRoot '${powerShellLiteral(developmentDataRoot)}'`
    : '';
  const innerCommand = [
    `$ErrorActionPreference = 'Stop'`,
    'try {',
    `$output = & '${powerShellLiteral(powershellPath)}' -NoProfile -ExecutionPolicy Bypass -File '${powerShellLiteral(installerPath)}' -Mode Install -DevKernelCheckpoint${developmentDataRootArgument} -Json 2> '${powerShellLiteral(stderrPath)}'`,
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

function installerArguments(mode, { developmentDataRoot = '' } = {}) {
  return [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installerPath,
    '-Mode', mode,
    ...(mode === 'Install'
      ? [
          '-DevKernelCheckpoint',
          ...(developmentDataRoot ? ['-DevelopmentDataRoot', developmentDataRoot] : []),
        ]
      : []),
    '-Json',
  ];
}

function normalizeDevelopmentDataRoot(value, platform) {
  const candidate = String(value ?? '').trim();
  if (!candidate) return '';
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  if (!pathApi.isAbsolute(candidate)) {
    throw workflowError(
      'Development data root must be an explicit absolute non-volume-root path.',
      'dev-runtime-development-data-root-invalid',
      'select_existing_absolute_nimi_data_root',
    );
  }
  const normalized = pathApi.normalize(candidate);
  const volumeRoot = pathApi.parse(normalized).root;
  if (!volumeRoot || normalized === volumeRoot) {
    throw workflowError(
      'Development data root must be an explicit absolute non-volume-root path.',
      'dev-runtime-development-data-root-invalid',
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
