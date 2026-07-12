#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { signWindowsDevFiles } from '../../../scripts/lib/windows-dev-signing.mjs';

const DESKTOP_BINARY_NAME = process.platform === 'win32'
  ? 'nimiplatform-desktop.exe'
  : 'nimiplatform-desktop';
const DESKTOP_LAUNCH_BINARY_NAME = process.platform === 'win32'
  ? 'nimiplatform-desktop-dev-run.exe'
  : DESKTOP_BINARY_NAME;
const DESKTOP_REPLACEMENT_MARKER_NAME = '.nimiplatform-desktop-dev-run.replace.json';
const DESKTOP_SPAWN_MAX_ATTEMPTS = 8;
const DESKTOP_SHUTDOWN_GRACE_MS = 5000;
const DESKTOP_REPLACEMENT_MARKER_MAX_AGE_MS = 15000;
const PROTECTED_E2E_FEATURE = 'protected-local-e2e-fixture';
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const SIGNAL_EXIT_CODES = new Map([
  ['SIGINT', 130],
  ['SIGTERM', 143],
  ['SIGHUP', 129],
]);
const SIGNAL_FORCE_KILL_GRACE_MS = 1500;
const SIGNAL_HARD_EXIT_MS = 5000;
const childEnv = {
  ...process.env,
  CARGO_TERM_PROGRESS_WHEN: process.env.CARGO_TERM_PROGRESS_WHEN || 'never',
};
const inheritedChildStdio = process.platform === 'win32'
  ? ['ignore', 'inherit', 'inherit']
  : 'inherit';
let activeDesktopChild = null;
let shuttingDown = false;
let shutdownExitCode = null;
let signalForceKillTimer = null;
let signalHardExitTimer = null;

function runCargo(args) {
  const result = spawnSync('cargo', args, {
    cwd: process.cwd(),
    env: childEnv,
    stdio: 'inherit',
  });
  if (result.error) {
    process.stderr.write(`[tauri-dev-runner] failed to start cargo: ${result.error.message}\n`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

function splitRunArgs(args) {
  const separatorIndex = args.indexOf('--');
  if (separatorIndex === -1) {
    return { cargoArgs: args, appArgs: [] };
  }
  return {
    cargoArgs: args.slice(0, separatorIndex),
    appArgs: args.slice(separatorIndex + 1),
  };
}

function readFlagValue(args, name) {
  const prefix = `${name}=`;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === name) {
      return args[index + 1] ?? null;
    }
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
  }
  return null;
}

function cargoFeatures(args) {
  const features = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    let raw = null;
    if (arg === '--features') {
      raw = args[index + 1] ?? '';
      index += 1;
    } else if (arg.startsWith('--features=')) {
      raw = arg.slice('--features='.length);
    }
    if (raw == null) {
      continue;
    }
    for (const feature of raw.split(/[\s,]+/u).filter(Boolean)) {
      features.add(feature);
    }
  }
  return features;
}

function resolveDesktopBinary(cargoArgs) {
  const release = cargoArgs.includes('--release');
  const profile = release ? 'release' : 'debug';
  const rawTargetDir = process.env.CARGO_TARGET_DIR?.trim();
  const targetDir = rawTargetDir
    ? path.resolve(process.cwd(), rawTargetDir)
    : path.join(process.cwd(), 'target');
  const targetTriple = readFlagValue(cargoArgs, '--target');
  return targetTriple
    ? path.join(targetDir, targetTriple, profile, DESKTOP_BINARY_NAME)
    : path.join(targetDir, profile, DESKTOP_BINARY_NAME);
}

function resolveDesktopLaunchBinary(cargoBinaryPath) {
  if (process.platform !== 'win32') {
    return cargoBinaryPath;
  }
  return path.join(path.dirname(cargoBinaryPath), DESKTOP_LAUNCH_BINARY_NAME);
}

function resolveReplacementMarkerPath(launchBinaryPath) {
  if (process.platform !== 'win32') {
    return null;
  }
  return path.join(path.dirname(launchBinaryPath), DESKTOP_REPLACEMENT_MARKER_NAME);
}

function isRetryableDesktopSpawnError(error) {
  const code = String(error?.code || '').toUpperCase();
  return code === 'UNKNOWN' || code === 'EBUSY' || code === 'EACCES' || code === 'EPERM';
}

function isChildRunning(child) {
  return Boolean(child?.pid && child.exitCode === null && child.signalCode === null);
}

function forceKillProcessTree(child) {
  if (!isChildRunning(child)) {
    return;
  }
  if (process.platform === 'win32') {
    const taskkill = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    taskkill.on('error', () => {});
    taskkill.unref();
    return;
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // The child may have exited between the running check and forced cleanup.
  }
}

function requestProcessTreeShutdown(child, signal) {
  if (!isChildRunning(child)) {
    return false;
  }
  try {
    if (process.platform === 'win32') {
      if (signal !== 'SIGINT') {
        child.kill('SIGTERM');
      }
    } else {
      child.kill(signal === 'SIGINT' ? 'SIGINT' : 'SIGTERM');
    }
  } catch {
    return false;
  }
  signalForceKillTimer = setTimeout(() => {
    forceKillProcessTree(child);
  }, SIGNAL_FORCE_KILL_GRACE_MS);
  signalHardExitTimer = setTimeout(() => {
    process.exit(shutdownExitCode ?? SIGNAL_EXIT_CODES.get(signal) ?? 1);
  }, SIGNAL_HARD_EXIT_MS);
  return true;
}

function clearSignalShutdownTimers() {
  if (signalForceKillTimer) {
    clearTimeout(signalForceKillTimer);
    signalForceKillTimer = null;
  }
  if (signalHardExitTimer) {
    clearTimeout(signalHardExitTimer);
    signalHardExitTimer = null;
  }
}

function exitFromSignal(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  shutdownExitCode = SIGNAL_EXIT_CODES.get(signal) ?? 1;
  if (!requestProcessTreeShutdown(activeDesktopChild, signal)) {
    process.exit(shutdownExitCode);
  }
}

function wasReplacedByNewRunner(childPid, replacementMarkerPath) {
  if (!replacementMarkerPath || !childPid) {
    return false;
  }
  try {
    const marker = JSON.parse(readFileSync(replacementMarkerPath, 'utf8'));
    const createdAtMs = Date.parse(marker.createdAt);
    if (!Number.isFinite(createdAtMs) || Date.now() - createdAtMs > DESKTOP_REPLACEMENT_MARKER_MAX_AGE_MS) {
      return false;
    }
    return Array.isArray(marker.pids) && marker.pids.includes(childPid);
  } catch {
    return false;
  }
}

function spawnDesktopBinary(binaryPath, appArgs, options = {}, attempt = 1) {
  const child = spawn(binaryPath, appArgs, {
    cwd: process.cwd(),
    env: childEnv,
    stdio: inheritedChildStdio,
  });
  activeDesktopChild = child;
  child.on('error', (error) => {
    activeDesktopChild = null;
    clearSignalShutdownTimers();
    if (shuttingDown) {
      process.exit(shutdownExitCode ?? 1);
    }
    if (attempt < DESKTOP_SPAWN_MAX_ATTEMPTS && isRetryableDesktopSpawnError(error)) {
      const delayMs = attempt * 250;
      process.stderr.write(
        `[tauri-dev-runner] desktop binary spawn attempt ${attempt} failed (${error.code || error.message}); retrying in ${delayMs}ms\n`,
      );
      setTimeout(() => {
        spawnDesktopBinary(binaryPath, appArgs, options, attempt + 1);
      }, delayMs);
      return;
    }
    process.stderr.write(`[tauri-dev-runner] failed to start desktop binary: ${error.message}\n`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    activeDesktopChild = null;
    clearSignalShutdownTimers();
    if (process.platform === 'win32' && wasReplacedByNewRunner(child.pid, options.replacementMarkerPath)) {
      process.exit(0);
    }
    if (shuttingDown) {
      process.exit(shutdownExitCode ?? SIGNAL_EXIT_CODES.get(signal) ?? code ?? 0);
      return;
    }
    if (signal) {
      process.exit(SIGNAL_EXIT_CODES.get(signal) ?? 1);
      return;
    }
    process.exit(code ?? 0);
  });
}

function runPowerShell(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-OutputFormat', 'Text', '-EncodedCommand', encoded],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    },
  );
  if (result.error) {
    throw new Error(`failed to start powershell.exe: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`powershell.exe exited with status ${result.status ?? 'unknown'}`);
  }
}

function stopExistingWindowsDevBinary(binaryPath, options = {}) {
  const escapedBinary = binaryPath.replaceAll("'", "''");
  const escapedReplacementMarkerPath = options.replacementMarkerPath
    ? options.replacementMarkerPath.replaceAll("'", "''")
    : '';
  runPowerShell(`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$BinaryPath = [System.IO.Path]::GetFullPath('${escapedBinary}')
$ReplacementMarkerPath = '${escapedReplacementMarkerPath}'
$BinaryName = [System.IO.Path]::GetFileName($BinaryPath).Replace("'", "''")
function Get-TargetProcesses {
  @(Get-CimInstance Win32_Process -Filter "Name = '$BinaryName'" |
    Where-Object {
      $_.ExecutablePath -and ([System.IO.Path]::GetFullPath($_.ExecutablePath) -ieq $BinaryPath)
    })
}
$Processes = @(Get-TargetProcesses)
if ($Processes.Count -eq 0) {
  return
}
if (-not [string]::IsNullOrWhiteSpace($ReplacementMarkerPath)) {
  $Marker = [pscustomobject]@{
    reason = 'replace-dev-run'
    binaryPath = $BinaryPath
    pids = @($Processes | ForEach-Object { $_.ProcessId })
    createdAt = (Get-Date).ToUniversalTime().ToString('o')
  }
  $Marker | ConvertTo-Json -Compress | Set-Content -LiteralPath $ReplacementMarkerPath -Encoding UTF8
}
foreach ($ProcessInfo in $Processes) {
  & taskkill.exe /pid $ProcessInfo.ProcessId /t /f | Out-Null
  if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 128) {
    throw "taskkill failed for stale dev binary PID $($ProcessInfo.ProcessId) with exit code $LASTEXITCODE"
  }
  [Console]::Out.WriteLine("[tauri-dev-runner] stopped stale dev binary process $($ProcessInfo.ProcessId) for $BinaryPath")
}
$Deadline = (Get-Date).AddMilliseconds(${DESKTOP_SHUTDOWN_GRACE_MS})
while ((Get-Date) -lt $Deadline) {
  $Remaining = @(Get-TargetProcesses)
  if ($Remaining.Count -eq 0) {
    return
  }
  Start-Sleep -Milliseconds 100
}
$RemainingIds = (@(Get-TargetProcesses) | ForEach-Object { $_.ProcessId }) -join ', '
throw "stale dev binary process still running for \${BinaryPath}: $RemainingIds"
`);
}

const rawArgs = process.argv.slice(2);
if (process.platform !== 'win32' || rawArgs[0] !== 'run') {
  runCargo(rawArgs);
}

for (const signal of SIGNAL_EXIT_CODES.keys()) {
  process.on(signal, () => exitFromSignal(signal));
}

const { cargoArgs, appArgs } = splitRunArgs(rawArgs.slice(1));
const protectedE2E = cargoFeatures(cargoArgs).has(PROTECTED_E2E_FEATURE);
if (protectedE2E && !SHA256_PATTERN.test(String(childEnv.NIMI_WINDOWS_E2E_SIGNER_CERT_SHA256 || ''))) {
  process.stderr.write('[tauri-dev-runner] protected-local-e2e-fixture requires the fixed build-time signer identity\n');
  process.exit(1);
}
const binaryPath = resolveDesktopBinary(cargoArgs);
const launchBinaryPath = resolveDesktopLaunchBinary(binaryPath);
const replacementMarkerPath = resolveReplacementMarkerPath(launchBinaryPath);
try {
  stopExistingWindowsDevBinary(binaryPath);
} catch (error) {
  process.stderr.write(`[tauri-dev-runner] failed to stop stale Windows dev binary: ${String(error?.message ?? error)}\n`);
  process.exit(1);
}

const buildArgs = ['build', '--quiet', ...cargoArgs];
const buildResult = spawnSync('cargo', buildArgs, {
  cwd: process.cwd(),
  env: childEnv,
  stdio: 'inherit',
});
if (buildResult.error) {
  process.stderr.write(`[tauri-dev-runner] failed to start cargo build: ${buildResult.error.message}\n`);
  process.exit(1);
}
if (buildResult.status !== 0) {
  process.exit(buildResult.status ?? 1);
}

try {
  stopExistingWindowsDevBinary(launchBinaryPath, { replacementMarkerPath });
  copyFileSync(binaryPath, launchBinaryPath);
  if (protectedE2E) {
    signWindowsDevFiles([launchBinaryPath], { cwd: process.cwd(), env: childEnv });
  }
} catch (error) {
  process.stderr.write(`[tauri-dev-runner] failed to prepare Windows dev binary: ${String(error?.message ?? error)}\n`);
  process.exit(1);
}

spawnDesktopBinary(launchBinaryPath, appArgs, { replacementMarkerPath });
