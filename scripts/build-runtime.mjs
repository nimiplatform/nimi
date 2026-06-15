#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const runtimeDir = path.join(repoRoot, 'runtime');
const distDir = path.join(repoRoot, 'dist');
const binaryName = process.platform === 'win32' ? 'nimi.exe' : 'nimi';
const outputPath = path.join(distDir, binaryName);
const devOutputPath = process.platform === 'win32' ? path.join(distDir, 'nimi-dev.exe') : null;
const windowsDevCertSubject = 'CN=Nimi Local Development Code Signing';

function runPowerShell(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-OutputFormat', 'Text', '-EncodedCommand', encoded],
    {
      cwd: repoRoot,
      env: process.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  if (result.error) {
    throw new Error(`failed to start powershell.exe: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join('\n');
    throw new Error(`powershell.exe exited with status ${result.status ?? 'unknown'}${detail ? `\n${detail}` : ''}`);
  }
  return String(result.stdout || '').trim();
}

function signWindowsDevBinary(binaryPath) {
  if (process.platform !== 'win32') {
    return;
  }
  const escapedBinary = binaryPath.replaceAll("'", "''");
  const escapedSubject = windowsDevCertSubject.replaceAll("'", "''");
  const output = runPowerShell(`
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
    [Console]::Out.WriteLine($Cert.Thumbprint)
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
  process.stdout.write(`[build-runtime] signed ${path.relative(repoRoot, binaryPath)} with ${output}\n`);
}

mkdirSync(distDir, { recursive: true });

const result = spawnSync('go', ['build', '-o', outputPath, './cmd/nimi'], {
  cwd: runtimeDir,
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  process.stderr.write(`[build-runtime] failed to start go build: ${result.error.message}\n`);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const signTargets = [outputPath];
if (devOutputPath && existsSync(devOutputPath)) {
  signTargets.push(devOutputPath);
}
for (const targetPath of signTargets) {
  try {
    signWindowsDevBinary(targetPath);
  } catch (error) {
    process.stderr.write(`[build-runtime] failed to sign ${path.relative(repoRoot, targetPath)}: ${String(error?.message ?? error)}\n`);
    process.exit(1);
  }
}

process.stdout.write(`[build-runtime] built ${path.relative(repoRoot, outputPath)}\n`);
