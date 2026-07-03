#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const runtimeDir = path.join(repoRoot, 'runtime');
const distDir = path.join(repoRoot, 'dist');
const binaryName = process.platform === 'win32' ? 'nimi.exe' : 'nimi';
const outputPath = path.join(distDir, binaryName);
const windowsDevSigningScript = path.join(repoRoot, 'scripts', 'lib', 'windows-dev-signing.ps1');

function powerShellSingleQuoted(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function findWindowsRuntimeBinaryOwners(binaryPath) {
  if (process.platform !== 'win32') {
    return [];
  }
  const command = [
    `$target = [System.IO.Path]::GetFullPath(${powerShellSingleQuoted(binaryPath)})`,
    '$owners = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -and ([System.IO.Path]::GetFullPath($_.ExecutablePath) -ieq $target) } | ForEach-Object { [pscustomobject]@{ processId = $_.ProcessId; commandLine = $_.CommandLine } })',
    'ConvertTo-Json -Compress -InputObject @($owners)',
  ].join('; ');
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
    {
      cwd: repoRoot,
      env: process.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  if (result.error || result.status !== 0) {
    return [];
  }
  const output = String(result.stdout || '').trim();
  if (!output) {
    return [];
  }
  try {
    const parsed = JSON.parse(output);
    return (Array.isArray(parsed) ? parsed : [parsed]).filter((owner) => owner && owner.processId);
  } catch {
    return [];
  }
}

function assertWindowsRuntimeBinaryNotRunning(binaryPath) {
  const owners = findWindowsRuntimeBinaryOwners(binaryPath);
  if (owners.length === 0) {
    return;
  }
  const ownerSummary = owners
    .map((owner) => `pid ${owner.processId}`)
    .join(', ');
  const relativeBinaryPath = path.relative(repoRoot, binaryPath);
  throw new Error(
    [
      `${relativeBinaryPath} is currently running (${ownerSummary}), so Windows will not allow it to be rebuilt or signed.`,
      `Stop the running runtime first with \`.\\${relativeBinaryPath} stop --force\` or close the previous \`pnpm dev:runtime\` terminal, then rebuild.`,
    ].join(' '),
  );
}

function signWindowsDevBinary(binaryPath) {
  if (process.platform !== 'win32') {
    return;
  }
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      windowsDevSigningScript,
      '-Mode',
      'Sign',
      '-Path',
      binaryPath,
      '-Json',
    ],
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
    throw new Error(
      [
        `powershell.exe exited with status ${result.status ?? 'unknown'}`,
        detail,
        'Run `pnpm provision:windows-dev-trust` once before building Windows runtime binaries.',
      ].filter(Boolean).join('\n'),
    );
  }
  const payload = JSON.parse(String(result.stdout || '{}'));
  process.stdout.write(`[build-runtime] signed ${path.relative(repoRoot, binaryPath)} with ${payload.thumbprint}\n`);
}

mkdirSync(distDir, { recursive: true });
try {
  assertWindowsRuntimeBinaryNotRunning(outputPath);
} catch (error) {
  process.stderr.write(`[build-runtime] cannot rebuild runtime binary: ${String(error?.message ?? error)}\n`);
  process.exit(1);
}

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

try {
  assertWindowsRuntimeBinaryNotRunning(outputPath);
  signWindowsDevBinary(outputPath);
} catch (error) {
  process.stderr.write(`[build-runtime] failed to sign ${path.relative(repoRoot, outputPath)}: ${String(error?.message ?? error)}\n`);
  process.exit(1);
}

process.stdout.write(`[build-runtime] built ${path.relative(repoRoot, outputPath)}\n`);
