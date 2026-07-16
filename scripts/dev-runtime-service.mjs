#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  if (args.includes('--binary-only')) {
    throw workflowError(
      'Binary-only Runtime replacement is not admitted because installer resource/layout equivalence is not proven.',
      'dev-runtime-binary-only-layout-unverified',
      'run_full_dev_runtime_service_update',
    );
  }
  if (args.length > 0) {
    throw workflowError(
      `Unsupported dev:runtime argument: ${args[0]}`,
      'dev-runtime-argument-invalid',
      'run_pnpm_dev_runtime_without_arguments',
    );
  }
}

export function parseFirstJsonDocument(output, reasonCode) {
  const raw = String(output ?? '').replace(/^\ufeff/u, '').trim();
  for (let start = 0; start < raw.length; start += 1) {
    const opening = raw[start];
    if (opening !== '{' && opening !== '[') {
      continue;
    }

    const stack = [];
    let inString = false;
    let escaped = false;
    for (let cursor = start; cursor < raw.length; cursor += 1) {
      const character = raw[cursor];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === '\\') {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
        continue;
      }

      if (character === '"') {
        inString = true;
        continue;
      }
      if (character === '{' || character === '[') {
        stack.push(character);
        continue;
      }
      if (character !== '}' && character !== ']') {
        continue;
      }

      const expectedOpening = character === '}' ? '{' : '[';
      if (stack.pop() !== expectedOpening) {
        break;
      }
      if (stack.length !== 0) {
        continue;
      }

      const candidate = raw.slice(start, cursor + 1);
      try {
        return {
          value: JSON.parse(candidate),
          diagnostics: [raw.slice(0, start).trim(), raw.slice(cursor + 1).trim()]
            .filter(Boolean)
            .join('\n'),
        };
      } catch {
        break;
      }
    }
  }

  throw workflowError(
    'NimiRuntime service command did not return a complete valid JSON document.',
    reasonCode,
    'inspect_dev_runtime_command_output',
  );
}

export async function runDevRuntimeService(input = {}) {
  const platform = input.platform ?? process.platform;
  if (platform !== 'win32') {
    throw workflowError(
      `dev:runtime fixed-service update is available only on Windows, received ${platform}.`,
      'dev-runtime-platform-unsupported',
      'use_windows_fixed_runtime_service_host',
    );
  }
  const now = input.now ?? (() => performance.now());
  const queryInstalled = input.queryInstalled ?? queryInstalledService;
  const buildRuntime = input.buildRuntime ?? (() => runChecked(process.execPath, ['scripts/build-runtime.mjs', '--dev-kernel-checkpoint']));
  const buildInstaller = input.buildInstaller ?? (() => runChecked(process.execPath, ['scripts/build-windows-runtime-service-installer.mjs']));
  const install = input.install ?? installGeneratedCandidate;
  const queryCandidate = input.queryCandidate ?? queryGeneratedInstallerStatus;

  const initial = await queryInstalled();
  assertRuntimeServiceInstalled(initial);

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
  const effectiveStatus = finalStatus?.status === 'present' ? finalStatus : installStatus;
  assertRuntimeServiceHealthy(effectiveStatus);

  return {
    status: 'updated',
    serviceName: effectiveStatus.serviceName,
    state: effectiveStatus.state,
    runtimeCandidateId: effectiveStatus.runtimeCandidateId,
    runtimeBinarySha256: effectiveStatus.runtimeBinarySha256,
    signatureStatus: effectiveStatus.signatureStatus,
    timings,
    totalMs: Object.values(timings).reduce((sum, value) => sum + value, 0),
    consequence: 'Runtime boot epoch rotated; Desktop/local-app sessions and bindings must reopen through their existing supervisors. Login and durable grants remain Runtime-owned.',
  };
}

async function queryInstalledService() {
  const command = [
    "$record = Get-CimInstance Win32_Service -Filter \"Name='NimiRuntime'\" -ErrorAction SilentlyContinue",
    "$status = if ($null -eq $record) { @{ status = 'absent' } } else { @{ status = 'present'; state = ([string]$record.State).ToLowerInvariant() } }",
    '$status | ConvertTo-Json -Compress',
  ].join('; ');
  const result = runCaptured('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command]);
  return parseJsonOutput(result.stdout, 'dev-runtime-service-query-invalid');
}

async function queryGeneratedInstallerStatus() {
  const result = runCaptured('powershell.exe', installerArguments('Status'));
  return parseJsonOutput(result.stdout, 'dev-runtime-status-invalid');
}

async function installGeneratedCandidate() {
  if (isAdministrator()) {
    const result = runCaptured('powershell.exe', installerArguments('Install'));
    return parseJsonOutput(result.stdout, 'dev-runtime-install-result-invalid');
  }
  return installGeneratedCandidateElevated();
}

function installGeneratedCandidateElevated() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-dev-runtime-service-'));
  const stdoutPath = path.join(tempRoot, 'stdout.txt');
  const stderrPath = path.join(tempRoot, 'stderr.txt');
  const innerCommand = [
    `$ErrorActionPreference = 'Stop'`,
    'try {',
    `$output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File '${powerShellLiteral(installerPath)}' -Mode Install -DevKernelCheckpoint -Json 2> '${powerShellLiteral(stderrPath)}'`,
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
    `$process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encodedCommand}') -Wait -PassThru`,
    'exit $process.ExitCode',
  ].join('; ');
  try {
    const elevated = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', outerCommand], {
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
    const receipt = parseFirstJsonDocument(stdout, 'dev-runtime-install-result-invalid');
    const diagnostics = [installerStderr, receipt.diagnostics, launcherStderr]
      .filter(Boolean)
      .join('\n');
    if (diagnostics) {
      process.stderr.write(`${diagnostics}\n`);
    }
    return receipt.value;
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function installerArguments(mode) {
  return [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installerPath,
    '-Mode', mode,
    ...(mode === 'Install' ? ['-DevKernelCheckpoint'] : []),
    '-Json',
  ];
}

function isAdministrator() {
  const result = spawnSync('powershell.exe', [
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

function parseJsonOutput(output, reasonCode) {
  try {
    return JSON.parse(String(output || '').trim());
  } catch {
    throw workflowError(
      'NimiRuntime service command did not return valid JSON.',
      reasonCode,
      'inspect_dev_runtime_command_output',
    );
  }
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
    rejectBinaryOnlyRequest(process.argv.slice(2));
    const result = await runDevRuntimeService();
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
