#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

const DESKTOP_BINARY_NAME = process.platform === 'win32'
  ? 'nimiplatform-desktop.exe'
  : 'nimiplatform-desktop';
const DEV_CERT_SUBJECT = 'CN=Nimi Local Development Code Signing';
const DESKTOP_SPAWN_MAX_ATTEMPTS = 8;
const childEnv = {
  ...process.env,
  CARGO_TERM_PROGRESS_WHEN: process.env.CARGO_TERM_PROGRESS_WHEN || 'never',
};

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

function isRetryableDesktopSpawnError(error) {
  const code = String(error?.code || '').toUpperCase();
  return code === 'UNKNOWN' || code === 'EBUSY' || code === 'EACCES' || code === 'EPERM';
}

function spawnDesktopBinary(binaryPath, appArgs, attempt = 1) {
  const child = spawn(binaryPath, appArgs, {
    cwd: process.cwd(),
    env: childEnv,
    stdio: 'inherit',
  });
  child.on('error', (error) => {
    if (attempt < DESKTOP_SPAWN_MAX_ATTEMPTS && isRetryableDesktopSpawnError(error)) {
      const delayMs = attempt * 250;
      process.stderr.write(
        `[tauri-dev-runner] desktop binary spawn attempt ${attempt} failed (${error.code || error.message}); retrying in ${delayMs}ms\n`,
      );
      setTimeout(() => {
        spawnDesktopBinary(binaryPath, appArgs, attempt + 1);
      }, delayMs);
      return;
    }
    process.stderr.write(`[tauri-dev-runner] failed to start desktop binary: ${error.message}\n`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
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

function signWindowsDevBinary(binaryPath) {
  const escapedBinary = binaryPath.replaceAll("'", "''");
  const escapedSubject = DEV_CERT_SUBJECT.replaceAll("'", "''");
  runPowerShell(`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Subject = '${escapedSubject}'
$BinaryPath = '${escapedBinary}'
$Cert = Get-ChildItem Cert:\\CurrentUser\\My\\ -CodeSigningCert |
  Where-Object { $_.Subject -eq $Subject } |
  Sort-Object NotAfter -Descending |
  Select-Object -First 1
if (-not $Cert) {
  $Cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $Subject -KeyUsage DigitalSignature -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -CertStoreLocation Cert:\\CurrentUser\\My -NotAfter (Get-Date).AddYears(2)
}
$TrustedPublisher = Get-ChildItem Cert:\\CurrentUser\\TrustedPublisher\\ |
  Where-Object { $_.Thumbprint -eq $Cert.Thumbprint } |
  Select-Object -First 1
if (-not $TrustedPublisher) {
  $CertPath = Join-Path $env:TEMP "nimi-dev-code-signing-$($Cert.Thumbprint).cer"
  Export-Certificate -Cert $Cert -FilePath $CertPath -Force | Out-Null
  certutil.exe -user -addstore TrustedPublisher $CertPath | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "certutil TrustedPublisher import failed with exit code $LASTEXITCODE"
  }
}
$LastError = $null
for ($Attempt = 1; $Attempt -le 12; $Attempt++) {
  try {
    $Signature = Set-AuthenticodeSignature -FilePath $BinaryPath -Certificate $Cert -HashAlgorithm SHA256
    if (-not $Signature.SignerCertificate) {
      throw "Set-AuthenticodeSignature did not attach a signer certificate"
    }
    [Console]::Out.WriteLine("[tauri-dev-runner] signed $BinaryPath with $($Cert.Thumbprint)")
    return
  } catch {
    $LastError = $_
    Start-Sleep -Milliseconds 250
  }
}
if ($null -ne $LastError) {
  [Console]::Error.WriteLine($LastError.Exception.Message)
}
exit 1
`);
}

const rawArgs = process.argv.slice(2);
if (process.platform !== 'win32' || rawArgs[0] !== 'run') {
  runCargo(rawArgs);
}

const { cargoArgs, appArgs } = splitRunArgs(rawArgs.slice(1));
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

const binaryPath = resolveDesktopBinary(cargoArgs);
try {
  signWindowsDevBinary(binaryPath);
} catch (error) {
  process.stderr.write(`[tauri-dev-runner] failed to sign Windows dev binary: ${String(error?.message ?? error)}\n`);
  process.exit(1);
}

spawnDesktopBinary(binaryPath, appArgs);
