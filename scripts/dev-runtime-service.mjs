#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
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

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const installerPath = path.join(repoRoot, 'dist', 'windows-runtime-service-installer', 'install-nimi-runtime.ps1');

export function assertRuntimeServiceInstalled(status) {
  if (status?.status !== 'present') {
    throw workflowError(
      'NimiRuntime fixed service is not installed; dev:runtime will not perform a silent first installation.',
      'dev-runtime-service-not-installed',
      'run_the_windows_runtime_service_installer_from_an_elevated_terminal',
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
    && status?.signatureStatus === 'Valid'
    && /^runtime-[0-9a-f]{32}$/u.test(status?.runtimeCandidateId ?? '');
  if (!healthy) {
    throw workflowError(
      'NimiRuntime did not reach the required signed fixed-service state after update.',
      'dev-runtime-service-update-unhealthy',
      'inspect_dev_runtime_status_summary',
      { status },
    );
  }
}

export function parseDevRuntimeArguments(args) {
  args = args.slice();
  while (args[0] === '--') args.shift();
  if (args.length === 0) {
    return {};
  }
  throw workflowError(
    `Unsupported dev:runtime argument: ${args[0]}`,
    'dev-runtime-argument-invalid',
    'run_pnpm_dev_runtime_without_overrides',
  );
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

  const queryInstalled = input.queryInstalled ?? queryInstalledService;
  const buildRuntime = input.buildRuntime ?? (() => runChecked(process.execPath, ['scripts/build-runtime.mjs']));
  const buildInstaller = input.buildInstaller ?? (() => runChecked(process.execPath, ['scripts/build-windows-runtime-service-installer.mjs']));
  const install = input.install ?? installGeneratedRuntime;
  const queryStatus = input.queryStatus ?? queryGeneratedInstallerStatus;

  const initial = await queryInstalled();
  assertRuntimeServiceInstalled(initial);
  await buildRuntime();
  await buildInstaller();
  await install();
  const finalStatus = await queryStatus();
  assertRuntimeServiceHealthy(finalStatus);

  return {
    status: 'updated',
    serviceName: finalStatus.serviceName,
    state: finalStatus.state,
    runtimeCandidateId: finalStatus.runtimeCandidateId,
    runtimeBinarySha256: finalStatus.runtimeBinarySha256,
    signatureStatus: finalStatus.signatureStatus,
  };
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

async function installGeneratedRuntime() {
  const powershellPath = resolveWindowsPowerShell7();
  if (isAdministrator(powershellPath)) {
    const result = runCaptured(
      powershellPath,
      installerArguments('Install'),
    );
    return parsePowerShellJsonResult(result, 'dev-runtime-install-result-invalid');
  }
  return installGeneratedRuntimeElevated({ powershellPath });
}

function installGeneratedRuntimeElevated({ powershellPath } = {}) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-runtime-service-'));
  const stdoutPath = path.join(tempRoot, 'stdout.txt');
  const stderrPath = path.join(tempRoot, 'stderr.txt');
  const innerCommand = [
    `$ErrorActionPreference = 'Stop'`,
    'try {',
    `$output = & '${powerShellLiteral(powershellPath)}' -NoProfile -ExecutionPolicy Bypass -File '${powerShellLiteral(installerPath)}' -Mode Install -Json 2> '${powerShellLiteral(stderrPath)}'`,
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
    '-Json',
  ];
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
