#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  requireWindowsDevSigningIdentity,
  signWindowsDevFiles,
} from './lib/windows-dev-signing.mjs';
import {
  assertRuntimeBuildSourceUnchanged,
  captureRuntimeBuildSource,
  createRuntimeBuildRecord,
  fileSha256,
  WINDOWS_RUNTIME_BUILD_SOURCE_PATHS,
} from './lib/runtime-build-record.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const runtimeDir = path.join(repoRoot, 'runtime');
const distDir = path.join(repoRoot, 'dist');
const binaryName = process.platform === 'win32' ? 'nimi.exe' : 'nimi';
const outputPath = path.join(distDir, binaryName);
const buildRecordPath = path.join(distDir, 'nimi-build-record.json');
const buildArguments = process.argv.slice(2);
if (buildArguments.length > 0) {
  throw new Error(`Unsupported Runtime build arguments: ${buildArguments.join(', ')}`);
}
const buildSource = process.platform === 'win32'
  ? captureRuntimeBuildSource(repoRoot, { pathspecs: WINDOWS_RUNTIME_BUILD_SOURCE_PATHS })
  : null;

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

mkdirSync(distDir, { recursive: true });
try {
  assertWindowsRuntimeBinaryNotRunning(outputPath);
} catch (error) {
  process.stderr.write(`[build-runtime] cannot rebuild runtime binary: ${String(error?.message ?? error)}\n`);
  process.exit(1);
}

let windowsSignerIdentity = null;
try {
  if (process.platform === 'win32') {
    windowsSignerIdentity = requireWindowsDevSigningIdentity({ cwd: repoRoot });
  }
} catch (error) {
  process.stderr.write(`[build-runtime] Windows signer identity unavailable: ${String(error?.message ?? error)}\n`);
  process.exit(1);
}

const goBuildArguments = ['build'];
if (windowsSignerIdentity) {
  goBuildArguments.push(
    '-ldflags',
    `-X github.com/nimiplatform/nimi/runtime/internal/protectedlocal.WindowsProductionSignerCertSHA256=${windowsSignerIdentity.certificateSha256}`,
  );
}
goBuildArguments.push('-o', outputPath, './cmd/nimi');

const result = spawnSync('go', goBuildArguments, {
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
  if (process.platform === 'win32') {
    const payload = signWindowsDevFiles([outputPath], { cwd: repoRoot });
    if (payload.certificateSha256 !== windowsSignerIdentity.certificateSha256) {
      throw new Error('build-time Runtime signer identity changed before signing');
    }
    assertRuntimeBuildSourceUnchanged(buildSource, repoRoot, { pathspecs: WINDOWS_RUNTIME_BUILD_SOURCE_PATHS });
    const buildRecord = createRuntimeBuildRecord({
      source: buildSource,
      runtimeBinarySha256: fileSha256(outputPath),
      signerCertificateSha256: payload.certificateSha256,
    });
    writeFileSync(buildRecordPath, `${JSON.stringify(buildRecord, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    process.stdout.write(`[build-runtime] signed ${path.relative(repoRoot, outputPath)} with ${payload.thumbprint}\n`);
    process.stdout.write(`[build-runtime] bound ${buildRecord.candidateId} to source ${buildSource.dirtyDescriptorSha256}\n`);
  }
} catch (error) {
  process.stderr.write(`[build-runtime] failed to sign ${path.relative(repoRoot, outputPath)}: ${String(error?.message ?? error)}\n`);
  process.exit(1);
}

process.stdout.write(`[build-runtime] built ${path.relative(repoRoot, outputPath)}\n`);
